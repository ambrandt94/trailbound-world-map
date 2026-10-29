/**
 * Determinism check and fixture writer for AreaExport v0.5.
 *   npx tsx scripts/area-export-check.ts
 * Writes fixtures/ when AREA_EXPORT_WRITE=1.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { residentCountFor, spawnEntities, spawnResidents } from '../src/app/engine/entities';
import { forcedFixtureNpcs, snapshotNpcs } from '../src/app/engine/live-link';
import { countDwellings, crowdSize, isDwellingType, isSettlementKind, residentCensus } from '../src/app/engine/residents';
import {
  AREA_EXPORT_VERSION,
  BORDER_WORLD_TILES,
  GROUND,
  GROUND_CLASSES,
  HEIGHT_DETAIL_METERS,
  HEIGHT_SOFT_MIN_SPAN,
  HEIGHT_SUBDIV_METERS,
  RELIEF_BIOME_MULT,
  RELIEF_METERS,
  buildAreaExport,
  contentHash,
  decodeB64U8,
  type AreaExport,
} from '../src/app/engine/area-export';
import { PART_CODE, PART_LEGEND } from '../src/app/engine/building-templates';
import { generateWorld, worldHeightSampler } from '../src/app/engine/world-gen';
import { rollMinigameSlots, type MinigameRule } from '../src/app/engine/minigame-slots';
import { Biome, DEFAULT_WORLD_SETTINGS, ZONE_SCALE, type MapNode, type WorldData } from '../src/app/models/world.models';

const V03_HASH: Record<string, string> = {
  hollowmere: 'sha1:d39734cf18ba4ba99b5063edee1fd40cd0e0eb68',
  jadewild: 'sha1:d16ff6014c7e9083c794030b916c2cf1a59541f7',
  veldcross: 'sha1:63e5aaf2bedf0ffb91eb091cd839ab45cea71e07',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = 7741;
const fixed = { exportedAt: '2026-10-26T00:00:00.000Z', timeOfDayHours: 8 };

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

function waterCells(area: AreaExport): number {
  const bytes = decodeB64U8(area.layers.ground.data);
  let n = 0;
  for (const v of bytes) if (v === GROUND.water) n++;
  return n;
}

const SPAWN: Record<string, { x: number; y: number; facing: string }> = {
  jadewild: { x: 2843.5, y: 4977.5, facing: 'E' },
  hollowmere: { x: 6451.5, y: 9115.5, facing: 'S' },
  veldcross: { x: 4628.5, y: 6643.5, facing: 'N' },
};

const RING_GROUND = new Set<number>([GROUND.grass, GROUND.dirt, GROUND.road, GROUND.water, GROUND.sand, GROUND.rock]);

function checkShape(area: AreaExport, place: MapNode, world: WorldData): void {
  assert(area.type === 'trailbound.area', 'type');
  assert(area.version === AREA_EXPORT_VERSION, 'version');
  assert(area.version === '0.6.0', 'version string');
  assert(area.meta.kitVersion === '0.1-draft', 'kit version');
  assert(area.npcs === undefined && area.session === undefined, 'builder leaves npcs and session off');
  if (isSettlementKind(place.kind)) {
    const pop = area.population;
    assert(pop, `${place.id} missing population`);
    if (!pop) return;
    assert(pop.mode === 'perPlace' && pop.avg === 24 && pop.seed === world.seed, `${place.id} default population`);
    const houses = area.buildings.filter((b) => isDwellingType(b.type)).length;
    const census = residentCensus({ seed: world.seed, placeId: place.id, mode: pop.mode, avg: pop.avg, houses });
    assert(pop.count === census, `${place.id} count ${pop.count} != ${census}`);
    assert(pop.homes.length >= houses, `${place.id} homes shorter than dwellings`);
    for (const index of pop.homes) {
      const building = area.buildings[index];
      assert(building && isDwellingType(building.type), `${place.id} home ${index} is not a dwelling`);
    }
    assert(countDwellings(place, world) === houses, `${place.id} layout dwellings != export`);
    const named = residentCountFor(place);
    assert(named >= 3 && named <= 8, `${place.id} named ${named}`);
    assert(pop.named === named, `${place.id} population.named ${pop.named} != ${named}`);
    assert(crowdSize(pop.count, pop.named) === Math.max(0, pop.count - pop.named), `${place.id} crowd`);
    const note = area.meta.notes.find((line) => line.startsWith('population '));
    assert(!!note && /max\(0, count − named\)/.test(note), 'crowd note');
    for (const spot of pop.hotspots) {
      assert(Number.isFinite(spot.x) && Number.isFinite(spot.y), 'hotspot');
      assert(spot.x >= 0 && spot.y >= 0 && spot.x <= area.grid.w && spot.y <= area.grid.h, `hotspot outside area ${spot.x},${spot.y}`);
    }
  } else {
    assert(area.population === undefined, `${place.id} should omit population`);
  }
  const withLive = {
    ...area,
    npcs: { frame: 'zone-m' as const, asOfHours: 8, list: [] },
    session: { sid: 'sid-hash', live: 1 as const },
  };
  assert(contentHash(withLive) === area.meta.hash, 'npcs and session changed the hash');
  const legacy = JSON.parse(JSON.stringify(area)) as AreaExport;
  legacy.version = '0.3.0';
  delete legacy.npcs;
  delete legacy.session;
  delete legacy.population;
  legacy.meta.notes = legacy.meta.notes
    .filter((note) => !note.startsWith('population '))
    .map((note) =>
      note.includes('npcs, and session')
        ? 'meta.exportedAt and meta.timeOfDayHours are excluded from meta.hash.'
        : note,
    );
  const v04 = JSON.parse(JSON.stringify(area)) as AreaExport;
  v04.version = '0.4.0';
  delete v04.population;
  v04.meta.notes = v04.meta.notes.filter((note) => !note.startsWith('population '));
  const v04Hash = contentHash(v04);
  assert(v04Hash !== area.meta.hash, `${place.id} v0.4 shape did not change the hash`);
  if (area.population) {
    const bumped = { ...area, population: { ...area.population, count: area.population.count + 1 } };
    assert(contentHash(bumped) !== area.meta.hash, `${place.id} count did not change the hash`);
    const renamed = { ...area, population: { ...area.population, named: area.population.named + 1 } };
    assert(contentHash(renamed) !== area.meta.hash, `${place.id} named did not change the hash`);
  }
  const legacyHash = contentHash(legacy);
  void legacyHash;
  void V03_HASH;
  assert(area.source.seed === seed, 'seed');
  assert(area.area.id === place.id, 'id');
  assert(area.units.metersPerTile === 1, 'metres');
  assert(area.area.borderWorldTiles === BORDER_WORLD_TILES, 'border tiles');
  assert(BORDER_WORLD_TILES === 4, 'border constant');
  const spanX = area.area.worldBounds.x1 - area.area.worldBounds.x0 + 1;
  const spanY = area.area.worldBounds.y1 - area.area.worldBounds.y0 + 1;
  const expectW = (spanX + BORDER_WORLD_TILES * 2) * ZONE_SCALE;
  const expectH = (spanY + BORDER_WORLD_TILES * 2) * ZONE_SCALE;
  assert(area.grid.w === expectW && area.grid.h === expectH, `grid ${area.grid.w}x${area.grid.h} expected ${expectW}x${expectH}`);
  assert(area.grid.originInner.x === area.area.innerOrigin.x && area.grid.originInner.y === area.area.innerOrigin.y, 'grid origin');
  assert(
    area.grid.originInner.x === (area.area.worldBounds.x0 - BORDER_WORLD_TILES) * ZONE_SCALE,
    'origin x',
  );
  assert(
    area.grid.originInner.y === (area.area.worldBounds.y0 - BORDER_WORLD_TILES) * ZONE_SCALE,
    'origin y',
  );
  const mask = decodeB64U8(area.grid.mask.data);
  const border = decodeB64U8(area.grid.borderMask.data);
  const biomes = decodeB64U8(area.layers.biome.data);
  const ground = decodeB64U8(area.layers.ground.data);
  const cells = area.grid.w * area.grid.h;
  assert(mask.length === cells, 'mask size');
  assert(border.length === cells, 'border size');
  assert(biomes.length === cells, 'biome size');
  assert(ground.length === cells, 'ground size');
  assert(area.layers.biome.legend?.length === 27, 'biome legend');
  assert(area.layers.biome.legend?.[7] === 'Badlands', 'badlands legend');
  assert(area.layers.biome.legendAliases?.['Heath'] === 'Badlands', 'heath alias');
  assert(area.layers.ground.legend?.join() === GROUND_CLASSES.join(), 'ground legend');
  assert(area.layers.ground.legend?.[9] === 'park' && area.layers.ground.legend?.[10] === 'field', 'park and field');
  assert(area.layers.surface?.enc === 'b64u8', 'surface layer');
  const surface = decodeB64U8(area.layers.surface.data);
  assert(surface.length === cells, 'surface size');
  const placeKeys = new Set(area.area.worldTiles.map(([x, y]) => `${x},${y}`));
  let playable = 0;
  let ring = 0;
  let both = 0;
  let voidCells = 0;
  for (let iy = 0; iy < area.grid.h; iy++) {
    for (let ix = 0; ix < area.grid.w; ix++) {
      const gi = ix + iy * area.grid.w;
      const m = mask[gi] ?? 0;
      const b = border[gi] ?? 0;
      if (m && b) both++;
      if (m) playable++;
      if (b) ring++;
      if (!m && !b) voidCells++;
      const wx = Math.floor((area.grid.originInner.x + ix) / ZONE_SCALE);
      const wy = Math.floor((area.grid.originInner.y + iy) / ZONE_SCALE);
      const key = `${wx},${wy}`;
      if (m) assert(placeKeys.has(key), `playable cell outside place ${key}`);
      if (b) {
        assert(!placeKeys.has(key), `ring cell inside place ${key}`);
        assert(RING_GROUND.has(ground[gi] ?? 255), `ring ground ${ground[gi]} at ${key}`);
        assert((ground[gi] ?? 0) !== GROUND.lot && (ground[gi] ?? 0) !== GROUND.plaza && (ground[gi] ?? 0) !== GROUND.yard, 'ring building ground');
        const stored = world.biomes[wx + wy * world.width];
        assert(biomes[gi] === stored, `ring biome ${biomes[gi]} != world ${stored} at ${key}`);
      }
    }
  }
  assert(both === 0, 'mask and borderMask overlap');
  assert(playable === placeKeys.size * ZONE_SCALE * ZONE_SCALE, `playable ${playable}`);
  assert(ring > 0, 'border ring empty');
  const rectInside =
    area.area.worldBounds.x0 - BORDER_WORLD_TILES >= 0 &&
    area.area.worldBounds.y0 - BORDER_WORLD_TILES >= 0 &&
    area.area.worldBounds.x1 + BORDER_WORLD_TILES < world.width &&
    area.area.worldBounds.y1 + BORDER_WORLD_TILES < world.height;
  if (rectInside) assert(voidCells === 0, `void cells ${voidCells}`);
  else assert(voidCells > 0, 'expected void where the ring leaves the world');
  const height = area.layers.height;
  assert(height.sampling === 'world-subdiv', 'sampling');
  assert(height.subdivMeters === HEIGHT_SUBDIV_METERS && height.subdivMeters === 2, 'subdiv');
  assert(height.heightUnit === 'normalized', 'height unit');
  assert(height.detailMeters === HEIGHT_DETAIL_METERS && height.detailMeters === 0.4, 'detail');
  assert(height.raw.length === height.w * height.h, 'height size');
  assert(height.w === area.grid.w / height.subdivMeters + 3, 'height w');
  assert(height.h === area.grid.h / height.subdivMeters + 3, 'height h');
  assert(height.originInner.x === height.originCorner.x && height.originInner.y === height.originCorner.y, 'height origins');
  assert(height.originInner.x === area.grid.originInner.x - height.subdivMeters, 'height apron x');
  assert(height.originInner.y === area.grid.originInner.y - height.subdivMeters, 'height apron y');
  assert(height.maxRaw - height.minRaw >= HEIGHT_SOFT_MIN_SPAN - 1e-6, `soft span ${height.maxRaw - height.minRaw}`);
  const rawLo = height.raw.reduce((m, v) => Math.min(m, v), Number.POSITIVE_INFINITY);
  const rawHi = height.raw.reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY);
  if (rawHi - rawLo < HEIGHT_SOFT_MIN_SPAN) {
    assert(height.maxRaw - height.minRaw > rawHi - rawLo, 'span was not widened');
  }
  const sample = worldHeightSampler(world);
  const sx = height.originInner.x + 2 * height.subdivMeters;
  const sy = height.originInner.y + 3 * height.subdivMeters;
  const si = 2 + 3 * height.w;
  const expected = Math.round(sample(sx / ZONE_SCALE, sy / ZONE_SCALE) * 1e5) / 1e5;
  assert(height.raw[si] === expected, `lattice sample ${height.raw[si]} != formula ${expected}`);
  const span = height.maxRaw - height.minRaw;
  const waterT = Math.min(1, Math.max(0, (area.layers.water.raw - height.minRaw) / span));
  const waterLevel = Math.round(waterT * height.reliefMeters * 10000) / 10000;
  assert(Math.abs(area.layers.water.level - waterLevel) < 1e-6, `water level ${area.layers.water.level} != ${waterLevel}`);
  const notes = area.meta.notes.join('\n');
  assert(/visual only/i.test(notes), 'visual-only note');
  assert(/walkable/i.test(notes) && /mask/i.test(notes), 'walkable note');
  assert(/Catmull-Rom/.test(notes), 'Catmull-Rom note');
  assert(/Catmull-Rom/.test(height.note), 'height note spline');
  const spawn = area.entries.find((e) => e.kind === 'spawn');
  assert(spawn, 'spawn entry');
  void SPAWN;
  for (const b of area.buildings) {
    const tx = Math.floor((b.structureX + b.structureW / 2) / ZONE_SCALE);
    const ty = Math.floor((b.structureY + b.structureD / 2) / ZONE_SCALE);
    assert(placeKeys.has(`${tx},${ty}`), `${b.id} building in ring ${tx},${ty}`);
  }
  for (const p of area.props) {
    const ix = Math.floor(p.x - area.grid.originInner.x);
    const iy = Math.floor(p.y - area.grid.originInner.y);
    const gi = ix + iy * area.grid.w;
    const tx = Math.floor(p.x / ZONE_SCALE);
    const ty = Math.floor(p.y / ZONE_SCALE);
    const onPlace = placeKeys.has(`${tx},${ty}`);
    const onRing = ix >= 0 && iy >= 0 && ix < area.grid.w && iy < area.grid.h && border[gi] === 1;
    assert(onPlace || onRing, `prop outside place and ring ${p.type} ${tx},${ty}`);
  }
  assert(RELIEF_METERS === 15, 'named relief base');
  assert(RELIEF_BIOME_MULT[Biome.Hills] === 2, 'hills constant');
  assert(RELIEF_BIOME_MULT[Biome.Mountain] === 3, 'mountain constant');
  assert(area.layers.height.reliefBaseMeters === RELIEF_METERS, 'relief base');
  assert(area.entries.some((e) => e.kind === 'spawn'), 'spawn');
  const rotations = new Set([0, 90, 180, 270]);
  for (const b of area.buildings) {
    assert(rotations.has(b.rotation), `${b.id} rotation ${b.rotation}`);
    assert(b.door === 'N' || b.door === 'E' || b.door === 'S' || b.door === 'W', `${b.id} door`);
    assert(b.tiles.legend.join() === PART_LEGEND.join(), `${b.id} legend`);
    assert(decodeB64U8(b.tiles.data).length === b.tiles.w * b.tiles.h, `${b.id} mask length`);
    assert(b.tiles.w === b.plotW && b.tiles.h === b.plotD, `${b.id} plot mask`);
    assert(b.footW === b.structureW && b.footD === b.structureD, `${b.id} foot is structure`);
    const longSide = Math.max(b.structureW, b.structureD);
    const shortSide = Math.min(b.structureW, b.structureD);
    if (b.shape === 'kit' || b.kit) {
      assert(longSide <= 15 && shortSide <= 15, `${b.id} kit structure ${b.structureW}x${b.structureD}`);
      const onGrid = (n: number) => n % 3 === 0 || n === 2;
      assert(onGrid(b.structureW) && onGrid(b.structureD), `${b.id} kit grid ${b.structureW}x${b.structureD}`);
      if (b.lot) assert(b.lot.x % 3 === 0 && b.lot.y % 3 === 0 && b.lot.w % 3 === 0 && b.lot.d % 3 === 0, `${b.id} lot grid`);
    } else {
      assert(longSide <= 10 && shortSide <= 8, `${b.id} structure ${b.structureW}x${b.structureD}`);
    }
    assert(b.structureX >= b.plotX && b.structureY >= b.plotY, `${b.id} structure origin`);
    assert(b.structureX + b.structureW <= b.plotX + b.plotW, `${b.id} structure width`);
    assert(b.structureY + b.structureD <= b.plotY + b.plotD, `${b.id} structure depth`);
    assert(b.templateId.length > 0 && b.storeys >= 1, `${b.id} template`);
    assert(b.roof.ridge === 'E-W' || b.roof.ridge === 'N-S', `${b.id} ridge`);
    const mask = decodeB64U8(b.tiles.data);
    const di = b.doorCell.x - b.plotX + (b.doorCell.y - b.plotY) * b.tiles.w;
    assert(mask[di] === PART_CODE.door, `${b.id} door cell`);
  }
  assert(GROUND.yard === 8, 'yard class index');
  assert(area.meta.hash.startsWith('sha1:'), 'hash prefix');
  assert(contentHash(area) === area.meta.hash, 'hash matches content');
  const canonical = canonicalForHash(area);
  const nodeHex = createHash('sha1').update(canonical).digest('hex');
  assert(area.meta.hash === `sha1:${nodeHex}`, `sha1 mismatch ${area.meta.hash} vs sha1:${nodeHex}`);
}

function canonicalForHash(area: AreaExport): string {
  const copy = JSON.parse(JSON.stringify(area)) as AreaExport;
  delete copy.meta.hash;
  delete copy.meta.exportedAt;
  delete copy.meta.timeOfDayHours;
  return JSON.stringify(sortKeys(copy));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return value;
}

function exportPlace(world: WorldData, id: string): AreaExport {
  const place = world.nodes.find((n) => n.id === id);
  if (!place) fail(`missing place ${id}`);
  const a = buildAreaExport(world, place, fixed);
  const b = buildAreaExport(world, place, { ...fixed, exportedAt: '2030-01-01T00:00:00.000Z', timeOfDayHours: 19.25 });
  assert(a.meta.hash === b.meta.hash, `${id} hash changed between exports`);
  checkShape(a, place, world);
  console.log(
    `${place.name} (${place.id}, ${place.kind}, ${place.tiles?.length ?? 0} tiles) ` +
      `grid=${a.grid.w}x${a.grid.h} height=${a.layers.height.w}x${a.layers.height.h} ` +
      `span=${(a.layers.height.maxRaw - a.layers.height.minRaw).toFixed(4)} ` +
      `hash=${a.meta.hash} relief=${a.layers.height.reliefMeters}m ` +
      `buildings=${a.buildings.length} props=${a.props.length} water=${waterCells(a)} ` +
      `spawn=${a.entries[0]?.x},${a.entries[0]?.y}`,
  );
  return a;
}

console.log(`generating world seed ${seed}…`);
const world = generateWorld(seed, DEFAULT_WORLD_SETTINGS);
console.log(`nodes=${world.nodes.length} size=${world.width}`);

const town = exportPlace(world, 'veldcross');
assert(town.buildings.length > 0, 'town has buildings');
assert(town.population, 'town population');
const townAgain = buildAreaExport(world, world.nodes.find((n) => n.id === 'veldcross')!, fixed);
assert(townAgain.population?.count === town.population?.count, 'count changed across a reload');
assert(townAgain.meta.hash === town.meta.hash, 'hash changed across a reload');
const townOverride = buildAreaExport(world, world.nodes.find((n) => n.id === 'veldcross')!, {
  ...fixed,
  residents: {
    residentsMode: 'perPlace',
    avgPerHouse: 2.5,
    avgPerPlace: 24,
    override: { mode: 'perPlace', avg: 3 },
  },
});
assert(townOverride.population?.count !== town.population?.count, 'override did not beat the default');
assert(townOverride.population?.avg === 3 && townOverride.population?.mode === 'perPlace', 'override params');
assert(townOverride.meta.hash !== town.meta.hash, 'override did not change the hash');
const townHouse = buildAreaExport(world, world.nodes.find((n) => n.id === 'veldcross')!, {
  ...fixed,
  residents: { residentsMode: 'perHouse', avgPerHouse: 2.5, avgPerPlace: 24 },
});
assert(townHouse.population?.mode === 'perHouse' && townHouse.population?.avg === 2.5, 'per-house mode');
assert(townHouse.meta.hash !== town.meta.hash, 'mode did not change the hash');
assert((town.population?.hotspots.length ?? 0) > 0, 'town has crowd hotspots');
assert(new Set(town.buildings.map((b) => b.rotation)).size >= 2, 'town doors face more than one way');
assert(town.buildings.some((b) => b.shape === 'kit'), 'town has a kit building');
assert(
  town.buildings.some((b) => b.specialty === 'general_store' && b.type === 'shop' && b.kit?.includes('general_store')),
  'general store keeps the legacy shop type',
);
assert(
  town.buildings.some((b) => (b.type === 'church' || b.type === 'town-hall') && b.storeys === 2),
  'civic building is two storeys',
);
assertSettlement(town, 'town', 25, 80);
const village = exportPlace(world, 'sunspire');
assert(village.area.kind === 'village', 'sunspire is a village');
assertSettlement(village, 'village', 8, 25);
assert([...decodeB64U8(town.layers.ground.data)].some((v) => v === GROUND.yard), 'town has yard ground');
function assertSettlement(area: AreaExport, tier: string, minBuildings: number, maxBuildings: number): void {
  const settlement = area.area.settlement;
  assert(settlement, `${area.area.id} settlement`);
  if (!settlement) return;
  assert(settlement.tier === tier, `${area.area.id} tier ${settlement.tier}`);
  assert(settlement.variant === 'default', 'variant default');
  assert(settlement.style.length > 0, 'style');
  assert(settlement.buildingCount === area.buildings.length, 'buildingCount');
  assert(settlement.buildingCount >= minBuildings, `${area.area.id} buildings ${settlement.buildingCount} < ${minBuildings}`);
  assert(settlement.buildingCount <= maxBuildings, `${area.area.id} buildings ${settlement.buildingCount} > ${maxBuildings}`);
  assert(settlement.respawnAnchor.kind.length > 0, 'respawn kind');
  const anchor = settlement.respawnAnchor;
  assert(Number.isFinite(anchor.x) && Number.isFinite(anchor.y), 'respawn point');
  const wagon = area.zones.find((zone) => zone.kind === 'wagon_yard');
  assert(wagon, `${area.area.id} wagon yard`);
  if (tier === 'village' || tier === 'town') {
    assert(wagon?.subtype === 'yard', 'full wagon yard');
    assert((wagon?.slots?.length ?? 0) >= 2, 'wagon slots');
    assert(wagon?.slots?.every((slot) => slot.w === 3 && (slot.d === 6 || slot.d === 3)), 'slot size');
  }
  assert(area.roads.polylines.length > 0, 'polylines');
  for (const road of area.roads.polylines) {
    assert(road.points.length >= 2, `${road.id} points`);
    for (const [x, y] of road.points) {
      assert(x % 3 === 0 && y % 3 === 0, `${road.id} off 3 m grid ${x},${y}`);
    }
    if (tier === 'village' || tier === 'town') {
      const main = area.roads.polylines.some((line) => line.rank === 1 && line.widthM >= 3);
      assert(main, 'entry road at least 3 m');
    }
  }
  const need = ['tavern', 'general_store', 'smithy', 'stables', 'wagonwright'];
  for (const id of need) {
    const building = area.buildings.find((b) => b.specialty === id);
    assert(building, `${area.area.id} missing ${id}`);
    assert(building?.kit?.startsWith('bld_'), `${id} kit`);
    assert(!!building?.type, `${id} legacy type`);
    assert(building?.family, `${id} family`);
    assert(building?.lot, `${id} lot`);
    assert(building?.frontageRank !== undefined, `${id} frontage`);
  }
  if (tier === 'town') {
    assert(area.buildings.some((b) => b.specialty === 'healer'), 'town healer');
    assert(settlement.respawnAnchor.kind === 'healer' || settlement.respawnAnchor.kind === 'temple', 'town respawn');
  }
  if (tier === 'village') {
    assert(settlement.respawnAnchor.kind === 'shrine' || settlement.respawnAnchor.kind === 'temple', 'village respawn');
  }
  const games = new Set(area.minigameSlots.map((slot) => slot.gameId));
  for (const id of ['tavern_dice', 'tavern_cards', 'arm_wrestling']) {
    assert(games.has(id), `${area.area.id} missing ${id}`);
  }
  for (const slot of area.minigameSlots) {
    if (slot.scope === 'wild' || slot.gameId === 'ford_crossing') assert(slot.peeloff === true, `${slot.gameId} peeloff`);
    assert(slot.schedule.hours === undefined || slot.schedule.hours[0] <= slot.schedule.hours[1], 'hours');
  }
  const notes = area.meta.notes.join('\n');
  assert(!/off-grid|overlap|respawn unreachable|wagon yard missing|under 3 m/.test(notes), `${area.area.id} layout warnings\n${notes}`);
}

const wild = exportPlace(world, 'hollowmere');
assert(wild.population === undefined, 'grove omits population');
assert(wild.area.settlement === undefined, 'grove omits settlement');
assert(
  wild.props.some((prop) => /tree_oak|tree_beech|tree_birch|tree_pine|bush_fern|log_fallen/.test(prop.kit ?? '')),
  'forest kit props',
);
const shore = exportPlace(world, 'jadewild');
assert(waterCells(shore) > 0, 'jadewild has water ground');
const hills = exportPlace(world, 'dunharrow');
assert(hills.layers.height.reliefBiome === 'Hills', 'dunharrow biome');
assert(
  hills.props.some((prop) => /tree_pine|tree_juniper|rock_outcrop|rock_scree|rock_boulder|bush_alpine|prop_cairn|tree_oak|bush_gorse/.test(prop.kit ?? '')),
  'upland kit props',
);
assert(hills.area.settlement?.tier === 'camp', 'camp settlement');
assert(hills.area.settlement?.respawnAnchor.kind === 'campfire', 'camp respawn');
const gold = world.nodes.find((node) => node.id === 'goldmere');
assert(gold, 'goldmere');
if (gold && gold.biome !== Biome.Plains) {
  const dry = gold.tiles.filter((tile) => world.biomes[tile.x + tile.y * world.width] !== Biome.Water);
  const flattened = dry.length > 0 && dry.every((tile) => world.biomes[tile.x + tile.y * world.width] === Biome.Plains);
  assert(!flattened, 'goldmere was flattened to plains');
}
const unknown = rollMinigameSlots(
  {
    placeSeed: 1,
    tier: 'village',
    biome: 'Forest',
    variant: 'default',
    areaHa: 1,
    buildings: [],
    props: [],
    cells: { fish: [], forage: [{ x: 3, y: 3 }], chop: [], ford: [] },
    extraRules: [
      {
        gameId: 'totally_unknown',
        scope: 'wild',
        host: { kind: 'cell', anchor: 'exterior' },
        perSettlement: [1, 1],
        schedule: { hours: [1, 2] },
        weight: 1,
      } satisfies MinigameRule,
    ],
  },
  [],
);
assert(unknown.length === 1 && unknown[0]?.gameId === 'totally_unknown' && unknown[0]?.peeloff === true, 'unknown game id passes through');
assert(hills.layers.height.reliefMeters === 30, `hills relief ${hills.layers.height.reliefMeters}`);
assert(hills.layers.height.reliefBiomeMultiplier === 2, 'hills multiplier');

let waterPick: AreaExport | null = null;
let waterN = -1;
for (const node of world.nodes) {
  if (node.id === 'veldcross' || node.id === 'hollowmere') continue;
  if (!node.tiles?.length) continue;
  const area = buildAreaExport(world, node, fixed);
  const n = waterCells(area);
  console.log(`  water scan ${node.name} (${node.id}, ${node.kind}) cells=${n} tiles=${node.tiles.length}`);
  if (n > waterN) {
    waterN = n;
    waterPick = area;
  }
}
if (!waterPick || waterN <= 0) fail('no place contained water ground cells');
const waterPlace = world.nodes.find((n) => n.id === waterPick!.area.id)!;
checkShape(waterPick, waterPlace, world);
const again = buildAreaExport(world, waterPlace, fixed);
assert(again.meta.hash === waterPick.meta.hash, 'water place hash drifted');
console.log(`water fixture: ${waterPick.area.name} (${waterPick.area.id}) cells=${waterN} hash=${waterPick.meta.hash}`);

const hollowmereV04: AreaExport = {
  ...wild,
  npcs: { frame: 'zone-m', asOfHours: 8, list: forcedFixtureNpcs(wild, world.width, 8) },
};
delete hollowmereV04.session;
assert(contentHash(hollowmereV04) === wild.meta.hash, 'v04 fixture hash');
assert(hollowmereV04.npcs?.list.length === 3, 'forced npcs');

/**
 * Download area JSON is the builder payload plus a standalone npc snapshot.
 * `buildAreaExport` leaves `npcs` off (they are not part of the hash). The
 * v0.5 Ironmarch file is that download: npcs included, session omitted.
 * The player stands at the place centroid, the same situation as an isolated
 * download, with entities freshly spawned at hour 8.
 */
const people = [...spawnEntities(world, seed), ...spawnResidents(world, seed)];
const townResidents = people.filter((entity) => entity.resident?.placeId === town.area.id);
const townCenter = {
  x: (town.area.worldBounds.x0 + town.area.worldBounds.x1 + 1) / 2,
  y: (town.area.worldBounds.y0 + town.area.worldBounds.y1 + 1) / 2,
};
const veldcrossV05: AreaExport = {
  ...town,
  npcs: snapshotNpcs(town, people, townCenter, fixed.timeOfDayHours, 'download', world.width),
};
delete veldcrossV05.session;
assert(veldcrossV05.session === undefined, 'download omits session');
assert(veldcrossV05.npcs && veldcrossV05.npcs.list.length > 0, 'download includes npcs');
assert(contentHash(veldcrossV05) === town.meta.hash, 'npcs changed the v05 hash');
assert(veldcrossV05.population?.named === townResidents.length, 'fixture named');
const snapped = new Set(veldcrossV05.npcs?.list.map((npc) => npc.id));
for (const resident of townResidents) {
  assert(snapped.has(resident.id), `download snapshot missing named resident ${resident.id}`);
}
console.log(
  `download snapshot ${town.area.name}: npcs=${veldcrossV05.npcs?.list.length} named=${townResidents.length} ` +
    `population.named=${veldcrossV05.population?.named}`,
);

if (process.env['AREA_EXPORT_WRITE'] === '1') {
  const dir = join(root, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const files: Array<[string, AreaExport]> = [
    [`area-${town.area.id}.json`, town],
    [`area-${village.area.id}.json`, village],
    [`area-${wild.area.id}.json`, wild],
    [`area-${shore.area.id}.json`, shore],
    ['area-hollowmere-v04.json', hollowmereV04],
    [`area-${town.area.id}-v05.json`, veldcrossV05],
  ];
  for (const [name, area] of files) {
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(area, null, 2)}\n`);
    const bytes = statSync(path).size;
    console.log(`wrote ${path} (${bytes} bytes)`);
  }
}

assertHeightFormula(world);

function assertHeightFormula(world: WorldData): void {
  const sample = worldHeightSampler(world);
  let matched = 0;
  let maxBilinearGap = 0;
  for (let y = 40; y < world.height - 40; y += 97) {
    for (let x = 40; x < world.width - 40; x += 89) {
      const got = sample(x, y);
      const stored = world.heights[x + y * world.width] ?? 0;
      assert(Math.abs(got - stored) < 1e-5, `height formula drift at ${x},${y} ${got} vs ${stored}`);
      matched++;
      for (const [tx, ty] of [
        [0.37, 0.41],
        [0.5, 0.5],
      ] as const) {
        const exact = sample(x + tx, y + ty);
        const h00 = world.heights[x + y * world.width] ?? 0;
        const h10 = world.heights[x + 1 + y * world.width] ?? 0;
        const h01 = world.heights[x + (y + 1) * world.width] ?? 0;
        const h11 = world.heights[x + 1 + (y + 1) * world.width] ?? 0;
        const bilin = h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty;
        maxBilinearGap = Math.max(maxBilinearGap, Math.abs(exact - bilin));
      }
    }
  }
  assert(matched > 10, 'integer height samples');
  assert(maxBilinearGap > 5e-5, `fractional samples collapsed to bilinear (max gap ${maxBilinearGap})`);
  console.log(`height formula matched ${matched} integer tiles; max gap vs bilinear ${maxBilinearGap.toExponential(2)}`);
}

console.log('area export check ok');
