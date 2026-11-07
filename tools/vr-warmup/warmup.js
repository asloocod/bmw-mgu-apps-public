'use strict';
/*
 * warmup.js - whether the warm-up icon is on at time t (ms, the caller's clock).
 *
 * The oil is `warm` from warm_c up, and stays warm until it is below rearm_c (no flicker around warm_c); only an oil
 * value moves that latch. The icon is on when the oil is known and fresh (a valid value within stale_ms), not warm,
 * and the engine is running or its state unknown (no DataPowerTrain2CRC, an invalid value). test_pattern: always on.
 * The reason names the first cause, in this order: test pattern, no oil temperature, warm, engine off, cold.
 */

function createWarmup(cfg) {
    let oilC = null, oilT = null, isWarm = false, eng = null;

    const fresh = (t) => oilT !== null && t - oilT < cfg.stale_ms;

    return {
        /* a valid oil temperature (degrees C) at t */
        oil(c, t) {
            oilC = c;
            oilT = t;
            if (c >= cfg.warm_c) isWarm = true;
            else if (c < cfg.rearm_c) isWarm = false;
        },
        /* 'running' | 'off' | null */
        engine(state) { eng = state; },
        state(t) {
            const oil = oilC;
            if (cfg.test_pattern) return { visible: true, reason: 'test pattern', oil };
            if (!fresh(t)) return { visible: false, reason: 'no oil temperature', oil };
            if (isWarm) return { visible: false, reason: 'warm', oil };
            if (eng === 'off') return { visible: false, reason: 'engine off', oil };
            return { visible: true, reason: 'cold', oil };
        },
        /* when the state can next change by itself (the oil going stale), or null */
        nextChange(t) { return fresh(t) ? oilT + cfg.stale_ms : null; },
        warm() { return isWarm; },
    };
}

module.exports = { createWarmup };
