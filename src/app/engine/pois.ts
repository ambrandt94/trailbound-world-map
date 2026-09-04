import { Biome, PointOfInterest, PoiKind } from '../models/world.models';
import { Rng } from './noise';

export const POI_SPECS: Array<{ kind: PoiKind; want: Biome[]; radius: number; names: string[]; count?: number }> = [
  { kind: 'ruins', want: [Biome.Hills, Biome.Heath, Biome.Plains, Biome.Ashlands], radius: 6.4, names: ['Greyfen Ruins', "King's Fall", 'Oldwatch Stones', 'Mythrend'] },
  { kind: 'mansion', want: [Biome.Plains, Biome.Forest, Biome.Meadow], radius: 5.8, names: ['Duskmanor', 'Hallow House', 'Ashveil Hall', 'Ravenholt'] },
  { kind: 'abandoned-camp', want: [Biome.Forest, Biome.Hills, Biome.Heath, Biome.Desert], radius: 3.6, names: ['Coldfire Camp', 'Last Watch', 'Ember Rest'] },
  { kind: 'shrine', want: [Biome.Forest, Biome.DarkForest, Biome.Meadow, Biome.Jungle], radius: 4.2, names: ['Rowan Shrine', 'Fern Altar', 'Moss Chapel', 'Moonwell'] },
  { kind: 'cave', want: [Biome.Mountain, Biome.Hills, Biome.Snow, Biome.Ashlands], radius: 4.4, names: ['Nettle Cave', 'Hollow Mouth', 'Dunharrow Cleft', 'Wyrmcrack'] },
  { kind: 'graves', want: [Biome.Plains, Biome.Heath, Biome.Hills], radius: 4.6, names: ['The Quiet Stones', 'Crowbarrow', 'Lark Grave', 'Kingsbarrow'], count: 2 },
  { kind: 'homestead', want: [Biome.Plains, Biome.Meadow, Biome.Hills], radius: 4.1, names: ['Briar Croft', 'Goldlea Farm', 'Otterstead'] },
  { kind: 'hideout', want: [Biome.DarkForest, Biome.Marsh, Biome.Forest, Biome.Jungle], radius: 4.3, names: ['Fox Den', 'Thorn Cache', 'Mire Hold'] },
  { kind: 'treehouse', want: [Biome.Forest, Biome.DarkForest, Biome.Jungle], radius: 4.5, names: ['Canopy Hold', 'Willow Nest', 'Sedge Perch'] },
  { kind: 'battlefield', want: [Biome.Plains, Biome.Heath, Biome.Meadow, Biome.Ashlands], radius: 8.4, names: ['Crow Field', 'Ashfen Moor', 'Broken Ridge', 'Redmarch'] },
  { kind: 'military-camp', want: [Biome.Hills, Biome.Plains, Biome.Heath, Biome.Desert], radius: 5.2, names: ['Watchpost Thorn', 'Gate Camp', 'Pike Rest'] },
  { kind: 'tower', want: [Biome.Hills, Biome.Heath, Biome.Mountain, Biome.Plains], radius: 4.0, names: ['Stormspire', 'Grey Tor', 'Broken Watch'] },
  { kind: 'wizard-tower', want: [Biome.Hills, Biome.Meadow, Biome.Forest, Biome.Snow], radius: 4.3, names: ["Archmage's Spire", 'Starfall Tower', 'Runekeep'] },
  { kind: 'dragon-lair', want: [Biome.Mountain, Biome.Ashlands, Biome.Desert, Biome.Snow], radius: 7.2, names: ['Wyrmrest', 'Cinder Maw', 'Hoardscar'] },
  { kind: 'mine', want: [Biome.Mountain, Biome.Hills, Biome.Ashlands], radius: 4.5, names: ['Ironvein', 'Deepdelve', 'Copperhollow'] },
  { kind: 'temple', want: [Biome.Plains, Biome.Desert, Biome.Jungle, Biome.Meadow], radius: 5.5, names: ['Sunward Temple', 'Jade Sanctum', 'Silent Choir'] },
  { kind: 'monastery', want: [Biome.Hills, Biome.Mountain, Biome.Forest, Biome.Snow], radius: 5.0, names: ['High Cloister', 'Candle Abbey', 'Frosthaven Priory'] },
  { kind: 'port', want: [Biome.Sand, Biome.Plains, Biome.Marsh], radius: 5.4, names: ['Saltgate Quay', 'Gull Landing', 'Tidehaven'] },
  { kind: 'bridge-keep', want: [Biome.Plains, Biome.Hills, Biome.Marsh, Biome.Meadow], radius: 4.8, names: ['Fordkeep', 'Twin Arch', 'Riverward'] },
  { kind: 'fey-circle', want: [Biome.Forest, Biome.DarkForest, Biome.Meadow, Biome.Jungle], radius: 4.0, names: ['Moonring', 'Glimmerdance', 'Elder Circle'] },
  { kind: 'orc-fort', want: [Biome.Hills, Biome.Heath, Biome.Ashlands, Biome.Mountain], radius: 5.6, names: ['Bloodpike Fort', 'Skullgate', 'Grimhold'] },
  { kind: 'crypt', want: [Biome.Hills, Biome.Heath, Biome.DarkForest, Biome.Plains], radius: 4.2, names: ['Bonevault', 'Quiet Crypt', 'Ashen Tombs'] },
  { kind: 'watchtower', want: [Biome.Hills, Biome.Mountain, Biome.Plains, Biome.Heath], radius: 3.8, names: ['Beacon Tor', 'March Watch', 'Signal Spire'] },
  { kind: 'trading-post', want: [Biome.Plains, Biome.Desert, Biome.Hills, Biome.Meadow], radius: 4.4, names: ['Crossroads Mart', 'Spice Post', 'Goldway'] },
  { kind: 'bandit-camp', want: [Biome.Forest, Biome.Heath, Biome.Hills, Biome.Desert], radius: 3.9, names: ['Cutpurse Camp', 'Red Hood Rest', 'Ambush Dell'] },
  { kind: 'ancient-gate', want: [Biome.Mountain, Biome.Ashlands, Biome.Desert, Biome.Hills], radius: 6.0, names: ['Worldgate', 'Rune Arch', 'First Door'] },
];

export { poiKindToNodeKind } from '../models/world.models';

export function placePois(
  biomes: Uint8Array,
  w: number,
  h: number,
  rng: Rng,
  blocked: Array<{ cx: number; cy: number; radius: number }>,
  target = 12,
): PointOfInterest[] {
  const pois: PointOfInterest[] = [];
  const taken = [...blocked];
  const kinds = POI_SPECS;
  const maxTries = Math.max(80, target * 14);
  for (let i = 0; i < maxTries && pois.length < target; i++) {
    const spec = kinds[i % kinds.length]!;
    const site = findPoiSite(biomes, w, h, spec.want, rng, taken, spec.radius);
    if (!site) continue;
    const n = Math.floor(pois.length / kinds.length);
    const base = spec.names[n % spec.names.length] ?? spec.names[0]!;
    const name = n === 0 ? base : `${base} ${n + 1}`;
    const poi: PointOfInterest = {
      id: `poi-${spec.kind}-${pois.length}`,
      name,
      kind: spec.kind,
      x: site.x + 0.5,
      y: site.y + 0.5,
      radius: spec.radius,
      seed: rng.int(2000, 90000),
      biome: site.biome,
    };
    pois.push(poi);
    taken.push({ cx: poi.x, cy: poi.y, radius: poi.radius });
  }
  return pois;
}

function findPoiSite(
  biomes: Uint8Array,
  w: number,
  h: number,
  want: Biome[],
  rng: Rng,
  taken: Array<{ cx: number; cy: number; radius: number }>,
  radius: number,
): { x: number; y: number; biome: Biome } | null {
  for (let attempt = 0; attempt < 2400; attempt++) {
    const pad = Math.max(8, Math.floor(Math.min(w, h) * 0.04));
    const x = rng.int(pad, w - pad - 1);
    const y = rng.int(pad, h - pad - 1);
    const b = biomes[x + y * w] as Biome;
    if (!want.includes(b)) continue;
    if (b === Biome.Water) continue;
    const ok = taken.every((n) => Math.hypot(n.cx - x, n.cy - y) > n.radius + radius + 3.5);
    if (!ok) continue;
    return { x, y, biome: b };
  }
  return null;
}
