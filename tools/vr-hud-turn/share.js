'use strict';
/*
 * share.js - "Отдать лог на телефон" in the app: for open_ms a small page on the car's hotspot, the same way the
 * Store's phone page works (robertnisipeanu/mgu-store native/mgu-updater/js/web.js): an HTTP server on the hotspot
 * interface's address, and while it is open one rule at the top of the unit firewall's input chain (nft table ip
 * filter, tagged with a comment) accepts its port from that interface. The address carries a random code, so another
 * phone on the hotspot cannot guess it. The page offers one file: the recording and events.log.
 *
 *   GET /<code>                     the page
 *   GET /<code>/vr-hud-turn-log.txt the file
 */
const NFT_COMMENT = 'vr-hud-turn-log';

/* deps: { http, nft(args) -> Promise<stdout>, ifaceAddr(name) -> IPv4 | null, logText() -> string, code() -> string,
 * setTimeout, clearTimeout, log }; cfg: { port, iface, open_ms } */
function createShare(cfg, deps) {
    let server = null, url = null, timer = null, code = null;

    function ruleHandles() {
        return deps.nft(['-a', 'list', 'chain', 'ip', 'filter', 'input']).then((out) => String(out).split('\n')
            .filter((line) => line.indexOf('comment "' + NFT_COMMENT + '"') >= 0)
            .map((line) => /# handle (\d+)\s*$/.exec(line))
            .filter(Boolean)
            .map((m) => m[1]), () => null);
    }
    function removeRules() {
        return ruleHandles().then((hs) => (hs || []).reduce((p, h) =>
            p.then(() => deps.nft(['delete', 'rule', 'ip', 'filter', 'input', 'handle', h])), Promise.resolve()));
    }
    function addRule() {
        return ruleHandles().then((hs) => {
            if (!hs) return undefined;       // no unit firewall here
            if (hs.length) return undefined; // already in
            return deps.nft(['insert', 'rule', 'ip', 'filter', 'input', 'iifname', '"' + cfg.iface + '"',
                'tcp', 'dport', String(cfg.port), 'accept', 'comment', '"' + NFT_COMMENT + '"']);
        });
    }

    function page() {
        return '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Лог поворотников на HUD</title>' +
            '<style>body{font:18px -apple-system,sans-serif;margin:24px;line-height:1.4}' +
            'a{display:block;padding:16px;margin:16px 0;background:#0a7;color:#fff;text-align:center;border-radius:12px;text-decoration:none}</style>' +
            '</head><body><h1>Лог поворотников на HUD</h1>' +
            '<a href="/' + code + '/vr-hud-turn-log.txt" download>Скачать лог</a>' +
            '<p>Файл сохранится на телефон. Отправьте его в Telegram тому, кто просил лог.</p></body></html>';
    }

    function onRequest(req, res) {
        const p = String(req.url || '').split('?')[0];
        if (req.method === 'GET' && p === '/' + code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(page());
        } else if (req.method === 'GET' && p === '/' + code + '/vr-hud-turn-log.txt') {
            let text;
            try { text = deps.logText(); } catch (e) { text = 'error: ' + e; }
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
                'Content-Disposition': 'attachment; filename="vr-hud-turn-log.txt"' });
            res.end(text);
            deps.log('share: the log was downloaded');
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('not found');
        }
    }

    function close(why) {
        if (timer !== null) deps.clearTimeout(timer);
        timer = null;
        if (server) {
            try { server.close(); } catch (e) { /* closed */ }
            deps.log('share: closed (' + why + ')');
        }
        server = null;
        url = null;
        return removeRules().catch((e) => deps.log('share: ' + e.message));
    }

    function arm() {
        if (timer !== null) deps.clearTimeout(timer);
        timer = deps.setTimeout(() => { timer = null; close('time'); }, cfg.open_ms);
    }

    /* the page open (again for open_ms when it already is): { url } or { error } */
    function open() {
        if (server) { arm(); return Promise.resolve({ url }); }
        const ip = deps.ifaceAddr(cfg.iface);
        if (!ip) return Promise.resolve({ error: 'no hotspot' });
        code = deps.code();
        return removeRules().then(() => new Promise((resolve) => {
            const s = deps.http.createServer(onRequest);
            s.on('error', (e) => resolve({ error: 'listen ' + (e && e.code ? e.code : e) }));
            s.listen(cfg.port, ip, () => {
                server = s;
                url = 'http://' + ip + ':' + cfg.port + '/' + code;
                resolve(addRule().then(() => {
                    arm();
                    deps.log('share: open at ' + url + ' for ' + Math.round(cfg.open_ms / 60000) + ' min');
                    return { url };
                }, (e) => { close('firewall'); return { error: 'firewall: ' + e.message }; }));
            });
        }));
    }

    return { open, close, isOpen: () => server !== null };
}

module.exports = { NFT_COMMENT, createShare };
