'use strict';
/*
 * main.js - vr-hud-turn: the turn indicators as arrows on the HUD of a BMW with an MGU (iDrive 7), drawn by
 * cluster-render. A root service (vr-hud-turn.service), Node 8. Reads the car only: SOME/IP subscriptions.
 *
 *   de.bmw.body.Light StatusFunctionsIndicators   -> the direction, sent on change
 *   de.bmw.body.Light StatusFunctionsIndicators2  -> the direction, and sent at every flash start: re-syncs the flash
 *   (the direction also comes from the car's own flashing: driver assistance, hazard after emergency braking, signal.js)
 *   blinker.js -> lit or not now -> hud.js -> cluster-render's `hud` target, shown only during a turn
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

const LIGHT = 'de.bmw.body.Light';
const RETRY_MS = 30000;
const BOOT_RETRY_MS = 60000;
const PATHS = {
    config: '/var/opt/vr-hud-turn/config.json',
    events: '/var/opt/vr-hud-turn/log/events.log',
    catalog: '/etc/oap/someip/someip-interfaces.json',
    someipDir: '/run/vr-hud-turn/someip',
    client: '/var/opt/cluster-render/current/cluster_render_client.js',
    binding: '/usr/lib/someip.node',
};

/* deps: { cfg, client, someip, now, setTimeout, clearTimeout, log }; resolves once the subscription was tried */
async function run(deps) {
    const cfg = deps.cfg, log = deps.log, now = deps.now;
    const blinker = createBlinker(cfg);
    const hud = createHud(deps.client, shader(cfg), log, { setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout });
    const lastRaw = {};
    let timer = null, staleTimer = null;
    // flash starts this turn: an Indicators2 event at least half a cycle after the last one (or the turn's start). Only a
    // car that sends them (X6 G06: one every 640 ms) can be judged stale; one that sends on change only (X5 G05) cannot.
    let lastFlash = 0, flashStarts = false;

    function update() {
        const t = now();
        hud.show(blinker.state(t));
        hud.setActive(blinker.direction() !== 'none' || cfg.test_pattern);
        if (timer !== null) deps.clearTimeout(timer);
        timer = null;
        const next = blinker.nextChange(t);
        if (next !== null) timer = deps.setTimeout(() => { timer = null; update(); }, Math.max(0, next - t));
    }

    function setDirection(dir, why) {
        const t = now();
        if (dir === blinker.direction()) return;
        blinker.setDirection(dir, t);
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
        }
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

    function watch() {
        return deps.someip.watch(LIGHT, '1', {
            StatusFunctionsIndicators: (p) => onLight('StatusFunctionsIndicators', p),
            StatusFunctionsIndicators2: (p) => onLight('StatusFunctionsIndicators2', p),
        }, onAvailability).then((res) => {
            if (res.error) {
                log(LIGHT + ': ' + res.error + ', again in ' + RETRY_MS / 1000 + ' s');
                deps.setTimeout(() => { watch(); }, RETRY_MS);
            }
            return res;
        });
    }

    log('vr-hud-turn: ' + JSON.stringify(cfg));
    hud.start();
    update();
    await watch();
    return { onLight, onAvailability };
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

function main() {
    const fs = require('fs');
    const events = createEventLog(PATHS.events, 256 * 1024, fs, Date.now);
    const log = (line) => { console.log(line); events.write(line); };
    const loaded = config.load(PATHS.config, fs.readFileSync);
    if (loaded.warning) log(loaded.warning);
    boot({
        log, setTimeout,
        requireClient: () => require(process.env.CLUSTER_RENDER_CLIENT || PATHS.client).ClusterRender,
        requireBinding: () => require(process.env.SOMEIP_NODE || PATHS.binding),
        generate: () => oapgen.generate(PATHS.catalog, PATHS.someipDir, {
            readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, mkdirSync: fs.mkdirSync,
            existsSync: fs.existsSync, generator: oapgen.loadGenerator(process.env.OAP_APPMGMT || oapgen.APPMGMT, fs.readFileSync),
        }),
        start: (ClusterRender, binding) => {
            const client = new ClusterRender('vr-hud-turn');
            process.on('SIGTERM', () => { client.close(); process.exit(0); });
            return run({
                cfg: loaded.config, client, someip: createSomeip(binding, PATHS.someipDir, fs.readFileSync, log),
                now: monotonicMs, setTimeout, clearTimeout, log,
            });
        },
    });
}

if (require.main === module) main();
module.exports = { run, boot, PATHS };
