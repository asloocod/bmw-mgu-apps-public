'use strict';
/*
 * hud.js - the arrows' layer on the HUD through cluster-render (robertnisipeanu/idrive-apps,
 * native/cluster-render/PROTOCOL.md): one effect layer over the whole `hud` target, class overlay, drawn by
 * arrow.js's shader; u_left / u_right light a side. The layer is made hidden and shown only while an indicator is
 * on (setActive): the HUD slot shares its scene with cluster-render's `panel` target, and on the car the slot came
 * within 37 ms (2026-11-07), so holding it buys nothing. cluster-render keeps it 3 s after (hud_linger_ms).
 * Only changes are sent. The client reconnects by itself and makes the layer again with its last settings.
 */

const NOT_REACHABLE_MS = 5000;

/* opts.setTimeout / clearTimeout: to say once that cluster-render was not reachable NOT_REACHABLE_MS after the start */
function createHud(client, fragmentShader, log, opts) {
    let ref = 0;
    let ready = false;
    let check = null;
    let visible = 0;
    const sent = { u_left: null, u_right: null };

    function send(name, on) {
        const v = on ? 1 : 0;
        if (!ref || sent[name] === v) return;
        sent[name] = v;
        client.uniform(ref, name, [v]);
    }

    return {
        start() {
            ref = client.effect({ target: 'hud', klass: 'overlay', fs: fragmentShader, visible: 0 });
            if (!ref) {
                log('hud: cluster-render client refused the layer');
                return false;
            }
            send('u_left', false);
            send('u_right', false);
            client.on('ready', () => {
                ready = true;
                if (check !== null && opts.clearTimeout) opts.clearTimeout(check);
                check = null;
                log('hud: connected to cluster-render');
            });
            client.on('disconnected', () => { ready = false; log('hud: cluster-render disconnected, reconnecting'); });
            client.on('target', (name, state, holder, reason, guideDisabled, disabled) => {
                if (name !== 'hud') return;
                log('hud: target ' + state + (holder ? ' holder=' + holder : '') + (reason ? ' (' + reason + ')' : '') +
                    (disabled ? ' disabled by the mapping guard' : ''));
            });
            client.on('layer', (r, state, reason) => log('hud: layer ' + state + (reason ? ' (' + reason + ')' : '')));
            client.on('refused', (op, r, reason) => log('hud: refused ' + op + ': ' + reason));
            client.connect();
            if (opts && opts.setTimeout && !ready) {
                check = opts.setTimeout(() => {
                    check = null;
                    if (!ready) log('hud: cluster-render not reachable after ' + NOT_REACHABLE_MS / 1000 + ' s (installed? its socket up?)');
                }, NOT_REACHABLE_MS);
            }
            return true;
        },
        /* the layer shown (the HUD slot asked for) or hidden */
        setActive(active) {
            const v = active ? 1 : 0;
            if (!ref || visible === v) return;
            visible = v;
            client.set(ref, { visible: v });
        },
        show(s) {
            send('u_left', s.left);
            send('u_right', s.right);
        },
    };
}

module.exports = { createHud };
