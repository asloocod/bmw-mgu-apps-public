'use strict';
/*
 * blinker.js - whether the arrows are lit at a moment, in step with the car's flasher.
 *
 * An anchor is the start of a lit phase; the arrows of the current direction are lit while
 * (t - anchor) mod period_ms < period_ms * duty. Turning on (or to another direction) anchors at that moment:
 * BMW's flasher starts with a flash. A flash start from the car (Light.StatusFunctionsIndicators2, sent at every
 * flash start and again ~80 ms later, probe 2 on the car) moves the anchor to it when it comes at least half a
 * cycle after the anchor, so the repeat is ignored. The same direction reported again changes nothing.
 * Times are the caller's (ms); nothing here reads a clock.
 */

const SIDES = { none: [false, false], left: [true, false], right: [false, true], both: [true, true] };

function createBlinker(cfg) {
    const period = cfg.period_ms;
    const onLen = period * cfg.duty;
    let dir = 'none';
    let anchor = 0;

    const pos = (t) => (((t - anchor) % period) + period) % period;
    const lit = (t) => dir !== 'none' && pos(t) < onLen;

    return {
        direction: () => dir,
        setDirection(next, t) {
            if (!SIDES[next] || next === dir) return;
            dir = next;
            if (dir !== 'none') anchor = t;
        },
        cycle(t) {
            if (dir === 'none' || t - anchor < period / 2) return;
            anchor = t;
        },
        state(t) {
            if (cfg.test_pattern) return { left: true, right: true };
            const on = lit(t);
            return { left: on && SIDES[dir][0], right: on && SIDES[dir][1] };
        },
        nextChange(t) {
            if (cfg.test_pattern || dir === 'none') return null;
            const p = pos(t);
            return t + (p < onLen ? onLen - p : period - p);
        },
    };
}

module.exports = { createBlinker };
