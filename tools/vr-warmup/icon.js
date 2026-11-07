'use strict';
/*
 * icon.js - the warm-up icon: a thermometer over two waves (the temperature telltale's shape, drawn blue), in the
 * unit square of its layer (u right, v down: cluster-render's v_uv, 0,0 at the top-left). One shape, two forms:
 * coverage() in JavaScript for the tests, shader() as the GLSL ES 1.00 fragment shader of an effect layer.
 *
 * Signed distances: the stem and the three ticks are capsules (a segment with a radius), the bulb a circle, each wave
 * a band of half-width `half` about v0 + amp * sin(2 pi (u - u0) / period) over u0..u1 (its vertical distance:
 * close enough at this slope), rounded at the ends. d = the nearest of them; coverage = clamp(0.5 - d / aa, 0, 1),
 * aa = one pixel of the layer (1 / size): a smooth 1 px edge. Outside the shape: transparent. The colour goes out
 * premultiplied (colour * a, a): nothing at all outside the shape whichever way the cluster blends an effect layer
 * (not documented); with straight alpha blending the 1 px edge only comes out a little darker.
 */

const SHAPE = Object.freeze({
    stem: { a: [0.42, 0.10], b: [0.42, 0.60], r: 0.07 },
    bulb: { c: [0.42, 0.66], r: 0.13 },
    ticks: { u0: 0.53, u1: 0.66, vs: [0.18, 0.30, 0.42], r: 0.025 },
    waves: { u0: 0.08, u1: 0.92, vs: [0.85, 0.94], amp: 0.025, period: 0.28, half: 0.025 },
});

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function capsule(u, v, a, b, r) {
    const pu = u - a[0], pv = v - a[1], bu = b[0] - a[0], bv = b[1] - a[1];
    const h = clamp((pu * bu + pv * bv) / (bu * bu + bv * bv), 0, 1);
    return Math.hypot(pu - bu * h, pv - bv * h) - r;
}

function wave(u, v, v0) {
    const w = SHAPE.waves;
    const uc = clamp(u, w.u0, w.u1);
    const dy = v - (v0 + w.amp * Math.sin(2 * Math.PI * (uc - w.u0) / w.period));
    return Math.hypot(u - uc, dy) - w.half;
}

/* 0 (outside) .. 1 (inside) at u, v; aa: the smoothing width in unit-square units */
function coverage(u, v, aa) {
    const s = SHAPE;
    let d = capsule(u, v, s.stem.a, s.stem.b, s.stem.r);
    d = Math.min(d, Math.hypot(u - s.bulb.c[0], v - s.bulb.c[1]) - s.bulb.r);
    s.ticks.vs.forEach((tv) => { d = Math.min(d, capsule(u, v, [s.ticks.u0, tv], [s.ticks.u1, tv], s.ticks.r)); });
    s.waves.vs.forEach((v0) => { d = Math.min(d, wave(u, v, v0)); });
    return clamp(0.5 - d / aa, 0, 1);
}

/* a GLSL float literal: 72 -> 72.0, 0.15 -> 0.15, never exponent notation */
function f(n) {
    const r = +Number(n).toFixed(4);
    return Number.isInteger(r) ? r.toFixed(1) : String(r);
}
const v2 = (p) => 'vec2(' + f(p[0]) + ', ' + f(p[1]) + ')';

function shader(cfg) {
    const s = SHAPE, w = s.waves, c = cfg.color;
    const lines = [
        '#version 100',
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'float capsule(vec2 p, vec2 a, vec2 b, float r) {',
        '    vec2 pa = p - a;',
        '    vec2 ba = b - a;',
        '    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);',
        '    return length(pa - ba * h) - r;',
        '}',
        'float wave(vec2 p, float v0) {',
        '    float uc = clamp(p.x, ' + f(w.u0) + ', ' + f(w.u1) + ');',
        '    float dy = p.y - (v0 + ' + f(w.amp) + ' * sin(6.2832 * (uc - ' + f(w.u0) + ') / ' + f(w.period) + '));',
        '    float dx = p.x - uc;',
        '    return sqrt(dx * dx + dy * dy) - ' + f(w.half) + ';',
        '}',
        'void main() {',
        '    vec2 p = v_uv;',
        '    float d = capsule(p, ' + v2(s.stem.a) + ', ' + v2(s.stem.b) + ', ' + f(s.stem.r) + ');',
        '    d = min(d, length(p - ' + v2(s.bulb.c) + ') - ' + f(s.bulb.r) + ');',
    ];
    s.ticks.vs.forEach((tv) => lines.push('    d = min(d, capsule(p, ' + v2([s.ticks.u0, tv]) + ', ' +
        v2([s.ticks.u1, tv]) + ', ' + f(s.ticks.r) + '));'));
    w.vs.forEach((v0) => lines.push('    d = min(d, wave(p, ' + f(v0) + '));'));
    lines.push(
        '    float a = clamp(0.5 - d / ' + f(1 / cfg.size) + ', 0.0, 1.0);',
        '    gl_FragColor = vec4(vec3(' + f(c[0]) + ', ' + f(c[1]) + ', ' + f(c[2]) + ') * a, a);',
        '}',
        '');
    return lines.join('\n');
}

module.exports = { SHAPE, coverage, shader };
