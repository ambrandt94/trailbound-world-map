/**
 * Resident census checks (no world build).
 *   npx tsx scripts/resident-count-check.ts
 *
 * Count = round(avg × (house count | 1) × seededJitter(seed, placeId)).
 * Jitter is ±25% and does not draw from the sim RNG.
 * Named residents stay map entities: crowd = max(0, count − named).
 */
import { contentHash, type AreaExport } from '../src/app/engine/area-export';
import { Rng } from '../src/app/engine/noise';
import {
  RESIDENT_JITTER,
  crowdHotspots,
  crowdSize,
  dwellingHomes,
  parseResidentOverrides,
  residentCensus,
  resolveResidentParams,
  seededJitter,
} from '../src/app/engine/residents';
import { DEFAULT_WORLD_SETTINGS, clampSettings } from '../src/app/models/world.models';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

const defaults = {
  residentsMode: DEFAULT_WORLD_SETTINGS.residentsMode,
  avgPerHouse: DEFAULT_WORLD_SETTINGS.avgPerHouse,
  avgPerPlace: DEFAULT_WORLD_SETTINGS.avgPerPlace,
};

assert(defaults.residentsMode === 'perPlace', 'default mode is per place');
assert(defaults.avgPerPlace === 24, 'default per-place average');
assert(defaults.avgPerHouse === 2.5, 'per-house average stays 2.5');
assert(RESIDENT_JITTER === 0.25, 'jitter is ±25%');

const filled = clampSettings({});
assert(filled.residentsMode === 'perPlace', 'missing mode fills per place');
assert(filled.avgPerPlace === 24 && filled.avgPerHouse === 2.5, 'missing averages fill defaults');
assert(clampSettings({ residentsMode: 'nope' as 'perHouse' }).residentsMode === 'perPlace', 'unknown mode falls back');
const kept = clampSettings({ residentsMode: 'perHouse', avgPerHouse: 3.7, avgPerPlace: 40 });
assert(kept.residentsMode === 'perHouse' && kept.avgPerHouse === 3.7 && kept.avgPerPlace === 40, 'explicit averages round-trip');

const jitterA = seededJitter(7741, 'veldcross');
const jitterB = seededJitter(7741, 'veldcross');
assert(jitterA === jitterB, 'jitter is deterministic');
assert(jitterA >= 1 - RESIDENT_JITTER && jitterA <= 1 + RESIDENT_JITTER, `jitter out of range ${jitterA}`);
assert(seededJitter(7741, 'ashfen') !== jitterA, 'place id changes the jitter');
for (const id of ['ashfen', 'goldmere', 'saltgate', 'sunspire', 'hollowmere']) {
  const j = seededJitter(7741, id);
  assert(j >= 0.75 && j <= 1.25, `${id} jitter ${j}`);
}

const rng = new Rng(7741);
const before = rng.next();
residentCensus({ seed: 7741, placeId: 'veldcross', mode: 'perPlace', avg: 24, houses: 9 });
seededJitter(99, 'ashfen');
const rng2 = new Rng(7741);
assert(rng2.next() === before, 'census moved the sim RNG');
assert(rng.next() === rng2.next(), 'census consumed a later sim draw');

const worldDefault = resolveResidentParams(defaults, null);
assert(worldDefault.mode === 'perPlace' && worldDefault.avg === 24, 'world default params');
const houses = 8;
const base = residentCensus({
  seed: 7741,
  placeId: 'veldcross',
  mode: worldDefault.mode,
  avg: worldDefault.avg,
  houses,
});
assert(base === Math.round(24 * 1 * jitterA), `per-place count ${base}`);
const perHouse = residentCensus({
  seed: 7741,
  placeId: 'veldcross',
  mode: 'perHouse',
  avg: 2.5,
  houses,
});
assert(perHouse === Math.round(2.5 * houses * jitterA), `per-house count ${perHouse}`);
assert(perHouse !== base, 'per-house count differs from per-place on this town');

const override = resolveResidentParams(defaults, { mode: 'perPlace', avg: 3 });
const overridden = residentCensus({
  seed: 7741,
  placeId: 'veldcross',
  mode: override.mode,
  avg: override.avg,
  houses,
});
assert(overridden !== base, 'override beats the world default');
assert(overridden === Math.round(3 * jitterA), `override count ${overridden}`);

const named = 6;
assert(crowdSize(base, named) === Math.max(0, base - named), 'crowd subtracts named residents');
assert(crowdSize(2, 8) === 0, 'crowd does not go negative');
assert(crowdSize(base, 0) === base, 'no named residents leaves the census');

const savedSettings = JSON.stringify(kept);
const reloadedSettings = clampSettings(JSON.parse(savedSettings) as Record<string, unknown>);
const savedOverride = JSON.stringify({ veldcross: { mode: 'perHouse', avg: 4 } });
const reloadedOverride = parseResidentOverrides(savedOverride);
assert(reloadedOverride['veldcross']?.mode === 'perHouse' && reloadedOverride['veldcross']?.avg === 4, 'override reloads');
assert(parseResidentOverrides(savedOverride)['ashfen'] === undefined, 'other places stay on the default');
const once = residentCensus({
  seed: 7741,
  placeId: 'veldcross',
  mode: 'perHouse',
  avg: reloadedOverride['veldcross']!.avg,
  houses,
});
const twice = residentCensus({
  seed: 7741,
  placeId: 'veldcross',
  ...resolveResidentParams(reloadedSettings, parseResidentOverrides(savedOverride)['veldcross'] ?? null),
  houses,
});
assert(once === twice, 'same count after a settings reload');
assert(
  residentCensus({
    seed: 7741,
    placeId: 'veldcross',
    mode: reloadedSettings.residentsMode,
    avg: reloadedSettings.residentsMode === 'perHouse' ? reloadedSettings.avgPerHouse : reloadedSettings.avgPerPlace,
    houses,
  }) ===
    residentCensus({
      seed: 7741,
      placeId: 'veldcross',
      mode: kept.residentsMode,
      avg: kept.avgPerHouse,
      houses,
    }),
  'reloaded world settings keep the count',
);

const garbage = parseResidentOverrides('{"veldcross":{"mode":"nope","avg":4},"ok":{"mode":"perPlace","avg":12},"bad":null}');
assert(garbage['veldcross'] === undefined, 'bad override dropped');
assert(garbage['ok']?.avg === 12 && garbage['ok']?.mode === 'perPlace', 'good override kept');
assert(parseResidentOverrides('not-json')['x'] === undefined, 'invalid json is empty');

const homes = dwellingHomes([
  { type: 'shop', structureW: 7, structureD: 6 },
  { type: 'cottage-1', structureW: 6, structureD: 5 },
  { type: 'house-1', structureW: 12, structureD: 10 },
  { type: 'tavern', structureW: 10, structureD: 8 },
  { type: 'farm', structureW: 8, structureD: 6 },
]);
assert(JSON.stringify(homes) === JSON.stringify([1, 2, 2, 2, 2, 4, 4]), `homes ${homes.join(',')}`);

const spots = crowdHotspots({
  originX: 80,
  originY: 180,
  buildings: [
    { type: 'cottage-1', doorCell: { x: 10, y: 10 } },
    { type: 'tavern', doorCell: { x: 100, y: 200 } },
    { type: 'inn', doorCell: { x: 50, y: 50 } },
  ],
  props: [
    { type: 'market', x: 90, y: 190 },
    { type: 'well', x: 88, y: 188 },
    { type: 'tree-1', x: 1, y: 1 },
  ],
  plaza: { x: 96, y: 196 },
});
assert(
  JSON.stringify(spots) ===
    JSON.stringify([
      { x: 16, y: 16 },
      { x: 10, y: 10 },
      { x: 20.5, y: 20.5 },
      { x: 8, y: 8 },
    ]),
  `hotspots ${JSON.stringify(spots)}`,
);

const bare = {
  type: 'trailbound.area' as const,
  version: '0.4.0',
  meta: {
    hash: 'sha1:ignored',
    exportedAt: '2026-10-26T00:00:00.000Z',
    timeOfDayHours: 8,
    season: 'summer' as const,
    notes: ['meta.exportedAt and meta.timeOfDayHours are excluded from meta.hash.'],
  },
};
const withPop = {
  ...bare,
  version: '0.5.0',
  population: {
    count: 24,
    mode: 'perPlace' as const,
    avg: 24,
    seed: 7741,
    homes: [0, 0],
    hotspots: [{ x: 1, y: 2 }],
  },
};
const v04Hash = contentHash(bare as AreaExport);
const v05Hash = contentHash(withPop as AreaExport);
const changedHash = contentHash({
  ...withPop,
  population: { ...withPop.population, count: 25 },
} as AreaExport);
assert(v04Hash.startsWith('sha1:') && v04Hash !== v05Hash, 'v0.4 payload without population still hashes');
assert(changedHash !== v05Hash, 'changing the count changes the hash');
const withNpcs = {
  ...withPop,
  npcs: { frame: 'zone-m' as const, asOfHours: 8, list: [] },
  session: { sid: 's', live: 1 as const },
};
assert(contentHash(withNpcs as AreaExport) === v05Hash, 'npcs and session stay out of the hash');
const stripped = { ...withPop, version: '0.4.0' } as AreaExport;
delete stripped.population;
assert(contentHash(stripped) === v04Hash, 'dropping population is a v0.4-compatible payload');

console.log('resident count check ok');
