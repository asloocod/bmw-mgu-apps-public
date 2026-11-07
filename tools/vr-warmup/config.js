'use strict';
/*
 * config.js - vr-warmup's settings: the defaults, and /var/opt/vr-warmup/config.json over them (kept over updates).
 * A key with a value of the wrong kind or out of range is ignored, the previous value stays. Two rules across keys:
 * rearm_c below warm_c (else warm_c - 10), and the whole icon on the 1920x720 panel (x and y pulled in).
 */

const PANEL_W = 1920;
const PANEL_H = 720;

const DEFAULTS = Object.freeze({
    warm_c: 80,                 // oil at or above this: warm, the icon goes off
    rearm_c: 70,                // once warm, the icon comes back only when the oil is below this
    stale_ms: 5000,             // no valid oil temperature this long: none known, the icon goes off
    x: 1593,                    // the icon's top-left on cluster-render's `panel` target, px (placed on the car,
    y: 473,                     // 2026-11-07: by the rev counter)
    size: 56,                   // the icon's side, px
    color: Object.freeze([0.15, 0.5, 1.0]),
    test_pattern: false,        // the icon on all the time (to place it on the cluster)
});

const isInt = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (lo, hi) => (v) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
const RULES = {
    warm_c: isInt(40, 110),
    rearm_c: isInt(30, 105),
    stale_ms: isInt(2000, 60000),
    x: isInt(0, PANEL_W - 24),
    y: isInt(0, PANEL_H - 24),
    size: isInt(24, 240),
    color: (v) => Array.isArray(v) && v.length === 3 && v.every(isNum(0, 1)),
    test_pattern: (v) => typeof v === 'boolean',
};

/* base with the valid keys of patch over it; a new object, the colour array copied */
function merge(base, patch) {
    const out = {};
    Object.keys(DEFAULTS).forEach((k) => {
        const p = patch && typeof patch === 'object' ? patch[k] : undefined;
        const v = p !== undefined && RULES[k](p) ? p : base[k];
        out[k] = k === 'color' ? v.slice() : v;
    });
    if (out.rearm_c >= out.warm_c) out.rearm_c = out.warm_c - 10;
    out.x = Math.min(out.x, PANEL_W - out.size);
    out.y = Math.min(out.y, PANEL_H - out.size);
    return out;
}

/* the settings from file (readFileSync injected); a missing file is no warning */
function load(file, readFileSync) {
    let text;
    try {
        text = readFileSync(file, 'utf8');
    } catch (e) {
        if (e && e.code === 'ENOENT') return { config: merge(DEFAULTS, {}), warning: null };
        return { config: merge(DEFAULTS, {}), warning: 'config ' + file + ': ' + (e && e.code ? e.code : e) };
    }
    try {
        return { config: merge(DEFAULTS, JSON.parse(text)), warning: null };
    } catch (e) {
        return { config: merge(DEFAULTS, {}), warning: 'config ' + file + ': ' + e.message };
    }
}

module.exports = { DEFAULTS, merge, load };
