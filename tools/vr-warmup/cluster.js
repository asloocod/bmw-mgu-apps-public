'use strict';
/*
 * cluster.js - the warm-up icon's layer on the instrument cluster through cluster-render (robertnisipeanu/idrive-apps,
 * native/cluster-render/PROTOCOL.md): one effect layer, class overlay, a size x size square at x, y of the `panel`
 * target (slot 0x203, the whole 1920x720 cluster over the gauges, under the telltales), drawn by icon.js's shader.
 * Made hidden; shown while wanted (setActive) and allowed. Only changes are sent.
 *
 * Allowed only once cluster-render's status, asked after every (re)connect, shows the panel with a scene of its
 * own. cluster-render's default gives the panel the HUD's scene 0x01000400, and two targets with one scene are never
 * up at once: the first to ask holds it. Shown with it, the icon would keep vr-hud-turn's arrows off the HUD for the
 * whole warm-up. The fix is cluster-render's local config (README): panel_scene_id = 0x010004f2.
 * The link going hides the icon at once: the client makes the layer again on its own with what it last had.
 */

const { shader } = require('./icon');

const ANSWER_MS = 5000;
const ASK_AGAIN_MS = 30000;
const FIX = 'set panel_scene_id = 0x010004f2 (and add it to scene_ids_allowed) in ' +
    '/var/opt/cluster-render/cluster-render.local.conf, see the README';

/* { panel, hud }: each target's scene id as the status text writes it (hex, 0x10004f2), or null */
function parseScenes(text) {
    const out = { panel: null, hud: null };
    const re = /^target (\w+): slot 0x[0-9a-f]+ scene (0x[0-9a-f]+)/gm;
    let m;
    while ((m = re.exec(String(text))) !== null) {
        if (Object.prototype.hasOwnProperty.call(out, m[1])) out[m[1]] = m[2];
    }
    return out;
}

/* timers: { setTimeout, clearTimeout } */
function createCluster(client, cfg, log, timers) {
    const fragmentShader = shader(cfg);
    let ref = 0, want = false, allowed = false, visible = 0, timer = null, said = null, saidNoAnswer = false;

    function apply() {
        const v = want && allowed ? 1 : 0;
        if (!ref || visible === v) return;
        visible = v;
        client.set(ref, { visible: v });
    }

    function stopAsking() {
        if (timer !== null) timers.clearTimeout(timer);
        timer = null;
    }

    function ask(wait) {
        stopAsking();
        timer = timers.setTimeout(() => {
            timer = null;
            if (!saidNoAnswer) log('panel: no status answer from cluster-render, asking again every ' + ASK_AGAIN_MS / 1000 + ' s');
            saidNoAnswer = true;
            client.status();
            ask(ASK_AGAIN_MS);
        }, wait);
    }

    function verdict(text) {
        stopAsking();
        const sc = parseScenes(text);
        let line;
        if (!sc.panel) {
            allowed = false;
            line = 'panel: no panel target in cluster-render, the icon stays off';
        } else if (sc.hud && sc.hud === sc.panel) {
            allowed = false;
            line = 'panel: its scene ' + sc.panel + ' is the hud\'s, the icon stays off so the HUD arrows keep working: ' + FIX;
        } else {
            allowed = true;
            line = 'panel: scene ' + sc.panel + ' of its own, the icon may show';
        }
        if (line !== said) log(line);
        said = line;
        apply();
    }

    return {
        start() {
            ref = client.effect({ target: 'panel', klass: 'overlay', x: cfg.x, y: cfg.y, w: cfg.size, h: cfg.size,
                fs: fragmentShader, visible: 0 });
            if (!ref) {
                log('panel: cluster-render client refused the layer');
                return false;
            }
            client.on('ready', () => {
                log('panel: connected to cluster-render, asking which scene the panel has');
                saidNoAnswer = false;
                client.status();
                ask(ANSWER_MS);
            });
            client.on('status', verdict);
            client.on('disconnected', () => {
                stopAsking();
                allowed = false;
                apply();
                log('panel: cluster-render disconnected, reconnecting');
            });
            client.on('target', (name, state, holder, reason, guideDisabled, disabled) => {
                if (name !== 'panel') return;
                log('panel: target ' + state + (holder ? ' holder=' + holder : '') + (reason ? ' (' + reason + ')' : '') +
                    (disabled ? ' disabled by the mapping guard' : ''));
            });
            client.on('layer', (r, state, reason) => {
                if (r === ref) log('panel: layer ' + state + (reason ? ' (' + reason + ')' : ''));
            });
            client.on('refused', (op, r, reason) => log('panel: refused ' + op + ': ' + reason));
            client.connect();
            return true;
        },
        /* the icon wanted on or off */
        setActive(on) {
            want = !!on;
            apply();
        },
    };
}

module.exports = { parseScenes, createCluster };
