import {
  BIOME_COUNT,
  Biome,
  MapNode,
  MapStyle,
  WORLD_BASE,
  WorldData,
  WorldFeature,
  WorldSettings,
  DEFAULT_WORLD_SETTINGS,
  growTileBlob,
  worldExtent,
  clamp,
} from '../models/world.models';
import { fbm, Rng, ridged } from './noise';
import { placePois } from './pois';
import { prepareLandSketch, sampleLandSketch } from './land-sketch';

const AUTHORED: Array<Omit<MapNode, 'cx' | 'cy' | 'biome' | 'x0' | 'y0' | 'x1' | 'y1' | 'tiles'> & { want: Biome }> = [
  { id: 'ashfen', name: 'Ashfen', origin: 'authored', kind: 'city', radius: 11.4, seed: 1101, want: Biome.Plains },
  { id: 'goldmere', name: 'Goldmere', origin: 'authored', kind: 'city', radius: 9.6, seed: 1105, want: Biome.Meadow },
  { id: 'saltgate', name: 'Saltgate', origin: 'authored', kind: 'city', radius: 8.8, seed: 1103, want: Biome.Sand },
  { id: 'veldcross', name: 'Veldcross', origin: 'authored', kind: 'town', radius: 6.4, seed: 1107, want: Biome.Hills },
  { id: 'hollowmere', name: 'Hollowmere', origin: 'authored', kind: 'grove', radius: 3.5, seed: 1102, want: Biome.Forest },
  { id: 'dunharrow', name: 'Dunharrow', origin: 'authored', kind: 'camp', radius: 3.3, seed: 1104, want: Biome.Mountain },
  { id: 'rowancopse', name: 'Rowan Copse', origin: 'authored', kind: 'grove', radius: 3.2, seed: 1106, want: Biome.DarkForest },
];

function idx(x: number, y: number, w: number): number {
  return x + y * w;
}

function inBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

function classify(height: number, moist: number, temp: number, river: number): Biome {
  if (height < 0.33 || (river > 0.88 && height < 0.58)) return Biome.Water;
  if (height < 0.375) return Biome.Sand;
  if (height < 0.46 && moist > 0.68) return Biome.Marsh;
  if (height > 0.86 || (temp < 0.22 && height > 0.7)) return Biome.Snow;
  if (height > 0.76) return Biome.Mountain;
  if (temp < 0.3 && moist > 0.45) return Biome.Taiga;
  if (temp < 0.32) return Biome.Snow;
  if (height > 0.64 && moist < 0.5) return Biome.Hills;
  if (temp > 0.7 && moist < 0.42 && height > 0.45) return Biome.Heath;
  if (moist > 0.7 && temp < 0.55) return Biome.DarkForest;
  if (moist > 0.56 && height < 0.7) return Biome.Forest;
  if (moist > 0.42 && temp > 0.48 && height < 0.62) return Biome.Meadow;
  return Biome.Plains;
}

function smooth(biomes: Uint8Array, w: number, h: number): void {
  const next = new Uint8Array(biomes);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const counts = new Array<number>(BIOME_COUNT).fill(0);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          counts[biomes[idx(x + ox, y + oy, w)]]++;
        }
      }
      let best = biomes[idx(x, y, w)];
      let bestN = -1;
      for (let b = 0; b < counts.length; b++) {
        if (counts[b] > bestN) {
          bestN = counts[b];
          best = b;
        }
      }
      if (bestN >= 5) next[idx(x, y, w)] = best;
    }
  }
  biomes.set(next);
}

function bump(nx: number, ny: number, cx: number, cy: number, sx: number, sy: number): number {
  return Math.exp(-Math.hypot((nx - cx) * sx, (ny - cy) * sy));
}

function landMask(
  nx: number,
  ny: number,
  style: MapStyle,
  seed: number,
  sketch: Float32Array | null,
): number {
  if (style !== 'custom') return styleMask(nx, ny, style, seed);
  if (!sketch) return styleMask(nx, ny, 'continent', seed);
  const warp = (fbm(nx * 3.1, ny * 2.9, seed + 71, 3) - 0.5) * 0.04;
  const warpY = (fbm(ny * 2.9, nx * 3.0, seed + 88, 3) - 0.5) * 0.04;
  const drawn = sampleLandSketch(sketch, nx + warp, ny + warpY);
  if (drawn < 0.08) return 0;
  const nibble = (fbm(nx * 11, ny * 11, seed + 19, 2) - 0.5) * 0.1 * drawn;
  return clamp(drawn * 0.96 + nibble, 0, 1);
}

function styleMask(nx: number, ny: number, style: MapStyle, seed: number): number {
  switch (style) {
    case 'continent': {
      const warp = (fbm(nx * 2.1, ny * 2.0, seed + 4, 3) - 0.5) * 0.14;
      const r = Math.hypot((nx - 0.5 + warp) * 2.08, (ny - 0.5 - warp * 0.35) * 2.22);
      return Math.pow(Math.max(0, 1 - r), 1.12);
    }
    case 'archipelago': {
      const peaks: Array<[number, number, number, number]> = [
        [0.27, 0.34, 5.4, 5.6],
        [0.64, 0.26, 5.8, 5.2],
        [0.74, 0.58, 5.1, 5.5],
        [0.36, 0.7, 5.6, 5.0],
        [0.52, 0.48, 4.6, 4.8],
        [0.2, 0.56, 6.2, 5.8],
        [0.58, 0.78, 6.0, 5.4],
      ];
      let m = 0;
      for (let i = 0; i < peaks.length; i++) {
        const [px, py, sx, sy] = peaks[i]!;
        const jx = px + (fbm(px * 4, py * 4, seed + 8 + i, 2) - 0.5) * 0.1;
        const jy = py + (fbm(py * 4, px * 4, seed + 21 + i, 2) - 0.5) * 0.1;
        m = Math.max(m, bump(nx, ny, jx, jy, sx, sy));
      }
      return m * 0.82 + fbm(nx * 3.4, ny * 3.4, seed + 11, 3) * 0.18;
    }
    case 'isthmus': {
      const warp = (fbm(nx * 1.8, ny * 1.8, seed + 6, 3) - 0.5) * 0.08;
      const west = bump(nx, ny, 0.3 + warp, 0.46, 3.15, 3.35);
      const east = bump(nx, ny, 0.7 - warp, 0.54, 3.1, 3.4);
      const bridge =
        Math.exp(-Math.abs(ny - 0.5 - (nx - 0.5) * 0.14 - warp) * 13) * Math.max(0, 1 - Math.abs(nx - 0.5) * 1.85);
      return Math.max(west, east, bridge * 0.72);
    }
    case 'lakes': {
      const edge = Math.pow(Math.max(0, 1 - Math.hypot((nx - 0.5) * 2.12, (ny - 0.5) * 2.18)), 0.85);
      return 0.58 + edge * 0.4;
    }
    case 'highlands': {
      const edge = Math.max(0, 1 - Math.pow(Math.hypot((nx - 0.5) * 1.88, (ny - 0.5) * 1.88), 7.4));
      return 0.6 + edge * 0.28;
    }
    case 'custom':
      return 0;
  }
}

function styleFreq(style: MapStyle, geo: number): number {
  const g = Math.sqrt(geo);
  switch (style) {
    case 'continent':
      return 2.35 * g;
    case 'archipelago':
      return 5.5 * g;
    case 'isthmus':
      return 2.7 * g;
    case 'lakes':
      return 3.15 * g;
    case 'highlands':
      return 3.5 * g;
    case 'custom':
      return 2.35 * g;
  }
}

function findSite(
  biomes: Uint8Array,
  w: number,
  h: number,
  want: Biome,
  rng: Rng,
  taken: MapNode[],
  minR: number,
): { x: number; y: number; biome: Biome } | null {
  const fallback: Biome[] =
    want === Biome.Sand
      ? [Biome.Sand, Biome.Plains, Biome.Meadow]
      : want === Biome.Mountain
        ? [Biome.Mountain, Biome.Hills, Biome.Snow, Biome.Heath]
        : want === Biome.Forest
          ? [Biome.Forest, Biome.Meadow, Biome.Plains]
          : want === Biome.DarkForest
            ? [Biome.DarkForest, Biome.Forest, Biome.Marsh]
            : want === Biome.Meadow
              ? [Biome.Meadow, Biome.Plains, Biome.Hills]
              : [want, Biome.Plains, Biome.Meadow, Biome.Hills];

  for (let attempt = 0; attempt < 4000; attempt++) {
    const x = rng.int(16, w - 17);
    const y = rng.int(16, h - 17);
    const b = biomes[idx(x, y, w)] as Biome;
    if (!fallback.includes(b)) continue;
    if (b === Biome.Water) continue;
    const ok = taken.every((n) => Math.hypot(n.cx - x, n.cy - y) > n.radius + minR + 4);
    if (!ok) continue;
    return { x, y, biome: b };
  }
  return null;
}

function stampPathCell(paths: Uint8Array, biomes: Uint8Array, w: number, h: number, x: number, y: number): void {
  if (!inBounds(x, y, w, h)) return;
  if (biomes[idx(x, y, w)] === Biome.Water) return;
  paths[idx(x, y, w)] = 1;
}

function stampPath(
  paths: Uint8Array,
  biomes: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rng: Rng,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const bends = rng.range(2.4, 4.8);
  const amp = Math.min(22, Math.max(6, len * 0.18)) * rng.range(0.75, 1.2);
  const phase = rng.range(0, Math.PI * 2);
  const noiseSeed = rng.int(1, 99991);
  const steps = Math.ceil(len * 3.2) + 16;
  let prevX = x0;
  let prevY = y0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const envelope = Math.sin(t * Math.PI);
    const wander = Math.sin(t * Math.PI * bends + phase) * amp * envelope;
    const n = fbm(t * 6.1 + x0 * 0.03, y0 * 0.03 + t * 2.4, noiseSeed, 3) - 0.5;
    const off = wander + n * amp * 0.85 * envelope;
    let x = Math.round(x0 + dx * t + px * off);
    let y = Math.round(y0 + dy * t + py * off);
    if (inBounds(x, y, w, h) && biomes[idx(x, y, w)] === Biome.Water) {
      x = Math.round(x0 + dx * t + px * off * 0.35);
      y = Math.round(y0 + dy * t + py * off * 0.35);
    }
    const seg = Math.max(Math.abs(x - prevX), Math.abs(y - prevY), 1);
    for (let s = 0; s <= seg; s++) {
      const sx = Math.round(prevX + ((x - prevX) * s) / seg);
      const sy = Math.round(prevY + ((y - prevY) * s) / seg);
      stampPathCell(paths, biomes, w, h, sx, sy);
      stampPathCell(paths, biomes, w, h, sx + 1, sy);
      stampPathCell(paths, biomes, w, h, sx, sy + 1);
    }
    prevX = x;
    prevY = y;
  }
}

export function generateWorld(seed: number, settings: WorldSettings = DEFAULT_WORLD_SETTINGS): WorldData {
  const w = worldExtent(settings.worldScale);
  const h = w;
  const rng = new Rng(seed);
  const biomes = new Uint8Array(w * h);
  const paths = new Uint8Array(w * h);
  const geo = w / WORLD_BASE;
  const style = settings.mapStyle ?? 'continent';
  const sketch = style === 'custom' ? prepareLandSketch(settings.landSketch) : null;
  const freq = styleFreq(style, geo);
  const noiseW = sketch
    ? 0.28
    : style === 'continent' || style === 'isthmus'
      ? 0.4
      : style === 'archipelago'
        ? 0.58
        : 0.44;
  const maskW = 1 - noiseW;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const ny = y / h;
      const mask = landMask(nx, ny, style, seed, sketch);
      const height = fbm(nx * freq, ny * freq, seed, 5) * noiseW + mask * maskW;
      const moist = fbm(nx * (freq * 1.17) + 9.2, ny * (freq * 1.17), seed + 17, 4);
      const temp = fbm(nx * (freq * 0.74) - 2.1, ny * (freq * 0.83) + 4.4, seed + 53, 4);
      const river = ridged(nx * (freq * 1.54), ny * (freq * 1.54), seed + 31);
      let biome = classify(height, moist, temp, river);
      if (style === 'custom' && mask < 0.12) biome = Biome.Water;
      else if (mask < 0.07 && style !== 'highlands') biome = Biome.Water;
      if (style === 'lakes' && river > 0.8 && height < 0.78 && biome !== Biome.Water && mask > 0.2) {
        biome = Biome.Water;
      }
      if (style === 'archipelago' && height < 0.38) biome = Biome.Water;
      biomes[idx(x, y, w)] = biome;
    }
  }
  smooth(biomes, w, h);
  smooth(biomes, w, h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (biomes[idx(x, y, w)] !== Biome.Marsh) continue;
      const n = hashNoise(x, y, seed + 9);
      if (n > 0.62) biomes[idx(x, y, w)] = Biome.Water;
    }
  }

  const nodes: MapNode[] = [];
  const blocked = new Set<string>();
  for (const spec of AUTHORED) {
    const site = findSite(biomes, w, h, spec.want, rng, nodes, spec.radius);
    if (!site) continue;
    const blob = growTileBlob(site.x + 0.5, site.y + 0.5, spec.radius, {
      kind: spec.kind,
      seed: spec.seed,
      biomes,
      width: w,
      height: h,
      blocked,
      avoid: nodes.map((n) => ({ cx: n.cx, cy: n.cy })),
    });
    for (const t of blob.tiles) blocked.add(`${t.x},${t.y}`);
    nodes.push({
      id: spec.id,
      name: spec.name,
      origin: spec.origin,
      kind: spec.kind,
      radius: spec.radius,
      seed: spec.seed,
      cx: site.x + 0.5,
      cy: site.y + 0.5,
      biome: site.biome,
      tiles: blob.tiles,
      x0: blob.x0,
      y0: blob.y0,
      x1: blob.x1,
      y1: blob.y1,
    });
  }

  const towns = nodes.filter((n) => n.kind === 'city' || n.kind === 'town');
  for (let i = 0; i < towns.length; i++) {
    const a = towns[i]!;
    const b = towns[(i + 1) % towns.length]!;
    stampPath(paths, biomes, w, h, Math.floor(a.cx), Math.floor(a.cy), Math.floor(b.cx), Math.floor(b.cy), rng);
  }

  for (const node of nodes) {
    if (node.kind !== 'city' && node.kind !== 'town' && node.kind !== 'hamlet') continue;
    for (const t of node.tiles) {
      if (!inBounds(t.x, t.y, w, h)) continue;
      if (biomes[idx(t.x, t.y, w)] === Biome.Water) continue;
      biomes[idx(t.x, t.y, w)] = Biome.Plains;
    }
  }

  const features: WorldFeature[] = [];
  const keep = 1 / Math.max(1, settings.worldScale);
  const step = settings.worldScale >= 8 ? 2 : 1;
  for (let y = 2; y < h - 2; y += step) {
    for (let x = 2; x < w - 2; x += step) {
      if (hashNoise(x, y, seed + 3) > keep * 1.35) continue;
      const b = biomes[idx(x, y, w)] as Biome;
      const n = hashNoise(x, y, seed);
      const tree = treeFor(b, n);
      if (tree && n > tree.threshold) {
        features.push({
          kind: 'tree',
          sprite: tree.sprite,
          x: x + 0.5,
          y: y + 0.72,
        });
      } else if ((b === Biome.Mountain || b === Biome.Hills || b === Biome.Heath) && n > 0.86) {
        features.push({
          kind: 'rock',
          sprite: n > 0.95 ? 'rock-4' : n > 0.9 ? 'rock-3' : 'rock-1',
          x: x + 0.5,
          y: y + 0.6,
        });
      } else if ((b === Biome.Snow || b === Biome.Taiga) && n > 0.86) {
        features.push({
          kind: 'rock',
          sprite: 'rock-snow',
          x: x + 0.5,
          y: y + 0.6,
        });
      } else if ((b === Biome.Meadow || b === Biome.Plains) && n > 0.78 && n < 0.86) {
        features.push({
          kind: 'flower',
          sprite: n > 0.82 ? 'flower-7' : 'flower-1',
          x: x + 0.45,
          y: y + 0.55,
        });
      } else if ((b === Biome.Hills || b === Biome.Heath) && n > 0.78 && n < 0.86) {
        features.push({
          kind: 'flower',
          sprite: 'flower-autumn',
          x: x + 0.45,
          y: y + 0.55,
        });
      } else if (b === Biome.Marsh && n > 0.7 && n < 0.84) {
        features.push({
          kind: 'flower',
          sprite: n > 0.78 ? 'reed' : 'mushroom-dark',
          x: x + 0.45,
          y: y + 0.55,
        });
      }
    }
  }

  for (const node of nodes) {
    if (node.kind === 'city' || node.kind === 'town' || node.kind === 'hamlet' || node.kind === 'camp') {
      features.push({
        kind: 'landmark',
        sprite: node.kind === 'city' ? 'town-hall' : node.kind === 'camp' ? 'farm' : 'house-1',
        x: node.cx,
        y: node.cy + 0.35,
      });
    }
  }

  const pois = placePois(
    biomes,
    w,
    h,
    rng,
    nodes.map((n) => ({ cx: n.cx, cy: n.cy, radius: n.radius })),
    settings.poiCount,
  );

  return { seed, width: w, height: h, settings, biomes, paths, nodes, pois, features };
}

function treeFor(b: Biome, n: number): { threshold: number; sprite: string } | null {
  switch (b) {
    case Biome.DarkForest:
      return { threshold: 0.55, sprite: ['forest-1', 'forest-2', 'forest-6', 'forest-8'][Math.floor(n * 40) % 4]! };
    case Biome.Forest:
      return { threshold: 0.64, sprite: ['summer-1', 'summer-3', 'summer-8', 'summer-11'][Math.floor(n * 28) % 4]! };
    case Biome.Taiga:
      return { threshold: 0.6, sprite: n > 0.8 ? 'winter-11' : 'winter-6' };
    case Biome.Hills:
    case Biome.Heath:
      return { threshold: 0.88, sprite: n > 0.94 ? 'autumn-11' : 'autumn-8' };
    case Biome.Meadow:
    case Biome.Plains:
      return { threshold: 0.94, sprite: ['summer-8', 'summer-10', 'summer-3'][Math.floor(n * 15) % 3]! };
    case Biome.Snow:
      return { threshold: 0.9, sprite: 'winter-2' };
    case Biome.Marsh:
      return { threshold: 0.9, sprite: 'forest-8' };
    default:
      return null;
  }
}

function hashNoise(x: number, y: number, seed: number): number {
  let h = Math.imul(x + seed, 374761393) + Math.imul(y, 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

export function defaultPlayerStart(world: WorldData): { x: number; y: number } {
  const town = world.nodes.find((n) => n.id === 'ashfen') ?? world.nodes[0];
  if (!town) return { x: world.width / 2, y: world.height / 2 };
  return { x: town.cx, y: town.cy + 0.55 };
}
