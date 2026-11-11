// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const P = require('../js/core.js');

const doc = (layers, extra = {}) => ({
  name: 'test',
  symmetry: 'none',
  output: { mode: 'peak', peak: 2000, flux: 800, watts: 10 },
  layers,
  ...extra,
});

const lobe = (id, aimV, aimH) => ({ id, type: 'beam', enabled: true, blend: 'add', gain: 0, mix: 1, radius: 12, soft: 4, taper: 0, aimV, aimH });

// Reads a parsed file back at the 256 x 256 grid positions, normalized to its peak.
function bake(parsed) {
  const out = new Float32Array(256 * 256);
  const peak = Math.max(...parsed.cd);
  for (let y = 0, i = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++, i++) out[i] = P.sampleIES(parsed, (y / 256) * 360, (x / 256) * 180) / peak;
  }
  return out;
}

function maxError(a, b) {
  let e = 0;
  for (let i = 0; i < a.length; i++) e = Math.max(e, Math.abs(a[i] - b[i]));
  return e;
}

test('asymmetric export lands on the grid when read back', () => {
  const d = doc([lobe(1, 30, 90), lobe(2, 45, 200)]);
  const c = P.composite(d);
  const parsed = P.parseIES(P.writeIES(d, c));
  assert.strictEqual(parsed.h.length, 257);
  assert.ok(maxError(bake(parsed), c.N) < 1e-4);
});

for (const [symmetry, planes] of [['axial', 1], ['quadrant', 65], ['bilateral', 129]]) {
  test(`${symmetry} export uses ${planes} planes and reads back unchanged`, () => {
    const d = doc([lobe(1, 25, 40)], { symmetry });
    const c = P.composite(d);
    const parsed = P.parseIES(P.writeIES(d, c));
    assert.strictEqual(parsed.h.length, planes);
    assert.ok(maxError(bake(parsed), c.N) < 1e-4);
  });
}

test('a file symmetric about the 90-270 plane unfolds correctly', () => {
  const data = { v: [0, 90], h: [90, 180, 270], cd: [1, 1, 2, 2, 3, 3] };
  assert.strictEqual(P.sampleIES(data, 135, 10), 1.5);
  assert.strictEqual(P.sampleIES(data, 45, 10), 1.5);
  assert.strictEqual(P.sampleIES(data, 315, 10), 2.5);
});

test('peak candela and recipe round trip', () => {
  const d = doc([lobe(1, 0, 0)]);
  const parsed = P.parseIES(P.writeIES(d, P.composite(d)));
  assert.strictEqual(Math.round(parsed.peak), 2000);
  assert.deepStrictEqual(parsed.doc, d);
  assert.strictEqual(parsed.v.at(-1), 180);
});

test('no header line is overly long', () => {
  const d = doc([lobe(1, 0, 0)]);
  const header = P.writeIES(d, P.composite(d)).split('TILT=NONE')[0].split('\r\n');
  assert.ok(header.every((s) => s.length < 255));
});

test('flux mode solves the peak from lumens', () => {
  const d = doc([lobe(1, 0, 0)]);
  d.output.mode = 'flux';
  const c = P.composite(d);
  assert.ok(Math.abs(c.flux - 800) < 1e-6);
  assert.ok(Math.abs(c.peak * c.integral - 800) < 1e-6);
});

test('unlocked output only changes the angles an edit touches', () => {
  const base = { id: 1, type: 'sliders', enabled: true, blend: 'normal', gain: 0, mix: 1, step: 10, spikes: 0, c90: null, c0: [1, 0.8, 0.5, 0.2, 0, 0, 0, 0, 0, 0] };
  const d = doc([base]);
  d.output = { ...d.output, mode: 'free', scale: 1000 };
  const before = P.composite(d);
  base.c0[9] = 1;
  const after = P.composite(d);
  assert.strictEqual(after.peak, before.peak);
  assert.ok(Math.abs(P.sample(after.N, 10, 0) * after.peak - P.sample(before.N, 10, 0) * before.peak) < 1e-3);
  assert.ok(after.flux > before.flux * 1.5, 'total lumens rise with the added light');

  // A lumen lock is the opposite: the same edit dims everything else.
  d.output.mode = 'flux';
  d.output.flux = before.flux;
  base.c0[9] = 0;
  const lockedBefore = P.composite(d).peak;
  base.c0[9] = 1;
  assert.ok(P.composite(d).peak < lockedBefore);
});

test('a drawn stroke replaces only what it passes over', () => {
  const base = [{ a: 0, v: 1, s: 0 }, { a: 15, v: 0.8, s: 0.5 }, { a: 30, v: 0.4, s: 0 }, { a: 180, v: 0, s: 0 }];
  const out = P.applyStroke(base, [{ a: 10, v: 0.2, s: 0 }, { a: 20, v: 0.3, s: 0 }]);
  assert.deepStrictEqual(out.map((p) => p.a), [0, 10, 20, 30, 180]);
  assert.strictEqual(out[0].v, 1);
  assert.strictEqual(out[3].v, 0.4);
});

test('simplifying a stroke keeps its shape with far fewer points', () => {
  const stroke = [];
  for (let a = 0; a <= 60; a += 0.5) stroke.push({ a, v: a < 30 ? 1 - a / 60 : 0.5 - (a - 30) / 60, s: 0 });
  const out = P.simplifyCurve(stroke, 0.005);
  assert.ok(out.length <= 4, `got ${out.length} points`);
  const T = P.curveTable(out, false);
  assert.ok(Math.abs(T[300] - 0.5) < 0.03);
  assert.strictEqual(out[0].a, 0);
  assert.strictEqual(out.at(-1).a, 60);
});

test('adjustment layers at their defaults change nothing', () => {
  const base = { ...lobe(1, 0, 0), blend: 'normal', soft: 20 };
  const before = P.composite(doc([base])).N;
  const adjustments = [
    { id: 2, type: 'tonecurve', enabled: true, mix: 1, points: [{ a: 0, v: 0 }, { a: 1, v: 1 }] },
    { id: 3, type: 'levels', enabled: true, mix: 1, inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 },
    { id: 4, type: 'contrast', enabled: true, mix: 1, amount: 0, pivot: 0.18 },
  ];
  for (const adjustment of adjustments) {
    assert.ok(maxError(P.composite(doc([base, adjustment])).N, before) < 2e-3, adjustment.type);
  }
});

test('adjustment layers reshape the stack below them', () => {
  const base = { ...lobe(1, 0, 0), blend: 'normal', radius: 40, soft: 60 };
  const level = (l) => P.sample(P.composite(doc([base, { id: 2, enabled: true, mix: 1, ...l }])).N, 25, 0);
  const plain = P.sample(P.composite(doc([base])).N, 25, 0);
  assert.ok(level({ type: 'levels', inBlack: 0, inWhite: 1, gamma: 2, outBlack: 0, outWhite: 1 }) > plain, 'gamma lifts mids');
  assert.ok(level({ type: 'contrast', amount: 0.5, pivot: 0.9 }) < plain, 'contrast drops below its pivot');
  assert.ok(level({ type: 'tonecurve', points: [{ a: 0, v: 0 }, { a: 0.5, v: 0.8 }, { a: 1, v: 1 }] }) > plain, 'curve lift');
  assert.ok(Math.abs(level({ type: 'contrast', amount: 1, pivot: 0.9, mix: 0 }) - plain) < 1e-6, 'mix of 0 is off');
  const hidden = P.composite(doc([base, { id: 2, type: 'contrast', enabled: false, amount: 1, pivot: 0.5 }])).N;
  assert.ok(Math.abs(P.sample(hidden, 25, 0) - plain) < 1e-6, 'hidden adjustment is off');
});

test('view-matching curves carry a look between the map views', () => {
  const linearView = (n) => Math.pow(n, 1 / 2.2);
  const stopsView = (n) => Math.max(0, 1 + Math.log2(Math.max(n, 1e-6)) / P.STOPS);
  const curve = (kind) => P.adjustment({ type: 'tonecurve', points: P.viewCurve(kind) });
  const toLinear = curve('stops-in-linear'), toStops = curve('linear-in-stops');
  assert.ok(P.viewCurve('stops-in-linear').length < 40, 'stays editable');
  for (const n of [1, 0.75, 0.5, 0.25, 0.1, 0.03, 0.01, 0.003, 0.001]) {
    assert.ok(Math.abs(linearView(toLinear(n)) - stopsView(n)) < 0.02, `stops look at ${n}`);
    assert.ok(Math.abs(stopsView(toStops(n)) - linearView(n)) < 0.04, `linear look at ${n}`);
  }
});

test('source count multiplies per-source lumens', () => {
  const d = doc([lobe(1, 0, 0)]);
  d.output = { ...d.output, mode: 'flux', flux: 181000, count: 8 };
  assert.ok(Math.abs(P.composite(d).flux - 1448000) < 1e-3);
});

test('brightness references match the PBL catalog', () => {
  const refs = require('../js/references.js');
  assert.strictEqual(refs.length, 16);
  assert.ok(refs.every((r) => r.description && r.source));
  const totals = refs.map((r) => r.lumens * r.count);
  assert.deepStrictEqual(totals, [...totals].sort((a, b) => a - b));
  assert.strictEqual(totals[0], 12.57);
  assert.strictEqual(totals.at(-1), 1448000);
});

test('a uniform sphere integrates to 4 pi', () => {
  const d = doc([{ id: 9, type: 'curve', enabled: true, blend: 'normal', gain: 0, mix: 1, points: [{ a: 0, v: 1 }, { a: 180, v: 1 }] }]);
  assert.ok(Math.abs(P.composite(d).integral - 4 * Math.PI) < 0.01);
});

test('H orientation follows the map layout', () => {
  // Lobe at H=90 should peak toward light -Z, which is screen down in the map.
  const d = doc([lobe(1, 30, 90)]);
  const N = P.composite(d).N;
  assert.ok(P.sample(N, 30, 90) > 0.9);
  assert.ok(P.sample(N, 30, 270) < 0.01);
  const w = P.dir(30, 90);
  assert.ok(w[2] < 0, 'H=90 points toward -Z');
  assert.ok(Math.abs(w[1]) < 1e-9);
});

test('layerToGrid and gridToLayer are inverses', () => {
  const l = { aimV: 35, aimH: 120, roll: 20, squash: 0.6 };
  const [v, h] = P.layerToGrid(l, 18, 75);
  const [t, ph] = P.gridToLayer(l, v, h);
  assert.ok(Math.abs(t - 18) < 1e-6);
  assert.ok(Math.abs(ph - 75) < 1e-6);
});

test('sharpness of 1 gives a hard step at the segment midpoint', () => {
  const T = P.curveTable([{ a: 10, v: 1, s: 1 }, { a: 30, v: 0, s: 0 }], false);
  assert.ok(T[199] > 0.95);
  assert.ok(T[201] < 0.05);
});

test('spot cone falloff follows its formula, and export ignores it', () => {
  const terms = P.coneTerms({ inner: 10, outer: 30 });
  assert.strictEqual(P.coneFactor(terms, 5), 1);
  assert.strictEqual(P.coneFactor(terms, 31), 0);
  const mid = (Math.cos((20 * Math.PI) / 180) - Math.cos((30 * Math.PI) / 180)) / (Math.cos((10 * Math.PI) / 180) - Math.cos((30 * Math.PI) / 180));
  assert.ok(Math.abs(P.coneFactor(terms, 20) - mid * mid) < 1e-9);
  const clamped = P.coneTerms({ inner: 0, outer: 200 });
  assert.ok(Math.abs(clamped.cosOuter - Math.cos((88.9 * Math.PI) / 180 + 0.001)) < 1e-9);
  const wide = doc([lobe(1, 40, 0)], { lightType: 'spot', cone: { inner: 0, outer: 5 } });
  const narrow = doc([lobe(1, 40, 0)], { lightType: 'spot', cone: { inner: 0, outer: 80 } });
  const table = (d) => P.writeIES(d, P.composite(d)).split('TILT=NONE')[1];
  assert.strictEqual(table(wide), table(narrow));
});

test('multiply blend and clip behave as compositing', () => {
  const base = { ...lobe(1, 0, 0), blend: 'normal' };
  const cut = { id: 2, type: 'cutoff', enabled: true, blend: 'multiply', gain: 0, mix: 1, bearing: 180, edge: 0, soft: 0.5 };
  const N = P.composite(doc([base, cut])).N;
  assert.ok(P.sample(N, 5, 0) > 0.9, 'kept side');
  assert.ok(P.sample(N, 5, 180) < 0.01, 'cut side');
});

test('missing or TILT files give a useful error', () => {
  assert.throws(() => P.parseIES('hello'), /does not look like an IES/);
  assert.throws(() => P.parseIES('IESNA91\nTILT=INCLUDE\n'), /TILT data/);
});

test('the earlier orientation test file imports', () => {
  const text = require('node:fs').readFileSync(require('node:path').join(__dirname, 'orientation_test.ies'), 'utf8');
  const parsed = P.parseIES(text);
  assert.strictEqual(parsed.h.length, 73);
  assert.ok(P.sampleIES(parsed, 90, 30) > 900);
});

test('a file with more values than a spread can hold still opens', () => {
  const nV = 361, nH = 721;
  const angles = (n, span) => Array.from({ length: n }, (_, i) => +((i * span) / (n - 1)).toFixed(4)).join(' ');
  const text = ['IESNA:LM-63-2002', 'TILT=NONE', `1 1000 1 ${nV} ${nH} 1 2 0 0 0`, '1 1 10', angles(nV, 180), angles(nH, 360), new Array(nV * nH).fill(5).join(' ')].join('\n');
  const parsed = P.parseIES(text);
  assert.strictEqual(parsed.cd.length, nV * nH);
  assert.strictEqual(parsed.peak, 5);
  const baked = P.bakeIES(parsed);
  assert.strictEqual(baked.peak, 5);
  assert.ok(Math.abs(baked.N[1234] - 1) < 1e-6);
});

test('a recipe without usable layers is ignored, not loaded', () => {
  const comp = P.composite(doc([lobe(1, 0, 0)]));
  const good = P.writeIES(doc([lobe(1, 0, 0)]), comp);
  assert.ok(P.parseIES(good).doc);
  const empty = Buffer.from(JSON.stringify({ layers: [], output: {} })).toString('base64');
  const bad = good.split('\r\n').filter((s) => !s.startsWith('[_PENUMBRA_RECIPE]'));
  bad.splice(1, 0, '[_PENUMBRA_RECIPE]' + empty);
  assert.strictEqual(P.parseIES(bad.join('\r\n')).doc, null);
});

test('colour temperature is neutral at 6500 K and never changes luminance', () => {
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  P.kelvinRGB(6500).forEach((x) => assert.ok(Math.abs(x - 1) < 1e-9));
  for (const k of [1500, 2700, 4000, 9000, 12000]) assert.ok(Math.abs(luma(P.kelvinRGB(k)) - 1) < 1e-9);
  const warm = P.kelvinRGB(2700), cool = P.kelvinRGB(10000);
  assert.ok(warm[0] > warm[2] && cool[2] > cool[0]);
});
