'use strict';
/*
 * eventlog.js - the service's log lines also in a small file on the unit, because the unit's journal keeps only
 * minutes: what the car sent during a drive (the oil temperature through a cold start) can
 * be read at the next cable session. /var/opt/vr-warmup/log/events.log, wall-clock ISO time + the line; past
 * maxBytes it becomes events.log.1 (one kept). A failure to write never reaches the service.
 */
const path = require('path');

function createEventLog(file, maxBytes, fs, now) {
    let size = null;

    function prepare() {
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        try { size = fs.statSync(file).size; } catch (e) { size = 0; }
    }

    return {
        write(line) {
            try {
                if (size === null) prepare();
                const text = new Date(now()).toISOString() + ' ' + line + '\n';
                const bytes = Buffer.byteLength(text);
                if (size + bytes > maxBytes && size > 0) {
                    fs.renameSync(file, file + '.1');
                    size = 0;
                }
                fs.appendFileSync(file, text);
                size += bytes;
            } catch (e) { /* the log is a help, never a reason to stop */ }
        },
    };
}

module.exports = { createEventLog };
