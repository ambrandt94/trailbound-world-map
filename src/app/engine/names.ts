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
  'Baldur',
  'Never',
  'Candle',
  'Myth',
  'Grey',
  'Iron',
  'Storm',
  'Raven',
  'Dragon',
  'Silver',
  'Black',
  'White',
  'Red',
  'High',
  'Deep',
  'Old',
  'Moon',
  'Star',
  'Rune',
  'Oak',
  'Elm',
  'Yew',
  'Wolf',
  'Bear',
  'Hawk',
  'Wyrm',
  'Gloom',
  'Bright',
  'Frost',
  'Ember',
  'Stone',
  'Copper',
  'Jade',
  'Amber',
  'Shadow',
  'Sun',
  'Mist',
  'Salt',
  'Dusk',
  'Dawn',
  'Grim',
  'Fair',
  'Wild',
  'Loch',
  'Dun',
  'Caer',
  'Tor',
  'Glimmer',
  'Hollow',
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
  'Keep',
  'Hold',
  'Tor',
  'March',
  'Reach',
  'Spire',
  'Barrow',
  'Warren',
  'Haven',
  'Moor',
  'Dale',
  'Vale',
  'Crest',
  'Peak',
  'Pass',
  'Bridge',
  'Landing',
  'Harbor',
  'Fort',
  'Ward',
  'Shire',
  'Stead',
  'Burg',
  'Port',
  'Bay',
  'Glade',
  'Thicket',
  'Crag',
  'Gorge',
  'Depths',
  'Sanctum',
  'Altar',
  'Court',
];

const CITY_SUFFIX = ['Keep', 'Hold', 'Gate', 'Burg', 'Harbor', 'Spire', 'Ward', 'Port', 'March'];
const GROVE_SUFFIX = ['Glade', 'Copse', 'Hollow', 'Thicket', 'Dell', 'Circle', 'Grove', 'Barrow'];
const PASS_SUFFIX = ['Pass', 'Tor', 'Crag', 'Peak', 'Gorge', 'Watch', 'Crest', 'Heights'];
const CAMP_SUFFIX = ['Camp', 'Fort', 'Rest', 'Outpost', 'Hold', 'March', 'Post'];

const TITLES = [
  'on the Moor',
  'of the Twin Spires',
  'by the Deep',
  'of Ash',
  'Under Shadow',
  'of the Old Kings',
  'on the March',
  'of Nine Stones',
];

export function generatedName(rng: Rng, used: Set<string>, kind?: NodeKind): string {
  for (let i = 0; i < 32; i++) {
    const name = buildName(rng, kind);
    if (!used.has(name)) return name;
  }
  return `${buildName(rng, kind)} ${rng.int(2, 9)}`;
}

function buildName(rng: Rng, kind?: NodeKind): string {
  const prefix = rng.pick(PREFIXES);
  let suffix: string;
  if (kind === 'city' || kind === 'town') suffix = rng.pick(CITY_SUFFIX);
  else if (kind === 'grove' || kind === 'meadow') suffix = rng.pick(GROVE_SUFFIX);
  else if (kind === 'pass') suffix = rng.pick(PASS_SUFFIX);
  else if (kind === 'camp' || kind === 'shore') suffix = rng.pick(CAMP_SUFFIX);
  else suffix = rng.pick(SUFFIXES);
  let name = `${prefix} ${suffix}`;
  if (rng.chance(0.12)) name = `${name} ${rng.pick(TITLES)}`;
  return name;
}

export function kindForBiome(biome: Biome, rng: Rng): NodeKind {
  switch (biome) {
    case Biome.Water:
    case Biome.Sand:
      return rng.chance(0.55) ? 'shore' : 'meadow';
    case Biome.Marsh:
      return rng.chance(0.4) ? 'hamlet' : 'grove';
    case Biome.Desert:
      if (rng.chance(0.05)) return 'town';
      if (rng.chance(0.22)) return 'hamlet';
      return rng.chance(0.45) ? 'camp' : 'meadow';
    case Biome.Jungle:
      return rng.chance(0.15) ? 'hamlet' : 'grove';
    case Biome.Ashlands:
      return rng.chance(0.35) ? 'camp' : 'pass';
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
