'use strict';
/*
 * control.js - the vr_hud_turn app's socket: /run/vr-hud-turn/ctl.sock, root:<the app's group> 0660, so only the app
 * (and root) can ask. One line per connection, one line back:
 *   show          the settings read again, both arrows lit for show_ms where the mode now puts them -> ok sport|normal
 *   show sport    the same at Sport's height (or normal's), whatever the mode now
 *   -> moving     at show_max_kmh and faster: the settings are taken, nothing is lit (no arrows of their own while driving)
 *   rec start / rec stop / rec status   the recording (recorder.js) -> rec on|off <seconds> <bytes>
 *   share         the recording stopped, the log page opened on the car's hotspot (share.js) -> share <address>
 *   -> error <why>
 * The socket code is vr-start-sound's control.js.
 */

const MAX_LINE = 64;

const recReply = (st) => 'rec ' + (st.on ? 'on' : 'off') + ' ' + st.sec + ' ' + st.bytes;

/* deps: { speedKmh() -> km/h | null, reload(), show('sport' | 'normal' | null) -> the mode shown,
 * rec('start' | 'stop' | 'status') -> { on, sec, bytes }, share() -> Promise<{ url } | { error }> } */
function createHandler(cfg, deps) {
    return function handle(line) {
        const text = String(line).trim();
        const r = /^rec (start|stop|status)$/.exec(text);
        if (r && deps.rec) return Promise.resolve(recReply(deps.rec(r[1])));
        if (text === 'share' && deps.share) {
            if (deps.rec) deps.rec('stop');
            return Promise.resolve(deps.share()).then((x) => (x && x.url ? 'share ' + x.url : 'error ' + (x && x.error ? x.error : 'share')),
                (e) => 'error ' + (e && e.message ? e.message : e));
        }
        const m = /^show(?: (sport|normal))?$/.exec(text);
        if (!m) return Promise.resolve('error unknown command');
        deps.reload();
        const speed = deps.speedKmh();
        if (speed !== null && speed >= cfg.show_max_kmh) return Promise.resolve('moving');
        return Promise.resolve('ok ' + deps.show(m[1] || null));
    };
}

/* the socket at sockPath (a stale file from a crashed run removed first); gid: the app's group, null = leave it */
function listen(sockPath, gid, handle, deps) {
    try { deps.fs.unlinkSync(sockPath); } catch (e) { /* none there */ }
    const server = deps.net.createServer((conn) => {
        let buf = '', done = false;
        const reply = (text) => { if (!done) { done = true; conn.end(text + '\n'); } };
        if (conn.setTimeout) conn.setTimeout(10000, () => conn.destroy());
        conn.on('error', () => {});
        conn.on('data', (d) => {
            if (done) return;
            buf += d;
            const nl = buf.indexOf('\n');
            if (nl < 0 && buf.length <= MAX_LINE) return;
            if ((nl < 0 ? buf.length : nl) > MAX_LINE) { reply('error line too long'); return; }
            handle(buf.slice(0, nl).replace(/\r$/, '')).then(reply, (e) => reply('error ' + e));
        });
    });
    server.on('error', () => {});
    return new Promise((resolve) => server.listen(sockPath, () => {
        deps.fs.chmodSync(sockPath, 0o660);
        if (gid !== null && gid !== undefined) deps.fs.chownSync(sockPath, 0, gid);
        resolve(server);
    }));
}

module.exports = { createHandler, listen };
