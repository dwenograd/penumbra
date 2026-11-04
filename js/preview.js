// WebGL preview. Samples the profile through a 256 x 256
// bilinear lookup and spot cone falloff. The room is analytic and has no shadows or GI.
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
  uniform bool spot, greyRoom;
  uniform int metal;
  uniform float roughness, haze;
  const float PI = 3.14159265359;

  // GGX distribution, Smith joint approximation and Schlick Fresnel.
  float specular(vec3 n, vec3 v, vec3 l, float f0) {
    vec3 h = normalize(v + l);
    float a = roughness * roughness;
    float a2 = a * a;
    float noh = clamp(dot(n, h), 0.0, 1.0);
    float nov = clamp(abs(dot(n, v)), 0.001, 1.0);
    float nol = clamp(dot(n, l), 0.001, 1.0);
    float d = noh * noh * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * d * d);
    float vis = 0.5 / (nol * (nov * (1.0 - a) + a) + nov * (nol * (1.0 - a) + a));
    float F = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(v, h), 0.0, 1.0), 5.0);
    return D * vis * F;
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
    float lit = albedo * e / PI + albedo * ambient;
    if (metal == 2 || (metal == 1 && ball)) {
      const float F0 = 0.91;
      lit = e * specular(n, -rd, normalize(lightPos - q), F0) + F0 * 0.18 * ambient;
    }
    color = vec4(tonemap(vec3(lit)), 1.0);
  }`;

  const norm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, s = 1) => a.map((x, i) => x + b[i] * s);

  P.Preview = function (canvas, app) {
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

    function basis(yaw, pitch) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const F = [sy * cp, sp, cy * cp];
      const R = norm(cross([0, 1, 0], F));
      return { F, R, U: cross(F, R) };
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
      gl.uniform1i(u('metal'), { matte: 0, ball: 1, all: 2 }[v.material]);
      set1('roughness', Math.max(v.roughness, 0.04));
      set1('haze', v.haze);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (app.view.preview.mode !== 'first') return;
      canvas.setPointerCapture(e.pointerId);
      drag = [e.clientX, e.clientY, app.view.preview.yaw, app.view.preview.pitch];
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const v = app.view.preview;
      v.yaw = drag[2] + (e.clientX - drag[0]) * 0.004;
      v.pitch = Math.max(-1.4, Math.min(1.4, drag[3] - (e.clientY - drag[1]) * 0.004));
      app.requestDraw();
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    return { draw };
  };
})();
