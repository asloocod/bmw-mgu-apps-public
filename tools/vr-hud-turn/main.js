'use strict';
/*
 * main.js - vr-hud-turn: the turn indicators as arrows on the HUD of a BMW with an MGU (iDrive 7), drawn by
 * cluster-render. A root service (vr-hud-turn.service), Node 8. Reads the car only: SOME/IP subscriptions.
 *
 *   de.bmw.body.Light StatusFunctionsIndicators   -> the direction, sent on change
 *   de.bmw.body.Light StatusFunctionsIndicators2  -> the direction, and sent at every flash start: re-syncs the flash
 *   (the direction also comes from the car's own flashing: driver assistance, hazard after emergency braking, signal.js)
 *   blinker.js -> lit or not now -> hud.js -> cluster-render's `hud` target, shown only during a turn
 *   de.bmw.infotainment.drivingexcitement.FES statusFESVehicleDynamicSwitchHMI -> Sport or not: the arrows' height
 *   the vr_hud_turn app (iDrive) -> its offsets (appsettings.js); "show" on its socket (control.js) lights both arrows
 *   de.bmw.infotainment.vehicle.Vehicle2 statusCarSpeed2 -> "show" only while (nearly) standing
 *   the app's "rec start / stop" -> every event into record.log (recorder.js); "share" -> a page on the car's hotspot
 *   to take the log to a phone (share.js)
 *
 * A value that says nothing (unfilled, error) changes nothing; no valid event for stale_ms during a turn, or the
 * provider gone, ends it. Raw values are logged when they change.
 * Settings: /var/opt/vr-hud-turn/config.json (config.js). Log: journalctl -u vr-hud-turn, and the same lines in
 * /var/opt/vr-hud-turn/log/events.log (+ .1), which outlive the journal's few minutes.
 */
const config = require('./config');
const signal = require('./signal');
const { createBlinker } = require('./blinker');
const { shader } = require('./arrow');
const { createHud } = require('./hud');
const { createSomeip } = require('./someip');
const oapgen = require('./oapgen');
const { createEventLog } = require('./eventlog');
const mode = require('./mode');
const appsettings = require('./appsettings');
const control = require('./control');
const { createRecorder } = require('./recorder');
const { createShare } = require('./share');

const VERSION = '0.2.2';

const LIGHT = 'de.bmw.body.Light';
const FES = 'de.bmw.infotainment.drivingexcitement.FES';
const V2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const APP_RETRY_MS = 60000;
/* the log page on the car's hotspot: the interface and the way of the Store's phone page (its port 8470, ours 8471) */
const SHARE = { port: 8471, iface: 'wlan_bridge', open_ms: 10 * 60 * 1000 };
const RETRY_MS = 30000;
const BOOT_RETRY_MS = 60000;
const PATHS = {
    config: '/var/opt/vr-hud-turn/config.json',
    events: '/var/opt/vr-hud-turn/log/events.log',
    record: '/var/opt/vr-hud-turn/log/record.log',
    catalog: '/etc/oap/someip/someip-interfaces.json',
    someipDir: '/run/vr-hud-turn/someip',
    sock: '/run/vr-hud-turn/ctl.sock',
    client: '/var/opt/cluster-render/current/cluster_render_client.js',
    binding: '/usr/lib/someip.node',
};

/* deps: { cfg, client, someip, now, setTimeout, clearTimeout, log, appSettings() -> the app's offsets (optional),
 * listen(handle) -> the app's socket (optional), recorder (recorder.js, optional), share (share.js, optional) };
 * resolves once the subscriptions were tried */
async function run(deps) {
    const cfg = deps.cfg, log = deps.log, now = deps.now;
    const recorder = deps.recorder || null;
    /* a line for the recording only (log() lines reach it too) */
    const trace = (line) => { if (recorder) recorder.write(line); };
    const blinker = createBlinker(cfg);
    const hud = createHud(deps.client, shader(), log, { setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout });
    const readApp = () => (deps.appSettings ? deps.appSettings() : {});
    const lastRaw = {};
    let timer = null, staleTimer = null;
    let driveMode = null, speedKmh = null, app = readApp(), lastPlace = '';
    // "show" from the app: both arrows until showUntil, at showWhich's height ('sport' | 'normal', null: the mode now)
    let showUntil = 0, showWhich = null;
    const showing = (t) => t < showUntil && blinker.direction() === 'none';

    function place(t) {
        const p = config.placement(cfg, showing(t) && showWhich ? showWhich : driveMode, app);
        const rgb = config.look(cfg, app);
        const text = 'y ' + p.y + ' margin ' + p.margin + ' size ' + p.size + ' color ' + rgb.join(',');
        if (text !== lastPlace) {
            lastPlace = text;
            log('place ' + text + ' (' + (driveMode || 'mode unknown') + ')');
        }
        hud.setGeometry(p);
        hud.setColor(rgb);
    }
    // flash starts this turn: an Indicators2 event at least half a cycle after the last one (or the turn's start). Only a
    // car that sends them (X6 G06: one every 640 ms) can be judged stale; one that sends on change only (X5 G05) cannot.
    let lastFlash = 0, flashStarts = false;

    function update() {
        const t = now();
        const show = showing(t);
        place(t);
        hud.show(show ? { left: true, right: true } : blinker.state(t));
        hud.setActive(blinker.direction() !== 'none' || cfg.test_pattern || show);
        if (timer !== null) deps.clearTimeout(timer);
        timer = null;
        let next = blinker.nextChange(t);
        if (show && (next === null || next > showUntil)) next = showUntil;
        if (next !== null) timer = deps.setTimeout(() => { timer = null; update(); }, Math.max(0, next - t));
    }

    function setDirection(dir, why) {
        const t = now();
        if (dir === blinker.direction()) return;
        blinker.setDirection(dir, t);
        if (dir !== 'none') showUntil = 0;      // a turn ends a "show"
        lastFlash = t;
        flashStarts = false;
        log('direction ' + dir + ' at ' + Math.round(t) + (why ? ' (' + why + ')' : ''));
    }

    /* a valid event during a turn holds it for stale_ms more, on a car seen sending flash starts this turn */
    function armStale() {
        if (staleTimer !== null) deps.clearTimeout(staleTimer);
        staleTimer = null;
        if (!cfg.stale_ms || !flashStarts || blinker.direction() === 'none') return;
        staleTimer = deps.setTimeout(() => {
            staleTimer = null;
            setDirection('none', 'stale: no indicator event for ' + cfg.stale_ms + ' ms');
            update();
        }, cfg.stale_ms);
    }

    function onLight(field, payload) {
        const t = now();
        let raw;
        try { raw = JSON.stringify(payload); } catch (e) { raw = String(payload); }
        if (lastRaw[field] !== raw) {
            lastRaw[field] = raw;
            log('Light.' + field + ' ' + raw + ' at ' + Math.round(t));
        } else trace('Light.' + field + ' ' + raw + ' at ' + Math.round(t));
        const dir = signal.decode(payload);
        if (dir === null) return;
        setDirection(dir);
        if (field === 'StatusFunctionsIndicators2' && dir !== 'none' && t - lastFlash >= cfg.period_ms / 2) {
            lastFlash = t;
            flashStarts = true;
            if (cfg.phase === 'light2') blinker.cycle(t);
        }
        armStale();
        update();
    }

    function onAvailability(available) {
        if (available) return;
        setDirection('none', 'provider gone');
        armStale();
        update();
    }

    function onMode(payload) {
        let raw;
        try { raw = JSON.stringify(payload); } catch (e) { raw = String(payload); }
        if (lastRaw.mode !== raw) {
            lastRaw.mode = raw;
            log('FES.statusFESVehicleDynamicSwitchHMI ' + raw);
        } else trace('FES.statusFESVehicleDynamicSwitchHMI ' + raw);
        const m = mode.decode(payload);
        if (m === null || m === driveMode) return;
        driveMode = m;
        update();
    }

    /* km/h, or null: no signal (65535: not available) */
    function onSpeed(payload) {
        const v = payload !== null && typeof payload === 'object' ? payload.speedVehicleCentreOfGravity : payload;
        const before = speedKmh === null ? null : Math.round(speedKmh);
        speedKmh = typeof v === 'number' && isFinite(v) && v >= 0 && v < 65535 ? v * 0.015625 : null;
        const after = speedKmh === null ? null : Math.round(speedKmh);
        if (after !== before) trace('speed ' + (after === null ? 'none' : after + ' km/h') + ' at ' + Math.round(now()));
    }

    /* the app's recording buttons */
    function rec(cmd) {
        if (!recorder) return { on: false, sec: 0, bytes: 0 };
        if (cmd === 'start') {
            recorder.start(['vr-hud-turn ' + VERSION, 'config ' + JSON.stringify(cfg), 'app settings ' + JSON.stringify(app),
                'mode ' + (driveMode || 'unknown') + ', direction ' + blinker.direction() + ', place ' + lastPlace]);
            log('recording started');
        } else if (cmd === 'stop') recorder.stop('button');
        return recorder.status();
    }

    /* the app's "show": the arrows lit for show_ms; returns the mode they are shown for */
    function show(which) {
        showWhich = which;
        showUntil = now() + cfg.show_ms;
        const shown = which || driveMode || 'normal';
        log('show ' + shown + ' for ' + cfg.show_ms + ' ms');
        update();
        return shown;
    }
    function reload() {
        app = readApp();
        log('app settings ' + JSON.stringify(app));
        update();
    }

    function watch(iface, handlers, onAvail) {
        return deps.someip.watch(iface, '1', handlers, onAvail).then((res) => {
            if (res.error) {
                log(iface + ': ' + res.error + ', again in ' + RETRY_MS / 1000 + ' s');
                deps.setTimeout(() => { watch(iface, handlers, onAvail); }, RETRY_MS);
            }
            return res;
        });
    }

    log('vr-hud-turn: ' + JSON.stringify(cfg));
    log('app settings ' + JSON.stringify(app));
    hud.start();
    update();
    const handle = control.createHandler(cfg, { speedKmh: () => speedKmh, reload, show, rec,
        share: deps.share ? () => deps.share.open() : null });
    if (deps.listen) deps.listen((line) => handle(line).then((reply) => { log('app: ' + line + ' -> ' + reply); return reply; }));
    await watch(LIGHT, {
        StatusFunctionsIndicators: (p) => onLight('StatusFunctionsIndicators', p),
        StatusFunctionsIndicators2: (p) => onLight('StatusFunctionsIndicators2', p),
    }, onAvailability);
    await watch(FES, { statusFESVehicleDynamicSwitchHMI: onMode });     // gone: the last mode stays
    await watch(V2, { statusCarSpeed2: onSpeed }, (a) => { if (!a) speedKmh = null; });
    return { onLight, onAvailability, onMode, onSpeed, handle };
}

/* Start, trying again in this process every BOOT_RETRY_MS while something it needs is missing (cluster-render's
 * client, the SOME/IP binding, MainApp's generator): no restart loop. The cheap requires go first.
 * d: { requireClient, requireBinding, generate, start(ClusterRender, binding), log, setTimeout } */
function boot(d) {
    let ClusterRender, binding;
    try {
        ClusterRender = d.requireClient();
        binding = d.requireBinding();
        d.generate();
    } catch (e) {
        d.log('vr-hud-turn: cannot start yet: ' + String(e && e.message ? e.message : e).split('\n')[0] +
            ', again in ' + BOOT_RETRY_MS / 1000 + ' s');
        d.setTimeout(() => boot(d), BOOT_RETRY_MS);
        return;
    }
    Promise.resolve(d.start(ClusterRender, binding)).catch((e) => d.log('vr-hud-turn: ' + (e && e.stack ? e.stack : e)));
}

/* a monotonic clock in ms: the unit sets its wall clock after boot */
function monotonicMs() {
    const h = process.hrtime();
    return h[0] * 1e3 + h[1] / 1e6;
}

/* the recording and events.log as one text, for the phone */
function logText(fs) {
    const part = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return '(none)\n'; } };
    return 'vr-hud-turn ' + VERSION + ' log, ' + new Date().toISOString() + '\n\n== record.log ==\n' + part(PATHS.record) +
        '\n== events.log.1 ==\n' + part(PATHS.events + '.1') + '\n== events.log ==\n' + part(PATHS.events);
}

/* the IPv4 address of a network interface, or null */
function ifaceAddr(name) {
    const list = require('os').networkInterfaces()[name] || [];
    const a = list.filter((x) => x.family === 'IPv4' && !x.internal)[0];
    return a ? a.address : null;
}

/* the app's socket, owned by the app's group; an app installed later is found every APP_RETRY_MS and given the socket */
function listenForApp(handle, findApp, log) {
    const fs = require('fs'), net = require('net');
    const app = findApp();
    if (!app) log('app ' + appsettings.APP_ID + ' not installed: its socket is root only for now');
    control.listen(PATHS.sock, app ? app.gid : null, handle, { net, fs }).then(() => {
        if (app) return;
        const retry = setInterval(() => {
            const a = findApp();
            if (!a) return;
            clearInterval(retry);
            try {
                fs.chownSync(PATHS.sock, 0, a.gid);
                log('app ' + appsettings.APP_ID + ' found: socket for its group ' + a.gid);
            } catch (e) { log('socket chown: ' + e); }
        }, APP_RETRY_MS);
    }, (e) => log('socket: ' + e));
}

function main() {
    const fs = require('fs');
    const events = createEventLog(PATHS.events, 256 * 1024, fs, Date.now);
    const recorder = createRecorder(PATHS.record, fs, Date.now, { maxBytes: 2 * 1024 * 1024, maxMs: 30 * 60 * 1000 });
    const log = (line) => { console.log(line); events.write(line); recorder.write(line); };
    const loaded = config.load(PATHS.config, fs.readFileSync);
    if (loaded.warning) log(loaded.warning);
    boot({
        log, setTimeout,
        requireClient: () => require(process.env.CLUSTER_RENDER_CLIENT || PATHS.client).ClusterRender,
        requireBinding: () => require(process.env.SOMEIP_NODE || PATHS.binding),
        generate: () => oapgen.generate(PATHS.catalog, PATHS.someipDir, {
            readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, mkdirSync: fs.mkdirSync,
            existsSync: fs.existsSync, log, generator: oapgen.loadGenerator(process.env.OAP_APPMGMT || oapgen.APPMGMT, fs.readFileSync),
        }),
        start: (ClusterRender, binding) => {
            const client = new ClusterRender('vr-hud-turn');
            process.on('SIGTERM', () => { client.close(); process.exit(0); });
            const findApp = () => appsettings.findApp(appsettings.OAP_ROOT, appsettings.APP_ID, fs);
            return run({
                cfg: loaded.config, client, someip: createSomeip(binding, PATHS.someipDir, fs.readFileSync, log),
                now: monotonicMs, setTimeout, clearTimeout, log,
                appSettings: () => { const a = findApp(); return appsettings.read(a ? a.dir : null, fs); },
                listen: (handle) => listenForApp(handle, findApp, log),
                recorder,
                share: createShare(SHARE, {
                    http: require('http'), ifaceAddr, logText: () => logText(fs), log, setTimeout, clearTimeout,
                    code: () => require('crypto').randomBytes(4).toString('hex'),
                    nft: (args) => new Promise((resolve, reject) => require('child_process').execFile('nft', args,
                        { timeout: 15000, maxBuffer: 4 << 20 }, (err, out, errText) => (err ? reject(new Error('nft ' + args.join(' ') + ': ' +
                            String(errText || err.message).trim())) : resolve(out)))),
                }),
            });
        },
    });
}

if (require.main === module) main();
module.exports = { run, boot, PATHS, VERSION };
