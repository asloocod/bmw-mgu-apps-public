'use strict';
/*
 * arrow.js - the two arrows on cluster-render's HUD canvas (800 x 480 on iDrive 7), as triangles, and the GLSL ES 1.00
 * fragment shader of an effect layer that draws them: uniforms u_left / u_right (0 or 1) light a side. Everything
 * else is transparent (black, which a HUD shows as nothing). hit() is the shader's test in JavaScript, for the tests.
 *
 * Left arrow, s = size, m = margin: a head [m, y] [m + head, y - s/2] [m + head, y + s/2], head = round(s * 0.55),
 * and a shaft from m + head to m + head + round(s * 0.5), round(s * 0.36) high. The right arrow is its mirror image.
 */

const W = 800;
const H = 480;

function triangles(cfg) {
    const s = cfg.size, m = cfg.margin, y = cfg.y;
    const head = Math.round(s * 0.55), shaft = Math.round(s * 0.5), sh = Math.round(s * 0.36);
    const x0 = m + head, x1 = m + head + shaft, y0 = y - sh / 2, y1 = y + sh / 2;
    const left = [
        [[m, y], [x0, y - s / 2], [x0, y + s / 2]],
        [[x0, y0], [x1, y0], [x1, y1]],
        [[x0, y0], [x1, y1], [x0, y1]],
    ];
    const right = left.map((tri) => tri.map((p) => [W - p[0], p[1]]));
    return { left, right };
}

/* which side of the edge a -> b the point is on; 0 on the edge */
const side = (p, a, b) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

function inTri(p, t) {
    const d = [side(p, t[0], t[1]), side(p, t[1], t[2]), side(p, t[2], t[0])];
    const neg = d.some((v) => v < 0), pos = d.some((v) => v > 0);
    return !(neg && pos);
}

function hit(cfg, which, x, y) {
    return triangles(cfg)[which].some((t) => inTri([x, y], t));
}

/* a GLSL float literal: 40 -> 40.0, 0.85 -> 0.85, never exponent notation */
function f(n) {
    const r = +Number(n).toFixed(4);
    return Number.isInteger(r) ? r.toFixed(1) : String(r);
}
const v2 = (p) => 'vec2(' + f(p[0]) + ', ' + f(p[1]) + ')';
const any = (tris) => tris.map((t) => 'tri(p, ' + t.map(v2).join(', ') + ')').join(' || ');

function shader(cfg) {
    const t = triangles(cfg), c = cfg.color;
    return [
        '#version 100',
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'uniform float u_left;',
        'uniform float u_right;',
        'varying vec2 v_uv;',
        'float side(vec2 p, vec2 a, vec2 b) { return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); }',
        'bool tri(vec2 p, vec2 a, vec2 b, vec2 c) {',
        '    float d1 = side(p, a, b);',
        '    float d2 = side(p, b, c);',
        '    float d3 = side(p, c, a);',
        '    bool neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;',
        '    bool pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;',
        '    return !(neg && pos);',
        '}',
        'void main() {',
        '    vec2 p = v_uv * vec2(' + f(W) + ', ' + f(H) + ');',
        '    bool l = u_left > 0.5 && (' + any(t.left) + ');',
        '    bool r = u_right > 0.5 && (' + any(t.right) + ');',
        '    gl_FragColor = (l || r) ? vec4(' + f(c[0]) + ', ' + f(c[1]) + ', ' + f(c[2]) + ', 1.0) : vec4(0.0);',
        '}',
        '',
    ].join('\n');
}

module.exports = { W, H, triangles, hit, shader };
