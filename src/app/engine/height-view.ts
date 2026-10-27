/**
 * Continental elevation for the 2D map.
 * WorldData.heights is 0..1. Metres are that sample times ELEVATION_SPAN_M.
 * Area-export relief is a separate local span and does not use this scale.
 * The overlay image is baked once per world; frames only blit the visible rect.
 */
import { TILE, WorldData } from '../models/world.models';

/** Normalized height 1 maps to this many metres above the depth datum. */
export const ELEVATION_SPAN_M = 3200;
/** Legend ticks, high to low, matching the colour ramp. */
export const ELEVATION_LEGEND_M = [3200, 2400, 1600, 800, 0] as const;
/** Isoline spacing. Index lines are every second interval (800 m). */
export const CONTOUR_INTERVAL_M = 400;
/**
 * First contour. World-gen treats height under 0.33 as water (~1,056 m),
 * so lines start at the next interval and stay on land.
 */
export const CONTOUR_MIN_M = 1200;

const RAMP: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [18, 46, 88]],
  [0.3, [38, 108, 146]],
  [0.38, [72, 146, 102]],
  [0.52, [122, 162, 78]],
  [0.66, [186, 168, 90]],
  [0.78, [166, 118, 76]],
  [0.88, [174, 166, 158]],
  [1, [246, 247, 248]],
];

const RAMP_LUT = buildRampLut();

export function formatMeters(meters: number): string {
  const n = Math.round(meters);
  const body = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${body} m`;
}

/** Nearest world-tile elevation in continental metres. */
export function elevationMetersAt(world: WorldData, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (!world.heights || ix < 0 || iy < 0 || ix >= world.width || iy >= world.height) return 0;
  return (world.heights[ix + iy * world.width] ?? 0) * ELEVATION_SPAN_M;
}

/** CSS gradient, low at the bottom, matching the baked ramp. */
export function elevationRampCss(): string {
  const stops = RAMP.map(([t, rgb]) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]}) ${(t * 100).toFixed(1)}%`);
  return `linear-gradient(to top, ${stops.join(', ')})`;
}

/** One pixel per world tile. Hillshade is mixed into the ramp; alpha lets biomes show through. */
export function bakeElevationOverlay(world: WorldData): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const heights = world.heights;
  const w = world.width;
  const h = world.height;
  if (!heights || heights.length !== w * h || w < 2 || h < 2) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const pix = img.data;
  const zf = 20;
  const lx = -0.48;
  const ly = -0.56;
  const lz = 0.67;
  const llen = Math.hypot(lx, ly, lz);
  const invL = 1 / llen;

  for (let y = 0; y < h; y++) {
    const yN = y > 0 ? y - 1 : 0;
    const yS = y + 1 < h ? y + 1 : h - 1;
    const row = y * w;
    const rowN = yN * w;
    const rowS = yS * w;
    for (let x = 0; x < w; x++) {
      const xW = x > 0 ? x - 1 : w - 1;
      const xE = x + 1 < w ? x + 1 : 0;
      const hc = heights[row + x] ?? 0;
      const zx = ((heights[row + xE] ?? hc) - (heights[row + xW] ?? hc)) * zf;
      const zy = ((heights[rowS + x] ?? hc) - (heights[rowN + x] ?? hc)) * zf;
      const inv = 1 / Math.hypot(zx, zy, 1);
      let ndot = (-zx * inv * lx + -zy * inv * ly + inv * lz) * invL;
      if (ndot < 0) ndot = 0;
      else if (ndot > 1) ndot = 1;
      const li = (hc <= 0 ? 0 : hc >= 1 ? 255 : (hc * 255) | 0) * 3;
      const light = 0.34 + ndot * 0.9;
      const o = (row + x) * 4;
      pix[o] = clampByte(RAMP_LUT[li]! * light);
      pix[o + 1] = clampByte(RAMP_LUT[li + 1]! * light);
      pix[o + 2] = clampByte(RAMP_LUT[li + 2]! * light);
      pix[o + 3] = 168;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface ContourPaths {
  minor: Path2D;
  major: Path2D;
}

/** Marching-squares isolines in world pixels for one visible window. */
export function buildContours(
  world: WorldData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number,
): ContourPaths {
  const minor = new Path2D();
  const major = new Path2D();
  const heights = world.heights;
  const w = world.width;
  const h = world.height;
  if (!heights || step < 1) return { minor, major };
  const interval = CONTOUR_INTERVAL_M / ELEVATION_SPAN_M;
  const minLevel = CONTOUR_MIN_M / ELEVATION_SPAN_M;
  const sample = (x: number, y: number): number => {
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y;
    let xx = x % w;
    if (xx < 0) xx += w;
    return heights[xx + yy * w] ?? 0;
  };
  const add = (path: Path2D, ax: number, ay: number, bx: number, by: number) => {
    path.moveTo(ax * TILE, ay * TILE);
    path.lineTo(bx * TILE, by * TILE);
  };

  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const h0 = sample(x, y);
      const h1 = sample(x + step, y);
      const h2 = sample(x + step, y + step);
      const h3 = sample(x, y + step);
      let lo = h0;
      let hi = h0;
      if (h1 < lo) lo = h1;
      if (h2 < lo) lo = h2;
      if (h3 < lo) lo = h3;
      if (h1 > hi) hi = h1;
      if (h2 > hi) hi = h2;
      if (h3 > hi) hi = h3;
      if (hi < minLevel || hi - lo < 1e-6) continue;
      let level = Math.max(minLevel, Math.ceil((lo + 1e-5) / interval) * interval);
      for (; level < hi - 1e-5; level += interval) {
        const pts: Array<[number, number]> = [];
        cross(pts, x, y, h0, x + step, y, h1, level);
        cross(pts, x + step, y, h1, x + step, y + step, h2, level);
        cross(pts, x + step, y + step, h2, x, y + step, h3, level);
        cross(pts, x, y + step, h3, x, y, h0, level);
        const index = Math.round(level / interval) % 2 === 0;
        const path = index ? major : minor;
        if (pts.length === 2) {
          add(path, pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]);
        } else if (pts.length === 4) {
          const mid = (h0 + h1 + h2 + h3) / 4 >= level;
          if (mid === h0 >= level) {
            add(path, pts[0]![0], pts[0]![1], pts[3]![0], pts[3]![1]);
            add(path, pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1]);
          } else {
            add(path, pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]);
            add(path, pts[2]![0], pts[2]![1], pts[3]![0], pts[3]![1]);
          }
        }
      }
    }
  }
  return { minor, major };
}

export function contourWindow(
  worldH: number,
  cameraX: number,
  cameraY: number,
  viewW: number,
  viewH: number,
  scale: number,
): { x0: number; y0: number; x1: number; y1: number; step: number } {
  const safe = Math.max(scale, 1e-4);
  const halfW = viewW / (2 * safe) / TILE + 3;
  const halfH = viewH / (2 * safe) / TILE + 3;
  let x0 = Math.floor(cameraX - halfW);
  let x1 = Math.ceil(cameraX + halfW);
  let y0 = Math.max(-2, Math.floor(cameraY - halfH));
  let y1 = Math.min(worldH + 2, Math.ceil(cameraY + halfH));
  const span = Math.max(8, x1 - x0, y1 - y0);
  const step = Math.max(1, Math.ceil(span / 180));
  x0 = Math.floor(x0 / step) * step;
  y0 = Math.floor(y0 / step) * step;
  x1 = Math.ceil(x1 / step) * step;
  y1 = Math.ceil(y1 / step) * step;
  return { x0, y0, x1, y1, step };
}

function cross(
  out: Array<[number, number]>,
  ax: number,
  ay: number,
  ha: number,
  bx: number,
  by: number,
  hb: number,
  level: number,
): void {
  const aboveA = ha >= level;
  if (aboveA === hb >= level) return;
  const d = hb - ha;
  const t = Math.abs(d) < 1e-8 ? 0.5 : (level - ha) / d;
  out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
}

function buildRampLut(): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const rgb = sampleRamp(i / 255);
    lut[i * 3] = rgb[0];
    lut[i * 3 + 1] = rgb[1];
    lut[i * 3 + 2] = rgb[2];
  }
  return lut;
}

function sampleRamp(t: number): [number, number, number] {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  let i = 1;
  while (i < RAMP.length - 1 && u > RAMP[i]![0]) i++;
  const a = RAMP[i - 1]!;
  const b = RAMP[i]!;
  const span = b[0] - a[0] || 1;
  const f = (u - a[0]) / span;
  return [
    a[1][0] + (b[1][0] - a[1][0]) * f,
    a[1][1] + (b[1][1] - a[1][1]) * f,
    a[1][2] + (b[1][2] - a[1][2]) * f,
  ];
}

function clampByte(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}
