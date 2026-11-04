// WebGL preview. Samples the profile through a 256 x 256
// bilinear lookup and spot cone falloff. The room is analytic, with no GI, and only the ball casts shadows.
(function () {
  const VS = `#version 300 es
  in vec2 p; out vec2 uv;
  void main() { uv = p; gl_Position = vec4(p, 0.0, 1.0); }`;

  const FS = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 color;
  uniform sampler2D ies;
  uniform int mode;
  uniform vec2 aspect;
  uniform vec3 camPos, camR, camU, camF;
  uniform vec3 lightPos, lightF, lightT, lightB;
  uniform vec3 room;
  uniform float tanFov, peak, exposure, ambient, radius, cosOuter, invCone, sideMeters, bearing;
  uniform bool spot, greyRoom, shadows;
  uniform int metal;
  uniform float roughness, haze, sourceRadius;
  const float PI = 3.14159265359;

  // GGX distribution, Smith joint approximation and Schlick Fresnel.
  float specular(vec3 n, vec3 v, vec3 l, float f0, float lightDist) {
    vec3 h = normalize(v + l);
    // Widens the lobe for a sphere source, and scales it down to keep the energy about the same.
    float a0 = roughness * roughness;
    float a = clamp(a0 + sourceRadius / (2.0 * lightDist), 0.0, 1.0);
    float energy = (a0 / a) * (a0 / a);
    float a2 = a * a;
    float noh = clamp(dot(n, h), 0.0, 1.0);
    float nov = clamp(abs(dot(n, v)), 0.001, 1.0);
    float nol = clamp(dot(n, l), 0.001, 1.0);
    float d = noh * noh * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * d * d);
    float vis = 0.5 / (nol * (nov * (1.0 - a) + a) + nov * (nol * (1.0 - a) + a));
    float F = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(v, h), 0.0, 1.0), 5.0);
    return energy * D * vis * F;
  }

  float profile(vec3 w) {
    float v = acos(clamp(dot(w, lightF), -1.0, 1.0)) / PI;
    float h = atan(dot(w, lightT), dot(w, lightB)) / (2.0 * PI) + 0.5;
    return textureLod(ies, vec2(v, h), 0.0).r;
  }

  float lightAt(vec3 q, vec3 n) {
    vec3 d = q - lightPos;
    float d2 = max(dot(d, d), 1e-4);
    vec3 w = d / sqrt(d2);
    float cone = 1.0;
    if (spot) { cone = clamp((dot(w, lightF) - cosOuter) * invCone, 0.0, 1.0); cone *= cone; }
    float win = clamp(1.0 - pow(d2 / (radius * radius), 2.0), 0.0, 1.0);
    return peak * profile(w) * cone * win * win * max(dot(n, -w), 0.0) / d2;
  }

  vec3 tonemap(vec3 x) {
    x *= exposure;
    x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    return pow(x, vec3(1.0 / 2.2));
  }

  void main() {
    if (mode == 3) {
      vec2 q = uv * aspect * sideMeters;
      // A spot hangs near the top. A point light sits in the middle so its back hemisphere shows.
      if (spot) q.y -= sideMeters * 0.86;
      float d2 = max(dot(q, q), 1e-3);
      float a = bearing;
      vec3 s = -(cos(a) * lightB + sin(a) * lightT);
      vec3 w = normalize(q.x * -s + (-q.y) * lightF);
      float cone = 1.0;
      if (spot) { cone = clamp((dot(w, lightF) - cosOuter) * invCone, 0.0, 1.0); cone *= cone; }
      float e = haze * peak * profile(w) * cone / d2 / PI;
      color = vec4(tonemap(vec3(e)), 1.0);
      return;
    }
    vec3 rd = normalize(camF + (uv.x * aspect.x * camR + uv.y * aspect.y * camU) * tanFov);
    vec3 lo = vec3(-room.x * 0.5, 0.0, 0.0), hi = vec3(room.x * 0.5, room.y, room.z);
    vec3 t1 = (lo - camPos) / rd, t2 = (hi - camPos) / rd;
    vec3 tm = max(t1, t2);
    float t = min(tm.x, min(tm.y, tm.z));
    vec3 n = vec3(0.0, 0.0, -sign(rd.z));
    if (tm.x <= t) n = vec3(-sign(rd.x), 0.0, 0.0);
    else if (tm.y <= t) n = vec3(0.0, -sign(rd.y), 0.0);
    float albedo = greyRoom ? 0.18 : 0.45;
    vec3 sc = vec3(0.0, 0.5, room.z * 0.55);
    vec3 oc = camPos - sc;
    float b = dot(oc, rd), c = dot(oc, oc) - 0.25;
    float disc = b * b - c;
    bool ball = false;
    if (disc > 0.0) {
      float ts = -b - sqrt(disc);
      if (ts > 0.0 && ts < t) { t = ts; n = normalize(camPos + rd * t - sc); ball = true; if (!greyRoom) albedo = 0.5; }
    }
    vec3 q = camPos + rd * t;
    if (!ball && !greyRoom) {
      vec3 g = floor(q + 1e-3);
      float checker = mod(g.x + g.y + g.z, 2.0);
      albedo *= checker > 0.5 ? 1.0 : 0.72;
    }
    float e = lightAt(q, n);
    if (shadows && !ball) {
      // The ball is the only caster, so the light is blocked only if this ray hits it on the way.
      vec3 toLight = lightPos - q;
      float lightDist = length(toLight);
      vec3 ol = q - sc;
      float along = -dot(ol, toLight / lightDist);
      if (along > 0.001 && along < lightDist) {
        // Compares the ray's miss distance with the ball's radius, softened by how large the
        // source looks from the ball. An approximation, not a true area light.
        float miss = sqrt(max(dot(ol, ol) - along * along, 0.0));
        float blur = max(sourceRadius * along / lightDist, 0.001);
        e *= smoothstep(0.5 - blur, 0.5 + blur, miss);
      }
    }
    float lit = albedo * e / PI + albedo * ambient;
    if (metal == 2 || (metal == 1 && ball)) {
      const float F0 = 0.91;
      lit = e * specular(n, -rd, normalize(lightPos - q), F0, length(lightPos - q)) + F0 * 0.18 * ambient;
    }
    color = vec4(tonemap(vec3(lit)), 1.0);
  }`;

  const norm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, s = 1) => a.map((x, i) => x + b[i] * s);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  P.Preview = function (canvas, app, overlay) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const u = (n) => gl.getUniformLocation(prog, n);
    const set3 = (n, v) => gl.uniform3fv(u(n), v);
    const set1 = (n, v) => gl.uniform1f(u(n), v);
    let uploaded = null;
    let drag = null;

    function basis(yaw, pitch) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const F = [sy * cp, sp, cy * cp];
      // Built from yaw rather than world up, so a light can point straight down.
      const R = [cy, 0, -sy];
      return { F, R, U: cross(F, R) };
    }

    function freeCamera(v) {
      return { pos: [v.camX, v.camY, v.camZ], ...basis(v.camYaw, v.camPitch) };
    }

    function lightBasis(v) {
      const b = basis((v.lightYaw * Math.PI) / 180, (v.lightPitch * Math.PI) / 180);
      const c = Math.cos((v.lightRoll * Math.PI) / 180), s = Math.sin((v.lightRoll * Math.PI) / 180);
      return { F: b.F, R: add(b.R.map((x) => x * c), b.U, -s), U: add(b.U.map((x) => x * c), b.R, s) };
    }

    const roomLimit = (v, p) => [
      Math.max(-v.roomW / 2 + 0.1, Math.min(v.roomW / 2 - 0.1, p[0])),
      Math.max(0.1, Math.min(v.roomH - 0.1, p[1])),
      Math.max(0.1, Math.min(v.roomD - 0.1, p[2])),
    ];
    const frustum = (v) => {
      const r = canvas.getBoundingClientRect();
      const tan = Math.tan(((v.fov / 2) * Math.PI) / 180);
      return { r, sx: Math.max(r.width / r.height, 1) * tan, sy: Math.max(r.height / r.width, 1) * tan };
    };
    // Where a world point lands in the view, in CSS pixels. Null when it's behind the camera.
    function project(v, p) {
      const cam = freeCamera(v), f = frustum(v);
      const d = add(p, cam.pos, -1);
      const z = dot(d, cam.F);
      if (z <= 0.05) return null;
      return { x: ((dot(d, cam.R) / z / f.sx + 1) / 2) * f.r.width, y: ((1 - dot(d, cam.U) / z / f.sy) / 2) * f.r.height, z };
    }
    function unproject(v, x, y, z) {
      const cam = freeCamera(v), f = frustum(v);
      const ux = ((x / f.r.width) * 2 - 1) * f.sx * z, uy = (1 - (y / f.r.height) * 2) * f.sy * z;
      return add(add(add(cam.pos, cam.F, z), cam.R, ux), cam.U, uy);
    }

    // Keeps the gizmo the same size on screen at any distance.
    const worldPerPixel = (v, z) => { const f = frustum(v); return (2 * f.sy * z) / f.r.height; };
    const GIZMO_PIXELS = 85;
    const AXES = [
      { id: 'x', dir: [1, 0, 0], color: '#ff5a5a' },
      { id: 'y', dir: [0, 1, 0], color: '#6be06b' },
      { id: 'z', dir: [0, 0, 1], color: '#5aa2ff' },
    ];
    const PLANES = [
      { id: 'xy', a: [1, 0, 0], b: [0, 1, 0], normal: [0, 0, 1], color: '#5aa2ff' },
      { id: 'yz', a: [0, 1, 0], b: [0, 0, 1], normal: [1, 0, 0], color: '#ff5a5a' },
      { id: 'xz', a: [1, 0, 0], b: [0, 0, 1], normal: [0, 1, 0], color: '#6be06b' },
    ];

    // The gizmo's parts as screen shapes, shared by drawing and picking.
    function gizmoParts(v) {
      const pos = [v.lightX, v.lightY, v.lightZ];
      const centre = project(v, pos);
      if (!centre) return null;
      const L = GIZMO_PIXELS * worldPerPixel(v, centre.z);
      const at = (d, k) => add(pos, d, k * L);
      if (v.gizmo === 'rotate') {
        const yawF = [Math.sin((v.lightYaw * Math.PI) / 180), 0, Math.cos((v.lightYaw * Math.PI) / 180)];
        const b = lightBasis({ ...v, lightRoll: 0 });
        const ring = (id, key, color, u, w) => {
          const pts = [];
          for (let i = 0; i <= 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            pts.push(project(v, add(add(pos, u, Math.cos(a) * L), w, Math.sin(a) * L)));
          }
          return { id, key, color, pts };
        };
        return {
          centre,
          rings: [
            // Each ring runs in the direction that increases its angle.
            ring('yaw', 'lightYaw', '#6be06b', [0, 0, 1], [1, 0, 0]),
            ring('pitch', 'lightPitch', '#ff5a5a', yawF, [0, 1, 0]),
            ring('roll', 'lightRoll', '#5aa2ff', b.R, b.U.map((x) => -x)),
          ],
          forward: project(v, at(lightBasis(v).F, 1)),
        };
      }
      const corner = (p, ka, kb) => at(add(p.a.map((x) => x * ka), p.b, kb), 1);
      return {
        centre,
        axes: AXES.map((a) => ({ ...a, tip: project(v, at(a.dir, 1)) })),
        planes: PLANES.map((p) => ({
          ...p,
          quad: [corner(p, 0.22, 0.22), corner(p, 0.45, 0.22), corner(p, 0.45, 0.45), corner(p, 0.22, 0.45)].map((q) => project(v, q)),
        })),
        forward: project(v, at(lightBasis(v).F, 0.6)),
      };
    }

    const segmentDistance = (x, y, a, b) => {
      if (!a || !b) return Infinity;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / Math.max(dx * dx + dy * dy, 1e-6)));
      return Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
    };
    const insideQuad = (x, y, q) => {
      if (q.some((p) => !p)) return false;
      let inside = false;
      for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
        if ((q[i].y > y) !== (q[j].y > y) && x < ((q[j].x - q[i].x) * (y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
      }
      return inside;
    };

    function pickGizmo(v, x, y) {
      const g = gizmoParts(v);
      if (!g) return null;
      if (g.rings) {
        let best = null, bestDistance = 8;
        for (const ring of g.rings) {
          for (let i = 0; i < ring.pts.length - 1; i++) {
            const d = segmentDistance(x, y, ring.pts[i], ring.pts[i + 1]);
            if (d < bestDistance) { bestDistance = d; best = { kind: 'ring', id: ring.id, key: ring.key, a: ring.pts[i], b: ring.pts[i + 1] }; }
          }
        }
        return best;
      }
      if (Math.hypot(g.centre.x - x, g.centre.y - y) < 9) return { kind: 'screen', id: 'screen', z: g.centre.z };
      for (const p of g.planes) if (insideQuad(x, y, p.quad)) return { kind: 'plane', id: p.id, normal: p.normal };
      let best = null, bestDistance = 8;
      for (const a of g.axes) {
        const d = segmentDistance(x, y, g.centre, a.tip);
        if (d < bestDistance) { bestDistance = d; best = { kind: 'axis', id: a.id, dir: a.dir }; }
      }
      return best;
    }

    function drawOverlay(v) {
      const ctx = overlay.getContext('2d');
      const r = overlay.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      const w = Math.round(r.width * d), h = Math.round(r.height * d);
      if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
      ctx.clearRect(0, 0, w, h);
      if (v.mode !== 'free') return;
      const g = gizmoParts(v);
      if (!g) return;
      ctx.scale(d, d);
      const active = drag && drag.id ? drag.id : hoverPart;
      const tint = (id, color) => (id === active ? '#ffe14d' : color);
      if (g.forward) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(g.centre.x, g.centre.y); ctx.lineTo(g.forward.x, g.forward.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (g.rings) {
        for (const ring of g.rings) {
          ctx.strokeStyle = tint(ring.id, ring.color);
          ctx.lineWidth = ring.id === active ? 3 : 2;
          ctx.beginPath();
          let pen = false;
          for (const p of ring.pts) {
            if (!p) { pen = false; continue; }
            if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
            pen = true;
          }
          ctx.stroke();
        }
      } else {
        for (const p of g.planes) {
          if (p.quad.some((q) => !q)) continue;
          ctx.fillStyle = tint(p.id, p.color);
          ctx.globalAlpha = p.id === active ? 0.75 : 0.4;
          ctx.beginPath();
          p.quad.forEach((q, i) => { if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
        }
        for (const a of g.axes) {
          if (!a.tip) continue;
          const color = tint(a.id, a.color);
          const dx = a.tip.x - g.centre.x, dy = a.tip.y - g.centre.y, len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          ctx.strokeStyle = color; ctx.fillStyle = color;
          ctx.lineWidth = a.id === active ? 3 : 2;
          ctx.beginPath(); ctx.moveTo(g.centre.x, g.centre.y); ctx.lineTo(a.tip.x, a.tip.y); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(a.tip.x + ux * 11, a.tip.y + uy * 11);
          ctx.lineTo(a.tip.x - uy * 5, a.tip.y + ux * 5);
          ctx.lineTo(a.tip.x + uy * 5, a.tip.y - ux * 5);
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.fillStyle = tint('screen', '#ffffff');
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(g.centre.x, g.centre.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function draw() {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      const v = app.view.preview;
      const source = app.showRef && app.ref ? app.ref : app.comp;
      if (uploaded !== source.N) {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, P.SIZE, P.SIZE, 0, gl.RED, gl.FLOAT, source.N);
        uploaded = source.N;
      }
      const room = [v.roomW, v.roomH, v.roomD];
      let cam, cp, lp, lb;
      if (v.mode === 'first') {
        cam = basis(v.yaw, v.pitch);
        cp = [Math.max(-room[0] / 2 + 0.1, Math.min(room[0] / 2 - 0.1, 0)), v.eye, 0.15];
        lp = add(add(add(cp, cam.R, v.offR), cam.U, v.offU), cam.F, 0.15);
        lb = cam;
      } else if (v.mode === 'free') {
        const free = freeCamera(v);
        cam = free;
        cp = free.pos;
        lp = [v.lightX, v.lightY, v.lightZ];
        lb = lightBasis(v);
      } else if (v.mode === 'floor') {
        cam = { F: [0, -1, 0], R: [1, 0, 0], U: [0, 0, 1] };
        cp = [0, v.throw, room[2] * 0.5];
        lp = cp; lb = cam;
      } else {
        cam = { F: [0, 0, 1], R: [1, 0, 0], U: [0, 1, 0] };
        cp = [0, room[1] * 0.5, room[2] - v.throw];
        lp = cp; lb = cam;
      }
      gl.uniform1i(u('mode'), v.mode === 'side' ? 3 : 0);
      gl.uniform2f(u('aspect'), Math.max(w / h, 1), Math.max(h / w, 1));
      set3('camPos', cp); set3('camR', cam.R); set3('camU', cam.U); set3('camF', cam.F);
      set3('lightPos', lp); set3('lightF', lb.F); set3('lightT', lb.U);
      // H=0 is emitted toward -B, and B is the light's right, matching the map's screen layout.
      set3('lightB', lb.R);
      set3('room', room);
      set1('tanFov', Math.tan(((v.fov / 2) * Math.PI) / 180));
      set1('peak', source.peak);
      set1('exposure', 1 / (1.2 * Math.pow(2, v.ev)));
      set1('ambient', v.ambient);
      set1('radius', v.radius);
      set1('sideMeters', v.throw);
      set1('bearing', (app.view.bearing * Math.PI) / 180);
      const spot = app.doc.lightType === 'spot';
      gl.uniform1i(u('spot'), spot ? 1 : 0);
      const cone = P.coneTerms(app.doc.cone);
      set1('cosOuter', cone.cosOuter); set1('invCone', cone.invRange);
      gl.uniform1i(u('greyRoom'), v.room === 'grey' ? 1 : 0);
      gl.uniform1i(u('shadows'), v.shadows ? 1 : 0);
      gl.uniform1i(u('metal'), { matte: 0, ball: 1, all: 2 }[v.material]);
      set1('roughness', Math.max(v.roughness, 0.04));
      set1('haze', v.haze);
      set1('sourceRadius', v.sourceRadius);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      drawOverlay(v);
    }

    const round = (n) => Math.round(n * 1000) / 1000;
    const setLight = (v, p) => {
      const at = roomLimit(v, p);
      v.lightX = round(at[0]); v.lightY = round(at[1]); v.lightZ = round(at[2]);
    };
    const snapTo = (value, step, on) => (on ? Math.round(value / step) * step : value);
    const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

    function pointerRay(v, x, y) {
      const cam = freeCamera(v);
      return { origin: cam.pos, dir: norm(add(unproject(v, x, y, 1), cam.pos, -1)) };
    }
    // Distance along an axis to the point nearest the pointer's ray.
    function alongAxis(ray, point, axis) {
      const w = add(point, ray.origin, -1);
      const b = dot(axis, ray.dir), denom = 1 - b * b;
      if (denom < 1e-4) return null;
      return (b * dot(ray.dir, w) - dot(axis, w)) / denom;
    }
    function onPlane(ray, point, normal) {
      const facing = dot(ray.dir, normal);
      if (Math.abs(facing) < 1e-3) return null;
      const t = dot(add(point, ray.origin, -1), normal) / facing;
      return t > 0 ? add(ray.origin, ray.dir, t) : null;
    }

    let hoverPart = null, flying = false;
    const localPoint = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const startLook = (e, v, yawKey, pitchKey, limit) => ({ kind: 'look', x: e.clientX, y: e.clientY, yaw: v[yawKey], pitch: v[pitchKey], keyY: yawKey, keyP: pitchKey, limit });

    canvas.addEventListener('contextmenu', (e) => { if (app.view.preview.mode === 'free') e.preventDefault(); });
    canvas.addEventListener('pointerdown', (e) => {
      const v = app.view.preview;
      if (v.mode === 'first') {
        canvas.setPointerCapture(e.pointerId);
        drag = startLook(e, v, 'yaw', 'pitch', 1.4);
        return;
      }
      if (v.mode !== 'free') return;
      if (e.button !== 0 && e.button !== 2) return;
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 2) {
        flying = true;
        drag = startLook(e, v, 'camYaw', 'camPitch', 1.5);
        return;
      }
      const [x, y] = localPoint(e);
      const part = pickGizmo(v, x, y);
      if (!part) return;
      const start = [v.lightX, v.lightY, v.lightZ];
      const ray = pointerRay(v, x, y);
      drag = { ...part, start, sx: e.clientX, sy: e.clientY };
      if (part.kind === 'axis') drag.t0 = alongAxis(ray, start, part.dir);
      if (part.kind === 'plane') drag.hit0 = onPlane(ray, start, part.normal);
      if (part.kind === 'screen') { const c = project(v, start); drag.ox = c.x - x; drag.oy = c.y - y; drag.z = c.z; }
      if (part.kind === 'ring') {
        const dx = part.b.x - part.a.x, dy = part.b.y - part.a.y, len = Math.hypot(dx, dy) || 1;
        drag.tx = dx / len; drag.ty = dy / len; drag.value = v[part.key];
      }
      app.requestDraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      const v = app.view.preview;
      if (v.mode === 'free' && !drag) {
        const [x, y] = localPoint(e);
        const part = pickGizmo(v, x, y);
        const id = part ? part.id : null;
        canvas.style.cursor = id ? 'grab' : '';
        if (id !== hoverPart) { hoverPart = id; app.requestDraw(); }
      }
      if (!drag) return;
      if (drag.kind === 'look') {
        v[drag.keyY] = drag.yaw + (e.clientX - drag.x) * 0.004;
        v[drag.keyP] = Math.max(-drag.limit, Math.min(drag.limit, drag.pitch - (e.clientY - drag.y) * 0.004));
        app.requestDraw();
        return;
      }
      // Ctrl snaps, by 0.25 m when moving and 15 degrees when rotating.
      const snap = e.ctrlKey || e.metaKey;
      const [x, y] = localPoint(e);
      if (drag.kind === 'ring') {
        const pixels = (e.clientX - drag.sx) * drag.tx + (e.clientY - drag.sy) * drag.ty;
        const moved = snapTo((pixels / GIZMO_PIXELS) * (180 / Math.PI), 15, snap);
        v[drag.key] = round(drag.key === 'lightPitch' ? Math.max(-90, Math.min(90, drag.value + moved)) : wrap180(drag.value + moved));
      } else if (drag.kind === 'screen') {
        setLight(v, unproject(v, x + drag.ox, y + drag.oy, drag.z));
      } else {
        const ray = pointerRay(v, x, y);
        if (drag.kind === 'axis') {
          const t = alongAxis(ray, drag.start, drag.dir);
          if (t !== null && drag.t0 !== null) setLight(v, add(drag.start, drag.dir, snapTo(t - drag.t0, 0.25, snap)));
        } else {
          const hit = onPlane(ray, drag.start, drag.normal);
          if (hit && drag.hit0) setLight(v, add(drag.start, add(hit, drag.hit0, -1).map((n) => snapTo(n, 0.25, snap))));
        }
      }
      app.syncPreviewControls();
      app.requestDraw();
    });
    const endDrag = () => { drag = null; flying = false; held.clear(); app.requestDraw(); };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // Hold the right mouse button to fly with W A S D, Q and E. Otherwise W and E switch gizmo mode.
    const held = new Set();
    let hovering = false, lastTick = 0, ticking = false;
    const MOVES = { w: [1, 0, 0], s: [-1, 0, 0], d: [0, 1, 0], a: [0, -1, 0], e: [0, 0, 1], q: [0, 0, -1] };
    const moveCamera = (v, amount) => {
      const cam = freeCamera(v);
      const at = roomLimit(v, add(cam.pos, amount, 1));
      v.camX = at[0]; v.camY = at[1]; v.camZ = at[2];
    };
    function tick(now) {
      const v = app.view.preview;
      if (!held.size || v.mode !== 'free') { ticking = false; return; }
      // A frame's timestamp can predate the key press, so this has to stay above zero.
      const dt = Math.max(0, Math.min((now - lastTick) / 1000, 0.1));
      lastTick = now;
      const speed = (held.has('shift') ? 5 : 2) * dt;
      const cam = freeCamera(v);
      let step = [0, 0, 0];
      for (const k of held) {
        const m = MOVES[k];
        if (!m) continue;
        step = add(add(add(step, cam.F, m[0] * speed), cam.R, m[1] * speed), [0, 1, 0], m[2] * speed);
      }
      moveCamera(v, step);
      app.requestDraw();
      requestAnimationFrame(tick);
    }
    canvas.addEventListener('pointerenter', () => { hovering = true; });
    canvas.addEventListener('pointerleave', () => { hovering = false; if (hoverPart) { hoverPart = null; app.requestDraw(); } });
    canvas.addEventListener('wheel', (e) => {
      const v = app.view.preview;
      if (v.mode !== 'free') return;
      e.preventDefault();
      moveCamera(v, freeCamera(v).F.map((x) => x * (e.deltaY < 0 ? 0.25 : -0.25)));
      app.requestDraw();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      const v = app.view.preview;
      if (k === 'shift') { held.add(k); return; }
      if (v.mode !== 'free' || !hovering || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
      if (flying && MOVES[k]) {
        e.preventDefault();
        held.add(k);
        if (!ticking) { ticking = true; lastTick = performance.now(); requestAnimationFrame(tick); }
      } else if (!flying && (k === 'w' || k === 'e')) {
        e.preventDefault();
        app.setGizmo(k === 'w' ? 'move' : 'rotate');
      }
    });
    window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { held.clear(); flying = false; });
    return { draw };
  };
})();
