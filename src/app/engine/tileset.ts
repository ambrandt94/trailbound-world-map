import { Biome, TILE } from '../models/world.models';

export const GROUPS = {
  plateau: 0,
  waterCliff: 4,
  path: 8,
  water: 12,
  forest: 16,
  rock: 20,
} as const;

export const SEASON = {
  summer: 0,
  winter: 7,
  autumn: 14,
  lush: 21,
} as const;

export interface TileSrc {
  sx: number;
  sy: number;
}

export function tileSrc(groupCol: number, seasonRow: number, lx: number, ly: number): TileSrc {
  return {
    sx: (groupCol + lx) * TILE,
    sy: (seasonRow + ly) * TILE,
  };
}

/** 4-neighbor blob using the 3x3 cluster in each 4-wide terrain group. */
export function blobLocal(n: boolean, e: boolean, s: boolean, w: boolean): [number, number] {
  if (n && e && s && w) return [1, 1];
  if (!n && e && s && w) return [1, 0];
  if (n && e && !s && w) return [1, 2];
  if (n && !e && s && w) return [2, 1];
  if (n && e && s && !w) return [0, 1];
  if (!n && e && s && !w) return [0, 0];
  if (!n && !e && s && w) return [2, 0];
  if (n && e && !s && !w) return [0, 2];
  if (n && !e && !s && w) return [2, 2];
  if (!n && !e && !s && !w) return [3, 2];
  // 1 neighbor or opposite pair: never use the interior tile (that dropped shores).
  if (s && !n) return [1, 0];
  if (n && !s) return [1, 2];
  if (e && !w) return [0, 1];
  if (w && !e) return [2, 1];
  return [1, 1];
}

export function biomeSeason(biome: Biome): number {
  switch (biome) {
    case Biome.Snow:
    case Biome.Taiga:
      return SEASON.winter;
    case Biome.Hills:
    case Biome.Heath:
    case Biome.Desert:
    case Biome.Ashlands:
      return SEASON.autumn;
    case Biome.DarkForest:
    case Biome.Marsh:
    case Biome.Jungle:
      return SEASON.lush;
    default:
      return SEASON.summer;
  }
}

export function overlayGroup(biome: Biome): number | null {
  switch (biome) {
    case Biome.Water:
      return GROUPS.water;
    case Biome.Sand:
    case Biome.Desert:
      return GROUPS.path;
    case Biome.Heath:
    case Biome.Ashlands:
      return GROUPS.path;
    case Biome.Forest:
    case Biome.DarkForest:
    case Biome.Taiga:
    case Biome.Jungle:
      return GROUPS.forest;
    case Biome.Hills:
      return GROUPS.plateau;
    case Biome.Mountain:
    case Biome.Snow:
      return GROUPS.rock;
    default:
      return null;
  }
}

export const FLOORS: TileSrc[] = [
  { sx: 16 * TILE, sy: 1 * TILE },
  { sx: 4 * TILE, sy: 1 * TILE },
  { sx: 1 * TILE, sy: 1 * TILE },
  { sx: 10 * TILE, sy: 1 * TILE },
  { sx: 16 * TILE, sy: 7 * TILE },
  { sx: 4 * TILE, sy: 7 * TILE },
  { sx: 1 * TILE, sy: 7 * TILE },
  { sx: 10 * TILE, sy: 7 * TILE },
];

export function decoFor(biome: Biome, kind: 'flower' | 'leaf' | 'pebble' | 'lily' | 'ripple'): TileSrc {
  const season = biomeSeason(biome);
  switch (kind) {
    case 'flower':
      return tileSrc(GROUPS.plateau, season, 0, 6);
    case 'leaf':
      return tileSrc(GROUPS.plateau, season, 1, 6);
    case 'pebble':
      return tileSrc(GROUPS.plateau, season, 2, 6);
    case 'lily':
      return tileSrc(GROUPS.waterCliff, season, 0, 6);
    case 'ripple':
      return tileSrc(GROUPS.waterCliff, season, 2, 6);
  }
}
