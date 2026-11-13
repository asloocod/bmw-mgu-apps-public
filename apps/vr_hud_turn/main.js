'use strict';
/*
 * vr_hud_turn - the iDrive screen of the HUD arrows: where they stand (higher / lower, Sport's own height, wider /
 * narrower, size) as kit settings, saved in this app's data/settings.json, where the vr-hud-turn service reads them.
 * Every change, "Показать стрелки" and "Сбросить" ask the service to light both arrows for 15 s (standing only),
 * so the new place is seen at once. "Начать / Остановить запись лога" and "Отдать лог на телефон": a recording of
 * everything the service sees, taken to a phone on the car's hotspot (a page the service opens for 10 minutes).
 */
const net = require('net');
const mgu = require('./kit/mgu');
const { request, statusText, urlText, commandFor } = require('./request');

const TIMEOUT_MS = 5000;

mgu.run({
    async start(ctx) {
        const ui = ctx.ui, settings = ctx.settings;
        let busy = false, next = null, resetting = false;

        /* one request at a time; asked again meanwhile: the last ask goes next */
        function ask(line) {
            if (busy) { next = line; return null; }
            busy = true;
            return request(line, (p) => net.createConnection(p), TIMEOUT_MS).then((reply) => {
                busy = false;
                ctx.log.info(line + ': ' + reply);
                const shown = Promise.all([ui.text('STATUS', statusText(reply)), ui.text('URL', urlText(reply))]);
                if (next !== null) { const n = next; next = null; ask(n); }
                return shown;
            });
        }

        ui.text('STATUS', '');
        ui.text('URL', '');
        ui.onClick('BTN_SHOW', () => ask('show'));
        ui.onClick('BTN_REC_START', () => ask('rec start'));
        ui.onClick('BTN_REC_STOP', () => ask('rec stop'));
        ui.onClick('BTN_SHARE', () => ask('share'));
        // a recording going on is said when the screen opens
        request('rec status', (p) => net.createConnection(p), TIMEOUT_MS).then((reply) => {
            if (/^rec on /.test(reply)) ui.text('STATUS', statusText(reply));
        });
        ui.onClick('BTN_RESET', () => {
            resetting = true;
            settings.schema.forEach((s) => { if (settings.get(s.key) !== s.default) settings.set(s.key, s.default); });
            resetting = false;
            return ask('show');
        });
        settings.onChange((key) => { if (!resetting) ask(commandFor(key)); });
    },
});
