'use strict';
/*
 * someip.js - subscribe to vehicle signals over SOME/IP through the unit's native binding (/usr/lib/someip.node),
 * read only: subscribe and getValue, nothing else.
 *
 * After watch() in kit/runtime/signals.js of idrive7-apps (MIT, see LICENSE.idrive7-apps): the binding deadlocks
 * when buildProxy / init run inline next to other SOME/IP traffic, so every call into it runs in a fresh
 * setImmediate tick, one at a time. The interface configs are the ones oapgen.js generated with MainApp's own
 * generator: <configDir>/<interface, dots as underscores>.json.
 */

function createSomeip(binding, configDir, readFileSync, log) {
    let chain = Promise.resolve();
    function nativeTick(fn) {
        const run = () => new Promise((resolve, reject) => setImmediate(() => {
            try { Promise.resolve(fn()).then(resolve, reject); } catch (e) { reject(e); }
        }));
        const p = chain.then(run, run);
        chain = p.catch(() => {});
        return p;
    }

    function loadConfig(iface) {
        return JSON.parse(readFileSync(configDir + '/' + iface.replace(/\./g, '_') + '.json', 'utf8'));
    }

    /* handlers = { field: fn(value) }; onAvailability(bool), optional, on every change of the provider; resolves
     * { available, error } (error: null or a string). Fields with a getter are read whenever the provider comes. */
    async function watch(iface, instance, handlers, onAvailability) {
        const res = { iface, available: false, error: null };
        if (!binding) { res.error = 'someip native binding not available'; return res; }
        const fields = Object.keys(handlers || {});
        const call = (f, v) => {
            try { handlers[f](v); } catch (e) { log(iface + '.' + f + ': ' + e); }
        };
        try {
            const cfg = loadConfig(iface);
            const p = await nativeTick(() => binding.buildProxy(cfg, String(instance)).then((px) => px.init().then(() => px)));
            const fetchAll = () => fields.forEach((f) => {
                if (cfg.fields && cfg.fields[f] && cfg.fields[f].getter) {
                    p.getValue(f, 3000).then((v) => call(f, v)).catch((e) => log(iface + '.' + f + ' get: ' + e));
                }
            });
            await nativeTick(() => {
                try {
                    return p.subscribeToAvailability((a) => {
                        res.available = !!a;
                        log(iface + ': provider ' + (a ? 'available' : 'gone'));
                        if (onAvailability) {
                            try { onAvailability(!!a); } catch (e) { log(iface + ' availability: ' + e); }
                        }
                        if (a) setImmediate(fetchAll);
                    });
                } catch (e) { return null; /* an older binding */ }
            });
            for (const f of fields) {
                try {
                    await nativeTick(() => p.subscribe({ name: f, onReceive: (v) => call(f, v) }));
                } catch (e) {
                    log('subscribe ' + iface + '.' + f + ': ' + e);
                }
            }
            if (p.isAvailable && p.isAvailable()) { res.available = true; fetchAll(); }
        } catch (e) {
            res.error = String(e);
        }
        return res;
    }

    return { watch };
}

module.exports = { createSomeip };
