import { LAND_SKETCH_SIZE, clamp } from '../models/world.models';

const N = LAND_SKETCH_SIZE;

export function sketchIndex(x: number, y: number): number {
  return x + y * N;
}

export function paintSketchDisk(grid: Float32Array, cx: number, cy: number, radius: number, erase: boolean): void {
  const r = Math.max(0.6, radius);
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const x1 = Math.min(N - 1, Math.ceil(cx + r + 1));
  const y1 = Math.min(N - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const t = 1 - d / r;
      const cover = t * t;
      const i = sketchIndex(x, y);
      grid[i] = erase ? grid[i]! * (1 - cover) : Math.max(grid[i]!, cover);
    }
  }
}

export function sketchHasInk(grid: ArrayLike<number>): boolean {
  for (let i = 0; i < grid.length; i++) {
    if ((grid[i] ?? 0) > 0.05) return true;
  }
  return false;
}

export function sameSketch(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 0.001) return false;
  }
  return true;
}

export function copySketch(from: ArrayLike<number> | null | undefined): Float32Array {
  const grid = new Float32Array(N * N);
  if (!from || from.length !== grid.length) return grid;
  for (let i = 0; i < grid.length; i++) grid[i] = clamp(from[i] ?? 0, 0, 1);
  return grid;
}

export function snapshotSketch(grid: Float32Array): number[] | null {
  if (!sketchHasInk(grid)) return null;
  return Array.from(grid, (v) => Math.round(v * 1000) / 1000);
}

/** Soften a scribble slightly; blank cells stay ocean. */
export function prepareLandSketch(raw: number[] | null | undefined): Float32Array | null {
  if (!raw || !sketchHasInk(raw)) return null;
  return boxBlur(copySketch(raw));
}

export function sampleLandSketch(grid: Float32Array, nx: number, ny: number): number {
  const x = clamp(nx * (N - 1), 0, N - 1);
  const y = clamp(ny * (N - 1), 0, N - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(N - 1, x0 + 1);
  const y1 = Math.min(N - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = grid[sketchIndex(x0, y0)]!;
  const b = grid[sketchIndex(x1, y0)]!;
  const c = grid[sketchIndex(x0, y1)]!;
  const d = grid[sketchIndex(x1, y1)]!;
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function boxBlur(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let sum = 0;
      let n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          sum += src[sketchIndex(xx, yy)]!;
          n++;
        }
      }
      out[sketchIndex(x, y)] = sum / n;
    }
  }
  return out;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function tryFillClosedStroke(
  grid: Float32Array,
  points: Array<{ x: number; y: number }>,
  brush: number,
): boolean {
  if (points.length < 8) return false;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  let len = 0;
  let minX = start.x;
  let minY = start.y;
  let maxX = start.x;
  let maxY = start.y;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const q = points[i - 1]!;
    len += Math.hypot(p.x - q.x, p.y - q.y);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (len < brush * 8) return false;
  if (maxX - minX < brush * 2 && maxY - minY < brush * 2) return false;
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const closeDist = Math.max(brush * 2.4, 5.5);
  if (dist > closeDist || dist > len * 0.28) return false;
  if (dist > 0.35) {
    const steps = Math.max(1, Math.ceil(dist));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      paintSketchDisk(grid, lerp(end.x, start.x, t), lerp(end.y, start.y, t), brush, false);
    }
  }
  fillPolygon(grid, points);
  return true;
}

function fillPolygon(grid: Float32Array, pts: Array<{ x: number; y: number }>): void {
  const n = pts.length;
  if (n < 3) return;
  let y0 = N;
  let y1 = 0;
  for (const p of pts) {
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const row0 = Math.max(0, Math.floor(y0));
  const row1 = Math.min(N - 1, Math.ceil(y1));
  for (let y = row0; y <= row1; y++) {
    const ys = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      if (a.y === b.y) continue;
      const up = a.y <= ys && b.y > ys;
      const down = b.y <= ys && a.y > ys;
      if (!up && !down) continue;
      xs.push(a.x + ((ys - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xStart = Math.max(0, Math.floor(xs[k]!));
      const xEnd = Math.min(N - 1, Math.ceil(xs[k + 1]!));
      for (let x = xStart; x <= xEnd; x++) {
        const i = sketchIndex(x, y);
        grid[i] = Math.max(grid[i]!, 1);
      }
    }
  }
}
