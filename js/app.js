// App state, inspector and layer stack.
(function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v !== undefined) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids) if (c !== null && c !== undefined) n.append(c);
    return n;
  };
  const icon = (id) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#i-' + id);
    s.append(u);
    return s;
  };

  let nextId = 1;
  const SHARED = { enabled: true, solo: false, clip: false, blend: 'add', gain: 0, mix: 1, aimV: 0, aimH: 0, roll: 0, squash: 1 };
  const mk = (type, name, props) => ({ id: nextId++, type, name, ...SHARED, ...props });

  const sliders = (c0, props) => mk('sliders', 'Sliders', { blend: 'normal', c0, c90: null, step: 10, spikes: 0, seed: 7, ...props });
  const FACTORY = {
    beam: () => mk('beam', 'Beam', { radius: 15, soft: 5, taper: 0 }),
    ring: () => mk('ring', 'Ring', { radius: 22, width: 4, soft: 2 }),
    lobe: () => mk('beam', 'Lobe', { radius: 10, soft: 8, taper: 0.5, aimV: 28, aimH: 225, gain: -1 }),
    cutoff: () => mk('cutoff', 'Cutoff', { blend: 'multiply', bearing: 270, edge: 30, soft: 4 }),
    repeat: () => mk('repeat', 'Repeat', { blend: 'multiply', count: 8, sharp: 0.1, inner: 5, outer: 60, fade: 4, phase: 0, mix: 0.5 }),
    curve: () => mk('curve', 'Free curve', { points: [{ a: 0, v: 1, s: 0 }, { a: 15, v: 0.8, s: 0 }, { a: 30, v: 0, s: 0.4 }, { a: 180, v: 0, s: 0 }] }),
    noise: () => mk('noise', 'Imperfection', { blend: 'multiply', scale: 6, contrast: 0.2, seed: 3 }),
    tonecurve: () => mk('tonecurve', 'Curves', { points: [{ a: 0, v: 0 }, { a: 1, v: 1 }] }),
    levels: () => mk('levels', 'Levels', { inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 }),
    contrast: () => mk('contrast', 'Contrast', { amount: 0, pivot: 0.18 }),
  };

  const docBase = (name, layers, extra = {}) => ({
    name, maker: '', symmetry: 'none', lightType: 'spot', cone: { inner: 0, outer: 88.9 },
    output: { mode: 'free', peak: 6000, flux: 800, count: 1, watts: 10, height: 220, ...extra.output },
    layers, ...extra.doc,
  });

  const PRESETS = {
    flashlight: () => docBase('Flashlight', [
      sliders([0.5, 0.42, 0.24, 0.17, 0.1, 0.05, 0.015, 0.003, 0, 0]),
      mk('beam', 'Hot core', { radius: 7, soft: 7, taper: 0.45, gain: 0.5 }),
      mk('ring', 'Reflector ring', { radius: 15, width: 3, soft: 2.5, gain: -1.2 }),
      mk('ring', 'Dark band', { radius: 20, width: 2.5, soft: 2, blend: 'subtract', gain: -2.4 }),
      mk('noise', 'Lens grime', { blend: 'multiply', scale: 5, contrast: 0.2, seed: 5 }),
    ], { output: { peak: 5000 } }),
    downlight: () => docBase('Downlight', [
      sliders([1, 0.98, 0.9, 0.62, 0.2, 0.03, 0, 0, 0, 0]),
    ], { doc: { symmetry: 'axial' } }),
    washer: () => docBase('Wall washer', [
      sliders([0.2, 0.25, 0.3, 0.35, 0.3, 0.2, 0.1, 0.03, 0, 0]),
      mk('beam', 'Throw', { radius: 42, soft: 28, taper: 0.5, aimV: 38, aimH: 270 }),
      mk('cutoff', 'Rear shield', { blend: 'multiply', bearing: 90, edge: 8, soft: 12 }),
    ], { output: { peak: 2500 } }),
    blank: () => docBase('Untitled', [sliders([1, 0.9, 0.7, 0.5, 0.3, 0.15, 0.05, 0.01, 0, 0])]),
  };

  const FREE_VIEW = { camX: -2.6, camY: 1.6, camZ: 0.7, camYaw: 0.72, camPitch: 0.1, lightX: 0, lightY: 2.2, lightZ: 3, lightPitch: -90, lightYaw: 0, lightRoll: 0 };

  const app = {
    doc: PRESETS.flashlight(),
    comp: null,
    ref: null,
    showRef: false,
    view: {
      active: null, sideTab: 'layer', bearing: 0, bearingSnap: 15, bearingLock: false, applyCone: true, mapExtent: 90, mapDisplay: 'stops', curveScale: 'linear', sliderPlane: 'c0', selectedPoint: 0,
      preview: { mode: 'first', gizmo: 'move', room: 'grey', shadows: true, sourceRadius: 0, material: 'matte', roughness: 0.3, haze: 0.03, ev: 4, fov: 80, yaw: 0, pitch: -0.06, eye: 1.7, offR: 0.18, offU: -0.2, throw: 2.2, roomW: 7, roomH: 3.2, roomD: 8, radius: 16, ambient: 0.4, ...FREE_VIEW },
    },
    activeLayer() { return app.doc.layers.find((l) => l.id === app.view.active) || null; },
    coneAt(v) {
      if (!app.view.applyCone || app.doc.lightType !== 'spot') return 1;
      return P.coneFactor(P.coneTerms(app.doc.cone), v);
    },
    sliderArray(l) { return app.view.sliderPlane === 'c90' && l.c90 ? l.c90 : l.c0; },
    setBearing(h) { app.view.bearing = Math.round(((h % 360) + 360) % 360 * 10) / 10; $('bearing').value = app.view.bearing; app.requestDraw(); updateStats(); },
    dragBearing(h, free) {
      const step = free ? 0 : app.view.bearingSnap;
      app.setBearing(step ? Math.round(h / step) * step : h);
    },
    syncPreviewControls() { previewSyncs.forEach((f) => f()); },
    setGizmo(mode) { app.view.preview.gizmo = mode; renderPreviewControls(); app.requestDraw(); },
    setMapReadout(v, h) {
      const r = $('map-readout');
      if (v === null || v === undefined) { r.textContent = ''; return; }
      const n = P.sample(app.comp.N, v, h) * app.coneAt(v);
      r.innerHTML = `V <b>${v.toFixed(1)}°</b> H <b>${h.toFixed(1)}°</b> <b>${(n * 100).toFixed(1)}%</b> <b>${fmt(n * app.comp.peak)} cd</b>`;
    },
    changed(fromCanvas) { dirty = true; app.requestDraw(); if (fromCanvas) syncs.forEach((f) => f()); },
    commit() { pushUndo(); renderLayers(); },
    syncInspector(rebuild) { if (rebuild) renderInspector(); else syncs.forEach((f) => f()); },
    requestDraw() { if (!raf) raf = requestAnimationFrame(frame); },
    // The layer a drawn stroke goes on. Other layer types get a new curve seeded from the current slice.
    beginStroke() {
      const active = app.activeLayer();
      if (active && (active.type === 'curve' || active.type === 'sliders')) return active;
      const c = app.comp, seed = [];
      for (let a = 0; a <= 180; a += 1) seed.push({ a, v: P.sample(c.N, a, app.view.bearing), s: 0 });
      const l = mk('curve', 'Drawn curve', { blend: 'normal', gain: c.raw > 0 ? Math.log2(c.raw) : 0, points: P.simplifyCurve(seed, 0.012) });
      app.doc.layers.push(l);
      app.view.active = l.id;
      app.view.sideTab = 'layer';
      updateSegs();
      renderLayers();
      renderInspector();
      status('Added a Drawn curve layer on top, from the current slice. It is the same at every bearing, so mute it to get the stack back.');
      return l;
    },
    removePoint(i) {
      const l = app.activeLayer();
      if (!l || l.points.length <= 2) return;
      l.points.splice(i, 1);
      app.view.selectedPoint = Math.min(i, l.points.length - 1);
      renderInspector(); app.changed(); app.commit();
    },
    mapTable(mode, shade) {
      if (tableMode !== mode) {
        tableMode = mode;
        // 16-bit lookup, so the dim end of the stops scale doesn't band.
        table = new Uint32Array(65536);
        for (let i = 0; i < 65536; i++) {
          const c = shade(i / 65535, mode);
          table[i] = (c[0] & 255) | ((c[1] & 255) << 8) | ((c[2] & 255) << 16);
        }
      }
      return table;
    },
  };
  let previewSyncs = [];
  let raf = 0, dirty = true, syncs = [], tableMode = null, table = null, fileHandle = null;

  const fmt = (n) => (n >= 1000 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? n.toFixed(1) : n.toFixed(2));
  const planeLabel = (symmetry) => ({ axial: '1 plane (radially symmetric)', quadrant: '65 planes (quadrant symmetric)', bilateral: '129 planes (bilateral)', none: '257 planes (asymmetric)' }[symmetry]);
  const fmtLm = (n) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : String(+n.toFixed(2)));

  function status(msg, error) {
    const s = $('status');
    s.textContent = msg;
    s.classList.toggle('error', !!error);
    s.title = msg;
  }

  const undo = [], redo = [];
  const snapshot = () => JSON.stringify(app.doc);
  let lastSnap = null;
  function pushUndo() {
    const s = snapshot();
    if (s === lastSnap) return;
    if (lastSnap) undo.push(lastSnap);
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    lastSnap = s;
    updateUndo();
  }
  function restore(s) {
    app.doc = JSON.parse(s);
    lastSnap = s;
    if (!app.activeLayer()) app.view.active = app.doc.layers[0].id;
    dirty = true;
    renderAll();
    updateUndo();
  }
  function updateUndo() {
    $('btn-undo').disabled = !undo.length;
    $('btn-redo').disabled = !redo.length;
  }
  function doUndo() { if (undo.length) { redo.push(lastSnap); restore(undo.pop()); } }
  function doRedo() { if (redo.length) { undo.push(lastSnap); restore(redo.pop()); } }

  function frame() {
    raf = 0;
    if (dirty) { app.comp = P.composite(app.doc); dirty = false; updateStats(); updateThumb(); updateSliderReadouts(); }
    map.draw();
    curve.draw();
    if (preview) preview.draw();
  }

  function updateStats() {
    if (!app.comp) return;
    const b = app.view.bearing, c = app.comp;
    const beam = P.spread(c.N, b, 0.5), field = P.spread(c.N, b, 0.1);
    const use = app.doc.lightType === 'spot' ? ' on spot cone' : '';
    $('stats').innerHTML = `Beam <b>${beam.toFixed(1)}°</b> Field <b>${field.toFixed(1)}°</b> Peak <b>${fmt(c.peak)} cd</b> Flux <b>${fmt(c.flux)} lm</b>`;
    $('stats').title = `Flux integrates the whole profile, before any crop${use}.`;
  }

  function thumb(canvas, l) {
    const S = 34 * 2;
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (P.isAdjustment(l)) {
      // Adjustments have no light of their own, so their thumbnail is their response curve.
      canvas.classList.add('adjust');
      const fn = P.adjustment(l);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 2) {
        const y = S - Math.min(Math.pow(fn(Math.pow(x / S, 2.2)), 1 / 2.2), 1) * S;
        if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
      return;
    }
    const img = ctx.createImageData(S, S);
    const F = P.layerField(l);
    let max = 0;
    for (let i = 0; i < F.length; i += 3) if (F[i] > max) max = F[i];
    if (max <= 0) max = 1;
    for (let y = 0, p = 0; y < S; y++) {
      for (let x = 0; x < S; x++, p += 4) {
        const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
        const r = Math.hypot(dx, dy) / (S / 2);
        if (r > 1) continue;
        let h = Math.atan2(dy, -dx) * 180 / Math.PI;
        if (h < 0) h += 360;
        const n = F[Math.min(255, Math.round(r * 128)) + (Math.round((h / 360) * 256) % 256) * 256] / max;
        const c = Math.pow(Math.max(n, 0), 1 / 2.2) * 255;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = c;
        img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function updateThumb() {
    const l = app.activeLayer();
    const c = l && document.querySelector(`.layer[data-id="${l.id}"] canvas`);
    if (c) thumb(c, l);
  }

  const BLEND = { normal: 'Normal', add: 'Add', screen: 'Screen', max: 'Max', multiply: 'Multiply', subtract: 'Subtract' };
  const TYPE_LABEL = { sliders: 'Sliders', imported: 'Imported', beam: 'Beam', ring: 'Ring', cutoff: 'Cutoff', repeat: 'Repeat', curve: 'Curve', noise: 'Imperfection', tonecurve: 'Curves', levels: 'Levels', contrast: 'Contrast' };

  function renderLayers() {
    const list = $('layer-list');
    list.replaceChildren();
    app.doc.layers.forEach((l, i) => {
      const iconBtn = (name, label, on, cls) => el('button', { class: 'icon ' + (cls || ''), title: label, 'aria-label': label, type: 'button', onclick: (e) => { e.stopPropagation(); on(); } }, name === 'S' ? 'S' : icon(name));
      const eye = iconBtn('eye', l.enabled ? 'Hide layer' : 'Show layer', () => { l.enabled = !l.enabled; app.changed(); app.commit(); });
      eye.classList.toggle('on', l.enabled);
      const solo = iconBtn('S', 'Solo layer', () => { l.solo = !l.solo; app.changed(); app.commit(); }, 'solo');
      solo.classList.toggle('on', l.solo);
      const up = iconBtn('up', 'Move up', () => moveLayer(i, 1));
      const down = iconBtn('down', 'Move down', () => moveLayer(i, -1));
      const dup = iconBtn('copy', 'Duplicate (Ctrl+D)', () => duplicateLayer(l));
      const del = iconBtn('x', 'Delete (Del)', () => deleteLayer(l));
      up.disabled = i === app.doc.layers.length - 1;
      down.disabled = i === 0;
      del.disabled = app.doc.layers.length === 1;
      const name = el('input', { class: 'layer-name', value: l.name, readonly: true, 'aria-label': 'Layer name. Double-click or press Enter to rename.', spellcheck: 'false',
        onchange: (e) => { l.name = e.target.value; pushUndo(); renderInspector(); },
        onblur: (e) => { e.target.readOnly = true; },
        onkeydown: (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (e.target.readOnly) { e.target.readOnly = false; e.target.select(); } else { e.target.blur(); }
        } });
      const meta = P.isAdjustment(l) ? `Adjustment · ${TYPE_LABEL[l.type]}` : `${TYPE_LABEL[l.type]} · ${BLEND[l.blend || 'normal']}${l.gain ? ` ${l.gain > 0 ? '+' : ''}${(+l.gain).toFixed(1)} EV` : ''}${l.clip ? ' · clipped' : ''}`;
      const cv = el('canvas', { 'aria-hidden': 'true' });
      const li = el('li', { class: 'layer' + (l.id === app.view.active ? ' active' : '') + (l.enabled ? '' : ' muted'), 'data-id': l.id, onclick: () => selectLayer(l.id), ondblclick: (e) => {
        if (e.target.closest('button')) return;
        name.readOnly = false;
        name.focus();
        name.select();
      } },
        eye, cv, el('div', { class: 'layer-text' }, name, el('div', { class: 'layer-meta' }, meta)),
        el('div', { class: 'layer-actions' }, P.isAdjustment(l) ? el('span', { class: 'icon' }) : solo, up, down, dup, del));
      list.append(li);
      thumb(cv, l);
    });
  }

  // Drag a row to reorder. The list shows the top of the stack first, so its rows run opposite to the array.
  function wireLayerDragging() {
    const list = $('layer-list');
    const marker = el('div', { class: 'layer-drop-marker' });
    let drag = null;

    const finish = (commit) => {
      if (!drag) return;
      const { row, moving, slot, id } = drag;
      drag = null;
      row.classList.remove('dragging');
      marker.remove();
      list.classList.remove('reordering');
      if (!moving || !commit || slot === null) return;
      const layers = app.doc.layers;
      const rest = layers.filter((l) => l.id !== id).reverse();
      rest.splice(slot, 0, layers.find((l) => l.id === id));
      const order = rest.reverse();
      if (order.every((l, i) => l === layers[i])) return;
      app.doc.layers = order;
      app.changed();
      app.commit();
    };

    list.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const row = e.target.closest('.layer');
      if (!row || e.target.closest('button') || (e.target.matches('input') && !e.target.readOnly)) return;
      drag = { row, id: +row.dataset.id, x: e.clientX, y: e.clientY, pointer: e.pointerId, moving: false, slot: null };
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      if (!drag.moving) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
        drag.moving = true;
        drag.row.classList.add('dragging');
        list.classList.add('reordering');
        list.append(marker);
      }
      const bounds = list.getBoundingClientRect();
      if (e.clientY < bounds.top + 16) list.scrollTop -= 8;
      if (e.clientY > bounds.bottom - 16) list.scrollTop += 8;
      const rows = [...list.querySelectorAll('.layer')].filter((r) => r !== drag.row).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      drag.slot = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < e.clientY; }).length;
      const next = rows[drag.slot], last = rows[rows.length - 1];
      const edge = next ? next.getBoundingClientRect().top - 1 : last ? last.getBoundingClientRect().bottom + 1 : bounds.top;
      marker.style.top = `${edge - bounds.top + list.scrollTop}px`;
    });
    window.addEventListener('pointerup', () => finish(true));
    window.addEventListener('pointercancel', () => finish(false));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(false); });
  }

  function selectLayer(id) {
    if (app.view.sideTab !== 'layer') { app.view.sideTab = 'layer'; updateSegs(); renderInspector(); }
    if (app.view.active === id) return;
    app.view.active = id;
    app.view.selectedPoint = 0;
    // Toggle in place so a click on the name field keeps its focus for renaming.
    document.querySelectorAll('.layer').forEach((n) => n.classList.toggle('active', +n.dataset.id === id));
    renderInspector(); app.requestDraw();
  }
  function moveLayer(i, d) {
    const a = app.doc.layers;
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    app.changed(); app.commit();
  }
  function duplicateLayer(l) {
    const c = JSON.parse(JSON.stringify(l));
    c.id = nextId++;
    c.name = l.name + ' copy';
    app.doc.layers.splice(app.doc.layers.indexOf(l) + 1, 0, c);
    app.view.active = c.id;
    app.changed(); app.commit(); renderInspector();
  }
  function deleteLayer(l) {
    if (app.doc.layers.length === 1) return;
    const i = app.doc.layers.indexOf(l);
    app.doc.layers.splice(i, 1);
    app.view.active = app.doc.layers[Math.max(0, i - 1)].id;
    app.changed(); app.commit(); renderInspector();
  }

  // A labelled slider with a typed value. Range edits go live; commit happens on release.
  function row(parent, label, obj, key, min, max, step, onInput) {
    const scale = 1;
    const range = el('input', { type: 'range', min, max, step, 'aria-label': label });
    const num = el('input', { type: 'number', class: 'num', min, max, step: 'any', 'aria-label': label + ' value' });
    const sync = () => { const v = obj[key] * scale; range.value = v; if (document.activeElement !== num) num.value = +(+v).toFixed(3); };
    const set = (v) => { obj[key] = v; if (onInput) onInput(v); app.changed(); };
    range.addEventListener('input', () => { set(+range.value); num.value = +(+range.value).toFixed(3); });
    range.addEventListener('change', () => app.commit());
    num.addEventListener('input', () => { if (num.value !== '' && Number.isFinite(+num.value)) { set(+num.value); range.value = num.value; } });
    num.addEventListener('change', () => { if (num.value === '') sync(); app.commit(); });
    sync();
    syncs.push(sync);
    parent.append(el('div', { class: 'row' }, el('label', {}, label), range, num));
  }

  function selectRow(parent, label, value, options, onChange) {
    const s = el('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
      ...Object.entries(options).map(([k, v]) => el('option', { value: k, selected: k === value }, v)));
    parent.append(el('div', { class: 'row simple' }, el('label', {}, label), s));
  }

  function checkRow(parent, label, value, onChange) {
    parent.append(el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: value, onchange: (e) => onChange(e.target.checked) }), label));
  }

  let sliderReadouts = [];
  function updateSliderReadouts() {
    sliderReadouts.forEach((f) => f());
  }

  function renderSliders(box, l) {
    const planeSeg = el('div', { class: 'seg plane-tabs' });
    for (const [k, s] of [['c0', 'C0-180'], ['c90', 'C90-270']]) {
      planeSeg.append(el('button', { class: app.view.sliderPlane === k ? 'on' : '', type: 'button', onclick: () => { app.view.sliderPlane = k; renderInspector(); app.requestDraw(); } }, s));
    }
    box.append(planeSeg);
    if (app.view.sliderPlane === 'c90' && !l.c90) {
      box.append(el('p', { class: 'hint' }, 'C90-270 is blank, so this plane follows C0-180 and the light stays symmetric.'));
      box.append(el('div', { class: 'btn-row' }, el('button', { type: 'button', onclick: () => { l.c90 = [...l.c0]; app.changed(); app.commit(); renderInspector(); } }, 'Start from C0-180')));
    } else {
      const arr = app.view.sliderPlane === 'c90' ? l.c90 : l.c0;
      arr.forEach((_, i) => {
        const a = i * (l.step || 10);
        const range = el('input', { type: 'range', min: 0, max: 100, step: 0.1, 'aria-label': `${a} degrees percent` });
        const num = el('input', { type: 'number', class: 'num', min: 0, step: 'any', 'aria-label': `${a} degrees candela` });
        const vals = el('div', { class: 'slider-values' });
        const refresh = () => {
          const pct = arr[i] * 100;
          range.value = pct;
          const peak = app.comp ? app.comp.peak : 0, raw = app.comp ? app.comp.raw || 1 : 1;
          const cd = (arr[i] / raw) * peak;
          if (document.activeElement !== num) num.value = +cd.toFixed(1);
          const h = app.doc.output.height / 100;
          // Says when the spot cone is removing this angle's light, which is otherwise a silent no-op.
          const keep = app.doc.lightType === 'spot' ? P.coneFactor(P.coneTerms(app.doc.cone), a) : 1;
          vals.replaceChildren(el('span', {}, `${pct.toFixed(1)} %`),
            keep < 0.995 ? el('span', { class: 'cone-warn' }, keep <= 0 ? 'past cone' : `cone ${Math.round(keep * 100)}%`) : '',
            el('span', {}, `${fmt(cd / (h * h))} lux`));
        };
        range.addEventListener('input', () => { arr[i] = +range.value / 100; refresh(); app.changed(); });
        range.addEventListener('change', () => app.commit());
        num.addEventListener('input', () => {
          if (num.value === '' || !Number.isFinite(+num.value) || !app.comp) return;
          arr[i] = Math.min(1, Math.max(0, ((+num.value / app.comp.peak) * (app.comp.raw || 1))));
          refresh(); app.changed();
        });
        num.addEventListener('change', () => app.commit());
        refresh();
        sliderReadouts.push(refresh);
        syncs.push(refresh);
        box.append(el('div', { class: 'slider-row' }, el('span', { class: 'deg' }, `${a}°`), range, num, el('span'), vals));
      });
      if (app.view.sliderPlane === 'c90') {
        box.append(el('div', { class: 'btn-row' }, el('button', { type: 'button', onclick: () => { l.c90 = null; app.changed(); app.commit(); renderInspector(); } }, 'Clear C90-270')));
      }
    }
    row(box, 'Spikes', l, 'spikes', 0, 1, 0.01);
    box.append(el('div', { class: 'btn-row' },
      el('button', { type: 'button', onclick: () => { const reset = (a) => a.map((_, i) => Math.max(0, 1 - i / (a.length - 1))); l.c0 = reset(l.c0); if (l.c90) l.c90 = reset(l.c90); l.spikes = 0; app.changed(); app.commit(); renderInspector(); } }, 'Reset'),
      el('button', { type: 'button', onclick: () => surprise(l) }, 'Surprise me')));
    const extended = l.c0.length > 10;
    checkRow(box, 'Sliders to 180°, for point lights', extended, (on) => {
      const resize = (a) => (on ? [...a, ...new Array(9).fill(0)] : a.slice(0, 10));
      l.c0 = resize(l.c0);
      if (l.c90) l.c90 = resize(l.c90);
      if (on) { app.view.mapExtent = 180; updateSegs(); }
      app.changed(); app.commit(); renderInspector();
    });
  }

  function surprise(l) {
    const roll = (a) => a.map((_, i) => {
      const fall = Math.max(0, 1 - i / (a.length - 1));
      return Math.round(Math.min(1, Math.random() * Math.random() + fall * 0.35) * fall * 1000) / 1000;
    });
    l.c0 = roll(l.c0);
    if (l.c90) l.c90 = roll(l.c90);
    l.seed = Math.floor(Math.random() * 1000);
    app.changed(); app.commit(); renderInspector();
  }

  function renderCurve(box, l) {
    box.append(el('p', { class: 'hint' }, 'Drag on the slice to draw. Drag a point to move it, double-click to add one and right-click to remove it. Sharp sets how hard the edge after a point is.'));
    const tb = el('tbody');
    l.points.forEach((p, i) => {
      const cell = (key, min, max) => {
        const n = el('input', { type: 'number', class: 'num', min, max, step: 'any', value: +(p[key] || 0).toFixed(3), 'aria-label': `Point ${i + 1} ${key}` });
        n.addEventListener('focus', () => { app.view.selectedPoint = i; tb.querySelectorAll('tr').forEach((t, j) => t.classList.toggle('sel', j === i)); app.requestDraw(); });
        n.addEventListener('input', () => {
          if (n.value === '' || !Number.isFinite(+n.value)) return;
          p[key] = Math.max(min, Math.min(max, +n.value));
          app.changed();
        });
        n.addEventListener('change', () => { l.points.sort((a, b) => a.a - b.a); renderInspector(); app.commit(); });
        // Keeps the table in step while a point is dragged on the slice.
        syncs.push(() => { if (document.activeElement !== n) n.value = +(p[key] || 0).toFixed(3); });
        return el('td', {}, n);
      };
      tb.append(el('tr', { class: app.view.selectedPoint === i ? 'sel' : '' }, cell('a', 0, 180), cell('v', 0, 1), cell('s', 0, 1),
        el('td', {}, el('button', { class: 'icon', type: 'button', title: 'Remove point', 'aria-label': `Remove point ${i + 1}`, disabled: l.points.length <= 2, onclick: () => app.removePoint(i) }, icon('x')))));
    });
    box.append(el('table', { class: 'points' }, el('thead', {}, el('tr', {}, el('th', {}, 'Angle °'), el('th', {}, 'Value'), el('th', {}, 'Sharp'), el('th'))), tb));
  }

  const FIELDS = {
    beam: [['Edge angle', 'radius', 0.5, 180, 0.1], ['Softness', 'soft', 0, 60, 0.1], ['Taper', 'taper', 0, 1, 0.01]],
    ring: [['Radius', 'radius', 0, 180, 0.1], ['Width', 'width', 0, 60, 0.1], ['Softness', 'soft', 0, 30, 0.1]],
    cutoff: [['Bearing', 'bearing', 0, 360, 0.5], ['Edge', 'edge', -90, 180, 0.1], ['Softness', 'soft', 0, 60, 0.1]],
    repeat: [['Count', 'count', 1, 48, 1], ['Sharpness', 'sharp', 0, 1, 0.01], ['Inner', 'inner', 0, 180, 0.5], ['Outer', 'outer', 0, 180, 0.5], ['Outer fade', 'fade', 0, 40, 0.5], ['Phase', 'phase', 0, 360, 0.5]],
    noise: [['Scale', 'scale', 0.5, 45, 0.1], ['Contrast', 'contrast', 0, 1, 0.01], ['Seed', 'seed', 1, 999, 1]],
    levels: [['In black', 'inBlack', 0, 1, 0.005], ['In white', 'inWhite', 0, 1, 0.005], ['Gamma', 'gamma', 0.1, 5, 0.01], ['Out black', 'outBlack', 0, 1, 0.005], ['Out white', 'outWhite', 0, 1, 0.005]],
    contrast: [['Amount', 'amount', -1, 1, 0.01], ['Pivot', 'pivot', 0.01, 1, 0.01]],
  };

  // Input to output graph for a Curves layer. Click to add a point, drag to move, right-click to remove.
  function renderToneCurve(box, l) {
    const canvas = el('canvas', { class: 'tone-curve', 'aria-label': 'Input to output curve. Click to add a point and drag to move it.' });
    box.append(canvas, el('p', { class: 'hint' }, 'Click to add a point, drag to move it and right-click to remove it. Both axes are in display gamma, relative to the peak of the layers below.'));
    const PAD = 6;
    const dpr = () => window.devicePixelRatio || 1;
    let drag = -1;
    const draw = () => {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      const d = dpr();
      canvas.width = Math.round(r.width * d);
      canvas.height = Math.round(r.height * d);
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height, p = PAD * d;
      const sx = (a) => p + a * (W - 2 * p), sy = (v) => H - p - v * (H - 2 * p);
      ctx.fillStyle = '#09090a';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = d;
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) {
        ctx.moveTo(sx(i / 4), sy(0)); ctx.lineTo(sx(i / 4), sy(1));
        ctx.moveTo(sx(0), sy(i / 4)); ctx.lineTo(sx(1), sy(i / 4));
      }
      ctx.moveTo(sx(0), sy(0)); ctx.lineTo(sx(1), sy(1));
      ctx.stroke();
      const T = P.curveTable(l.points.map((q) => ({ a: q.a * 180, v: q.v, s: 0 })), false);
      ctx.strokeStyle = '#f0b35a';
      ctx.lineWidth = 1.5 * d;
      ctx.beginPath();
      for (let i = 0; i <= 200; i++) {
        const a = i / 200, y = sy(Math.min(T[Math.round(a * 1800)], 1));
        if (i) ctx.lineTo(sx(a), y); else ctx.moveTo(sx(a), y);
      }
      ctx.stroke();
      l.points.forEach((q, i) => {
        ctx.fillStyle = i === drag ? '#f0b35a' : '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = d;
        ctx.beginPath(); ctx.arc(sx(q.a), sy(q.v), 4.5 * d, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
    };
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      const clamp01 = (n) => Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
      return [clamp01((e.clientX - r.left - PAD) / (r.width - 2 * PAD)), clamp01(1 - (e.clientY - r.top - PAD) / (r.height - 2 * PAD))];
    };
    const nearest = (e) => {
      const r = canvas.getBoundingClientRect();
      return l.points.findIndex((q) => Math.hypot(PAD + q.a * (r.width - 2 * PAD) - (e.clientX - r.left), r.height - PAD - q.v * (r.height - 2 * PAD) - (e.clientY - r.top)) < 9);
    };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      const hit = nearest(e);
      if (e.button === 2) {
        if (hit >= 0 && l.points.length > 2) { l.points.splice(hit, 1); app.changed(); app.commit(); draw(); }
        return;
      }
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      if (hit >= 0) {
        drag = hit;
      } else {
        const [a, v] = at(e);
        l.points.push({ a, v });
        l.points.sort((p, q) => p.a - q.a);
        drag = l.points.findIndex((q) => q.a === a && q.v === v);
        app.changed();
      }
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const [a, v] = at(e);
      const before = l.points[drag - 1], after = l.points[drag + 1];
      let next = a;
      if (before) next = Math.max(next, before.a + 0.002);
      if (after) next = Math.min(next, after.a - 0.002);
      l.points[drag].a = next;
      l.points[drag].v = v;
      app.changed();
      draw();
    });
    const release = () => { if (drag >= 0) { drag = -1; app.commit(); draw(); } };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    requestAnimationFrame(draw);
    syncs.push(draw);
    const preset = (label, kind, title) => el('button', { type: 'button', title, onclick: () => {
      l.points = P.viewCurve(kind);
      app.changed(); app.commit(); renderInspector();
    } }, label);
    box.append(el('h3', { class: 'subhead' }, 'Match a map view'),
      el('div', { class: 'btn-row' },
        preset('Stops look in Linear', 'stops-in-linear', 'Makes the Linear view look the way the Stops view looks now'),
        preset('Linear look in Stops', 'linear-in-stops', 'Makes the Stops view look the way the Linear view looks now')),
      el('p', { class: 'hint' }, 'Keep this layer on top of the stack. Turn off Apply cone for an exact match, because the cone is drawn over both views.'));
  }

  function resetAdjustment(l) {
    const fresh = FACTORY[l.type]();
    const { id, name, enabled, solo, mix, ...settings } = fresh;
    Object.assign(l, settings);
    app.changed();
    app.commit();
    renderInspector();
  }

  function renderInspector() {
    syncs = [];
    sliderReadouts = [];
    const box = $('inspector');
    box.replaceChildren();
    if (app.view.sideTab === 'output') {
      $('inspector-title').textContent = '';
      renderOutput(box);
      return;
    }
    const l = app.activeLayer();
    if (!l) return;
    $('inspector-title').textContent = l.name;

    if (P.isAdjustment(l)) {
      if (l.type === 'tonecurve') renderToneCurve(box, l);
      for (const [label, key, a, b, c] of FIELDS[l.type] || []) row(box, label, l, key, a, b, c);
      if (l.type === 'levels') box.append(el('p', { class: 'hint' }, 'In and out values are in display gamma, relative to the peak of the layers below.'));
      if (l.type === 'contrast') box.append(el('p', { class: 'hint' }, 'Spreads light in stops around the pivot, which is a share of the peak of the layers below.'));
      row(box, 'Mix', l, 'mix', 0, 1, 0.01);
      box.append(el('div', { class: 'btn-row' }, el('button', { type: 'button', onclick: () => resetAdjustment(l) }, 'Reset')));
      return;
    }

    if (l.type === 'sliders') renderSliders(box, l);
    if (l.type === 'curve') renderCurve(box, l);
    if (l.type === 'imported') box.append(el('p', { class: 'hint' }, `${l.data.h.length} horizontal and ${l.data.v.length} vertical angles, from ${l.source || 'an IES file'}. Add layers above it to rework it non-destructively.`));
    for (const [label, key, a, b, c] of FIELDS[l.type] || []) row(box, label, l, key, a, b, c);

    box.append(el('h3', { class: 'subhead' }, 'Compositing'));
    selectRow(box, 'Blend', l.blend || 'normal', BLEND, (v) => { l.blend = v; app.changed(); app.commit(); });
    row(box, 'Gain (EV)', l, 'gain', -8, 4, 0.1);
    row(box, 'Mix', l, 'mix', 0, 1, 0.01);
    if (app.doc.layers.indexOf(l) > 0) {
      checkRow(box, 'Clip to the layer below', l.clip, (v) => { l.clip = v; app.changed(); app.commit(); });
    }
    if (l.type !== 'noise') {
      box.append(el('h3', { class: 'subhead' }, 'Placement'));
      row(box, 'Aim V', l, 'aimV', 0, 180, 0.1);
      row(box, 'Aim H', l, 'aimH', 0, 360, 0.5);
      row(box, 'Roll', l, 'roll', -180, 180, 0.5);
      row(box, 'Squash', l, 'squash', 0.1, 3, 0.01);
    }
  }

  function renderOutput(box) {
    const o = app.doc.output;
    const refs = P.REFERENCES;
    const totalOf = (r) => r.lumens * r.count;
    const MIN = 10, MAX = totalOf(refs[refs.length - 1]);
    const toRuler = (lm) => (Math.log(Math.max(lm, MIN) / MIN) / Math.log(MAX / MIN)) * 1000;
    const fromRuler = (t) => MIN * Math.pow(MAX / MIN, t / 1000);
    const round = (lm) => +lm.toPrecision(lm < 100 ? 4 : 3);

    const ruler = el('input', { type: 'range', min: 0, max: 1000, step: 1, 'aria-label': 'Total output in lumens, logarithmic' });
    const rulerBox = el('div', { class: 'ruler' }, ruler);
    for (const r of refs) {
      const tick = el('i', { title: r.name });
      tick.style.left = `calc(5px + (100% - 10px) * ${toRuler(totalOf(r)) / 1000})`;
      rulerBox.append(tick);
    }
    // Sets the output once. Only an explicit lumen lock keeps holding it through later edits.
    const setTotal = (lm) => {
      const c = app.comp;
      if (!c) return;
      if (o.mode === 'flux') { o.flux = lm / (o.count || 1); return; }
      if (c.raw > 0 && c.integral > 0) { o.scale = lm / (c.raw * c.integral); o.mode = 'free'; }
    };
    ruler.addEventListener('input', () => {
      setTotal(round(fromRuler(+ruler.value)));
      syncFields();
      app.changed();
    });
    ruler.addEventListener('change', () => { app.commit(); renderInspector(); });
    box.append(rulerBox, el('div', { class: 'ruler-ends' }, el('span', {}, 'Candle'), el('span', {}, 'Stadium pole')));

    const total = el('div', { class: 'output-total' });
    box.append(total);

    const grid = el('div', { class: 'ref-grid' });
    const cards = refs.map((r) => {
      const label = r.count > 1 ? `${r.count} × ${fmtLm(r.lumens)} lm` : `${fmtLm(r.lumens)} lm`;
      const b = el('button', { class: 'ref-card', type: 'button', title: r.source, onclick: () => {
        o.count = r.count;
        setTotal(totalOf(r));
        app.changed(); app.commit(); renderInspector();
      } }, r.name, el('small', {}, label));
      grid.append(b);
      return b;
    });
    box.append(grid);

    const note = el('div', { class: 'ref-note' });
    box.append(note);

    box.append(el('h3', { class: 'subhead' }, 'Values'));
    selectRow(box, 'Lock', o.mode, { free: 'Off', flux: 'Total lumens', peak: 'Peak candela' }, (v) => {
      const c = app.comp;
      if (c) {
        o.peak = Math.round(c.peak);
        o.flux = c.flux / (o.count || 1);
        if (c.raw > 0) o.scale = c.peak / c.raw;
      }
      o.mode = v; app.changed(); app.commit(); renderInspector();
    });
    box.append(el('p', { class: 'hint' }, {
      free: 'Edits only change the angles they touch. Total lumens and peak follow along.',
      flux: 'Total lumens stay fixed, so adding light anywhere dims everything else. Good for keeping a real fixture’s output.',
      peak: 'The brightest point stays fixed, so raising it above the rest dims everything else.',
    }[o.mode]));
    const fields = [];
    const numRow = (label, get, set, min) => {
      const n = el('input', { type: 'number', class: 'num', min, step: 'any', 'aria-label': label });
      n.addEventListener('input', () => {
        if (n.value === '' || !Number.isFinite(+n.value) || +n.value < min) return;
        set(+n.value);
        app.changed();
      });
      n.addEventListener('change', () => app.commit());
      fields.push(() => { if (document.activeElement !== n) n.value = +(+get()).toFixed(2); });
      box.append(el('div', { class: 'row simple' }, el('label', {}, label), n));
    };
    const count = () => o.count || 1;
    const compFlux = () => (app.comp ? app.comp.flux : 0);
    if (o.mode === 'peak') {
      numRow('Peak (cd)', () => o.peak, (v) => { o.peak = v; }, 0.01);
    } else if (o.mode === 'flux') {
      numRow('Per source (lm)', () => o.flux, (v) => { o.flux = v; }, 0.01);
      numRow('Sources', count, (v) => { o.count = v; }, 1);
    } else {
      numRow('Peak (cd)', () => (app.comp ? app.comp.peak : 0), (v) => { if (app.comp && app.comp.raw > 0) o.scale = v / app.comp.raw; }, 0.01);
      numRow('Per source (lm)', () => compFlux() / count(), (v) => setTotal(v * count()), 0.01);
      numRow('Sources', count, (v) => { const each = compFlux() / count(); o.count = v; setTotal(each * v); }, 1);
    }
    numRow('Power (W)', () => o.watts ?? 0, (v) => { o.watts = v; }, 0);
    numRow('Height (cm)', () => o.height, (v) => { o.height = v; updateSliderReadouts(); }, 1);

    const guide = el('p', { class: 'output-guide' });
    const assetNote = el('p', { class: 'output-guide' });
    box.append(guide, assetNote);

    function syncFields() { fields.forEach((f) => f()); }
    function refresh() {
      syncFields();
      if (!app.comp) return;
      const lm = app.comp.flux, cd = app.comp.peak;
      if (document.activeElement !== ruler) ruler.value = toRuler(lm);
      total.innerHTML = `<b>${fmtLm(lm)} lm</b> total, ${fmt(cd)} cd peak`;
      const match = refs.find((r) => Math.abs(totalOf(r) - lm) <= totalOf(r) * 0.005);
      cards.forEach((c, i) => c.classList.toggle('on', refs[i] === match));
      if (match) {
        note.replaceChildren(el('strong', {}, match.name), el('p', {}, match.description), el('p', { class: 'cite' }, match.source));
      } else {
        const below = [...refs].reverse().find((r) => totalOf(r) < lm);
        const above = refs.find((r) => totalOf(r) > lm);
        const text = !below ? `Dimmer than a ${above.name.toLowerCase()}.` : !above ? `Brighter than a ${below.name.toLowerCase()}.`
          : `Between ${below.name} (${fmtLm(totalOf(below))} lm) and ${above.name} (${fmtLm(totalOf(above))} lm).`;
        note.replaceChildren(el('strong', {}, 'Custom output'), el('p', {}, text));
      }
      guide.innerHTML = `Peak is <b>${fmt(cd)} cd</b>. Lumens here cover the whole profile, before any spot cone crop.`;
      const symmetry = P.detectSymmetry(app.comp.N);
      assetNote.innerHTML = `Saves with <b>${planeLabel(symmetry)}</b>.`;
    }
    sliderReadouts.push(refresh);
    syncs.push(refresh);
    refresh();
  }

  function setSeg(id, value, on) {
    const seg = $(id);
    seg.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === String(value));
      b.setAttribute('aria-pressed', b.dataset.v === String(value));
      b.onclick = () => on(b.dataset.v);
    });
  }

  function updateSegs() {
    setSeg('side-tab', app.view.sideTab, (v) => { app.view.sideTab = v; updateSegs(); renderInspector(); });
    setSeg('map-extent', app.view.mapExtent, (v) => { app.view.mapExtent = +v; map.invalidate(); updateSegs(); app.requestDraw(); });
    setSeg('map-display', app.view.mapDisplay, (v) => { app.view.mapDisplay = v; updateSegs(); app.requestDraw(); });
    setSeg('curve-scale', app.view.curveScale, (v) => { app.view.curveScale = v; updateSegs(); app.requestDraw(); });
    setSeg('preview-view', app.view.preview.mode, (v) => { app.view.preview.mode = v; updateSegs(); renderPreviewControls(); app.requestDraw(); });
  }

  function renderPreviewControls() {
    const box = $('preview-controls');
    box.replaceChildren();
    previewSyncs = [];
    const v = app.view.preview;
    const ctl = (label, key, min, max, step) => {
      const range = el('input', { type: 'range', min, max, step, value: v[key], 'aria-label': label });
      const num = el('input', { type: 'number', class: 'num', min, max, step: 'any', value: v[key], 'aria-label': label + ' value' });
      range.addEventListener('input', () => { v[key] = +range.value; num.value = v[key]; app.requestDraw(); });
      num.addEventListener('input', () => { if (num.value !== '' && Number.isFinite(+num.value)) { v[key] = +num.value; range.value = v[key]; app.requestDraw(); } });
      previewSyncs.push(() => { range.value = v[key]; if (document.activeElement !== num) num.value = v[key]; });
      box.append(el('label', { class: 'field' }, label, range, num));
    };
    const choice = (label, key, options) => {
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': label });
      for (const [k, s] of options) {
        seg.append(el('button', { type: 'button', class: v[key] === k ? 'on' : '', 'aria-pressed': v[key] === k ? 'true' : 'false', onclick: () => { v[key] = k; renderPreviewControls(); app.requestDraw(); } }, s));
      }
      box.append(el('div', { class: 'field' }, label, seg));
    };
    if (v.mode !== 'side') {
      choice('Room', 'room', [['grey', 'Grey 18%'], ['checker', 'Checker']]);
      choice('Material', 'material', [['matte', 'Matte'], ['ball', 'Metal ball'], ['all', 'All metal']]);
      if (v.material !== 'matte') ctl('Roughness', 'roughness', 0.04, 1, 0.01);
      // Wall and Floor put the camera at the light, where a shadow is always hidden behind the ball.
      if (v.mode === 'first' || v.mode === 'free') box.append(el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: v.shadows, onchange: (e) => { v.shadows = e.target.checked; app.requestDraw(); } }), 'Shadows'));
    }
    if (v.mode === 'first' || v.mode === 'free') ctl('Source radius (m)', 'sourceRadius', 0, 0.5, 0.005);
    ctl('EV100', 'ev', -4, 16, 0.1);
    if (v.mode === 'first') {
      ctl('FOV', 'fov', 30, 120, 1);
      ctl('Light right', 'offR', -0.6, 0.6, 0.01);
      ctl('Light up', 'offU', -0.6, 0.6, 0.01);
    } else if (v.mode === 'free') {
      choice('Gizmo', 'gizmo', [['move', 'Move (W)'], ['rotate', 'Rotate (E)']]);
      ctl('FOV', 'fov', 30, 120, 1);
      ctl('Light X', 'lightX', -v.roomW / 2 + 0.1, v.roomW / 2 - 0.1, 0.01);
      ctl('Light Y', 'lightY', 0.1, v.roomH - 0.1, 0.01);
      ctl('Light Z', 'lightZ', 0.1, v.roomD - 0.1, 0.01);
      ctl('Pitch', 'lightPitch', -90, 90, 0.5);
      ctl('Yaw', 'lightYaw', -180, 180, 0.5);
      ctl('Roll', 'lightRoll', -180, 180, 0.5);
      box.append(el('button', { type: 'button', onclick: () => { Object.assign(v, FREE_VIEW); renderPreviewControls(); app.requestDraw(); } }, 'Reset view'));
    } else {
      ctl(v.mode === 'floor' ? 'Height m' : 'Distance m', 'throw', 0.2, 9, 0.05);
      if (v.mode !== 'side') ctl('FOV', 'fov', 30, 120, 1);
    }
    if (v.mode !== 'side') ctl('Ambient', 'ambient', 0, 5, 0.05);
    else ctl('Haze', 'haze', 0, 1, 0.005);
    if (v.mode === 'free') box.append(el('div', { class: 'note' }, 'Hold right-click to look and fly with W A S D, Q and E, and Shift goes faster. Scroll moves forward. Otherwise, W and E switch the gizmo. Hold Ctrl while dragging it to snap.'));
    box.append(el('div', { class: 'note' }, v.mode === 'side'
      ? (app.doc.lightType === 'point'
        ? 'Side view of a point light: no cone, so the whole 0–180° profile shows. Forward (V=0) is down and V=180 is up. C0 is left at bearing 0. Brightness is illustrative and scales with Haze.'
        : 'Side view of a spot light at the current bearing, with cone and inverse-square falloff. Anything past the cone is cut off. Brightness is illustrative and scales with Haze.')
      : 'Profile sampled through a 256×256 bilinear lookup, with spot cone and inverse-square. Metal uses GGX with a point source. Only the ball casts shadows, and Source radius softens them with an approximation. Tonemap is an ACES approximation. No GI or reflections.'));
  }

  function syncCone() {
    for (const key of ['inner', 'outer']) {
      const value = app.doc.cone[key];
      $(`${key}-cone-range`).value = value;
      if (document.activeElement !== $(`${key}-cone`)) $(`${key}-cone`).value = value;
    }
  }

  // Inner never passes outer, and each one pushes the other out of the way.
  function setCone(key, value) {
    const cone = app.doc.cone;
    if (key === 'inner') {
      cone.inner = Math.min(Math.max(value, 0), 88.9);
      cone.outer = Math.max(cone.outer, cone.inner);
    } else {
      cone.outer = Math.min(Math.max(value, 1), 88.9);
      cone.inner = Math.min(cone.inner, cone.outer);
    }
    syncCone();
    updateSliderReadouts();
    app.requestDraw();
  }

  function renderAll() {
    $('doc-name').value = app.doc.name;
    $('light-type').value = app.doc.lightType;
    syncCone();
    $('symmetry').value = app.doc.symmetry;
    const isSpot = app.doc.lightType === 'spot';
    document.querySelectorAll('.cone-field').forEach((n) => { n.style.display = isSpot ? '' : 'none'; });
    $('btn-cone').disabled = !isSpot;
    $('btn-cone').classList.toggle('toggle-on', app.view.applyCone && isSpot);
    $('btn-cone').setAttribute('aria-pressed', app.view.applyCone && isSpot ? 'true' : 'false');
    updateSegs();
    renderLayers();
    renderInspector();
    renderPreviewControls();
    app.requestDraw();
  }

  function loadDoc(doc) {
    const maxId = Math.max(0, ...doc.layers.map((l) => l.id));
    nextId = Math.max(nextId, maxId + 1);
    app.doc = doc;
    if (doc.output.mode === 'free' && doc.output.scale === undefined) {
      const c = P.composite(doc);
      doc.output.scale = c.raw > 0 ? doc.output.peak / c.raw : 1;
    }
    app.view.active = doc.layers[doc.layers.length - 1].id;
    if (doc.layers[0].type === 'sliders' && doc.layers.length === 1) app.view.active = doc.layers[0].id;
    app.view.selectedPoint = 0;
    fileHandle = null;
    dirty = true;
    undo.length = redo.length = 0;
    lastSnap = snapshot();
    updateUndo();
    renderAll();
  }

  async function openFile(file) {
    try {
      const parsed = P.parseIES(await file.text());
      const stem = file.name.replace(/\.ies$/i, '');
      if (parsed.doc) {
        loadDoc(parsed.doc);
        status(`Opened ${file.name} with its editable layers.`);
        return;
      }
      const notes = parsed.type !== 1 ? ` Photometric type ${parsed.type}: only type C is fully supported.` : '';
      const base = mk('imported', stem, { blend: 'normal', data: { v: parsed.v, h: parsed.h, cd: parsed.cd }, source: file.name });
      const d = docBase(stem, [base], { output: { peak: Math.round(parsed.peak), flux: Math.max(1, Math.round(parsed.lumens > 0 ? parsed.lumens : 800)), watts: parsed.watts } });      d.maker = parsed.keywords.MANUFAC || '';
      loadDoc(d);
      const reach = Math.max(...parsed.v);
      if (reach > 90) { app.view.mapExtent = 180; map.invalidate(); updateSegs(); }
      status(`Imported ${file.name} as the base layer.${notes}`);
    } catch (e) {
      status(`Could not open ${file.name}. ${e.message}`, true);
    }
  }

  async function save() {
    const text = P.writeIES(app.doc, app.comp);
    const name = `${(app.doc.name || 'profile').replace(/[\\/:*?"<>|]+/g, '_')}.ies`;
    try {
      if (window.showSaveFilePicker) {
        if (!fileHandle) fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'IES profile', accept: { 'text/plain': ['.ies'] } }] });
        const w = await fileHandle.createWritable();
        await w.write(text);
        await w.close();
        status(`Saved ${fileHandle.name} with ${planeLabel(P.detectSymmetry(app.comp.N))}.`);
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      fileHandle = null;
    }
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    // Firefox reads the blob after click returns, so it can't be revoked straight away.
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    status(`Saved ${name} to your downloads folder.`);
  }

  // Wire up.
  const map = P.Map($('map'), app);
  const curve = P.Curve($('curve'), app);
  let preview = null;
  try {
    preview = P.Preview($('preview'), app, $('preview-overlay'));
    if (!preview) status('WebGL2 is not available, so the preview is off. Map and curve still work.', true);
  } catch (e) {
    status(`Preview shader failed to start. ${e.message}`, true);
  }

  $('btn-open').onclick = () => $('file-input').click();
  $('file-input').onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
  $('btn-save').onclick = save;
  $('btn-undo').onclick = doUndo;
  $('btn-redo').onclick = doRedo;
  $('doc-name').onchange = (e) => { app.doc.name = e.target.value; pushUndo(); };
  $('preset').onchange = (e) => { if (e.target.value) { loadDoc(PRESETS[e.target.value]()); status(`Started from ${e.target.selectedOptions[0].text}.`); } e.target.value = ''; };
  $('light-type').onchange = (e) => {
    app.doc.lightType = e.target.value;
    if (e.target.value === 'point') {
      app.view.mapExtent = 180;
      app.view.preview.mode = 'side';
      map.invalidate();
      // A point light can use the whole sphere, so give the sliders somewhere to put back light.
      for (const l of app.doc.layers) {
        if (l.type !== 'sliders' || l.c0.length > 10) continue;
        l.c0 = [...l.c0, ...new Array(9).fill(0)];
        if (l.c90) l.c90 = [...l.c90, ...new Array(9).fill(0)];
      }
      const N = P.composite(app.doc).N;
      let back = 0;
      for (let y = 0; y < P.SIZE; y++) for (let x = 135; x < P.SIZE; x++) back = Math.max(back, N[x + y * P.SIZE]);
      if (back < 0.001) status('Nothing past 95° yet, so behind the light stays dark. Raise the sliders past 90° to add back light.');
      else status('Point light: this profile has light past 95°, so it shows behind the light.');
    }
    dirty = true;
    renderAll(); app.commit();
    updateSegs();
  };
  for (const key of ['inner', 'outer']) {
    const range = $(`${key}-cone-range`), num = $(`${key}-cone`);
    range.oninput = () => setCone(key, +range.value);
    range.onchange = () => app.commit();
    num.oninput = () => { if (num.value !== '' && Number.isFinite(+num.value)) setCone(key, +num.value); };
    num.onchange = () => { num.value = app.doc.cone[key]; app.commit(); };
  }
  $('btn-cone').onclick = () => { app.view.applyCone = !app.view.applyCone; renderAll(); };
  $('symmetry').onchange = (e) => { app.doc.symmetry = e.target.value; app.changed(); app.commit(); };
  $('bearing').oninput = (e) => { if (e.target.value !== '') app.setBearing(+e.target.value); };
  $('bearing-snap').value = app.view.bearingSnap;
  $('bearing-snap').onchange = (e) => { app.view.bearingSnap = +e.target.value; };
  $('bearing-reset').onclick = () => app.setBearing(0);
  $('bearing-lock').onclick = () => {
    const locked = !app.view.bearingLock;
    app.view.bearingLock = locked;
    $('bearing-lock').textContent = locked ? 'Locked' : 'Lock';
    $('bearing-lock').classList.toggle('toggle-on', locked);
    $('bearing-lock').setAttribute('aria-pressed', locked ? 'true' : 'false');
    $('bearing').disabled = locked;
    $('bearing-reset').disabled = locked;
    app.requestDraw();
  };
  $('add-layer').onchange = (e) => {
    if (!e.target.value) return;
    const l = FACTORY[e.target.value]();
    app.doc.layers.push(l);
    app.view.active = l.id;
    e.target.value = '';
    app.changed(); app.commit(); renderInspector();
  };
  $('btn-ref').onclick = () => {
    app.ref = { N: app.comp.N.slice(), peak: app.comp.peak };
    $('btn-compare').disabled = false;
    status('Reference stored. It shows on the slice, and in the preview when compared.');
    app.requestDraw();
  };
  $('btn-compare').onclick = () => {
    app.showRef = !app.showRef;
    $('btn-compare').textContent = app.showRef ? 'Show current' : 'Show reference';
    app.requestDraw();
  };
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); save(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); $('file-input').click(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); }
    if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); if (app.activeLayer()) duplicateLayer(app.activeLayer()); }
    if (k === 'delete' && app.activeLayer()) deleteLayer(app.activeLayer());
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]); });
  wireLayerDragging();
  new ResizeObserver(() => app.requestDraw()).observe(document.querySelector('.workspace'));

  $('bearing').value = app.view.bearing;
  window.penumbra = app;
  loadDoc(app.doc);
  status('Started from the flashlight example.');
})();
