'use strict';
/*
 * recorder.js - "Начать запись лога" in the app: everything the service sees, every indicator event too (the normal
 * log keeps only changes), into /var/opt/vr-hud-turn/log/record.log, so a friend's car can show us its own rhythm.
 * A new recording starts the file afresh; it stops by "Остановить", at maxBytes or after maxMs. Wall-clock ISO time
 * + the line, as events.log. A failure to write never reaches the service.
 */
const path = require('path');

/* opts: { maxBytes, maxMs } */
function createRecorder(file, fs, now, opts) {
    let on = false, startedAt = 0, bytes = 0;

    function append(line) {
        const text = new Date(now()).toISOString() + ' ' + line + '\n';
        try {
            fs.appendFileSync(file, text);
            bytes += Buffer.byteLength(text);
        } catch (e) { /* the log is a help, never a reason to stop */ }
    }

    const api = {
        /* a new recording; header: lines first (version, settings) */
        start(header) {
            if (on) return;
            try {
                const dir = path.dirname(file);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir);
                fs.writeFileSync(file, '');
            } catch (e) { /* written as far as it goes */ }
            on = true;
            startedAt = now();
            bytes = 0;
            append('recording started');
            (header || []).forEach(append);
        },
        stop(why) {
            if (!on) return;
            append('recording stopped (' + why + ')');
            on = false;
        },
        write(line) {
            if (!on) return;
            if (now() - startedAt >= opts.maxMs) { api.stop('time limit'); return; }
            append(line);
            if (bytes >= opts.maxBytes) api.stop('size limit');
        },
        /* { on, sec: seconds recording, bytes: the file's size } */
        status() {
            if (on && now() - startedAt >= opts.maxMs) api.stop('time limit');
            let size = bytes;
            if (!on) { try { size = fs.statSync(file).size; } catch (e) { size = 0; } }
            return { on, sec: on ? Math.floor((now() - startedAt) / 1000) : 0, bytes: size };
        },
    };
    return api;
}

module.exports = { createRecorder };
