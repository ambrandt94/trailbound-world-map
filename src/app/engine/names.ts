import { Biome, NodeKind } from '../models/world.models';
import { Rng } from './noise';

const PREFIXES = [
  'Willow',
  'Fern',
  'Ash',
  'Briar',
  'Moss',
  'Thorn',
  'Crow',
  'Fox',
  'Hare',
  'Otter',
  'Lark',
  'Mire',
  'Gold',
  'Nettle',
  'Rowan',
  'Heather',
  'Sedge',
  'Pine',
  'Dusk',
];

const SUFFIXES = [
  'Bend',
  'Hollow',
  'Clearing',
  'Rest',
  'Crossing',
  'Dell',
  'Rise',
  'Ford',
  'Copse',
  'Trail',
  'Lea',
  'Watch',
  'Gate',
  'Fall',
  'Fen',
  'Croft',
];

export function generatedName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 24; i++) {
    const name = `${rng.pick(PREFIXES)} ${rng.pick(SUFFIXES)}`;
    if (!used.has(name)) return name;
  }
  return `${rng.pick(PREFIXES)} ${rng.pick(SUFFIXES)} ${rng.int(2, 9)}`;
}

export function kindForBiome(biome: Biome, rng: Rng): NodeKind {
  switch (biome) {
    case Biome.Water:
    case Biome.Sand:
      return rng.chance(0.55) ? 'shore' : 'meadow';
    case Biome.Marsh:
      return rng.chance(0.4) ? 'hamlet' : 'grove';
    case Biome.Plains:
    case Biome.Meadow:
      if (rng.chance(0.04)) return 'city';
      if (rng.chance(0.1)) return 'town';
      if (rng.chance(0.32)) return 'hamlet';
      return 'meadow';
    case Biome.Forest:
    case Biome.DarkForest:
      return rng.chance(0.12) ? 'hamlet' : 'grove';
    case Biome.Hills:
    case Biome.Heath:
      if (rng.chance(0.03)) return 'town';
      if (rng.chance(0.28)) return 'hamlet';
      return 'meadow';
    case Biome.Mountain:
    case Biome.Snow:
    case Biome.Taiga:
      return rng.chance(0.18) ? 'camp' : 'pass';
    default:
      return 'meadow';
  }
}
