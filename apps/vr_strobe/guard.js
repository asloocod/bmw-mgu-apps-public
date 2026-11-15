'use strict';
/**
 * guard.js - the only frames vr_strobe may send:
 *  - to the headlight modules (FLM2 0x43 left, 0x44 right): the extended session and back, a flash of one LED
 *    channel 1-9 (FLM_KANAL A54B, 100 %, 1 s) and its stop;
 *  - to the body domain controller (BDC 0x40): the extended session and back, and the front fog light outputs
 *    left / right on or off (LICHT_AUSGANG_DIGITAL_STEUERN E3B5; our BDC wants a trailing 00, checked on the car).
 * Every request of the app goes through check(); anything else throws before it is sent.
 */

const FLM = [0x43, 0x44];
const BDC = 0x40;
const FOG = [0x0B, 0x0C];          // NSW_L, NSW_R, in the order of FLM (left, right)
// the menu's order: the three main ones, then the other LED channels of the headlight (owner, 2026-11-15)
const CHANNEL = { low: 2, high: 8, drl: 6, ch9: 9, ch7: 7, ch4: 4, ch5: 5, ch1: 1, ch3: 3 };
const ALLOWED_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function flash(ch) {
    if (ALLOWED_CHANNELS.indexOf(ch) < 0) throw new Error('blocked: channel ' + ch);
    return { sid: 0x31, data: [0x01, 0xA5, 0x4B, ch, 0x64, 0x01] };
}

function fog(output, on) {
    if (FOG.indexOf(output) < 0) throw new Error('blocked: output ' + output);
    return { sid: 0x2F, data: [0xE3, 0xB5, 0x03, output, on ? 0x01 : 0x00, 0x00] };
}

const FRAMES = Object.freeze({
    session: { sid: 0x10, data: [0x03] },
    normal: { sid: 0x10, data: [0x01] },
    stop: { sid: 0x31, data: [0x02, 0xA5, 0x4B] },
    flash: flash,
    fog: fog,
});

const SESSIONS = [FRAMES.session, FRAMES.normal];
const FLM_LIST = SESSIONS.concat([FRAMES.stop], ALLOWED_CHANNELS.map(flash));
const BDC_LIST = SESSIONS.concat([fog(0x0B, true), fog(0x0B, false), fog(0x0C, true), fog(0x0C, false)]);

function same(a, b) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

function hexList(a) {
    return Array.prototype.map.call(a, (x) => ('0' + (x & 0xff).toString(16)).slice(-2)).join(' ');
}

function check(target, sid, data) {
    const d = Array.prototype.slice.call(data || []);
    const list = target === BDC ? BDC_LIST : (FLM.indexOf(target) >= 0 ? FLM_LIST : []);
    if (!list.some((f) => f.sid === sid && same(f.data, d))) {
        throw new Error('blocked: ' + (target >>> 0).toString(16) + ' ' + hexList([sid].concat(d)));
    }
}

module.exports = { FLM, BDC, FOG, CHANNEL, FRAMES, check, hexList };
