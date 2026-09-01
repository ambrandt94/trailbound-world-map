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
      return rng.chance(0.28) ? 'hamlet' : 'meadow';
    case Biome.Forest:
    case Biome.DarkForest:
      return 'grove';
    case Biome.Hills:
    case Biome.Heath:
      return rng.chance(0.3) ? 'hamlet' : 'meadow';
    case Biome.Mountain:
    case Biome.Snow:
    case Biome.Taiga:
      return 'pass';
    default:
      return 'meadow';
  }
}
