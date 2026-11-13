'use strict';
/*
 * arrow.js - the two arrows on cluster-render's HUD canvas (800 x 480 on iDrive 7), as triangles, and the GLSL ES 1.00
 * fragment shader of an effect layer that draws them: uniforms u_left / u_right (0 or 1) light a side, u_y / u_margin /
 * u_size place them (px), u_r / u_g / u_b colour them (0-1, the brightness in them), so place and colour change
 * without a new layer. Everything else is transparent (black, which a HUD
 * shows as nothing). hit() is the shader's test in JavaScript, for the tests; round(x) is floor(x + 0.5) in both.
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

/* the shader: place and colour come from the uniforms */
function shader() {
    return [
        '#version 100',
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'uniform float u_left;',
        'uniform float u_right;',
        'uniform float u_y;',
        'uniform float u_margin;',
        'uniform float u_size;',
        'uniform float u_r;',
        'uniform float u_g;',
        'uniform float u_b;',
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
        '/* the left arrow at p; the right one is its mirror image */',
        'bool arrow(vec2 p) {',
        '    float head = floor(u_size * 0.55 + 0.5);',
        '    float shaft = floor(u_size * 0.5 + 0.5);',
        '    float sh = floor(u_size * 0.36 + 0.5);',
        '    float x0 = u_margin + head;',
        '    float x1 = x0 + shaft;',
        '    float y0 = u_y - sh / 2.0;',
        '    float y1 = u_y + sh / 2.0;',
        '    return tri(p, vec2(u_margin, u_y), vec2(x0, u_y - u_size / 2.0), vec2(x0, u_y + u_size / 2.0)) ||',
        '        tri(p, vec2(x0, y0), vec2(x1, y0), vec2(x1, y1)) ||',
        '        tri(p, vec2(x0, y0), vec2(x1, y1), vec2(x0, y1));',
        '}',
        'void main() {',
        '    vec2 p = v_uv * vec2(' + f(W) + ', ' + f(H) + ');',
        '    bool l = u_left > 0.5 && arrow(p);',
        '    bool r = u_right > 0.5 && arrow(vec2(' + f(W) + ' - p.x, p.y));',
        '    gl_FragColor = (l || r) ? vec4(u_r, u_g, u_b, 1.0) : vec4(0.0);',
        '}',
        '',
    ].join('\n');
}

module.exports = { W, H, triangles, hit, shader };
