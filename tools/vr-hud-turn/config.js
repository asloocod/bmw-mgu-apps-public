'use strict';
/*
 * config.js - vr-hud-turn's settings: the defaults, and /var/opt/vr-hud-turn/config.json over them (kept over
 * updates). A key with a value of the wrong kind or out of range is ignored, the previous value stays.
 */

const DEFAULTS = Object.freeze({
    period_ms: 640,             // one flash cycle, lit + dark (measured on the car, 2026-11-07)
    duty: 0.5,                  // the lit share of a cycle (measured: 320 ms of 640)
    phase: 'light2',            // 'light2': Light.StatusFunctionsIndicators2, sent at every flash start, re-syncs each flash;
                                // 'timer': the flash runs from the moment the indicator goes on
    stale_ms: 1500,             // no indicator event this long during a turn: the arrows go off (0: never)
    size: 40,                   // arrow height, px of the 800x480 HUD canvas (chosen on the car)
    margin: 190,                // from the canvas edge to the arrow tip, px (the HUD shows less than the canvas; 150 was too far out)
    y: 240,                     // the arrows' vertical centre, px (0 at the top)
    y_sport: 240,               // the same in Sport / Sport+, where the HUD shows its rev counter
    show_ms: 15000,             // "Показать стрелки" from the app: both arrows this long
    show_max_kmh: 5,            // and only below this speed (no speed signal: allowed)
    color: Object.freeze([0, 0.85, 0.3]),
    test_pattern: false,        // both arrows on all the time (to place them on the HUD)
});

const isInt = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (lo, hi) => (v) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
const RULES = {
    period_ms: isInt(300, 1500),
    duty: isNum(0.2, 0.8),
    phase: (v) => v === 'light2' || v === 'timer',
    stale_ms: (v) => v === 0 || isInt(700, 10000)(v),
    size: isInt(20, 400),
    margin: isInt(0, 300),
    y: isInt(0, 480),
    y_sport: isInt(0, 480),
    show_ms: isInt(1000, 60000),
    show_max_kmh: isInt(0, 50),
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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const offset = (o, k, dflt) => (o && Number.isInteger(o[k]) ? o[k] : dflt);

/* where the arrows go: { y, margin, size }. mode 'sport' takes y_sport (anything else y); app: the offsets from the
 * vr_hud_turn app (appsettings.js): up / up_sport px higher, wide px further apart, scale % of size. Kept on the canvas. */
function placement(cfg, mode, app) {
    const sport = mode === 'sport';
    const up = offset(app, sport ? 'up_sport' : 'up', 0);
    return {
        y: clamp((sport ? cfg.y_sport : cfg.y) - up, 0, 480),
        margin: clamp(cfg.margin - offset(app, 'wide', 0), 0, 300),
        size: clamp(Math.round(cfg.size * offset(app, 'scale', 100) / 100), 20, 400),
    };
}

module.exports = { DEFAULTS, merge, load, placement };
