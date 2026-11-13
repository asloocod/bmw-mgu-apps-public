'use strict';
/*
 * appsettings.js - the offsets the driver set in the vr_hud_turn app (iDrive: "Поворотники на HUD"). The kit keeps them
 * in the app's own data folder: /var/opt/public/oap/oap_<uid>/data/settings.json. The app is found by the name in
 * oap_<uid>/source/package.json (as vr-start-sound finds its app). Each value is checked on its own; a missing or
 * wrong one counts as no offset.
 */
const path = require('path');

const APP_ID = 'vr_hud_turn';
const OAP_ROOT = '/var/opt/public/oap';

const isInt = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const KEYS = {
    up: [isInt(-200, 200), 0],          // px higher on the HUD
    up_sport: [isInt(-200, 200), 0],    // the same in Sport
    wide: [isInt(-150, 150), 0],        // px further apart (towards the edges)
    scale: [isInt(50, 200), 100],       // % of the size
};

/* { dir, gid } of the installed app named appId under oapRoot, or null */
function findApp(oapRoot, appId, fs) {
    let names;
    try { names = fs.readdirSync(oapRoot); } catch (e) { return null; }
    for (const n of names.filter((x) => /^oap_\d+$/.test(x)).sort()) {
        const dir = path.join(oapRoot, n);
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'source', 'package.json'), 'utf8'));
            if (pkg && pkg.name === appId) return { dir, gid: fs.statSync(dir).gid };
        } catch (e) { /* not an app, or half written: skip */ }
    }
    return null;
}

/* { up, up_sport, wide, scale } from the app's settings (no app, no file: no offsets) */
function read(appDir, fs) {
    let s = null;
    if (appDir) {
        try { s = JSON.parse(fs.readFileSync(path.join(appDir, 'data', 'settings.json'), 'utf8')); } catch (e) { s = null; }
    }
    const out = {};
    Object.keys(KEYS).forEach((k) => {
        const v = s && typeof s === 'object' ? s[k] : undefined;
        out[k] = KEYS[k][0](v) ? v : KEYS[k][1];
    });
    return out;
}

module.exports = { APP_ID, OAP_ROOT, findApp, read };
