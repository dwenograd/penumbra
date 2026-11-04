// Canvas views: top-down polar map and slice curve editor.
(function () {
  const WARM = '#f0b35a', COOL = '#7db8ff', GRID = 'rgba(255,255,255,0.14)', LABEL = '#b4b4af';
  const FONT = '11px "Segoe UI", system-ui, sans-serif';
  // Stops scale range below peak. Everything dimmer than this draws as black.
  const STOPS = 12;
  const FALSE_BANDS = [[20, 20, 90], [30, 70, 190], [20, 150, 170], [40, 180, 80], [190, 200, 50], [240, 140, 40], [230, 50, 50], [255, 255, 255]];

  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
    return false;
  }

  function shade(n, mode) {
    if (mode === 'false') {
      if (n <= 0) return [0, 0, 0];
      const stop = Math.floor(-Math.log2(n));
      return stop >= 8 ? [0, 0, 0] : FALSE_BANDS[7 - stop];
    }
    const g = mode === 'stops' ? Math.max(0, 1 + Math.log2(Math.max(n, 1e-6)) / STOPS) : Math.pow(n, 1 / 2.2);
    const c = g * 255;
    return [c, c, c];
  }

  P.Map = function (canvas, app) {
    const ctx = canvas.getContext('2d');
    let img = null, lut = null, lutU = null, lutV = null, W = 0, H = 0, cx = 0, cy = 0, R = 0, ext = 0, drag = null;

    const toScreen = (v, h) => {
      const a = (h * Math.PI) / 180, r = (v / ext) * R;
      return [cx - r * Math.cos(a), cy + r * Math.sin(a)];
    };
    const fromScreen = (x, y) => {
      const dx = x - cx, dy = y - cy;
      let h = (Math.atan2(dy, -dx) * 180) / Math.PI;
      if (h < 0) h += 360;
      return [(Math.hypot(dx, dy) / R) * ext, h];
    };

    function rebuild() {
      W = canvas.width; H = canvas.height; ext = app.view.mapExtent;
      cx = W / 2; cy = H / 2; R = Math.min(W, H) / 2 - 24 * (window.devicePixelRatio || 1);
      img = ctx.createImageData(W, H);
      lut = new Int32Array(W * H).fill(-1);
      lutU = new Float32Array(W * H);
      lutV = new Float32Array(W * H);
      // Bilinear lookup with clamped edges, reading texels at their centres, as a GPU sampler would.
      for (let y = 0, i = 0; y < H; y++) {
        for (let x = 0; x < W; x++, i++) {
          const [v, h] = fromScreen(x + 0.5, y + 0.5);
          if (v > ext) continue;
          const u = Math.max(0, Math.min(255, (v / 180) * 256 - 0.5));
          const t = Math.max(0, Math.min(255, (h / 360) * 256 - 0.5));
          const x0 = Math.floor(u), y0 = Math.floor(t);
          lut[i] = x0 + y0 * 256;
          lutU[i] = u - x0;
          lutV[i] = t - y0;
        }
      }
    }

    function handles() {
      const l = app.activeLayer();
      if (!l) return [];
      const out = [];
      const aimable = !['sliders', 'imported', 'noise'].includes(l.type);
      if (aimable && l.type !== 'cutoff') out.push({ id: 'aim', at: P.layerToGrid(l, 0, 0) });
      if (l.type === 'beam' || l.type === 'ring') out.push({ id: 'radius', at: P.layerToGrid(l, l.radius, 180) });
      if (l.type === 'repeat') out.push({ id: 'outer', at: P.layerToGrid(l, l.outer, l.phase) });
      if (l.type === 'cutoff') out.push({ id: 'edge', at: P.layerToGrid(l, Math.max(l.edge, 0), l.bearing) });
      return out;
    }

    function outline(l) {
      const circle = (t) => {
        ctx.beginPath();
        for (let i = 0; i <= 72; i++) {
          const [v, h] = P.layerToGrid(l, t, i * 5);
          const [x, y] = toScreen(v, h);
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      };
      ctx.strokeStyle = WARM;
      ctx.lineWidth = window.devicePixelRatio || 1;
      if (l.type === 'beam') circle(l.radius);
      if (l.type === 'ring') { circle(l.radius - l.width / 2); circle(l.radius + l.width / 2); }
      if (l.type === 'repeat') { circle(l.inner); circle(l.outer); }
      if (l.type === 'cutoff') {
        const a = (l.bearing * Math.PI) / 180, r = (l.edge / ext) * R;
        const px = cx - r * Math.cos(a), py = cy + r * Math.sin(a);
        const tx = Math.sin(a) * R * 2, ty = Math.cos(a) * R * 2;
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
        ctx.beginPath(); ctx.moveTo(px - tx, py - ty); ctx.lineTo(px + tx, py + ty); ctx.stroke();
        ctx.restore();
      }
    }

    function draw() {
      const resized = fit(canvas);
      if (resized || !img || ext !== app.view.mapExtent) rebuild();
      const N = app.comp.N, d = img.data, mode = app.view.mapDisplay;
      const table = app.mapTable(mode, shade);
      const cone = new Float32Array(256);
      for (let x = 0; x < 256; x++) cone[x] = app.coneAt((x * 180) / 256);
      for (let i = 0, p = 0; i < lut.length; i++, p += 4) {
        const k = lut[i];
        if (k < 0) { d[p] = d[p + 1] = d[p + 2] = 0; d[p + 3] = 0; continue; }
        const x0 = k & 255, y0 = k >> 8;
        const x1 = x0 < 255 ? x0 + 1 : x0, y1 = y0 < 255 ? y0 + 1 : y0;
        const u = lutU[i], w = lutV[i];
        const top = N[k] + (N[x1 + y0 * 256] - N[k]) * u;
        const low = N[x0 + y1 * 256] + (N[x1 + y1 * 256] - N[x0 + y1 * 256]) * u;
        const shaped = (top + (low - top) * w) * (cone[x0] + (cone[x1] - cone[x0]) * u);
        const t = table[Math.min(65535, (shaped * 65535) | 0)];
        d[p] = t & 255; d[p + 1] = (t >> 8) & 255; d[p + 2] = (t >> 16) & 255; d[p + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const dpr = window.devicePixelRatio || 1;
      ctx.font = FONT.replace('11px', 11 * dpr + 'px');
      ctx.lineWidth = dpr;
      ctx.strokeStyle = GRID;
      for (let v = 15; v <= ext; v += ext > 90 ? 30 : 15) {
        ctx.beginPath(); ctx.arc(cx, cy, (v / ext) * R, 0, Math.PI * 2); ctx.stroke();
      }
      for (let h = 0; h < 360; h += 45) {
        const [x, y] = toScreen(ext, h);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      }
      if (app.doc.lightType === 'spot' && app.doc.cone.outer < ext) {
        ctx.save();
        ctx.fillStyle = 'rgba(8,8,9,0.72)';
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.arc(cx, cy, (app.doc.cone.outer / ext) * R, 0, Math.PI * 2, true);
        ctx.fill();
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.strokeStyle = LABEL;
        ctx.beginPath(); ctx.arc(cx, cy, (app.doc.cone.outer / ext) * R, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = LABEL;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [h, s] of [[0, 'C0'], [90, 'C90'], [180, 'C180'], [270, 'C270']]) {
        const a = (h * Math.PI) / 180, r = R + 12 * dpr;
        ctx.fillText(s, cx - r * Math.cos(a) + (h === 0 ? 2 * dpr : h === 180 ? -2 * dpr : 0), cy + r * Math.sin(a));
      }
      ctx.textAlign = 'left';
      ctx.fillText(`${ext}°`, cx + 3 * dpr, cy - R + 8 * dpr);

      // Slice plane through the centre.
      const b = app.view.bearing;
      const [x0, y0] = toScreen(ext, b), [x1, y1] = toScreen(ext, b + 180);
      const [x2, y2] = toScreen(ext, b + 90), [x3, y3] = toScreen(ext, b + 270);
      ctx.strokeStyle = COOL; ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = WARM;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.fillStyle = WARM;
      ctx.beginPath(); ctx.arc(x0, y0, 5 * dpr, 0, Math.PI * 2); ctx.fill();

      const l = app.activeLayer();
      if (l) outline(l);
      for (const hd of handles()) {
        const [x, y] = toScreen(hd.at[0], hd.at[1]);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000';
        ctx.beginPath(); ctx.rect(x - 4 * dpr, y - 4 * dpr, 8 * dpr, 8 * dpr); ctx.fill(); ctx.stroke();
      }
    }

    const pos = (e) => {
      const r = canvas.getBoundingClientRect(), s = canvas.width / r.width;
      return [(e.clientX - r.left) * s, (e.clientY - r.top) * s];
    };

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = pos(e), dpr = window.devicePixelRatio || 1;
      const near = (a, b) => Math.hypot(a - x, b - y) < 9 * dpr;
      drag = 'bearing';
      for (const hd of handles()) {
        const [hx, hy] = toScreen(hd.at[0], hd.at[1]);
        if (near(hx, hy)) drag = hd.id;
      }
      move(e);
    });

    function move(e) {
      const [x, y] = pos(e);
      const [v, h] = fromScreen(x, y);
      app.setMapReadout(v <= ext ? v : null, h);
      if (!drag) return;
      const l = app.activeLayer();
      const vc = Math.min(v, ext);
      if (drag === 'bearing') { app.setBearing(h); return; }
      const round = (n) => Math.round(n * 10) / 10;
      if (drag === 'aim') { l.aimV = round(vc); l.aimH = round(h); }
      if (drag === 'radius') l.radius = round(P.gridToLayer(l, vc, h)[0]);
      if (drag === 'outer') l.outer = round(P.gridToLayer(l, vc, h)[0]);
      if (drag === 'edge') {
        l.bearing = round(h); l.edge = round(vc);
      }
      app.changed(true);
    }

    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', () => {
      if (drag && drag !== 'bearing') app.commit();
      drag = null;
    });
    canvas.addEventListener('pointerleave', () => app.setMapReadout(null));
    return { draw, invalidate() { img = null; } };
  };

  P.Curve = function (canvas, app) {
    const ctx = canvas.getContext('2d');
    let drag = null, W = 0, H = 0, dpr = 1;
    const pad = () => ({ l: 44 * dpr, r: 14 * dpr, t: 10 * dpr, b: 22 * dpr });

    const xOf = (v) => { const p = pad(); return p.l + (v / app.view.mapExtent) * (W - p.l - p.r); };
    const yOf = (n) => {
      const p = pad(), h = H - p.t - p.b;
      const t = app.view.curveScale === 'stops' ? Math.max(0, 1 + Math.log2(Math.max(n, 1e-6)) / STOPS) : Math.min(n, 1.05) / 1.05;
      return p.t + (1 - t) * h;
    };
    const fromX = (x) => { const p = pad(); return Math.max(0, Math.min(app.view.mapExtent, ((x - p.l) / (W - p.l - p.r)) * app.view.mapExtent)); };
    const fromY = (y) => {
      const p = pad(), h = H - p.t - p.b;
      const t = Math.max(0, Math.min(1, 1 - (y - p.t) / h));
      return app.view.curveScale === 'stops' ? (t <= 0 ? 0 : Math.pow(2, (t - 1) * STOPS)) : t * 1.05;
    };

    function plot(N, bearing, color, dash, width) {
      if (!N) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = (width || 1.5) * dpr;
      ctx.setLineDash(dash ? dash.map((d) => d * dpr) : []);
      ctx.beginPath();
      const ext = app.view.mapExtent;
      for (let i = 0; i <= 512; i++) {
        const v = (i / 512) * ext;
        const x = xOf(v), y = yOf(P.sample(N, v, bearing) * app.coneAt(v));
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function points() {
      const l = app.activeLayer();
      if (!l) return [];
      if (l.type === 'curve') return l.points.map((p, i) => ({ i, v: p.a, n: p.v, kind: 'curve' }));
      if (l.type === 'sliders') {
        const arr = app.view.sliderPlane === 'c90' && l.c90 ? l.c90 : l.c0;
        return arr.map((n, i) => ({ i, v: i * (l.step || 10), n, kind: 'slider' }));
      }
      return [];
    }

    function draw() {
      fit(canvas);
      dpr = window.devicePixelRatio || 1; W = canvas.width; H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.font = FONT.replace('11px', 11 * dpr + 'px');
      const p = pad(), ext = app.view.mapExtent;
      ctx.lineWidth = dpr; ctx.strokeStyle = GRID; ctx.fillStyle = LABEL;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let v = 0; v <= ext; v += ext > 90 ? 20 : 10) {
        const x = xOf(v);
        ctx.beginPath(); ctx.moveTo(x, p.t); ctx.lineTo(x, H - p.b); ctx.stroke();
        ctx.fillText(`${v}°`, x, H - p.b + 5 * dpr);
      }
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const ticks = app.view.curveScale === 'stops'
        ? [0, -3, -6, -9, -12].map((s) => [Math.pow(2, s), s === 0 ? '0 EV' : `${s}`])
        : [0, 0.25, 0.5, 0.75, 1].map((t) => [t, `${t * 100}%`]);
      for (const [n, s] of ticks) {
        const y = yOf(n);
        ctx.beginPath(); ctx.moveTo(p.l, y); ctx.lineTo(W - p.r, y); ctx.stroke();
        ctx.fillText(s, p.l - 6 * dpr, y);
      }
      if (app.doc.lightType === 'spot' && app.doc.cone.outer < ext) {
        const x = xOf(app.doc.cone.outer);
        ctx.fillStyle = 'rgba(8,8,9,0.6)';
        ctx.fillRect(x, p.t, W - p.r - x, H - p.t - p.b);
      }
      const b = app.view.bearing;
      if (app.ref) plot(app.ref.N, b, '#b8b8b4', [2, 3], 1.25);
      plot(app.comp.N, b + 90, COOL, [5, 3], 1.25);
      plot(app.comp.N, b + 270, COOL, [1, 3], 1.25);
      plot(app.comp.N, b + 180, WARM, [1, 3], 1.25);
      plot(app.comp.N, b, WARM, null, 1.75);

      const l = app.activeLayer();
      if (l && (l.type === 'curve' || l.type === 'sliders')) {
        const pts = points();
        const planeH = l.type === 'sliders' && app.view.sliderPlane === 'c90' ? 90 : 0;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = dpr;
        ctx.beginPath();
        if (l.type === 'curve') {
          const T = P.curveTable([...l.points].sort((a, c) => a.a - c.a), false);
          for (let i = 0; i <= 512; i++) {
            const v = (i / 512) * ext, x = xOf(v), y = yOf(T[Math.round(v * 10)]);
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          }
        } else {
          pts.forEach((q, i) => { if (i) ctx.lineTo(xOf(q.v), yOf(q.n)); else ctx.moveTo(xOf(q.v), yOf(q.n)); });
        }
        ctx.stroke();
        void planeH;
        for (const q of pts) {
          if (q.v > ext) continue;
          const sel = l.type === 'curve' && app.view.selectedPoint === q.i;
          ctx.fillStyle = sel ? WARM : '#fff'; ctx.strokeStyle = '#000';
          ctx.beginPath(); ctx.arc(xOf(q.v), yOf(q.n), 4.5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
    }

    const pos = (e) => {
      const r = canvas.getBoundingClientRect(), s = canvas.width / r.width;
      return [(e.clientX - r.left) * s, (e.clientY - r.top) * s];
    };
    const hit = (x, y) => points().find((q) => q.v <= app.view.mapExtent && Math.hypot(xOf(q.v) - x, yOf(q.n) - y) < 9 * dpr);

    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = pos(e);
      const q = hit(x, y);
      if (!q) {
        // Nothing under the cursor: a drag from here draws, once it has moved far enough to not be a click.
        if (e.button === 0) { canvas.setPointerCapture(e.pointerId); drag = { kind: 'pending', x, y }; }
        return;
      }
      if (e.button === 2 && q.kind === 'curve') { app.removePoint(q.i); return; }
      canvas.setPointerCapture(e.pointerId);
      drag = q;
      if (q.kind === 'curve') { app.view.selectedPoint = q.i; app.syncInspector(true); }
      app.requestDraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      canvas.style.cursor = hit(x, y) ? 'grab' : 'crosshair';
      if (!drag) return;
      if (drag.kind === 'pending') {
        if (Math.hypot(x - drag.x, y - drag.y) < 4 * dpr) return;
        const target = app.beginStroke();
        drag = { kind: 'stroke', l: target, base: target.points ? target.points.map((p) => ({ ...p })) : null, bins: new Map(), last: [fromX(drag.x), Math.min(1, fromY(drag.y))] };
      }
      const l = drag.kind === 'stroke' ? drag.l : app.activeLayer();
      const n = Math.min(1, fromY(y));
      if (drag.kind === 'stroke') {
        paintStroke(fromX(x), n);
        app.changed(true);
        return;
      }
      if (drag.kind === 'curve') {
        const pt = l.points[drag.i];
        const prev = l.points[drag.i - 1], next = l.points[drag.i + 1];
        let a = fromX(x);
        if (prev) a = Math.max(a, prev.a + 0.1);
        if (next) a = Math.min(a, next.a - 0.1);
        pt.a = Math.round(a * 10) / 10; pt.v = Math.round(n * 1000) / 1000;
      } else {
        app.sliderArray(l)[drag.i] = Math.round(n * 1000) / 1000;
      }
      app.changed(true);
    });
    canvas.addEventListener('pointerup', () => {
      if (drag && drag.kind === 'stroke') {
        if (drag.base) {
          drag.l.points = P.applyStroke(drag.base, P.simplifyCurve(strokePoints(), 0.006));
          app.view.selectedPoint = 0;
          app.syncInspector(true);
        }
        app.changed();
        app.commit();
      } else if (drag && drag.kind !== 'pending') {
        app.commit();
      }
      drag = null;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const strokePoints = () => [...drag.bins.entries()].sort((p, q) => p[0] - q[0]).map(([k, v]) => ({ a: k / 2, v, s: 0 }));

    // Fills every half degree between pointer events, so a fast drag leaves no gaps.
    function paintStroke(a, n) {
      const [a0, n0] = drag.last;
      const steps = Math.max(1, Math.ceil(Math.abs(a - a0) * 2));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const at = a0 + (a - a0) * t, value = Math.round((n0 + (n - n0) * t) * 1000) / 1000;
        if (drag.base) {
          drag.bins.set(Math.round(at * 2), value);
        } else {
          const arr = app.sliderArray(drag.l);
          const index = Math.round(at / (drag.l.step || 10));
          if (index >= 0 && index < arr.length) arr[index] = value;
        }
      }
      drag.last = [a, n];
      if (drag.base) drag.l.points = P.applyStroke(drag.base, strokePoints());
    }
    canvas.addEventListener('dblclick', (e) => {
      const l = app.activeLayer();
      if (!l || l.type !== 'curve') return;
      const [x, y] = pos(e);
      if (hit(x, y)) return;
      const a = Math.round(fromX(x) * 10) / 10;
      l.points.push({ a, v: Math.round(Math.min(1, fromY(y)) * 1000) / 1000, s: 0 });
      l.points.sort((p, q) => p.a - q.a);
      app.view.selectedPoint = l.points.findIndex((p) => p.a === a);
      app.syncInspector(true);
      app.changed();
      app.commit();
    });
    return { draw };
  };
})();
