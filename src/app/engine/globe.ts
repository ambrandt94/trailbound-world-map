import {
  TILE,
  clamp,
  globeMinScaleFor,
  globeMorphStartFor,
  globeMorphT,
  minScaleFor,
  wrapX,
} from '../models/world.models';
import {
  GLOBE_FOV,
  GLOBE_TEX_MAX,
  globeFlatDistance,
  globeOrbitDistance,
  globeRadius,
  lonLatToSphere,
  lonLatToTile,
  sphereToLonLat,
  tileToLonLat,
} from './projection';

export interface GlobeMarker {
  x: number;
  y: number;
  color: [number, number, number];
  size: number;
}

export interface GlobeDrawState {
  width: number;
  height: number;
  cameraX: number;
  cameraY: number;
  scale: number;
  viewW: number;
  viewH: number;
  markers: GlobeMarker[];
}

const GRID_U = 128;
const GRID_V = 64;
const SPACE = [0.027, 0.043, 0.063] as const;

const PLANET_VS = `
attribute vec2 aUv;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uMorph;
uniform float uWidth;
uniform float uHeight;
uniform float uRadius;
uniform float uLookLon;
uniform float uLookLat;
uniform float uCamDist;
varying vec2 vUv;
varying vec3 vNormal;
varying float vFacing;
void main() {
  vUv = aUv;
  float lon = aUv.x * 6.28318530718;
  float lat = 1.57079632679 - aUv.y * 3.14159265359;
  float cl = cos(lat);
  vec3 sphere = vec3(uRadius * cl * cos(lon), uRadius * sin(lat), uRadius * cl * sin(lon));
  float lookU = uLookLon / 6.28318530718;
  float lookV = (1.57079632679 - uLookLat) / 3.14159265359;
  float du = aUv.x - lookU;
  du -= floor(du + 0.5);
  float dv = aUv.y - lookV;
  vec4 sView = uView * vec4(sphere, 1.0);
  vec3 planeView = vec3(du * uWidth, -dv * uHeight, -(uCamDist - uRadius));
  vec3 pos = mix(planeView, sView.xyz, uMorph);
  vec3 nSphere = normalize((uView * vec4(sphere, 0.0)).xyz);
  vec3 nPlane = vec3(0.0, 0.0, 1.0);
  vNormal = normalize(mix(nPlane, nSphere, uMorph));
  vFacing = vNormal.z;
  gl_Position = uProj * vec4(pos, 1.0);
}
`;

const PLANET_FS = `
precision mediump float;
uniform sampler2D uAlbedo;
uniform vec3 uLight;
uniform float uMorph;
varying vec2 vUv;
varying vec3 vNormal;
varying float vFacing;
void main() {
  vec3 albedo = texture2D(uAlbedo, vUv).rgb;
  float ndotl = max(0.0, dot(normalize(vNormal), normalize(uLight)));
  float amb = mix(1.0, 0.38, uMorph);
  vec3 lit = albedo * (amb + (1.0 - amb) * ndotl);
  gl_FragColor = vec4(lit, 1.0);
}
`;

const ATM_VS = `
attribute vec2 aUv;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uRadius;
varying vec3 vNormal;
void main() {
  float lon = aUv.x * 6.28318530718;
  float lat = 1.57079632679 - aUv.y * 3.14159265359;
  float cl = cos(lat);
  vec3 sphere = vec3(uRadius * cl * cos(lon), uRadius * sin(lat), uRadius * cl * sin(lon));
  vNormal = normalize((uView * vec4(sphere, 0.0)).xyz);
  gl_Position = uProj * uView * vec4(sphere, 1.0);
}
`;

const ATM_FS = `
precision mediump float;
varying vec3 vNormal;
void main() {
  float fresnel = pow(1.0 - abs(vNormal.z), 2.15);
  vec3 color = vec3(0.42, 0.62, 0.92);
  gl_FragColor = vec4(color, fresnel * 0.52);
}
`;

const MARK_VS = `
attribute vec2 aTile;
attribute vec3 aColor;
attribute float aSize;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uMorph;
uniform float uWidth;
uniform float uHeight;
uniform float uRadius;
uniform float uLookLon;
uniform float uLookLat;
uniform float uCamDist;
varying vec3 vColor;
varying float vFacing;
void main() {
  float lon = (aTile.x / uWidth) * 6.28318530718;
  float lat = 1.57079632679 - (aTile.y / uHeight) * 3.14159265359;
  float cl = cos(lat);
  vec3 sphere = vec3(uRadius * cl * cos(lon), uRadius * sin(lat), uRadius * cl * sin(lon));
  float lookU = uLookLon / 6.28318530718;
  float lookV = (1.57079632679 - uLookLat) / 3.14159265359;
  float du = aTile.x / uWidth - lookU;
  du -= floor(du + 0.5);
  float dv = aTile.y / uHeight - lookV;
  vec4 sView = uView * vec4(sphere, 1.0);
  vec3 planeView = vec3(du * uWidth, -dv * uHeight, -(uCamDist - uRadius));
  vec3 pos = mix(planeView, sView.xyz, uMorph);
  vec3 nSphere = normalize((uView * vec4(sphere, 0.0)).xyz);
  vFacing = mix(1.0, nSphere.z, uMorph);
  vColor = aColor;
  gl_Position = uProj * vec4(pos, 1.0);
  float facing = step(0.02, vFacing);
  gl_PointSize = aSize * facing;
}
`;

const MARK_FS = `
precision mediump float;
varying vec3 vColor;
varying float vFacing;
void main() {
  if (vFacing < 0.02) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float edge = smoothstep(1.0, 0.45, r);
  gl_FragColor = vec4(vColor, edge);
}
`;

export class GlobeRenderer {
  private gl: WebGLRenderingContext | null = null;
  private planet: Program | null = null;
  private atmosphere: Program | null = null;
  private markers: Program | null = null;
  private grid: Mesh | null = null;
  private texture: WebGLTexture | null = null;
  private markerBuf: WebGLBuffer | null = null;
  private markerCap = 0;
  private view = mat4();
  private proj = mat4();
  private invView = mat4();
  private lastCamDist = 400;
  private lastR = 100;
  private lastLook = { lon: 0, lat: 0 };
  private lastMorph = 0;
  private lastSize = { w: 0, h: 0 };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: true,
      depth: true,
      premultipliedAlpha: true,
    });
    if (!gl) return;
    this.gl = gl;
    this.planet = compile(gl, PLANET_VS, PLANET_FS);
    this.atmosphere = compile(gl, ATM_VS, ATM_FS);
    this.markers = compile(gl, MARK_VS, MARK_FS);
    this.grid = buildGrid(gl, GRID_U, GRID_V);
    this.markerBuf = gl.createBuffer();
    if (!this.planet || !this.atmosphere || !this.markers || !this.grid) {
      this.dispose();
    }
  }

  get ready(): boolean {
    return !!this.gl && !!this.planet && !!this.grid;
  }

  setTexture(bake: HTMLCanvasElement | null): void {
    const gl = this.gl;
    if (!gl || !bake) return;
    const src = downsampleBake(bake, GLOBE_TEX_MAX);
    if (!this.texture) this.texture = gl.createTexture();
    if (!this.texture) return;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    const canvas = this.gl?.canvas;
    if (!(canvas instanceof HTMLCanvasElement)) return;
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
  }

  draw(state: GlobeDrawState): void {
    const gl = this.gl;
    const planet = this.planet;
    const grid = this.grid;
    if (!gl || !planet || !grid) return;

    const { width, height, cameraX, cameraY, scale, viewW, viewH } = state;
    const morph = globeMorphT(scale, width);
    const R = globeRadius(width);
    const look = tileToLonLat(cameraX, cameraY, width, height);
    const camDist = cameraDistance(viewW, viewH, scale, width, R, morph);
    const eye = cameraEye(look.lon, look.lat, camDist);
    const up: [number, number, number] =
      Math.abs(Math.sin(look.lat)) > 0.92 ? [0, 0, 1] : [0, 1, 0];
    lookAt(this.view, eye, [0, 0, 0], up);
    invert4(this.invView, this.view);
    perspective(this.proj, GLOBE_FOV, viewW / Math.max(1, viewH), Math.max(0.08, camDist - R * 2.4), camDist + R * 4);
    this.lastCamDist = camDist;
    this.lastR = R;
    this.lastLook = look;
    this.lastMorph = morph;
    this.lastSize = { w: viewW, h: viewH };

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(SPACE[0], SPACE[1], SPACE[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    gl.useProgram(planet.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, grid.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.ibo);
    bindAttrib(gl, planet, 'aUv', 2, 8, 0);
    gl.uniformMatrix4fv(uni(planet, 'uView'), false, this.view);
    gl.uniformMatrix4fv(uni(planet, 'uProj'), false, this.proj);
    gl.uniform1f(uni(planet, 'uMorph'), morph);
    gl.uniform1f(uni(planet, 'uWidth'), width);
    gl.uniform1f(uni(planet, 'uHeight'), height);
    gl.uniform1f(uni(planet, 'uRadius'), R);
    gl.uniform1f(uni(planet, 'uLookLon'), look.lon);
    gl.uniform1f(uni(planet, 'uLookLat'), look.lat);
    gl.uniform1f(uni(planet, 'uCamDist'), camDist);
    gl.uniform3f(uni(planet, 'uLight'), 0.42, 0.62, 0.78);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(uni(planet, 'uAlbedo'), 0);
    gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_SHORT, 0);

    if (this.atmosphere && morph > 0.28) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.useProgram(this.atmosphere.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, grid.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.ibo);
      bindAttrib(gl, this.atmosphere, 'aUv', 2, 8, 0);
      gl.uniformMatrix4fv(uni(this.atmosphere, 'uView'), false, this.view);
      gl.uniformMatrix4fv(uni(this.atmosphere, 'uProj'), false, this.proj);
      gl.uniform1f(uni(this.atmosphere, 'uRadius'), R * 1.045);
      gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(true);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    if (this.markers && state.markers.length) {
      this.drawMarkers(state, morph, R, look, camDist);
    }

    gl.disable(gl.BLEND);
  }

  unproject(sx: number, sy: number, state: Pick<GlobeDrawState, 'width' | 'height' | 'cameraX' | 'cameraY' | 'scale' | 'viewW' | 'viewH'>): { x: number; y: number } | null {
    const { width, height, cameraX, cameraY, scale, viewW, viewH } = state;
    const morph = globeMorphT(scale, width);
    const R = globeRadius(width);
    const look = tileToLonLat(cameraX, cameraY, width, height);
    const camDist = cameraDistance(viewW, viewH, scale, width, R, morph);
    const eye = cameraEye(look.lon, look.lat, camDist);
    const up: [number, number, number] =
      Math.abs(Math.sin(look.lat)) > 0.92 ? [0, 0, 1] : [0, 1, 0];
    lookAt(this.view, eye, [0, 0, 0], up);
    invert4(this.invView, this.view);

    const aspect = viewW / Math.max(1, viewH);
    const tanH = Math.tan(GLOBE_FOV / 2);
    const nx = (sx / viewW) * 2 - 1;
    const ny = 1 - (sy / viewH) * 2;
    const dirView = norm3([nx * tanH * aspect, ny * tanH, -1]);
    const originWorld = transformPoint(this.invView, [0, 0, 0]);
    const dirWorld = transformDir(this.invView, dirView);

    const plane = unprojectPlane(dirView, camDist, R, cameraX, cameraY, width, height);
    if (morph < 0.18) return plane;

    const hit = intersectSphere(originWorld, dirWorld, R);
    if (!hit) return morph > 0.72 ? null : plane;
    const ll = sphereToLonLat(hit[0], hit[1], hit[2]);
    const tile = lonLatToTile(ll.lon, ll.lat, width, height);
    if (morph > 0.82) return tile;
    return {
      x: wrapX(plane.x + (tile.x - plane.x) * morph, width),
      y: plane.y + (tile.y - plane.y) * morph,
    };
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.markerBuf) gl.deleteBuffer(this.markerBuf);
    if (this.grid) {
      gl.deleteBuffer(this.grid.vbo);
      gl.deleteBuffer(this.grid.ibo);
    }
    if (this.planet) gl.deleteProgram(this.planet.prog);
    if (this.atmosphere) gl.deleteProgram(this.atmosphere.prog);
    if (this.markers) gl.deleteProgram(this.markers.prog);
    this.gl = null;
    this.planet = null;
    this.atmosphere = null;
    this.markers = null;
    this.grid = null;
    this.texture = null;
  }

  private drawMarkers(
    state: GlobeDrawState,
    morph: number,
    R: number,
    look: { lon: number; lat: number },
    camDist: number,
  ): void {
    const gl = this.gl;
    const prog = this.markers;
    if (!gl || !prog || !this.markerBuf) return;
    const list = state.markers;
    const stride = 6;
    const data = new Float32Array(list.length * stride);
    for (let i = 0; i < list.length; i++) {
      const m = list[i]!;
      const o = i * stride;
      data[o] = m.x;
      data[o + 1] = m.y;
      data[o + 2] = m.color[0];
      data[o + 3] = m.color[1];
      data[o + 4] = m.color[2];
      data[o + 5] = m.size;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuf);
    if (list.length > this.markerCap) {
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this.markerCap = list.length;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog.prog);
    bindAttrib(gl, prog, 'aTile', 2, stride * 4, 0);
    bindAttrib(gl, prog, 'aColor', 3, stride * 4, 8);
    bindAttrib(gl, prog, 'aSize', 1, stride * 4, 20);
    gl.uniformMatrix4fv(uni(prog, 'uView'), false, this.view);
    gl.uniformMatrix4fv(uni(prog, 'uProj'), false, this.proj);
    gl.uniform1f(uni(prog, 'uMorph'), morph);
    gl.uniform1f(uni(prog, 'uWidth'), state.width);
    gl.uniform1f(uni(prog, 'uHeight'), state.height);
    gl.uniform1f(uni(prog, 'uRadius'), R);
    gl.uniform1f(uni(prog, 'uLookLon'), look.lon);
    gl.uniform1f(uni(prog, 'uLookLat'), look.lat);
    gl.uniform1f(uni(prog, 'uCamDist'), camDist);
    gl.drawArrays(gl.POINTS, 0, list.length);
  }
}

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  a: Record<string, number>;
}

interface Mesh {
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
}

function compile(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): Program | null {
  const vs = shader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = shader(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  const u: Record<string, WebGLUniformLocation | null> = {};
  const a: Record<string, number> = {};
  const uCount = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < uCount; i++) {
    const info = gl.getActiveUniform(prog, i);
    if (info) u[info.name] = gl.getUniformLocation(prog, info.name);
  }
  const aCount = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES) as number;
  for (let i = 0; i < aCount; i++) {
    const info = gl.getActiveAttrib(prog, i);
    if (info) a[info.name] = gl.getAttribLocation(prog, info.name);
  }
  return { prog, u, a };
}

function shader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function uni(prog: Program, name: string): WebGLUniformLocation | null {
  return prog.u[name] ?? null;
}

function bindAttrib(
  gl: WebGLRenderingContext,
  prog: Program,
  name: string,
  size: number,
  stride: number,
  offset: number,
): void {
  const loc = prog.a[name];
  if (loc === undefined || loc < 0) return;
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
}

function buildGrid(gl: WebGLRenderingContext, segU: number, segV: number): Mesh | null {
  const nu = segU + 1;
  const nv = segV + 1;
  const verts = new Float32Array(nu * nv * 2);
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const i = (v * nu + u) * 2;
      verts[i] = u / segU;
      verts[i + 1] = v / segV;
    }
  }
  const idx = new Uint16Array(segU * segV * 6);
  let k = 0;
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      const a = v * nu + u;
      const b = a + 1;
      const c = a + nu;
      const d = c + 1;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = d;
    }
  }
  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  if (!vbo || !ibo) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  return { vbo, ibo, count: idx.length };
}

function downsampleBake(bake: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const longest = Math.max(bake.width, bake.height);
  if (longest <= max) return bake;
  const k = max / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bake.width * k));
  canvas.height = Math.max(1, Math.round(bake.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return bake;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bake, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cameraDistance(
  viewW: number,
  viewH: number,
  scale: number,
  width: number,
  radius: number,
  morph: number,
): number {
  const dFlat = globeFlatDistance(viewH, Math.max(scale, minScaleFor(width)), TILE);
  const dOrbit = globeOrbitDistance(viewW, viewH, radius);
  const t = morph * morph * (3 - 2 * morph);
  let d = dFlat + (dOrbit - dFlat) * t;
  const start = globeMorphStartFor(width);
  if (scale < start) {
    d *= start / Math.max(scale, globeMinScaleFor(width) * 0.65);
  }
  return Math.max(radius * 1.18, d);
}

function cameraEye(lon: number, lat: number, dist: number): [number, number, number] {
  const p = lonLatToSphere(lon, lat, 1);
  return [p[0] * dist, p[1] * dist, p[2] * dist];
}

function unprojectPlane(
  dirView: [number, number, number],
  camDist: number,
  radius: number,
  cameraX: number,
  cameraY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const zPlane = -(camDist - radius);
  const t = zPlane / (dirView[2] || -1e-6);
  const hitX = dirView[0] * t;
  const hitY = dirView[1] * t;
  return {
    x: wrapX(cameraX + hitX, width),
    y: clamp(cameraY - hitY, 0, height),
  };
}

function intersectSphere(
  origin: [number, number, number],
  dir: [number, number, number],
  radius: number,
): [number, number, number] | null {
  const b = 2 * (origin[0] * dir[0] + origin[1] * dir[1] + origin[2] * dir[2]);
  const c = origin[0] * origin[0] + origin[1] * origin[1] + origin[2] * origin[2] - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / 2;
  const t1 = (-b + s) / 2;
  const t = t0 > 0.001 ? t0 : t1 > 0.001 ? t1 : -1;
  if (t < 0) return null;
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
}

function mat4(): Float32Array {
  return new Float32Array(16);
}

function perspective(out: Float32Array, fovy: number, aspect: number, near: number, far: number): void {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
}

function lookAt(
  out: Float32Array,
  eye: [number, number, number],
  center: [number, number, number],
  up: [number, number, number],
): void {
  const zx = eye[0] - center[0];
  const zy = eye[1] - center[1];
  const zz = eye[2] - center[2];
  const zlen = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / zlen;
  const z1 = zy / zlen;
  const z2 = zz / zlen;
  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  const xlen = Math.hypot(x0, x1, x2) || 1;
  x0 /= xlen;
  x1 /= xlen;
  x2 /= xlen;
  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;
  out[0] = x0;
  out[1] = y0;
  out[2] = z0;
  out[3] = 0;
  out[4] = x1;
  out[5] = y1;
  out[6] = z1;
  out[7] = 0;
  out[8] = x2;
  out[9] = y2;
  out[10] = z2;
  out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
}

function invert4(out: Float32Array, a: Float32Array): boolean {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return false;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}

function transformPoint(m: Float32Array, p: [number, number, number]): [number, number, number] {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

function transformDir(m: Float32Array, d: [number, number, number]): [number, number, number] {
  return norm3([
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ]);
}

function norm3(v: [number, number, number]): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}
