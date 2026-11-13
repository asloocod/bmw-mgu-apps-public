'use strict';
/*
 * vr_xdrive logic - xDrive off until the ignition cycle on the G05/G06 VIP (0x39, VIP_G05 0F2520), the job
 * STEUERN_LMV_FUNKTION_QDM:  2E DB 2F 00 -> 6E DB 2F  (taken with the ignition on and the engine off, P, stationary;
 * NRC 33 while the engine runs - measured in idrive7-apps, issue #52, and on this car on 2026-11-11).
 * The mode comes from what happened (the VIP's yes, the ignition cycle), never from the transfer case's qualifier:
 * our LMV (0F2180) reads 0x1B before and after the write. The front-axle torque (LMV 0x19, 22 DB 32) is the proof.
 * No SDK here: the app (main.js) hands in send / data / now / log, the tests hand in fakes.
 */
const VIP = 0x39, LMV = 0x19;
const OFF_WRITE = [0xDB, 0x2F, 0x00];
const SUPPORTED_VIP = '0F2520';
const CONFIRM_MS = 6000;
const IGNITION = 7;     // VehicleCondition PRUEFEN_ANALYSE_DIAGNOSE: ignition on, engine off

const hex2 = (n) => (n < 16 ? '0' : '') + n.toString(16).toUpperCase();
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** 62 F1 50 <index> -> '0F2520' (leading zeros trimmed to 6 hex digits), else null. */
function sgbdIndex(uds) {
    if (!uds || uds.length < 4 || uds[0] !== 0x62 || uds[1] !== 0xF1 || uds[2] !== 0x50) return null;
    return uds.slice(3).map(hex2).join('').replace(/^0+(?=.{6})/, '');
}

const s16 = (h, l) => (((h << 8) | l) << 16) >> 16;
/** 62 DB 32 + 8 bytes: actual / requested front-axle torque (raw / 4 Nm, signed), qualifier (last byte). */
function decodeDb32(uds) {
    if (!uds || uds.length < 11 || uds[0] !== 0x62 || uds[1] !== 0xDB || uds[2] !== 0x32) return null;
    const b = uds.slice(3);
    return { actual: s16(b[0], b[1]) / 4, requested: s16(b[2], b[3]) / 4, qualifier: b[7] };
}

/** The only requests this app may send: the one write and three reads. */
const ALLOWED = [
    [VIP, 0x2E, OFF_WRITE],
    [VIP, 0x22, [0xF1, 0x50]],
    [LMV, 0x22, [0xF1, 0x50]],
    [LMV, 0x22, [0xDB, 0x32]],
];
function allowed(target, sid, data) {
    return ALLOWED.some((a) => a[0] === target && a[1] === sid && same(a[2], data || []));
}

/** What the VIP wants, as far as the head unit sees it. The parking brake is not readable. */
function readiness(d) {
    if (!d || d.demo) return { ready: false, missing: ['нет данных машины'] };
    const missing = [];
    if (d.condition === IGNITION) { /* ignition on, engine off */ } else if (d.condition >= 8) missing.push('мотор заведён');
    else missing.push('зажигание выключено');
    if (d.stage !== 'P') missing.push('не в P');
    if (!(typeof d.speed === 'number' && d.speed < 0.5)) missing.push('машина едет');
    return { ready: missing.length === 0, missing };
}

function nrcText(nrc) {
    if (nrc === 0x33) return 'Мотор работает: заглушите, оставьте зажигание и нажмите снова';
    if (nrc === 0x22) return 'Условия не выполнены: ручник, P, машина стоит';
    if ([0x11, 0x12, 0x13, 0x31].indexOf(nrc) >= 0) return 'VIP не знает этой команды, код ' + hex2(nrc);
    if (nrc === 0x7E || nrc === 0x7F) return 'Не в этой сессии, код ' + hex2(nrc);
    return 'Отказ VIP, код ' + hex2(nrc);
}

const bytesHex = (u) => (u ? u.map(hex2).join(' ') : null);
const nm = (v) => (v === null || v === undefined ? '—' : v.toFixed(1).replace('.', ','));
const MOVING_KMH = 3;

/**
 * The screen's controller. deps: send(target, sid, data, timeoutMs) -> Promise<uds|null> (may reject),
 * data() -> the car's data (car.js), now() -> ms, log(event, details).
 */
class XDrive {
    constructor(deps) {
        this.deps = deps;
        this.mode = 'unknown';          // 'awd' | 'rwd' | 'unknown'
        this.vip = null; this.lmv = null;
        this.torque = { now: null, max: null };
        this.answer = '';
        this.armedAt = null; this.busy = false;
    }

    _send(target, sid, data, timeoutMs) {
        if (!allowed(target, sid, data)) return Promise.reject(new Error('not allowed'));
        return this.deps.send(target, sid, data, timeoutMs);
    }

    async _read(target, data) {
        try { return await this._send(target, 0x22, data, 1500); } catch (e) { return null; }
    }

    async identify() {
        this.vip = sgbdIndex(await this._read(VIP, [0xF1, 0x50]));
        this.lmv = sgbdIndex(await this._read(LMV, [0xF1, 0x50]));
        this.deps.log('identified', { vip: this.vip, lmv: this.lmv });
    }

    /** One press at a time (identification and the write both await): a press meanwhile only says to wait. */
    async press() {
        if (this.busy) { this.answer = 'Подождите, команда уже отправлена'; return; }
        this.busy = true;
        try { await this._press(); } finally { this.busy = false; }
    }

    async _press() {
        if (this.vip === null) await this.identify();
        const d = this.deps.data(), r = readiness(d);
        const base = { vip: this.vip, missing: r.missing, condition: d.condition, rpm: d.rpm, speed: d.speed, stage: d.stage };
        if (this.vip !== SUPPORTED_VIP) {
            this.armedAt = null;
            this.answer = 'Этот VIP (' + (this.vip || 'нет ответа') + ') не поддерживается, команда не отправлена';
            this.deps.log('press', Object.assign({ result: 'unsupported' }, base));
            return;
        }
        if (!r.ready) {
            this.armedAt = null;
            this.answer = 'Не готово: ' + r.missing.join(', ');
            this.deps.log('press', Object.assign({ result: 'not_ready' }, base));
            return;
        }
        const t = this.deps.now();
        if (this.armedAt === null || t - this.armedAt > CONFIRM_MS) {
            this.armedAt = t;
            this.answer = 'Нажмите ещё раз в течение 6 с, чтобы отключить полный привод';
            this.deps.log('press', Object.assign({ result: 'armed' }, base));
            return;
        }
        this.armedAt = null;
        let reply = null, error = null;
        try { reply = await this._send(VIP, 0x2E, OFF_WRITE, 3000); } catch (e) { error = String(e && e.message || e); }
        // no answer, or the call failed after the transport took it: the VIP may have switched xDrive off unheard.
        // "transport refused" (diag.js _check) means the request never left: the mode stands.
        if ((error === null && !reply) || (error !== null && !/transport refused/.test(error))) this.mode = 'unknown';
        if (error !== null) this.answer = 'Канал диагностики недоступен';
        else if (reply && reply[0] === 0x6E && reply[1] === 0xDB && reply[2] === 0x2F) {
            this.mode = 'rwd';
            this.answer = 'Принято. Заводите (тормоз + Start), не выключая зажигание';
        } else if (reply && reply[0] === 0x7F) this.answer = nrcText(reply[2]);
        else if (!reply) this.answer = 'Нет ответа от VIP';
        else this.answer = 'Непонятный ответ VIP: ' + bytesHex(reply);
        this.deps.log('press', Object.assign({ result: 'sent', request: '2E DB 2F 00', reply: bytesHex(reply), error: error, mode: this.mode }, base));
    }

    /** VehicleCondition: 1-6 = ignition off, the VIP has given xDrive back. */
    onCondition(n) {
        if (n >= 1 && n <= 6) {
            if (this.mode !== 'awd') {
                this.deps.log('ignition_off', { condition: n, was: this.mode });
                this.answer = '';           // the last cycle's answer («Принято…») no longer holds
            }
            this.mode = 'awd'; this.torque.max = null; this.armedAt = null;
        }
    }

    async pollTorque() {
        const t = decodeDb32(await this._read(LMV, [0xDB, 0x32]));
        this.torque.now = t ? t.actual : null;
        const d = this.deps.data();
        if (t && typeof d.speed === 'number' && d.speed > MOVING_KMH) {
            const a = Math.abs(t.actual);
            if (this.torque.max === null || a > this.torque.max) this.torque.max = a;
            this.deps.log('db32', { actual: t.actual, requested: t.requested, qualifier: t.qualifier, speed: d.speed, rpm: d.rpm, mode: this.mode });
        }
    }

    view() {
        const r = readiness(this.deps.data());
        return {
            mode: this.mode === 'awd' ? 'Режим: полный привод'
                : this.mode === 'rwd' ? 'Режим: задний привод до выключения зажигания'
                    : 'Режим: неизвестен, смотрите момент на передней оси',
            answer: this.answer,
            ready: r.ready ? 'Готово: зажигание, мотор заглушен, P, стоим. Ручник проверьте сами' : 'Не готово: ' + r.missing.join(', '),
            torque: 'Передняя ось: сейчас ' + nm(this.torque.now) + ' Нм, максимум в движении ' + nm(this.torque.max) + ' Нм',
            units: 'VIP ' + (this.vip || '—') + ' · раздатка ' + (this.lmv || '—'),
        };
    }
}

module.exports = { VIP, LMV, OFF_WRITE, SUPPORTED_VIP, CONFIRM_MS, sgbdIndex, decodeDb32, allowed, readiness, nrcText, XDrive };
