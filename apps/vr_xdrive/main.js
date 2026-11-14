'use strict';
/*
 * vr_xdrive - «Задний привод»: one double-press button switches xDrive off until the ignition is switched off
 * (VIP 0x39, 2E DB 2F 00), with the conditions, the VIP's answer and the front-axle torque on the screen.
 * The logic is xdrive.js; here only the kit: the diagnostic link (TASU), the car's signals, the menu rows.
 * The screen and the button come first: a diagnostic link that is slow or never comes up only means
 * «канал не готов», never a blank screen.
 */
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const { Diag, replyTo } = require('./kit/diag');
const { XDrive, VIP } = require('./xdrive');

const ROWS = ['MODE', 'ANSWER', 'READY', 'TORQUE', 'UNITS'];
const REFRESH_TICKS = 3;        // every 3 s while shown, all rows again (the HMI may have dropped a write)

/** Which frame is the answer. A read: only its own positive reply (another app's refusal from the same ECU looks
 *  the same as ours, and a read needs the data anyway). The write: its echo or a refusal of 2E (replyTo). */
function acceptFor(sid, data) {
    if (sid === 0x22) return (u) => u[0] === 0x62 && u[1] === data[0] && u[2] === data[1];
    return replyTo(sid, data);
}

/** Monotonic ms (a clock set back by time sync must not stretch the 6 s window). */
function now() { const t = process.hrtime(); return t[0] * 1000 + t[1] / 1e6; }

mgu.run({
    async start(ctx) {
        const ui = ctx.ui, log = ctx.log;
        let diag = null;            // the TASU link once it is up
        let condition;              // VehicleCondition, from every notification (no polling gap)
        let x = null;
        const car = new Car(ctx, ['rpm', 'speed', 'gear'], {
            'de.bmw.infrastructure.VehicleCondition': {
                VehicleCondition: (v) => {
                    const n = Car.conditionOf(v && v.statusConditionVehicle);
                    if (n === undefined) return;            // 15 "no value" and unknown states: the last one stands
                    if (n !== condition) log.info('xdrive condition ' + condition + ' -> ' + n);
                    condition = n;
                    if (x) { x.onCondition(n); draw(); }
                },
            },
        });
        x = new XDrive({
            // "transport refused": the request never left (xdrive.js keeps the mode then)
            send: (target, sid, data, timeoutMs, opts) => (diag && diag.p
                ? diag.physical(target, sid, data, timeoutMs, acceptFor(sid, data), opts)
                : Promise.reject(new Error('transport refused: no diagnostic link'))),
            data: () => {
                const d = car.data();
                return d.demo ? d : Object.assign({}, d, { condition: condition });
            },
            now: now,
            log: (event, d) => log.info('xdrive ' + event + ' ' + JSON.stringify(d)),
        });
        if (condition !== undefined) x.onCondition(condition);

        // only the rows that changed go to the HMI; all of them when the screen opens and every few seconds
        let sent = {};
        function draw() {
            const v = x.view(), rows = { MODE: v.mode, ANSWER: v.answer, READY: v.ready, TORQUE: v.torque, UNITS: v.units };
            const changed = ROWS.filter((k) => sent[k] !== rows[k]);
            changed.forEach((k) => { sent[k] = rows[k]; });
            return Promise.all(changed.map((k) => ui.text(k, rows[k]))).catch((e) => log.warn('draw: ' + e));
        }

        // the front-axle torque and the rows, every second while the screen is shown (not while the write is out:
        // the transport takes one request at a time)
        let timer = null, polling = false, ticks = 0;
        const tick = () => {
            if (++ticks % REFRESH_TICKS === 0) sent = {};
            if (polling || x.busy) { draw(); return; }
            polling = true;
            x.pollTorque().catch((e) => log.warn('poll: ' + e)).then(() => { polling = false; return draw(); });
        };
        const shown = (on) => {
            if (on && timer === null) { sent = {}; draw(); timer = setInterval(tick, 1000); tick(); }
            if (!on && timer !== null) { clearInterval(timer); timer = null; }
        };
        ui.onVisible((name, v) => { if (name === 'MAIN') shown(v); });
        if (ui.isVisible('MAIN')) shown(true);

        ui.onClick('BTN_OFF', () => {
            const p = x.press().catch((e) => log.error('press', e)).then(draw);
            draw();
            return p;
        });
        draw();

        new Diag(ctx.signals, log).init().then((d) => {
            d.quiet = true;         // the app logs its own lines (the torque is polled every second)
            // every app sees every frame: a VIP yes to 2E DB 2F that is not ours = another app switched xDrive
            d.on('frame', (f) => {
                const u = f.uds;
                if (f.ecu === VIP && u[0] === 0x6E && u[1] === 0xDB && u[2] === 0x2F) { x.onForeignWrite(); draw(); }
            });
            diag = d;
            return x.identify();
        }).catch((e) => log.warn('identify: ' + e)).then(draw);
    },
});
