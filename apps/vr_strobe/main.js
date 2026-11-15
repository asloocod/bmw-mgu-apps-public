'use strict';
/*
 * vr_strobe - «Строб»: the left side (fog light and / or headlight) flashes, then the right one, until the button, the
 * auto-off or an exit. The loop is strobe.js, the frames guard.js; here only the kit: the menu, the settings and
 * the diagnostic link (TASU: one request at a time, every request waits for its own answer).
 */
const mgu = require('./kit/mgu');
const { Diag, replyTo } = require('./kit/diag');
const { Strobe } = require('./strobe');

const STATUS_MS = 500;

mgu.run({
    async start(ctx) {
        const ui = ctx.ui, log = ctx.log, settings = ctx.settings;
        let diag = null;
        const strobe = new Strobe({
            send: (target, sid, data) => {
                if (!diag || !diag.p) return Promise.resolve({ ok: false, reason: 'канал не готов' });
                return diag.physical(target, sid, data, 1500, replyTo(sid, data), { maxRetries: 0 })
                    .then((reply) => (reply && reply[0] === sid + 0x40 ? { ok: true, reply: reply }
                        : { ok: false, nrc: reply ? reply[2] : undefined,
                            reason: reply ? 'отказ 0x' + (reply[2] || 0).toString(16) : 'нет ответа' }));
            },
            sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
            log: (event, d) => log.info('strobe ' + event + ' ' + JSON.stringify(d)),
        });
        const options = () => ({ light: settings.get('light'), speed: settings.get('speed'), perSide: settings.get('perSide'),
            autoOffMin: settings.get('autoOffMin') });

        let shownStatus = null, shownButton = null;
        function draw() {
            const v = strobe.view();
            const status = !diag || !diag.p ? 'Канал не готов' : v.status;
            const button = v.running ? 'Выключить строб' : 'Включить строб';
            const jobs = [];
            if (status !== shownStatus) { shownStatus = status; jobs.push(ui.text('STATUS', status)); }
            if (button !== shownButton) { shownButton = button; jobs.push(ui.text('BTN_TOGGLE', button)); }
            return Promise.all(jobs).catch((e) => log.warn('draw: ' + e));
        }
        // wanted: the user's last word (button / shutdown). A settings change restarts only a strobe still wanted,
        // never one that is already stopping (button, auto-off, failures, exit)
        let wanted = false, restarting = false;
        function run() {
            wanted = true;
            const p = strobe.start(options()).catch((e) => log.error('strobe', e))
                .then(() => { if (!restarting) wanted = false; }).then(draw);
            draw();
            return p;
        }
        function halt() {
            wanted = false;
            const p = strobe.stop().then(draw);
            draw();
            return p;
        }

        ui.onClick('BTN_TOGGLE', () => {
            if (!diag || !diag.p) { draw(); return null; }
            if (strobe.view().running) return halt();
            run();
            return null;
        });
        // a new light / speed / count / auto-off while running: restart with it
        settings.onChange(() => {
            if (!wanted || restarting || !strobe.view().running || strobe.stopping) return;
            restarting = true;
            strobe.stop().then(() => { restarting = false; if (wanted) run(); else draw(); });
        });
        let timer = null;
        ui.onVisible((name, v) => {
            if (name !== 'MAIN') return;
            if (v && timer === null) { shownStatus = shownButton = null; draw(); timer = setInterval(draw, STATUS_MS); }
            if (!v && timer !== null) { clearInterval(timer); timer = null; }
        });
        process.once('SIGTERM', () => {
            const cap = new Promise((res) => setTimeout(res, 1000));
            wanted = false;
            Promise.race([strobe.stop(), cap]).then(() => process.exit(0));
        });
        // MainApp's own shutdown: the kit exits 200 ms later without a SIGTERM; start the stop (fog off first)
        ctx.app.on('shutdown', () => { wanted = false; strobe.stop(); });
        draw();

        new Diag(ctx.signals, log).init().then((d) => {
            d.quiet = true;           // a request every ~200 ms while running: the app logs its own lines
            diag = d;
            draw();
        }).catch((e) => log.warn('diag: ' + e));
    },
});
