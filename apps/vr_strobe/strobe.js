'use strict';
/**
 * strobe.js - the strobe: the left side flashes N times, then the right side N times, round and round.
 * A side can be the front fog light (BDC output, on / off), a headlight LED channel (FLM_KANAL A54B start / stop),
 * or both together. TASU takes one request at a time (~150-200 ms each), so every request waits for its answer;
 * that wait is the flash. Speed «mid» / «slow» add a hold after «on» and after «off».
 * Stops on stop(), the auto-off timer, three failed requests in a row or a refused session; then everything that
 * was used gets «off» and the default session back. Every frame goes through guard.check().
 */
const { FLM, BDC, FOG, CHANNEL, FRAMES, check } = require('./guard');

// «Чем мигать»: fog lights first (owner, 2026-11-15), then the headlight alone
const LIGHTS = {
    fog: { fog: true, ch: null },
    fog_drl: { fog: true, ch: CHANNEL.drl },
    fog_low: { fog: true, ch: CHANNEL.low },
    fog_high: { fog: true, ch: CHANNEL.high },
};
Object.keys(CHANNEL).forEach((k) => { LIGHTS[k] = { fog: false, ch: CHANNEL[k] }; });
const HOLD_MS = { max: 0, mid: 150, slow: 400 };
const MAX_FAILURES = 3;
const STATUS = {
    off: 'Выключен',
    starting: 'Включается…',
    on: 'Строб работает',
    failed: 'Фары не отвечают',
    auto: 'Автовыключение',
    refused: 'Фары не перешли в тестовый режим',
    engine: 'Туманки работают только при заглушенном двигателе',
};
const NRC_CONDITIONS = 0x22;    // the BDC's answer to the fog outputs while the engine runs (car, 2026-11-15)

class Strobe {
    constructor(o) {
        this.send = o.send;
        this.sleep = o.sleep;
        this.setTimeout = o.setTimeout || setTimeout;
        this.clearTimeout = o.clearTimeout || clearTimeout;
        this.log = o.log || (() => {});
        this.running = false;
        this.stopping = false;
        this.status = STATUS.off;
        this.failures = {};
        this.timer = null;
        this.used = null;
        this.last = {};
        this.done = Promise.resolve();
    }

    view() { return { running: this.running, status: this.status }; }

    /** one guarded request; true when the module answered it positively (the last answer stays in this.last) */
    _req(target, frame) {
        check(target, frame.sid, frame.data);
        return Promise.resolve(this.send(target, frame.sid, frame.data)).then(
            (r) => { this.last = r || {}; return !!(r && r.ok); },
            (e) => { this.last = {}; this.log('send', { error: String(e && e.message || e) }); return false; });
    }

    /** a request inside the loop: counts failures per module, three in a row from one module end the strobe
     *  (in fog + headlight modes the other module's answers must not hide a silent one) */
    async _loopReq(target, frame) {
        const ok = await this._req(target, frame);
        if (!ok && target === BDC && frame.sid === 0x2F && this.last.nrc === NRC_CONDITIONS && !this.stopping) {
            this.stopping = true;
            this.reason = STATUS.engine;
            return ok;
        }
        this.failures[target] = ok ? 0 : (this.failures[target] || 0) + 1;
        if (this.failures[target] >= MAX_FAILURES && !this.stopping) {
            this.stopping = true;
            this.reason = STATUS.failed;
        }
        return ok;
    }

    start(opts) {
        if (this.running) return this.done;
        const o = opts || {};
        const light = Object.prototype.hasOwnProperty.call(LIGHTS, o.light) ? LIGHTS[o.light] : LIGHTS.fog;
        const hold = Object.prototype.hasOwnProperty.call(HOLD_MS, o.speed) ? HOLD_MS[o.speed] : HOLD_MS.max;
        const perSide = Number(o.perSide) === 3 ? 3 : 2;
        const minutes = [1, 5, 10].indexOf(Number(o.autoOffMin)) >= 0 ? Number(o.autoOffMin) : 5;
        this.running = true;
        this.stopping = false;
        this.reason = STATUS.off;
        this.failures = {};
        this.status = STATUS.starting;
        this.used = light;
        this.timer = this.setTimeout(() => { this.stop(STATUS.auto); }, minutes * 60000);
        this.log('start', { fog: light.fog, channel: light.ch, hold: hold, perSide: perSide, minutes: minutes });
        // done is set before the first request goes out, so a stop() from inside a send waits for the right run
        this.done = Promise.resolve().then(() => this._run(light, hold, perSide));
        return this.done;
    }

    async _run(light, hold, perSide) {
        try {
            const sessions = (light.fog ? [BDC] : []).concat(light.ch ? FLM : []);
            for (const t of sessions) {
                if (!(await this._req(t, FRAMES.session))) {
                    this.stopping = true;
                    this.reason = STATUS.refused;
                    break;
                }
            }
            if (!this.stopping) this.status = STATUS.on;
            while (!this.stopping) {
                for (let side = 0; side < 2 && !this.stopping; side++) {
                    for (let i = 0; i < perSide && !this.stopping; i++) {
                        await this._side(light, side, true);
                        if (this.stopping) break;
                        if (hold) await this.sleep(hold);
                        await this._side(light, side, false);
                        if (this.stopping) break;
                        if (hold) await this.sleep(hold);
                    }
                }
            }
        } catch (e) {
            this.log('loop', { error: String(e && e.message || e) });
        }
        await this._finish();
    }

    /** one side on or off: the fog output, then the headlight channel (each skipped once stopping) */
    async _side(light, side, on) {
        if (light.fog && !this.stopping) await this._loopReq(BDC, FRAMES.fog(FOG[side], on));
        if (light.ch && !this.stopping) await this._loopReq(FLM[side], on ? FRAMES.flash(light.ch) : FRAMES.stop);
    }

    async _finish() {
        this.clearTimeout(this.timer);
        this.timer = null;
        const used = this.used || LIGHTS.fog;
        if (used.fog) {
            for (const o of FOG) await this._req(BDC, FRAMES.fog(o, false));
            await this._req(BDC, FRAMES.normal);
        }
        if (used.ch) {
            for (const t of FLM) await this._req(t, FRAMES.stop);
            for (const t of FLM) await this._req(t, FRAMES.normal);
        }
        this.running = false;
        this.status = this.reason || STATUS.off;
        this.log('stopped', { status: this.status });
    }

    /** ends the strobe; resolves once everything used got «off» and the default session */
    stop(reason) {
        if (!this.running) return Promise.resolve();
        if (!this.stopping) {
            this.stopping = true;
            this.reason = reason || STATUS.off;
        }
        return this.done;
    }
}

module.exports = { Strobe, STATUS, LIGHTS };
