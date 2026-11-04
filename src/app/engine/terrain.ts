/**
 * World-scale height in metres. Sea level is 0 everywhere.
 * Plates lay down ranges and trenches; a short thermal pass softens slopes.
 * The stored grid is one sample per world tile (8 m). Area export adds
 * detail noise seeded by world coordinates on top of a bicubic read.
 */
import { Biome, MapStyle } from '../models/world.models';
import { fbm, Rng, valueNoise2 } from './noise';

/** Metres. Trenches sit near this floor; the field is clamped here. */
export const TRENCH_FLOOR_M = -4000;
/** Abyssal plain, away from the shelf and from trenches. */
export const ABYSS_M = -2500;
/** Shelf break. Passive shelves ease from 0 down to this. */
export const SHELF_EDGE_M = -120;
/** Design peak. Normalization treats this as the top of the legacy 0..1 field. */
export const PEAK_M = 3000;
export const SEA_LEVEL_M = 0;
/**
 * Legacy normalized sea level. World-gen water and AreaExport `units.seaLevel`
 * both use this, so a sample below sea is below this number and a dry sample is not.
 */
export const NORMALIZED_SEA_LEVEL = 0.36;
/**
 * One playable vertical scale for every area.
 * Controller: renderedY = heightM * VERTICAL_EXAGGERATION.
 * 0.1 is a gentle compression of true metres (a 2,000 m face reads as 200 m).
 * It is not fitted per area.
 */
export const VERTICAL_EXAGGERATION = 0.1;
export const TILE_M = 8;

const PEAK_CLAMP_M = 3200;

export function metersToNormalized(metres: number): number {
  if (!(metres > 0)) {
    if (metres === 0) return NORMALIZED_SEA_LEVEL;
    const t = Math.min(1, metres / TRENCH_FLOOR_M);
    const below = NORMALIZED_SEA_LEVEL * (1 - t);
    // round5 is 1e-5. Keep every wet sample strictly under the sea level constant.
    return below < NORMALIZED_SEA_LEVEL - 1e-5 ? below : NORMALIZED_SEA_LEVEL - 1e-5;
  }
  const t = Math.min(1, metres / PEAK_M);
  return NORMALIZED_SEA_LEVEL + (1 - NORMALIZED_SEA_LEVEL) * t;
}

/** North is y = 0. Snowline is low in the north and high in the south. */
export function snowlineMetres(y: number, height: number): number {
  const lat = y / Math.max(1, height - 1);
  return 1750 + lat * 1100;
}

export function detailSeedFor(worldSeed: number): number {
  let h = (worldSeed >>> 0) ^ 0x51ed27b1;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h || 1;
}

/** Micro-relief amplitude in metres. Plains stay quiet; peaks get a few metres. */
export function detailAmplitudeM(macroM: number): number {
  if (macroM < -200) return 1.5;
  if (macroM < 0) return 0.4;
  if (macroM >= 1600) return 6;
  if (macroM >= 300) return 1.6;
  return 0.3;
}

/** Continuous detail. The same world tile coordinate always returns the same offset. */
export function detailOffsetM(x: number, y: number, worldSeed: number, macroM: number): number {
  const n = fbm(x * 0.47 + 2.2, y * 0.47 - 1.4, detailSeedFor(worldSeed), 2);
  return (n - 0.5) * 2 * detailAmplitudeM(macroM);
}

export function sampleMacroMeters(field: Float32Array, w: number, h: number, x: number, y: number): number {
  if (w <= 0 || h <= 0 || field.length === 0) return 0;
  const x1 = Math.floor(x);
  const y1 = Math.floor(y);
  const tx = x - x1;
  const ty = y - y1;
  if (tx <= 1e-8 && ty <= 1e-8) return at(field, w, h, x1, y1);
  const col = (ix: number) =>
    catmull(
      at(field, w, h, ix, y1 - 1),
      at(field, w, h, ix, y1),
      at(field, w, h, ix, y1 + 1),
      at(field, w, h, ix, y1 + 2),
      ty,
    );
  return catmull(col(x1 - 1), col(x1), col(x1 + 1), col(x1 + 2), tx);
}

export interface TerrainField {
  heightM: Float32Array;
  heights: Float32Array;
  biomes: Uint8Array;
}

export function buildTerrain(opts: {
  seed: number;
  width: number;
  height: number;
  style: MapStyle;
  landAt: (nx: number, ny: number) => number;
}): TerrainField {
  const { seed, width, height, style, landAt } = opts;
  const stride = coarseStride(width);
  const cw = Math.ceil(width / stride);
  const ch = Math.ceil(height / stride);
  const cellM = stride * TILE_M;
  const cut = landCut(style);
  const plates = makePlates(seed, width, height, landAt);
  const n = cw * ch;
  const elev = new Float32Array(n);
  const land = new Uint8Array(n);
  const pairOf = new Int16Array(n);
  pairOf.fill(-1);
  const distB = new Float32Array(n);
  /** Mid-ocean ridge height. Left very low where there is no divergent edge. */
  const seaRidge = new Float32Array(n);
  seaRidge.fill(-1e9);

  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const i = cx + cy * cw;
      const wx = (cx + 0.5) * stride;
      const wy = (cy + 0.5) * stride;
      const mask = landAt(wx / width, wy / height);
      const isLand = mask > cut ? 1 : 0;
      land[i] = isLand;
      const warpX =
        (valueNoise2(wx * 0.00105, wy * 0.00105, seed + 4) - 0.5) * 640 +
        (valueNoise2(wx * 0.0034, wy * 0.0034, seed + 8) - 0.5) * 180;
      const warpY =
        (valueNoise2(wx * 0.00105 + 19, wy * 0.00105, seed + 9) - 0.5) * 640 +
        (valueNoise2(wx * 0.0034 + 7, wy * 0.0034, seed + 13) - 0.5) * 180;
      const near = nearestPlates(wx + warpX, wy + warpY, plates);
      const boundaryM = Math.max(0, (near.d2 - near.d1) * 0.5) * TILE_M;
      distB[i] = boundaryM;
      const a = plates[near.a]!;
      const b = plates[near.b]!;
      const key = near.a < near.b ? near.a * 20 + near.b : near.b * 20 + near.a;
      if (boundaryM < 4200) pairOf[i] = key;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      const hills = valueNoise2(wx * 0.0042, wy * 0.0042, seed + 11);
      const hills2 = valueNoise2(wx * 0.009 + 3.2, wy * 0.008, seed + 29);
      if (isLand) elev[i] = landMetres(style, mask, cut, hills, hills2);
      if (boundaryM < 2600) {
        const along = ridgeAlong(wx, wy, seed);
        const crest = Math.exp(-(boundaryM * boundaryM) / (2 * 820 * 820));
        const oceanCont = a.continental !== b.continental && closing > 0.08;
        const contCont = a.continental && b.continental && closing > 0.05;
        const divergent = !a.continental && !b.continental && closing < -0.12;
        if (isLand && (contCont || oceanCont) && crest > 0.08) {
          const peak = (oceanCont ? 1400 : 1600) + along * 1400;
          const raised = crest * Math.min(PEAK_M, peak);
          if (raised > elev[i]!) elev[i] = raised;
        } else if (!isLand && divergent && crest > 0.05) {
          seaRidge[i] = ABYSS_M + crest * along * 1200;
        }
      }
    }
  }

  const { toSea, toLand } = distanceFields(land, cw, ch);
  // Shelf, slope, and abyss from the coast, then the guaranteed range and trench.
  for (let i = 0; i < n; i++) {
    const distSeaM = toSea[i]! * cellM;
    const distLandM = toLand[i]! * cellM;
    if (!land[i]) {
      const hills = valueNoise2((i % cw) * 0.17, (i / cw) * 0.13, seed + 21);
      const shelf = oceanMetres(distLandM, style === 'fjords', hills);
      const ridge = seaRidge[i]!;
      elev[i] = ridge > shelf ? ridge : shelf;
    } else if (distSeaM < 64 && elev[i]! < 140 && style !== 'fjords') {
      const t = distSeaM / 64;
      const beach = 0.9 + t * 3.2;
      elev[i] = beach * (1 - t) + elev[i]! * t;
    }
  }

  stampMainRange(elev, land, pairOf, distB, cw, ch, cellM, seed, style);
  if (style === 'lakes') carveLakes(elev, land, toSea, cw, ch, cellM, seed);

  thermalErode(elev, cw, ch, cellM, 4);
  blur(elev, cw, ch, 0.82);
  carveOffshoreTrench(elev, land, pairOf, distB, toLand, cw, ch, cellM, seed);
  blur(elev, cw, ch, 0.88);
  for (let i = 0; i < n; i++) {
    if (!land[i] && elev[i]! > -0.35) elev[i] = -0.35;
    if (elev[i]! > PEAK_CLAMP_M) elev[i] = PEAK_CLAMP_M;
    if (elev[i]! < TRENCH_FLOOR_M) elev[i] = TRENCH_FLOOR_M;
  }

  const moist = moistureField(elev, land, cw, ch, seed, height, stride);

  const heightM = new Float32Array(width * height);
  const heights = new Float32Array(width * height);
  const biomes = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = y / stride;
    const y0 = gy | 0;
    const ty = gy - y0;
    const y1 = y0 + 1 < ch ? y0 + 1 : y0;
    const row0 = y0 * cw;
    const row1 = y1 * cw;
    const snowline = snowlineMetres(y, height);
    const lat = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x++) {
      const gx = x / stride;
      const x0 = gx | 0;
      const tx = gx - x0;
      const x1 = x0 + 1 < cw ? x0 + 1 : x0;
      const hm =
        elev[row0 + x0]! * (1 - tx) * (1 - ty) +
        elev[row0 + x1]! * tx * (1 - ty) +
        elev[row1 + x0]! * (1 - tx) * ty +
        elev[row1 + x1]! * tx * ty;
      const coastM =
        toSea[row0 + x0]! * (1 - tx) * (1 - ty) +
        toSea[row0 + x1]! * tx * (1 - ty) +
        toSea[row1 + x0]! * (1 - tx) * ty +
        toSea[row1 + x1]! * tx * ty;
      const wet =
        moist[row0 + x0]! * (1 - tx) * (1 - ty) +
        moist[row0 + x1]! * tx * (1 - ty) +
        moist[row1 + x0]! * (1 - tx) * ty +
        moist[row1 + x1]! * tx * ty;
      const jitter = hash01(x, y, seed + 3);
      const i = x + y * width;
      heightM[i] = hm;
      heights[i] = metersToNormalized(hm);
      biomes[i] = classify(hm, wet, lat, snowline, coastM * cellM, jitter, style);
    }
  }
  return { heightM, heights, biomes };
}

/** Put beaches and snow back after the majority smooth, which eats one-tile edges. */
export function reinforceClimate(biomes: Uint8Array, heightM: Float32Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const snowline = snowlineMetres(y, h);
    const lat = y / Math.max(1, h - 1);
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const hm = heightM[i] ?? 0;
      if (hm < 0) {
        biomes[i] = Biome.Water;
        continue;
      }
      if (hm >= snowline) {
        biomes[i] = Biome.Snow;
        continue;
      }
      if (lat < 0.12 && hm < 220) {
        biomes[i] = Biome.Snow;
        continue;
      }
      if (lat < 0.24 && hm < 380 && (biomes[i] === Biome.Plains || biomes[i] === Biome.Meadow || biomes[i] === Biome.Forest)) {
        biomes[i] = Biome.Taiga;
      }
    }
  }
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const hm = heightM[i] ?? 0;
      if (hm < 0.4 || hm > 5) continue;
      const water =
        biomes[i - 1] === Biome.Water ||
        biomes[i + 1] === Biome.Water ||
        biomes[i - w] === Biome.Water ||
        biomes[i + w] === Biome.Water;
      if (water && biomes[i] !== Biome.Snow && biomes[i] !== Biome.Mountain) biomes[i] = Biome.Sand;
    }
  }
}

export interface TerrainSummary {
  minM: number;
  maxM: number;
  land: number;
  shelf: number;
  abyss: number;
  trench: number;
  mountain: number;
  snow: number;
  sand: number;
  desert: number;
  jungle: number;
  hills: number;
}

export function summarizeTerrain(
  heightM: Float32Array,
  biomes: Uint8Array,
): TerrainSummary {
  const out: TerrainSummary = {
    minM: Infinity,
    maxM: -Infinity,
    land: 0,
    shelf: 0,
    abyss: 0,
    trench: 0,
    mountain: 0,
    snow: 0,
    sand: 0,
    desert: 0,
    jungle: 0,
    hills: 0,
  };
  for (let i = 0; i < heightM.length; i++) {
    const hm = heightM[i] ?? 0;
    if (hm < out.minM) out.minM = hm;
    if (hm > out.maxM) out.maxM = hm;
    if (hm >= 0) out.land++;
    else if (hm >= SHELF_EDGE_M) out.shelf++;
    else if (hm >= -3200) out.abyss++;
    else out.trench++;
    const b = biomes[i];
    if (b === Biome.Mountain) out.mountain++;
    else if (b === Biome.Snow) out.snow++;
    else if (b === Biome.Sand) out.sand++;
    else if (b === Biome.Desert) out.desert++;
    else if (b === Biome.Jungle) out.jungle++;
    else if (b === Biome.Hills) out.hills++;
  }
  return out;
}

function classify(
  hm: number,
  moist: number,
  lat: number,
  snowline: number,
  coastM: number,
  jitter: number,
  style: MapStyle,
): Biome {
  if (hm < 0) return Biome.Water;
  const tempC = -8 + lat * 40 - Math.max(0, hm) * 0.0065 + (jitter - 0.5) * 3.5;
  const wet = clamp01(moist + (jitter - 0.5) * 0.06);
  if (hm < 4.2 && coastM < 72 && hm < 80) return Biome.Sand;
  if (hm >= snowline) return Biome.Snow;
  if (lat < 0.16 && hm < 260) return Biome.Snow;
  if (hm >= 1750) return Biome.Mountain;
  if (style === 'desert' && hm < 1100) {
    if (hm < 4) return Biome.Sand;
    return hm > 700 && wet < 0.35 ? Biome.Ashlands : Biome.Desert;
  }
  if (tempC < 2 && hm < 500) return wet > 0.42 ? Biome.Taiga : Biome.Snow;
  if (tempC < 7 && wet > 0.38 && hm < snowline - 80) return Biome.Taiga;
  if (hm < 7 && wet > 0.7 && coastM < 1600 && tempC > 6 && tempC < 24) return Biome.Marsh;
  if (tempC > 24 && wet < 0.4) return hm > 650 ? Biome.Ashlands : Biome.Desert;
  if (tempC > 22 && wet > 0.58 && hm < 700) return Biome.Jungle;
  if (hm >= 320) {
    if (wet < 0.34 && tempC > 16 && hm < 1100) return Biome.Heath;
    if (hm >= 900 && wet < 0.48) return Biome.Heath;
    return Biome.Hills;
  }
  if (tempC > 18 && wet < 0.38 && hm > 30) return Biome.Heath;
  if (style === 'fjords' && wet > 0.42 && hm < 900) return Biome.Forest;
  if (wet > 0.72 && tempC < 16) return Biome.DarkForest;
  if (wet > 0.55 && hm < 640) return Biome.Forest;
  if (wet > 0.44 && tempC > 10 && hm < 420) return Biome.Meadow;
  return Biome.Plains;
}

function landMetres(style: MapStyle, mask: number, cut: number, hills: number, hills2: number): number {
  const inland = clamp01((mask - cut) / Math.max(0.2, 1 - cut));
  let h = 3 + inland * 55 + (hills - 0.5) * (16 + inland * 140);
  h += Math.max(0, hills2 - 0.52) * 620 * Math.min(1, inland * 1.3);
  if (style === 'highlands') h += 420 + inland * 480;
  if (style === 'desert') h = 12 + inland * 40 + Math.abs(hills - 0.5) * 50;
  if (style === 'fjords') h += inland * 180;
  return h;
}

function oceanMetres(distLandM: number, active: boolean, noise01: number): number {
  const shelfW = active ? 620 : 2100;
  const slopeW = active ? 980 : 1900;
  let h: number;
  if (distLandM <= 0) h = -0.6;
  else if (distLandM < shelfW) {
    const t = distLandM / shelfW;
    h = SHELF_EDGE_M * (t * 0.72 + t * t * 0.28);
  } else if (distLandM < shelfW + slopeW) {
    const t = (distLandM - shelfW) / slopeW;
    const s = t * t * (3 - 2 * t);
    h = SHELF_EDGE_M + (ABYSS_M - SHELF_EDGE_M) * s;
  } else {
    h = ABYSS_M - 80 - noise01 * 220;
  }
  return h;
}

function stampMainRange(
  elev: Float32Array,
  land: Uint8Array,
  pairOf: Int16Array,
  distB: Float32Array,
  cw: number,
  ch: number,
  cellM: number,
  seed: number,
  style: MapStyle,
): void {
  const landN = new Map<number, number>();
  for (let i = 0; i < pairOf.length; i++) {
    const key = pairOf[i]!;
    if (key < 0 || distB[i]! > 3000 || !land[i]) continue;
    landN.set(key, (landN.get(key) ?? 0) + 1);
  }
  const bestLand = dominant(landN);
  const sigma = style === 'fjords' ? 620 : 860;
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const i = cx + cy * cw;
      const key = pairOf[i]!;
      if (key < 0) continue;
      const dist = distB[i]!;
      const wx = (cx + 0.5) * (cellM / TILE_M);
      const wy = (cy + 0.5) * (cellM / TILE_M);
      const along = ridgeAlong(wx, wy, seed + 17);
      if (land[i] && key === bestLand && dist < 2600) {
        const crest = Math.exp(-(dist * dist) / (2 * sigma * sigma));
        if (crest > 0.12) {
          const target = crest * (1600 + along * 1400);
          if (target > elev[i]!) elev[i] = Math.min(PEAK_M, target);
        }
      }
    }
  }
}

/** Trench parallel to the coast, cut after erosion so the floor stays deep. */
function carveOffshoreTrench(
  elev: Float32Array,
  land: Uint8Array,
  pairOf: Int16Array,
  distB: Float32Array,
  toLand: Float32Array,
  cw: number,
  ch: number,
  cellM: number,
  seed: number,
): void {
  const seaN = new Map<number, number>();
  for (let i = 0; i < pairOf.length; i++) {
    const key = pairOf[i]!;
    if (key < 0 || land[i] || distB[i]! > 3600) continue;
    if (toLand[i]! * cellM < 250) continue;
    seaN.set(key, (seaN.get(key) ?? 0) + 1);
  }
  const bestSea = dominant(seaN);
  if (bestSea < 0) return;
  const center = 1100;
  const sigma = 620;
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const i = cx + cy * cw;
      if (land[i] || pairOf[i] !== bestSea) continue;
      const offshore = toLand[i]! * cellM;
      const dz = offshore - center;
      const cross = Math.exp(-(dz * dz) / (2 * sigma * sigma));
      if (cross < 0.18) continue;
      const wx = (cx + 0.5) * (cellM / TILE_M);
      const wy = (cy + 0.5) * (cellM / TILE_M);
      const along = ridgeAlong(wx, wy, seed + 23);
      const floor = -3100 - along * 900;
      const target = elev[i]! * (1 - cross) + floor * cross;
      if (target < elev[i]!) elev[i] = target;
    }
  }
}

function carveLakes(
  elev: Float32Array,
  land: Uint8Array,
  toSea: Float32Array,
  cw: number,
  ch: number,
  cellM: number,
  seed: number,
): void {
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const i = cx + cy * cw;
      if (!land[i] || toSea[i]! * cellM < 700) continue;
      const n = valueNoise2(cx * 0.23, cy * 0.23, seed + 77);
      if (n > 0.74) elev[i] = -8 - (n - 0.74) * 90;
    }
  }
}

function moistureField(
  elev: Float32Array,
  land: Uint8Array,
  cw: number,
  ch: number,
  seed: number,
  worldH: number,
  stride: number,
): Float32Array {
  const moist = new Float32Array(cw * ch);
  const shadow = new Float32Array(cw * ch);
  for (let x = 0; x < cw; x++) {
    let carry = 0;
    for (let y = ch - 1; y >= 0; y--) {
      const i = x + y * cw;
      const rise = Math.max(0, elev[i]!);
      carry = Math.max(rise, carry * 0.86);
      shadow[i] = clamp01((carry - rise - 180) / 1600);
    }
  }
  for (let y = 0; y < ch; y++) {
    const lat = ((y + 0.5) * stride) / Math.max(1, worldH);
    for (let x = 0; x < cw; x++) {
      const i = x + y * cw;
      const n = valueNoise2(x * 0.11, y * 0.11, seed + 41);
      const base = 0.3 + lat * 0.32 + (n - 0.5) * 0.45;
      moist[i] = land[i] ? clamp01(base - shadow[i]! * 0.62) : clamp01(0.55 + lat * 0.2);
    }
  }
  return moist;
}

function thermalErode(h: Float32Array, w: number, ch: number, cellM: number, iters: number): void {
  const talus = Math.tan((48 * Math.PI) / 180) * cellM;
  const next = new Float32Array(h.length);
  for (let iter = 0; iter < iters; iter++) {
    next.set(h);
    for (let y = 1; y < ch - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        let lowest = i;
        let lowV = h[i]!;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = i + dx + dy * w;
            const v = h[j]!;
            if (v < lowV) {
              lowV = v;
              lowest = j;
            }
          }
        }
        const diff = h[i]! - lowV;
        if (lowest !== i && diff > talus) {
          const move = (diff - talus) * 0.3;
          next[i] -= move;
          next[lowest] += move;
        }
      }
    }
    h.set(next);
  }
}

function blur(h: Float32Array, w: number, ch: number, keep: number): void {
  const next = new Float32Array(h.length);
  const bleed = (1 - keep) / 4;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      let acc = h[i]! * keep;
      acc += h[x > 0 ? i - 1 : i]! * bleed;
      acc += h[x + 1 < w ? i + 1 : i]! * bleed;
      acc += h[y > 0 ? i - w : i]! * bleed;
      acc += h[y + 1 < ch ? i + w : i]! * bleed;
      next[i] = acc;
    }
  }
  h.set(next);
}

function distanceFields(land: Uint8Array, cw: number, ch: number): { toSea: Float32Array; toLand: Float32Array } {
  const toSea = new Float32Array(cw * ch);
  const toLand = new Float32Array(cw * ch);
  const INF = 1e6;
  for (let i = 0; i < land.length; i++) {
    toSea[i] = land[i] ? INF : 0;
    toLand[i] = land[i] ? 0 : INF;
  }
  chamfer(toSea, cw, ch);
  chamfer(toLand, cw, ch);
  return { toSea, toLand };
}

function chamfer(d: Float32Array, cw: number, ch: number): void {
  const diag = 1.41421356;
  for (let y = 0; y < ch; y++) {
    const row = y * cw;
    for (let x = 0; x < cw; x++) {
      const i = row + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 1);
      if (y > 0) v = Math.min(v, d[i - cw]! + 1);
      if (x > 0 && y > 0) v = Math.min(v, d[i - cw - 1]! + diag);
      if (x + 1 < cw && y > 0) v = Math.min(v, d[i - cw + 1]! + diag);
      d[i] = v;
    }
  }
  for (let y = ch - 1; y >= 0; y--) {
    const row = y * cw;
    for (let x = cw - 1; x >= 0; x--) {
      const i = row + x;
      let v = d[i]!;
      if (x + 1 < cw) v = Math.min(v, d[i + 1]! + 1);
      if (y + 1 < ch) v = Math.min(v, d[i + cw]! + 1);
      if (x + 1 < cw && y + 1 < ch) v = Math.min(v, d[i + cw + 1]! + diag);
      if (x > 0 && y + 1 < ch) v = Math.min(v, d[i + cw - 1]! + diag);
      d[i] = v;
    }
  }
}

interface Plate {
  x: number;
  y: number;
  vx: number;
  vy: number;
  continental: boolean;
}

function makePlates(
  seed: number,
  w: number,
  h: number,
  landAt: (nx: number, ny: number) => number,
): Plate[] {
  const rng = new Rng((seed ^ 0x5a17c3) >>> 0 || 1);
  const nPlates = rng.int(8, 14);
  const draft: Array<Plate & { mask: number }> = [];
  for (let i = 0; i < nPlates; i++) {
    const x = rng.range(w * 0.05, w * 0.95);
    const y = rng.range(h * 0.05, h * 0.95);
    const ang = rng.range(0, Math.PI * 2);
    const speed = rng.range(0.35, 1);
    draft.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      continental: false,
      mask: landAt(x / w, y / h),
    });
  }
  draft.sort((a, b) => a.mask - b.mask);
  const oceanN = Math.max(2, Math.round(nPlates * 0.35));
  return draft.map((plate, index) => ({
    x: plate.x,
    y: plate.y,
    vx: plate.vx,
    vy: plate.vy,
    continental: index >= oceanN,
  }));
}

function nearestPlates(x: number, y: number, plates: Plate[]): { a: number; b: number; d1: number; d2: number } {
  let a = 0;
  let b = 1;
  let d1 = Infinity;
  let d2 = Infinity;
  for (let i = 0; i < plates.length; i++) {
    const plate = plates[i]!;
    const d = Math.hypot(x - plate.x, y - plate.y);
    if (d < d1) {
      d2 = d1;
      b = a;
      d1 = d;
      a = i;
    } else if (d < d2) {
      d2 = d;
      b = i;
    }
  }
  return { a, b, d1, d2 };
}

function ridgeAlong(wx: number, wy: number, seed: number): number {
  const a = 1 - Math.abs(valueNoise2(wx / 260, wy / 260, seed) * 2 - 1);
  const b = 1 - Math.abs(valueNoise2(wx / 95, wy / 95, seed + 4) * 2 - 1);
  return a * 0.68 + b * 0.32;
}

function dominant(counts: Map<number, number>): number {
  let best = -1;
  let n = 0;
  for (const [key, count] of counts) {
    if (count > n) {
      n = count;
      best = key;
    }
  }
  return best;
}

function coarseStride(width: number): number {
  if (width >= 4096) return 8;
  if (width >= 1024) return 4;
  if (width >= 512) return 2;
  return 1;
}

function landCut(style: MapStyle): number {
  switch (style) {
    case 'archipelago':
      return 0.48;
    case 'shattered':
      return 0.45;
    case 'highlands':
      return 0.08;
    case 'desert':
      return 0.2;
    case 'lakes':
      return 0.1;
    case 'fjords':
      return 0.3;
    case 'isthmus':
      return 0.28;
    default:
      return 0.2;
  }
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function at(field: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0) x = 0;
  else if (x >= w) x = w - 1;
  if (y < 0) y = 0;
  else if (y >= h) y = h - 1;
  return field[x + y * w] ?? 0;
}

function hash01(x: number, y: number, seed: number): number {
  let h = Math.imul(x + seed, 374761393) + Math.imul(y, 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
