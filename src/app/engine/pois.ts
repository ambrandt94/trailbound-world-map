import { Biome, PointOfInterest, PoiKind } from '../models/world.models';
import { Rng } from './noise';

export const POI_SPECS: Array<{ kind: PoiKind; want: Biome[]; radius: number; names: string[]; count?: number }> = [
  { kind: 'ruins', want: [Biome.Hills, Biome.Heath, Biome.Plains], radius: 6.4, names: ['Greyfen Ruins', "King's Fall", 'Oldwatch Stones'] },
  { kind: 'mansion', want: [Biome.Plains, Biome.Forest, Biome.Meadow], radius: 5.8, names: ['Duskmanor', 'Hallow House', 'Ashveil Hall'] },
  { kind: 'abandoned-camp', want: [Biome.Forest, Biome.Hills, Biome.Heath], radius: 3.6, names: ['Coldfire Camp', 'Last Watch', 'Ember Rest'] },
  { kind: 'shrine', want: [Biome.Forest, Biome.DarkForest, Biome.Meadow], radius: 4.2, names: ['Rowan Shrine', 'Fern Altar', 'Moss Chapel'] },
  { kind: 'cave', want: [Biome.Mountain, Biome.Hills, Biome.Snow], radius: 4.4, names: ['Nettle Cave', 'Hollow Mouth', 'Dunharrow Cleft'] },
  { kind: 'graves', want: [Biome.Plains, Biome.Heath, Biome.Hills], radius: 4.6, names: ['The Quiet Stones', 'Crowbarrow', 'Lark Grave'], count: 2 },
  { kind: 'homestead', want: [Biome.Plains, Biome.Meadow, Biome.Hills], radius: 4.1, names: ['Briar Croft', 'Goldlea Farm', 'Otterstead'] },
  { kind: 'hideout', want: [Biome.DarkForest, Biome.Marsh, Biome.Forest], radius: 4.3, names: ['Fox Den', 'Thorn Cache', 'Mire Hold'] },
  { kind: 'treehouse', want: [Biome.Forest, Biome.DarkForest], radius: 4.5, names: ['Canopy Hold', 'Willow Nest', 'Sedge Perch'] },
  { kind: 'battlefield', want: [Biome.Plains, Biome.Heath, Biome.Meadow], radius: 8.4, names: ['Crow Field', 'Ashfen Moor', 'Broken Ridge'] },
  { kind: 'military-camp', want: [Biome.Hills, Biome.Plains, Biome.Heath], radius: 5.2, names: ['Watchpost Thorn', 'Gate Camp', 'Pike Rest'] },
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
  const maxTries = Math.max(80, target * 12);
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
