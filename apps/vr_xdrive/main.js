'use strict';
/*
 * vr_xdrive - «Задний привод»: one double-press button switches xDrive off until the ignition is switched off
 * (VIP 0x39, 2E DB 2F 00), with the conditions, the VIP's answer and the front-axle torque on the screen.
 * The logic is xdrive.js; here only the kit: the diagnostic link (TASU), the car's signals, the menu rows.
 */
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const { Diag, replyTo } = require('./kit/diag');
const { XDrive } = require('./xdrive');

mgu.run({
    async start(ctx) {
        const ui = ctx.ui, log = ctx.log;
        const car = new Car(ctx, ['rpm', 'speed', 'gear', 'condition']);
        const diag = await new Diag(ctx.signals, log).init();
        diag.quiet = true;      // the app logs its own lines (the torque is polled every second)
        const x = new XDrive({
            send: (target, sid, data, timeoutMs) => diag.physical(target, sid, data, timeoutMs, replyTo(sid, data)),
            data: () => car.data(),
            now: () => Date.now(),
            log: (event, d) => log.info('xdrive ' + event + ' ' + JSON.stringify(d)),
        });

        const draw = () => {
            const v = x.view();
            return Promise.all([ui.text('MODE', v.mode), ui.text('ANSWER', v.answer), ui.text('READY', v.ready),
                ui.text('TORQUE', v.torque), ui.text('UNITS', v.units)]).catch((e) => log.warn('draw: ' + e));
        };

        // the ignition cycle, screen shown or not: ignition off gives xDrive back
        let lastCondition;
        setInterval(() => {
            const d = car.data();
            if (d.demo || d.condition === undefined || d.condition === lastCondition) return;
            log.info('xdrive condition ' + lastCondition + ' -> ' + d.condition);
            lastCondition = d.condition;
            x.onCondition(d.condition);
        }, 500);

        // the front-axle torque and the rows, every second while the screen is shown
        let timer = null, polling = false;
        const tick = () => {
            if (polling) return;
            polling = true;
            x.pollTorque().catch((e) => log.warn('poll: ' + e)).then(() => { polling = false; return draw(); });
        };
        const shown = (on) => {
            if (on && timer === null) { timer = setInterval(tick, 1000); tick(); }
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
        x.identify().catch((e) => log.warn('identify: ' + e)).then(draw);
    },
});
