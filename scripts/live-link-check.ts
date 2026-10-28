/**
 * Live-link checks and a replay of recorded controller transcripts.
 *   npx tsx scripts/live-link-check.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PART_CODE } from '../src/app/engine/building-templates';
import { contentHash, decodeB64U8, buildAreaExport } from '../src/app/engine/area-export';
import { spawnEntities, spawnResidents, stepEntities, stepResidentRoutines, residentCountFor } from '../src/app/engine/entities';
import {
  createDirector,
  doorApproachPoint,
  placeWalkerFromExit,
  replayControllerScript,
  simSubsteps,
  structureContains,
  syncDirector,
  validateLive,
  worldFromZone,
  zoneFromWorld,
  type ScriptLine,
  type ValidateCtx,
  type ZoneFrame,
} from '../src/app/engine/live-link';
import { Rng } from '../src/app/engine/noise';
import { generateWorld } from '../src/app/engine/world-gen';
import {
  DEFAULT_WORLD_SETTINGS,
  GAME_HOURS_PER_REAL_SEC,
  ZONE_HONEST_KMH,
  ZONE_SIM_RATE,
  ZONE_WALK_MPS,
  travelGameHours,
  zoneWalkPaceMps,
  wrapDeltaX,
} from '../src/app/models/world.models';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SID = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'http://localhost:8787';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

function ctx(over: Partial<ValidateCtx> = {}): ValidateCtx {
  return {
    origin: ORIGIN,
    allow: [ORIGIN],
    pinnedOrigin: ORIGIN,
    sid: SID,
    lastSeq: 0,
    maxX: 400,
    maxZ: 400,
    ...over,
  };
}

function readScript(name: string): ScriptLine[] {
  const text = readFileSync(join(root, 'fixtures/live', name), 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ScriptLine);
}

const seam: ZoneFrame = {
  zoneScale: 8,
  metersPerTile: 1,
  originX: (1530 - 4) * 8,
  originY: 800,
  worldWidth: 1536,
  worldBounds: { x0: 1530, y0: 100, x1: 1534, y1: 104 },
};

for (const [x, y] of [
  [1532, 102],
  [2, 102],
  [1535.25, 100.5],
] as const) {
  const zone = zoneFromWorld(x, y, seam);
  const back = worldFromZone(zone.x, zone.z, seam);
  assert(Math.abs(wrapDeltaX(x, back.x, seam.worldWidth)) < 1e-6, `x round trip ${x} -> ${back.x}`);
  assert(Math.abs(y - back.y) < 1e-6, `y round trip ${y} -> ${back.y}`);
}

const honest = ZONE_WALK_MPS / ((ZONE_HONEST_KMH * 1000) / 3600);
const gameSec = ZONE_SIM_RATE * GAME_HOURS_PER_REAL_SEC * 3600;
assert(Math.abs(gameSec - honest) < 1e-9, `zone pace ${gameSec}`);
assert(Math.abs(gameSec - 1.44) < 0.01, 'about 1.44 game seconds per real second');
const tileHours = travelGameHours(8, zoneWalkPaceMps());
assert(Math.abs(tileHours - 8 / 5000) < 1e-12, 'one world tile at 5 km/h');
assert(travelGameHours(0, zoneWalkPaceMps()) === 0, 'no distance');
assert(travelGameHours(4, 0) === 0, 'no pace');
const idleHour = ZONE_SIM_RATE * GAME_HOURS_PER_REAL_SEC;
assert(Math.abs(idleHour - travelGameHours(ZONE_WALK_MPS, zoneWalkPaceMps())) < 1e-12, 'idle clock-true matches 2 m/s at 5 km/h');
const caught = simSubsteps(3, true);
assert(Math.abs(caught.reduce((sum, step) => sum + step, 0) - 2) < 1e-9, 'live catch-up caps at 2s');
assert(caught.every((step) => step <= 0.05 + 1e-9), 'substeps are 0.05s');
assert(Math.abs(simSubsteps(1, false).reduce((sum, step) => sum + step, 0) - 0.05) < 1e-9, 'hidden map frame stays capped');

const badOrigin = validateLive(
  { type: 'tb-player', tb: 1, sid: SID, seq: 1, pos: { x: 1, z: 1 }, yaw: 0, moving: false, sprint: false, inside: null },
  ctx({ origin: 'https://evil.example' }),
);
assert(!badOrigin.ok && badOrigin.reason === 'origin', 'wrong origin');
const badSid = validateLive(
  { type: 'tb-player', tb: 1, sid: 'other-sid', seq: 1, pos: { x: 1, z: 1 }, yaw: 0, moving: false, sprint: false, inside: null },
  ctx(),
);
assert(!badSid.ok && badSid.reason === 'sid', 'wrong sid');
const oldSeq = validateLive(
  { type: 'tb-player', tb: 1, sid: SID, seq: 2, pos: { x: 1, z: 1 }, yaw: 0, moving: false, sprint: false, inside: null },
  ctx({ lastSeq: 4 }),
);
assert(!oldSeq.ok && oldSeq.reason === 'seq', 'old seq');
const nan = validateLive(
  { type: 'tb-player', tb: 1, sid: SID, seq: 1, pos: { x: Number.NaN, z: 1 }, yaw: 0, moving: false, sprint: false, inside: null },
  ctx(),
);
assert(!nan.ok, 'NaN position');
const longText = validateLive(
  {
    type: 'tb-chatter',
    tb: 1,
    sid: SID,
    seq: 1,
    bubbleId: 'b',
    speakerId: 'wanderer-3',
    name: 'Wren',
    text: 'x'.repeat(161),
    ms: 5200,
  },
  ctx(),
);
assert(!longText.ok, '161-char text');
const tooMany = validateLive(
  {
    type: 'tb-sim',
    tb: 1,
    sid: SID,
    seq: 1,
    clock: { hours: 8, rate: 0, mode: 'zone' },
    key: true,
    ents: Array.from({ length: 33 }, (_, i) => ({ id: `wanderer-${i}` })),
    events: [],
  },
  ctx(),
);
assert(!tooMany.ok, '33 entities');

const replayFrame: ZoneFrame = {
  zoneScale: 8,
  metersPerTile: 1,
  originX: 0,
  originY: 0,
  worldWidth: 1536,
  worldBounds: { x0: 10, y0: 10, x1: 20, y1: 18 },
};
const replayOpts = {
  sid: SID,
  allow: [ORIGIN],
  origin: ORIGIN,
  frame: replayFrame,
  tiles: new Set<string>(),
};

const basic = replayControllerScript(readScript('session-basic.jsonl'), replayOpts);
assert(basic.acked, 'session ack');
assert(basic.player !== null, 'player mirrored');
assert(basic.dropped.includes('origin'), 'script drops a bad origin');
assert(basic.dropped.includes('sid'), 'script drops a bad sid');
assert(basic.dropped.includes('seq'), 'script drops an old seq');
assert(basic.reports.length === 1 && basic.reports[0]?.e === 'arrived', 'arrived event');

const east = replayControllerScript(readScript('exit-east.jsonl'), replayOpts);
const expectedExit = placeWalkerFromExit({ x: 72, z: 40 }, 'E', 1.5707963267948966, replayFrame, replayOpts.tiles);
assert(east.exit !== null, 'east exit');
assert(Math.abs((east.exit?.x ?? 0) - expectedExit.x) < 1e-6, 'exit x');
assert(Math.abs((east.exit?.y ?? 0) - expectedExit.y) < 1e-6, 'exit y');
assert(east.exit?.side === 'E', 'exit side');
const raw = worldFromZone(72, 40, replayFrame);
assert(east.exit !== null && east.exit.x > raw.x, 'walker nudged east');

const resumed = replayControllerScript(readScript('map-reload-resume.jsonl'), {
  ...replayOpts,
  stored: { sid: SID, hash: 'sha1:same' },
});
assert(resumed.resumed, 'map reload resume');
assert(resumed.player !== null, 'resume still accepts tb-player');
const missed = replayControllerScript(readScript('map-reload-resume.jsonl'), {
  ...replayOpts,
  stored: { sid: SID, hash: 'sha1:nope' },
});
assert(!missed.resumed, 'hash mismatch does not resume');

console.log('generating world seed 7741…');
const world = generateWorld(7741, DEFAULT_WORLD_SETTINGS);
const fixed = { exportedAt: '2026-10-26T00:00:00.000Z', timeOfDayHours: 8 };
const area = buildAreaExport(world, world.nodes.find((node) => node.id === 'hollowmere')!, fixed);
const town = buildAreaExport(world, world.nodes.find((node) => node.id === 'veldcross')!, fixed);
assert(town.buildings.length > 0, 'veldcross buildings');
for (const building of [...area.buildings, ...town.buildings]) {
  const point = doorApproachPoint(town.buildings.includes(building) ? town : area, building);
  assert(!structureContains(town.buildings.includes(building) ? town : area, building, point), `${building.id} door approach is inside the structure`);
  const mask = decodeB64U8(building.tiles.data);
  const di = building.doorCell.x - building.plotX + (building.doorCell.y - building.plotY) * building.tiles.w;
  assert(mask[di] === PART_CODE.door, `${building.id} door cell`);
}

const sim = new Rng(7741 ^ 0x91a2);
const mark = sim.next();
const residentsA = spawnResidents(world, 7741);
const residentsB = spawnResidents(world, 7741);
assert(JSON.stringify(residentsA) === JSON.stringify(residentsB), 'residents are deterministic');
const sim2 = new Rng(7741 ^ 0x91a2);
assert(sim2.next() === mark, 'simRng seed');
assert(sim.next() === sim2.next(), 'spawnResidents left simRng unchanged');

const ashfen = world.nodes.find((node) => node.id === 'ashfen')!;
const ashCount = residentsA.filter((entity) => entity.resident?.placeId === 'ashfen').length;
assert(ashCount === residentCountFor(ashfen), 'ashfen count');
assert(ashCount >= 3 && ashCount <= 8, `ashfen residents ${ashCount}`);
const hollow = residentsA.filter((entity) => entity.resident?.placeId === 'hollowmere');
assert(hollow.length === 0, 'grove has no residents');
for (const entity of residentsA) {
  const place = world.nodes.find((node) => node.id === entity.resident?.placeId);
  assert(place, 'place');
  const homeKey = `${Math.floor(entity.resident!.homeX)},${Math.floor(entity.resident!.homeY)}`;
  assert(place!.tiles.some((tile) => `${tile.x},${tile.y}` === homeKey), `${entity.id} home`);
  assert(entity.kind === 'wanderer', 'residents use the wanderer kind');
}
const counts = new Map<string, number>();
for (const entity of residentsA) counts.set(entity.resident!.placeId, (counts.get(entity.resident!.placeId) ?? 0) + 1);
for (const [id, count] of counts) {
  const place = world.nodes.find((node) => node.id === id)!;
  assert(count >= 3 && count <= 8, `${place.name} ${count}`);
  assert(place.kind === 'city' || place.kind === 'town' || place.kind === 'hamlet', place.kind);
}
stepResidentRoutines(residentsA, 8);
assert(residentsA[0] && Math.abs(residentsA[0].destX - residentsA[0].resident!.homeX) < 1e-6, 'morning at home');
stepResidentRoutines(residentsA, 12);
assert(Math.abs(residentsA[0]!.destX - residentsA[0]!.resident!.workX) < 1e-6, 'midday at work');
stepResidentRoutines(residentsA, 19);
assert(Math.abs(residentsA[0]!.destY - residentsA[0]!.resident!.tavernY) < 1e-6, 'evening at the tavern');

const travelers = spawnEntities(world, 7741);
const withResidents = structuredClone([...travelers, ...residentsA]);
for (const entity of withResidents) {
  if (!entity.resident) continue;
  entity.destX = entity.x;
  entity.destY = entity.y;
}
const plain = structuredClone(travelers);
const rngA = new Rng(7741 ^ 0x91a2);
const rngB = new Rng(7741 ^ 0x91a2);
stepEntities(world, withResidents, 0.4, rngA);
stepEntities(world, plain, 0.4, rngB);
assert(rngA.next() === rngB.next(), 'resident stepping does not consume simRng');

const stamped = { ...area, npcs: { frame: 'zone-m' as const, asOfHours: 9, list: [] }, session: { sid: 's', live: 1 as const } };
assert(contentHash(stamped) === area.meta.hash, 'hash ignores npcs and session');

const near = travelers[0];
assert(near, 'wanderer');
const place = world.nodes.find((node) => node.kind === 'town' || node.kind === 'city')!;
near.destX = (place.x0 + place.x1) / 2;
near.destY = (place.y0 + place.y1) / 2;
near.x = place.x0 + 0.5;
near.y = place.y0 + 0.5;
const townArea = buildAreaExport(world, place, { exportedAt: '2026-10-26T00:00:00.000Z', timeOfDayHours: 8 });
const intentRng = new Rng(42);
const before = intentRng.next();
const director = createDirector(townArea, SID, world.width);
syncDirector(director, [near], 8, false);
const again = createDirector(townArea, SID, world.width);
syncDirector(again, [structuredClone(near)], 8, false);
assert(JSON.stringify(director.tracks.get(near.id)?.intent) === JSON.stringify(again.tracks.get(near.id)?.intent), 'chooseIntent stable');
assert(director.tracks.get(near.id)?.intent.kind !== undefined, 'intent chosen');
const after = intentRng.next();
const intentRng2 = new Rng(42);
assert(intentRng2.next() === before, 'intent rng seed');
assert(intentRng2.next() === after, 'chooseIntent left simRng unchanged');

console.log(`live link check ok · zone pace ${gameSec.toFixed(3)} game s/s · ashfen residents ${ashCount}`);
