// Profile engine: layers, compositing and IES read/write. No DOM, so Node tests can load it.
// The working grid is 256 x 256: V = x * 180 / 256, H = y * 360 / 256.
(function (root) {
  const SIZE = 256;
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const P = { SIZE };

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (a, b, x) => {
    if (b <= a) return x < a ? 0 : 1;
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // Frame components: f = forward, r = screen right (light +Y), u = screen up (light +Z).
  // Seen along the beam with the light's +Z up: H=0 left, H=90 down, H=180 right, H=270 up.
  const dir = (v, h) => {
    const s = Math.sin(v * RAD);
    return [Math.cos(v * RAD), -s * Math.cos(h * RAD), -s * Math.sin(h * RAD)];
  };
  const toVH = (f, r, u) => {
    let h = Math.atan2(-u, -r) * DEG;
    if (h < 0) h += 360;
    return [Math.acos(clamp(f, -1, 1)) * DEG, h];
  };
  P.dir = dir;

  // A loop, because spreading a large file's values into Math.max overflows the stack.
  const maxOf = (values) => {
    let m = -Infinity;
    for (let i = 0; i < values.length; i++) if (values[i] > m) m = values[i];
    return m;
  };
  P.maxOf = maxOf;

  const gF = new Float64Array(SIZE * SIZE);
  const gR = new Float64Array(SIZE * SIZE);
  const gU = new Float64Array(SIZE * SIZE);
  for (let y = 0, i = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++, i++) {
      const d = dir((x * 180) / SIZE, (y * 360) / SIZE);
      gF[i] = d[0]; gR[i] = d[1]; gU[i] = d[2];
    }
  }

  // Rotates the frame so forward lands on the layer's aim direction.
  function aimBasis(l) {
    const A = dir(l.aimV || 0, l.aimH || 0);
    const s = Math.hypot(A[1], A[2]);
    if (s < 1e-9) {
      return A[0] > 0 ? { A: [1, 0, 0], R: [0, 1, 0], U: [0, 0, 1] } : { A: [-1, 0, 0], R: [0, -1, 0], U: [0, 0, 1] };
    }
    const k = [0, -A[2] / s, A[1] / s];
    const c = A[0];
    const rot = (w) => {
      const d = k[1] * w[1] + k[2] * w[2];
      const cr = [k[1] * w[2] - k[2] * w[1], k[2] * w[0], -k[1] * w[0]];
      return [0, 1, 2].map((i) => w[i] * c + cr[i] * s + k[i] * d * (1 - c));
    };
    return { A, R: rot([0, 1, 0]), U: rot([0, 0, 1]) };
  }

  const dot3 = (a, f, r, u) => a[0] * f + a[1] * r + a[2] * u;

  P.gridToLayer = function (l, v, h) {
    const b = aimBasis(l);
    const w = dir(v, h);
    const [t, ph] = toVH(dot3(b.A, w[0], w[1], w[2]), dot3(b.R, w[0], w[1], w[2]), dot3(b.U, w[0], w[1], w[2]));
    const lh = ph - (l.roll || 0);
    const sq = l.squash || 1;
    const x = t * Math.cos(lh * RAD);
    const y = (t * Math.sin(lh * RAD)) / sq;
    return [Math.hypot(x, y), ((Math.atan2(y, x) * DEG) % 360 + 360) % 360];
  };

  P.layerToGrid = function (l, t, h) {
    const sq = l.squash || 1;
    const x = t * Math.cos(h * RAD);
    const y = t * Math.sin(h * RAD) * sq;
    const lt = Math.hypot(x, y);
    const lh = Math.atan2(y, x) * DEG + (l.roll || 0);
    const w = dir(lt, lh);
    const b = aimBasis(l);
    const out = [0, 1, 2].map((i) => b.A[i] * w[0] + b.R[i] * w[1] + b.U[i] * w[2]);
    return toVH(out[0], out[1], out[2]);
  };

  // Monotone cubic through sorted points, sampled every 0.1 degree. Point.s sharpens the
  // segment leaving that point, from smooth (0) to a hard step at its midpoint (1).
  function curveTable(pts, zeroPastEnd) {
    const T = new Float32Array(1801);
    const n = pts.length;
    if (!n) return T;
    const d = [];
    const hs = [];
    for (let i = 0; i < n - 1; i++) {
      hs[i] = Math.max(pts[i + 1].a - pts[i].a, 1e-4);
      d[i] = (pts[i + 1].v - pts[i].v) / hs[i];
    }
    const m = new Array(n).fill(0);
    if (n > 1) {
      m[0] = d[0];
      m[n - 1] = d[n - 2];
      for (let i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] > 0) {
          const w1 = 2 * hs[i] + hs[i - 1];
          const w2 = hs[i] + 2 * hs[i - 1];
          m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
        }
      }
    }
    let seg = 0;
    for (let i = 0; i <= 1800; i++) {
      const a = i / 10;
      if (a <= pts[0].a) { T[i] = pts[0].v; continue; }
      if (a >= pts[n - 1].a) { T[i] = zeroPastEnd && a > pts[n - 1].a ? 0 : pts[n - 1].v; continue; }
      while (seg < n - 2 && a > pts[seg + 1].a) seg++;
      const h = hs[seg];
      const width = Math.max(1 - (pts[seg].s || 0), 0.002);
      const t = clamp(((a - pts[seg].a) / h - 0.5) / width + 0.5, 0, 1);
      const t2 = t * t;
      const t3 = t2 * t;
      const y = (2 * t3 - 3 * t2 + 1) * pts[seg].v + (t3 - 2 * t2 + t) * h * m[seg] +
        (-2 * t3 + 3 * t2) * pts[seg + 1].v + (t3 - t2) * h * m[seg + 1];
      T[i] = Math.max(y, 0);
    }
    return T;
  }
  P.curveTable = curveTable;

  // Reduces a drawn stroke to the few points that hold its shape, so it stays editable by hand.
  P.simplifyCurve = function (pts, tolerance) {
    if (pts.length < 3) return pts.slice();
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let worst = -1, far = tolerance;
      for (let i = a + 1; i < b; i++) {
        const t = (pts[i].a - pts[a].a) / (pts[b].a - pts[a].a);
        const d = Math.abs(pts[a].v + (pts[b].v - pts[a].v) * t - pts[i].v);
        if (d > far) { far = d; worst = i; }
      }
      if (worst >= 0) { keep[worst] = true; stack.push([a, worst], [worst, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };

  // Replaces whatever the stroke passed over and leaves the rest of the curve alone.
  P.applyStroke = function (points, stroke) {
    if (!stroke.length) return points;
    const lo = stroke[0].a, hi = stroke[stroke.length - 1].a;
    const kept = points.filter((p) => p.a < lo - 0.05 || p.a > hi + 0.05);
    return [...kept, ...stroke].sort((p, q) => p.a - q.a);
  };

  const hash = (n, seed) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  function sliderTable(values, step, spikes, seed) {
    const T = curveTable(values.map((v, i) => ({ a: i * step, v })), true);
    if (spikes > 0) {
      for (let i = 0; i <= 1800; i++) {
        const a = i / 10;
        const frac = (a / step) % 1;
        const w = Math.sin(Math.PI * frac) ** 2;
        const c = a / 1.5;
        const c0 = Math.floor(c);
        const n = hash(c0, seed) + (hash(c0 + 1, seed) - hash(c0, seed)) * (c - c0);
        T[i] *= Math.max(0, 1 + spikes * w * (n * 2 - 1) * 1.6);
      }
    }
    return T;
  }

  // Every lattice value a noise field of this frequency can ask for, hashed once. Each grid cell
  // reads eight of them and neighbours share most, so hashing per read did the same work many times.
  function noiseLattice(k, seed) {
    const span = (offset) => [Math.floor(offset - k) - 1, Math.floor(offset + k) + 2];
    const [x0, x1] = span(11), [y0, y1] = span(23), [z0, z1] = span(37);
    const lo = x0 + y0 * 57 + z0 * 131, hi = x1 + y1 * 57 + z1 * 131;
    const table = new Float64Array(hi - lo + 1);
    for (let n = lo; n <= hi; n++) table[n - lo] = hash(n, seed);
    return (a, b, c) => {
      const n = a + b * 57 + c * 131;
      return n >= lo && n <= hi ? table[n - lo] : hash(n, seed);
    };
  }

  function noise3(x, y, z, g) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(g(xi, yi, zi), g(xi + 1, yi, zi), u), l(g(xi, yi + 1, zi), g(xi + 1, yi + 1, zi), u), v),
      l(l(g(xi, yi, zi + 1), g(xi + 1, yi, zi + 1), u), l(g(xi, yi + 1, zi + 1), g(xi + 1, yi + 1, zi + 1), u), v),
      w
    );
  }

  // Spot lights stop at an 88.9 degree half-angle.
  P.coneTerms = function (cone) {
    const max = 88.9 * RAD;
    const inner = clamp(cone.inner, 0, 88.9) * RAD;
    const outer = clamp(cone.outer * RAD, inner + 0.001, max + 0.001);
    const cosOuter = Math.cos(outer);
    return { cosOuter, invRange: 1 / (Math.cos(inner) - cosOuter) };
  };

  // The spot's own falloff at angle V. Never written to the file; the light applies it.
  P.coneFactor = function (terms, v) {
    const t = clamp((Math.cos(v * RAD) - terms.cosOuter) * terms.invRange, 0, 1);
    return t * t;
  };

  // Fractional position of an angle in an ascending list. Angles outside the list hold its end value.
  function angleIndex(list, angle) {
    const last = list.length - 1;
    if (angle <= list[0]) return 0;
    if (angle >= list[last]) return last;
    let lo = 0, hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (list[mid] <= angle) lo = mid; else hi = mid;
    }
    return lo + (angle - list[lo]) / (list[hi] - list[lo]);
  }

  // LM-63 stores only the unique part of a symmetric light. This maps a bearing into that part.
  function foldBearing(h, first, last) {
    if (last === 0) return 0;
    if (last === 90) { const half = h % 180; return half <= 90 ? half : 180 - half; }
    if (last === 180) return h <= 180 ? h : 360 - h;
    if (first === 90 && last === 270) return h < 90 ? 180 - h : h > 270 ? 540 - h : h;
    return h;
  }

  P.sampleIES = function (data, hAngle, vAngle) {
    const H = data.h, V = data.v;
    const hi = angleIndex(H, foldBearing(hAngle, H[0], H[H.length - 1]));
    const vi = angleIndex(V, vAngle);
    const h0 = Math.floor(hi), v0 = Math.floor(vi);
    const h1 = Math.min(h0 + 1, H.length - 1), v1 = Math.min(v0 + 1, V.length - 1);
    const value = (h, v) => data.cd[v + h * V.length];
    const near = value(h0, v0) + (value(h0, v1) - value(h0, v0)) * (vi - v0);
    const far = value(h1, v0) + (value(h1, v1) - value(h1, v0)) * (vi - v0);
    return near + (far - near) * (hi - h0);
  };

  function prepare(l) {
    switch (l.type) {
      case 'sliders': {
        const c0 = sliderTable(l.c0, l.step || 10, l.spikes || 0, (l.seed || 1) + 1);
        const c90 = l.c90 ? sliderTable(l.c90, l.step || 10, l.spikes || 0, (l.seed || 1) + 2) : c0;
        return (t, h) => {
          const i = Math.min(1800, Math.round(t * 10));
          const c = Math.cos(h * RAD);
          const w = c * c;
          return c0[i] * w + c90[i] * (1 - w);
        };
      }
      case 'curve': {
        const T = curveTable([...l.points].sort((a, b) => a.a - b.a), false);
        return (t) => T[Math.min(1800, Math.round(t * 10))];
      }
      case 'imported': {
        const peak = Math.max(1e-6, maxOf(l.data.cd));
        return (t, h) => P.sampleIES(l.data, h, t) / peak;
      }
      case 'beam':
        return (t) => {
          const e = 1 - smooth(l.radius - l.soft / 2, l.radius + l.soft / 2, t);
          return e * (1 - (l.taper || 0) * clamp(t / Math.max(l.radius, 0.01), 0, 1));
        };
      case 'ring':
        return (t) => {
          const a = l.radius - l.width / 2, b = l.radius + l.width / 2, s = l.soft / 2;
          return smooth(a - s, a + s, t) * (1 - smooth(b - s, b + s, t));
        };
      case 'cutoff':
        return (t, h) => {
          const x = t * Math.cos((h - l.bearing) * RAD);
          return 1 - smooth(l.edge - l.soft / 2, l.edge + l.soft / 2, x);
        };
      case 'repeat': {
        const pow = 1 + l.sharp * 24;
        return (t, h) => {
          const band = smooth(l.inner - 2, l.inner + 2, t) * (1 - smooth(l.outer - l.fade, l.outer + l.fade, t));
          return band * Math.pow(0.5 + 0.5 * Math.cos(l.count * (h - l.phase) * RAD), pow);
        };
      }
      default:
        return () => 0;
    }
  }

  function computeField(l, out) {
    const b = aimBasis(l);
    const roll = l.roll || 0;
    const sq = l.squash || 1;
    const isNoise = l.type === 'noise';
    const fn = isNoise ? null : prepare(l);
    const k = isNoise ? 57.3 / Math.max(l.scale, 0.2) : 0;
    const lattice = isNoise ? noiseLattice(k, l.seed || 1) : null;
    // These shapes depend only on the angle from their own axis, so the bearing is never worked out.
    const round = sq === 1 && (l.type === 'beam' || l.type === 'ring' || l.type === 'curve');
    const n = SIZE * SIZE;
    for (let i = 0; i < n; i++) {
      const f = gF[i], r = gR[i], u = gU[i];
      if (isNoise) {
        const v = noise3(f * k + 11, r * k + 23, u * k + 37, lattice);
        out[i] = 1 - l.contrast * (1 - v);
        continue;
      }
      const lf = b.A[0] * f + b.A[1] * r + b.A[2] * u;
      if (round) { out[i] = fn(Math.acos(lf > 1 ? 1 : lf < -1 ? -1 : lf) * DEG, 0); continue; }
      const lr = b.R[0] * f + b.R[1] * r + b.R[2] * u;
      const lu = b.U[0] * f + b.U[1] * r + b.U[2] * u;
      let t = Math.acos(lf > 1 ? 1 : lf < -1 ? -1 : lf) * DEG;
      let h = Math.atan2(-lu, -lr) * DEG - roll;
      if (sq !== 1) {
        const x = t * Math.cos(h * RAD);
        const y = (t * Math.sin(h * RAD)) / sq;
        t = Math.min(180, Math.hypot(x, y));
        h = Math.atan2(y, x) * DEG;
      }
      if (h < 0) h += 360 * Math.ceil(-h / 360);
      out[i] = fn(t, h % 360);
    }
  }

  const cache = new Map();
  const shapeKey = (l) => {
    const { name, blend, gain, mix, enabled, solo, clip, data, ...shape } = l;
    return JSON.stringify(shape) + (data ? data.cd.length + ':' + data.cd[0] + ':' + data.h.length : '');
  };

  P.layerField = function (l) {
    const key = shapeKey(l);
    let c = cache.get(l.id);
    if (!c) { c = { key: null, data: new Float32Array(SIZE * SIZE) }; cache.set(l.id, c); }
    if (c.key !== key) { computeField(l, c.data); c.key = key; }
    return c.data;
  };
  P.forgetLayer = (id) => cache.delete(id);

  // A normalized grid and peak for a parsed file, for use as a comparison reference.
  P.bakeIES = function (parsed) {
    const N = new Float32Array(SIZE * SIZE);
    const peak = Math.max(1e-6, maxOf(parsed.cd));
    for (let y = 0, i = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++, i++) N[i] = Math.max(0, P.sampleIES(parsed, (y * 360) / SIZE, (x * 180) / SIZE)) / peak;
    }
    return { N, peak };
  };

  // Whether a decoded recipe has the parts the editor needs before it replaces the open profile.
  P.validDoc = (d) => !!d && Array.isArray(d.layers) && d.layers.length > 0 && d.layers.every((l) => l && typeof l.type === 'string' && l.id !== undefined)
    && !!d.output && typeof d.output === 'object';

  // Light colour for a temperature in kelvin, as linear RGB with equal luminance, so a tint
  // changes hue without changing how bright the preview reads. 6500 K is neutral.
  P.kelvinRGB = function (kelvin) {
    const raw = (k) => {
      const t = clamp(k, 1000, 40000) / 100;
      const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
      const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
      const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
      return [r, g, b].map((c) => Math.pow(clamp(c, 0, 255) / 255, 2.2));
    };
    const white = raw(6500);
    const c = raw(kelvin).map((x, i) => x / white[i]);
    const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return c.map((x) => x / y);
  };

  function applySymmetry(G, mode) {
    if (mode === 'axial') {
      for (let x = 0; x < SIZE; x++) {
        let sum = 0;
        for (let y = 0; y < SIZE; y++) sum += G[x + y * SIZE];
        sum /= SIZE;
        for (let y = 0; y < SIZE; y++) G[x + y * SIZE] = sum;
      }
    } else if (mode === 'bilateral' || mode === 'quadrant') {
      for (let y = 1; y < SIZE; y++) {
        let src;
        if (mode === 'bilateral') src = y <= 128 ? y : 256 - y;
        else src = y <= 64 ? y : y <= 128 ? 128 - y : y <= 192 ? y - 128 : 256 - y;
        if (src === y) continue;
        for (let x = 0; x < SIZE; x++) G[x + y * SIZE] = G[x + src * SIZE];
      }
    }
  }

  const DISPLAY_GAMMA = 2.2;
  P.isAdjustment = (l) => l.type === 'tonecurve' || l.type === 'levels' || l.type === 'contrast';

  // Maps light relative to the stack's current peak, 0 to 1. Curves and Levels work in display
  // gamma, like a paint program, so the dim end is usable. Contrast works in stops around its pivot.
  P.adjustment = function (l) {
    if (l.type === 'tonecurve') {
      const T = curveTable([...l.points].sort((a, b) => a.a - b.a).map((p) => ({ a: p.a * 180, v: p.v, s: 0 })), false);
      return (n) => {
        const at = Math.pow(Math.max(n, 0), 1 / DISPLAY_GAMMA) * 1800;
        const i = Math.min(Math.floor(at), 1799);
        return Math.pow(T[i] + (T[i + 1] - T[i]) * (at - i), DISPLAY_GAMMA);
      };
    }
    if (l.type === 'levels') {
      const range = Math.max(l.inWhite - l.inBlack, 1e-4);
      const power = 1 / Math.max(l.gamma, 0.01);
      return (n) => {
        const t = clamp((Math.pow(Math.max(n, 0), 1 / DISPLAY_GAMMA) - l.inBlack) / range, 0, 1);
        return Math.pow(l.outBlack + (l.outWhite - l.outBlack) * Math.pow(t, power), DISPLAY_GAMMA);
      };
    }
    const power = Math.pow(2, l.amount * 2);
    const pivot = Math.max(l.pivot, 1e-4);
    return (n) => (n > 0 ? pivot * Math.pow(n / pivot, power) : 0);
  };

  // How far below peak the map's Stops view reaches before drawing black.
  P.STOPS = 12;

  // Curves-layer points that carry a look between the map's views. 'stops-in-linear' makes the
  // Linear view look the way Stops looked; 'linear-in-stops' does the reverse.
  P.viewCurve = function (kind) {
    const g = DISPLAY_GAMMA, stops = P.STOPS;
    const toOutput = kind === 'stops-in-linear'
      ? (x) => Math.max(0, 1 + (g * Math.log2(Math.max(x, 1e-6))) / stops)
      : (x) => Math.pow(2, (stops * (x - 1)) / g);
    const samples = [];
    for (let i = 0; i <= 400; i++) {
      // Packs samples toward the dim end, where the stops scale changes fastest.
      const x = Math.pow(i / 400, 2);
      samples.push({ a: x, v: Math.min(1, toOutput(x)) });
    }
    return P.simplifyCurve(samples, 0.004).map((p) => ({ a: +p.a.toFixed(4), v: +p.v.toFixed(4) }));
  };

  function applyAdjustment(G, l) {
    let peak = 0;
    for (let i = 0; i < G.length; i++) if (G[i] > peak) peak = G[i];
    if (peak <= 0) return;
    const fn = P.adjustment(l);
    const mix = l.mix === undefined ? 1 : l.mix;
    for (let i = 0; i < G.length; i++) {
      G[i] = Math.max(0, G[i] + (fn(G[i] / peak) * peak - G[i]) * mix);
    }
  }

  P.composite = function (doc) {
    const G = new Float32Array(SIZE * SIZE);
    const anySolo = doc.layers.some((l) => l.solo);
    let prev = null;
    for (const l of doc.layers) {
      if (anySolo ? !l.solo : !l.enabled) continue;
      if (P.isAdjustment(l)) { applyAdjustment(G, l); continue; }
      const F = P.layerField(l);
      const clipTo = l.clip ? prev : null;
      const gain = Math.pow(2, l.gain || 0);
      const mix = l.mix === undefined ? 1 : l.mix;
      const mode = l.blend || 'normal';
      for (let i = 0; i < G.length; i++) {
        const u = G[i];
        let a = F[i] * gain;
        if (clipTo) a *= clipTo[i];
        let v;
        switch (mode) {
          case 'add': v = u + a; break;
          case 'screen': v = u + a - u * a; break;
          case 'max': v = a > u ? a : u; break;
          case 'multiply': v = u * a; break;
          case 'subtract': v = u > a ? u - a : 0; break;
          default: v = a;
        }
        G[i] = Math.max(0, u + (v - u) * mix);
      }
      prev = F;
    }
    applySymmetry(G, doc.symmetry);
    let raw = 0;
    for (let i = 0; i < G.length; i++) if (G[i] > raw) raw = G[i];
    const N = new Float32Array(G.length);
    if (raw > 0) for (let i = 0; i < G.length; i++) N[i] = G[i] / raw;
    // Solid angle integral of the normalized shape: lumens = peak candela * integral.
    let integral = 0;
    const dV = Math.PI / SIZE, dH = (2 * Math.PI) / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const s = Math.sin(((x + 0.5) * Math.PI) / SIZE);
      let sum = 0;
      for (let y = 0; y < SIZE; y++) sum += N[x + y * SIZE];
      integral += sum * s * dV * dH;
    }
    const out = doc.output;
    const totalFlux = out.flux * (out.count || 1);
    let peak;
    if (out.mode === 'flux') peak = integral > 0 ? totalFlux / integral : 0;
    else if (out.mode === 'peak') peak = out.peak;
    // Unlocked: a fixed candela per composite unit, so an edit only changes the angles it touches.
    else peak = raw * (out.scale ?? (raw > 0 ? out.peak / raw : 0));
    return { N, raw, integral, peak, flux: peak * integral };
  };

  P.sample = function (N, v, h) {
    const fx = clamp((v / 180) * SIZE - 0, 0, SIZE - 1);
    let fy = (((h % 360) + 360) % 360) / 360 * SIZE;
    const x0 = Math.floor(fx), y0 = Math.floor(fy) % SIZE;
    const x1 = Math.min(x0 + 1, SIZE - 1), y1 = (y0 + 1) % SIZE;
    fy -= Math.floor(fy);
    const tx = fx - x0;
    const a = N[x0 + y0 * SIZE] + (N[x1 + y0 * SIZE] - N[x0 + y0 * SIZE]) * tx;
    const b = N[x0 + y1 * SIZE] + (N[x1 + y1 * SIZE] - N[x0 + y1 * SIZE]) * tx;
    return a + (b - a) * fy;
  };

  // Full angle through the plane at bearing h, where intensity crosses a share of the plane's peak.
  // Front hemisphere only, so a point light's back lobes don't read as a huge beam.
  P.spread = function (N, h, share) {
    const front = SIZE / 2;
    let peak = 0;
    for (let x = 0; x <= front; x++) {
      peak = Math.max(peak, P.sample(N, (x * 180) / SIZE, h), P.sample(N, (x * 180) / SIZE, h + 180));
    }
    if (peak <= 0) return 0;
    const side = (hh) => {
      for (let x = front; x >= 0; x--) {
        if (P.sample(N, (x * 180) / SIZE, hh) >= peak * share) return ((x + 1) * 180) / SIZE;
      }
      return 0;
    };
    return side(h) + side(h + 180);
  };

  P.detectSymmetry = function (N) {
    const same = (fn) => {
      for (let y = 0; y < SIZE; y++) {
        const s = fn(y);
        for (let x = 0; x < SIZE; x++) if (Math.abs(N[x + y * SIZE] - N[x + s * SIZE]) > 2e-5) return false;
      }
      return true;
    };
    if (same(() => 0)) return 'axial';
    const q = (y) => (y <= 64 ? y : y <= 128 ? 128 - y : y <= 192 ? y - 128 : 256 - y);
    if (same(q)) return 'quadrant';
    if (same((y) => (y <= 128 ? y : 256 - y))) return 'bilateral';
    return 'none';
  };

  const encode = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
  const decode = (s) => (typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8'));
  const wrap = (values, perLine) => {
    const lines = [];
    for (let i = 0; i < values.length; i += perLine) lines.push(values.slice(i, i + perLine).join(' '));
    return lines.join('\r\n');
  };

  // Angles sit exactly on the working grid, so reading the file back reproduces it.
  P.writeIES = function (doc, comp) {
    const sym = P.detectSymmetry(comp.N);
    const nH = { axial: 1, quadrant: 65, bilateral: 129, none: 257 }[sym];
    const V = [];
    for (let x = 0; x < SIZE; x++) V.push(((x * 180) / SIZE).toFixed(6));
    V.push('180');
    const H = [];
    for (let y = 0; y < nH; y++) H.push(((y * 360) / SIZE).toFixed(6));
    const rows = [];
    for (let y = 0; y < nH; y++) {
      const yy = y % SIZE;
      const row = [];
      for (let x = 0; x <= SIZE; x++) {
        const n = comp.N[Math.min(x, SIZE - 1) + yy * SIZE] * comp.peak;
        row.push(n === 0 ? '0' : +n.toPrecision(6));
      }
      rows.push(wrap(row, 10));
    }
    const recipe = encode(JSON.stringify(doc));
    const recipeLines = [];
    for (let i = 0; i < recipe.length; i += 180) recipeLines.push('[_PENUMBRA_RECIPE]' + recipe.slice(i, i + 180));
    return [
      'IESNA:LM-63-2002',
      `[TEST]${doc.name || 'Untitled'}`,
      `[MANUFAC]${doc.maker || 'Penumbra'}`,
      '[OTHER]Authored in Penumbra',
      ...recipeLines,
      'TILT=NONE',
      `1 ${comp.flux.toFixed(2)} 1 ${V.length} ${H.length} 1 2 0 0 0`,
      `1 1 ${doc.output.watts || 0}`,
      wrap(V, 10),
      wrap(H, 10),
      rows.join('\r\n'),
      '',
    ].join('\r\n');
  };

  P.parseIES = function (text) {
    const lines = text.split(/\r?\n/);
    const tiltAt = lines.findIndex((s) => /^\s*TILT\s*=/i.test(s));
    if (tiltAt < 0) throw new Error('No TILT line found, so this does not look like an IES file.');
    if (!/^\s*TILT\s*=\s*NONE\s*$/i.test(lines[tiltAt])) {
      throw new Error('This file uses TILT data, which is not supported.');
    }
    const keywords = {};
    let recipe = '';
    for (const s of lines.slice(0, tiltAt)) {
      const m = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(s);
      if (!m) continue;
      if (m[1] === '_PENUMBRA_RECIPE') recipe += m[2].trim();
      else keywords[m[1].toUpperCase()] = m[2].trim();
    }
    const t = lines.slice(tiltAt + 1).join(' ').trim().split(/[\s,]+/).map(Number);
    if (t.length < 13 || t.some(Number.isNaN)) throw new Error('The photometric data after the TILT line could not be read.');
    let p = 0;
    p++; // lamps
    const lumens = t[p++];
    const mult = t[p++];
    const nV = t[p++], nH = t[p++], type = t[p++];
    p += 4; // units, width, length, height
    p += 2; // ballast, future use
    const watts = t[p++];
    if (t.length < p + nV + nH + nV * nH) throw new Error(`Expected ${nV * nH} candela values, but the file ends early.`);
    const v = t.slice(p, (p += nV));
    const h = t.slice(p, (p += nH));
    const cd = t.slice(p, (p += nV * nH)).map((x) => x * mult);
    let doc = null;
    if (recipe) {
      try { doc = JSON.parse(decode(recipe)); } catch (e) { doc = null; }
      if (!P.validDoc(doc)) doc = null;
    }
    return { v, h, cd, type, lumens, watts, keywords, doc, peak: maxOf(cd) };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
  else root.P = P;
})(typeof window !== 'undefined' ? window : globalThis);
