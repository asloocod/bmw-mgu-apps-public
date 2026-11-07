'use strict';
/*
 * main.js - vr-warmup: a blue thermometer on the instrument cluster of a BMW with an MGU (iDrive 7) while the engine
 * runs and its oil is still cold, drawn by cluster-render on its `panel` target. A root service (vr-warmup.service),
 * Node 8. Reads the car only: SOME/IP subscriptions.
 *
 *   de.bmw.infotainment.vehicle.CDS statusEngineTemperature            -> oil and coolant, every second
 *   de.bmw.infrastructure.VehicleInformation DataPowerTrain2CRC        -> the engine's run state, the same temperatures
 *   signal.js -> warmup.js (on or off now) -> cluster.js -> cluster-render's `panel`, only with a scene of its own
 *
 * The oil from either field; a value that says nothing (255, missing) changes nothing, and no valid one for stale_ms
 * turns the icon off. Logged on change: the icon with its reason, oil and coolant, the engine state, the DME's rev
 * limit reduction and rPMEngineMaximumAllowed (for a rev limit later; x 50 rpm assumed, after IterioDev).
 * Settings: /var/opt/vr-warmup/config.json (config.js). Log: journalctl -u vr-warmup, and the same lines in
 * /var/opt/vr-warmup/log/events.log (+ .1), which outlive the journal's few minutes.
 * VR_WARMUP_CONFIG, VR_WARMUP_EVENTS, VR_WARMUP_SOMEIP, CLUSTER_RENDER_CLIENT, SOMEIP_NODE, OAP_APPMGMT move the
 * paths, for a run by hand from /tmp.
 */
const config = require('./config');
const signal = require('./signal');
const { createWarmup } = require('./warmup');
const { createCluster } = require('./cluster');
const { createSomeip } = require('./someip');
const oapgen = require('./oapgen');
const { createEventLog } = require('./eventlog');

const CDS = 'de.bmw.infotainment.vehicle.CDS';
const VI = 'de.bmw.infrastructure.VehicleInformation';
const RETRY_MS = 30000;
const BOOT_RETRY_MS = 60000;
const env = process.env;
const PATHS = {
    config: env.VR_WARMUP_CONFIG || '/var/opt/vr-warmup/config.json',
    events: env.VR_WARMUP_EVENTS || '/var/opt/vr-warmup/log/events.log',
    catalog: '/etc/oap/someip/someip-interfaces.json',
    someipDir: env.VR_WARMUP_SOMEIP || '/run/vr-warmup/someip',
    client: env.CLUSTER_RENDER_CLIENT || '/var/opt/cluster-render/current/cluster_render_client.js',
    binding: env.SOMEIP_NODE || '/usr/lib/someip.node',
};

/* a struct member, undefined for anything that is not an object */
function member(p, name) {
    return p !== null && typeof p === 'object' ? p[name] : undefined;
}

const degrees = (c) => (c === null ? '--' : c + ' C');

/* deps: { cfg, client, someip, now, setTimeout, clearTimeout, log }; resolves once both subscriptions were tried */
async function run(deps) {
    const cfg = deps.cfg, log = deps.log, now = deps.now;
    const warmup = createWarmup(cfg);
    const cluster = createCluster(deps.client, cfg, log, { setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout });
    const said = { icon: null, temps: { cds: { oil: null, coolant: null }, powertrain: { oil: null, coolant: null } },
        engine: undefined, dme: null };
    let timer = null;

    function update() {
        const t = now();
        const st = warmup.state(t);
        cluster.setActive(st.visible);
        if (st.visible !== said.icon) {
            said.icon = st.visible;
            log('icon ' + (st.visible ? 'on' : 'off') + ' (' + st.reason + (st.oil !== null ? ', oil ' + st.oil + ' C' : '') + ')');
        }
        if (timer !== null) deps.clearTimeout(timer);
        timer = null;
        const next = warmup.nextChange(t);
        if (next !== null) timer = deps.setTimeout(() => { timer = null; update(); }, Math.max(0, next - t));
    }

    /* source 'cds' or 'powertrain': each logs its own changes (the two may differ by a degree, or one send 255),
     * and a value that says nothing keeps the last one, so a line comes only when a temperature really moved */
    function temps(p, source) {
        const oil = signal.temp(member(p, 'temperatureEngineOilDrive'));
        const coolant = signal.temp(member(p, 'temperatureEngineDrive'));
        const last = said.temps[source];
        const next = { oil: oil !== null ? oil : last.oil, coolant: coolant !== null ? coolant : last.coolant };
        if (next.oil !== last.oil || next.coolant !== last.coolant) {
            log((source === 'cds' ? '' : source + ' ') + 'oil ' + degrees(next.oil) + ' coolant ' + degrees(next.coolant));
        }
        said.temps[source] = next;
        if (oil !== null) warmup.oil(oil, now());
    }

    function engine(state) {
        warmup.engine(state);
        if (state !== said.engine) log('engine ' + (state || 'unknown'));
        said.engine = state;
    }

    function onTemperature(p) {
        temps(p, 'cds');
        update();
    }

    function onPowertrain(p) {
        temps(p, 'powertrain');
        engine(signal.engine(member(p, 'statusEngineRunDrive')));
        if (p !== null && typeof p === 'object') {
            const max = p.rPMEngineMaximumAllowed;
            const dme = 'dme reduction ' + p.reductionDownControlRPMDrive2 + ' rpm max ' + max +
                (Number.isInteger(max) && max !== 255 ? ' (x50 = ' + max * 50 + ')' : '');
            if (dme !== said.dme) log(dme);
            said.dme = dme;
        }
        update();
    }

    function onPowertrainAvailability(available) {
        if (available) return;
        engine(null);
        update();
    }

    function watch(iface, handlers, onAvailability) {
        return deps.someip.watch(iface, '1', handlers, onAvailability).then((res) => {
            if (res.error) {
                log(iface + ': ' + res.error + ', again in ' + RETRY_MS / 1000 + ' s');
                deps.setTimeout(() => { watch(iface, handlers, onAvailability); }, RETRY_MS);
            }
            return res;
        });
    }

    log('vr-warmup: ' + JSON.stringify(cfg));
    cluster.start();
    update();
    await watch(CDS, { statusEngineTemperature: onTemperature });
    await watch(VI, { DataPowerTrain2CRC: onPowertrain }, onPowertrainAvailability);
    return { onTemperature, onPowertrain };
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
        d.log('vr-warmup: cannot start yet: ' + String(e && e.message ? e.message : e).split('\n')[0] +
            ', again in ' + BOOT_RETRY_MS / 1000 + ' s');
        d.setTimeout(() => boot(d), BOOT_RETRY_MS);
        return;
    }
    Promise.resolve(d.start(ClusterRender, binding)).catch((e) => d.log('vr-warmup: ' + (e && e.stack ? e.stack : e)));
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
        requireClient: () => require(PATHS.client).ClusterRender,
        requireBinding: () => require(PATHS.binding),
        generate: () => oapgen.generate(PATHS.catalog, PATHS.someipDir, {
            readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, mkdirSync: fs.mkdirSync,
            existsSync: fs.existsSync, generator: oapgen.loadGenerator(env.OAP_APPMGMT || oapgen.APPMGMT, fs.readFileSync),
        }),
        start: (ClusterRender, binding) => {
            const client = new ClusterRender('vr-warmup');
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
