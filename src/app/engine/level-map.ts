import { Biome } from '../models/world.models';

/** Level Map Assets pack uses 32×32 cells. */
export const MAP_TILE = 32;

export interface MapTileSrc {
  sx: number;
  sy: number;
}

/** Atlas is 12×13 of 32px tiles (Map_tiles.png). */
export function mapTile(col: number, row: number): MapTileSrc {
  return { sx: col * MAP_TILE, sy: row * MAP_TILE };
}

/** Flat ground stamp for overworld bake (distinct from Pixel Kingdom street art). */
export function biomeMapTile(biome: Biome): MapTileSrc {
  switch (biome) {
    case Biome.Water:
      return mapTile(0, 0);
    case Biome.Marsh:
      return mapTile(2, 1);
    case Biome.Sand:
      return mapTile(9, 0);
    case Biome.Desert:
      return mapTile(10, 0);
    case Biome.Plains:
      return mapTile(3, 0);
    case Biome.Meadow:
      return mapTile(4, 0);
    case Biome.Forest:
      return mapTile(7, 7);
    case Biome.Jungle:
      return mapTile(3, 9);
    case Biome.DarkForest:
      return mapTile(5, 2);
    case Biome.Hills:
      return mapTile(3, 2);
    case Biome.Heath:
      return mapTile(5, 5);
    case Biome.Mountain:
      return mapTile(11, 2);
    case Biome.Ashlands:
      return mapTile(10, 5);
    case Biome.Snow:
      return mapTile(6, 0);
    case Biome.Taiga:
      return mapTile(6, 3);
    default:
      return mapTile(3, 0);
  }
}

/** Sparse overworld deco sprite keys (registered in assets). */
export function biomeMapDeco(biome: Biome, hash: number): string | null {
  const h = hash % 17;
  switch (biome) {
    case Biome.Forest:
    case Biome.Jungle:
    case Biome.DarkForest:
      if (h < 5) return `map-tree-${(hash % 12) + 1}`;
      return null;
    case Biome.Taiga:
      if (h < 4) return `map-tree-${(hash % 6) + 1}`;
      if (h === 5) return `map-rock-${(hash % 8) + 1}`;
      return null;
    case Biome.Hills:
    case Biome.Mountain:
    case Biome.Ashlands:
    case Biome.Heath:
      if (h < 4) return `map-rock-${(hash % 12) + 1}`;
      return null;
    case Biome.Desert:
    case Biome.Sand:
      if (h === 0) return 'map-pyramid-1';
      if (h === 1) return `map-rock-${(hash % 6) + 1}`;
      return null;
    case Biome.Snow:
      if (h < 2) return `map-rock-${(hash % 4) + 1}`;
      return null;
    case Biome.Plains:
    case Biome.Meadow:
      if (h === 0) return `map-tree-${(hash % 5) + 8}`;
      return null;
    default:
      return null;
  }
}

export function settlementMapIcon(kind: string, hash: number): string {
  if (kind === 'city') return `map-house-${(hash % 3) + 7}`;
  if (kind === 'town') return `map-house-${(hash % 3) + 4}`;
  if (kind === 'hamlet' || kind === 'camp') return `map-house-${(hash % 3) + 1}`;
  return `map-house-${(hash % 9) + 1}`;
}

export function poiMapIcon(kind: string, hash: number): string {
  switch (kind) {
    case 'ruins':
    case 'ancient-gate':
    case 'crypt':
      return hash % 2 === 0 ? 'map-pyramid-1' : 'map-pyramid-2';
    case 'temple':
    case 'monastery':
    case 'shrine':
      return `map-house-${(hash % 2) + 8}`;
    case 'dragon-lair':
    case 'cave':
    case 'mine':
      return `map-rock-${(hash % 6) + 7}`;
    case 'wizard-tower':
    case 'tower':
    case 'watchtower':
      return `map-house-${(hash % 3) + 5}`;
    case 'orc-fort':
    case 'bandit-camp':
    case 'military-camp':
      return `map-house-${(hash % 3) + 2}`;
    case 'treehouse':
    case 'fey-circle':
    case 'hideout':
      return `map-tree-${(hash % 8) + 1}`;
    default:
      return `map-house-${(hash % 6) + 1}`;
  }
}
