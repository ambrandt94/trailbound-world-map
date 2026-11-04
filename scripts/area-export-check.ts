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
  HEIGHT_QUANT_M,
  HEIGHT_SOFT_MIN_SPAN,
  HEIGHT_SUBDIV_METERS,
  RELIEF_BIOME_MULT,
  RELIEF_METERS,
  SEA_CLEARANCE_M,
  SEA_LEVEL,
  buildAreaExport,
  contentHash,
  decodeB64I16,
  decodeB64U8,
  quantizeHeightM,
  type AreaExport,
} from '../src/app/engine/area-export';
import { PART_CODE, PART_LEGEND } from '../src/app/engine/building-templates';
import { generateWorld, worldHeightSampler } from '../src/app/engine/world-gen';
import {
  SEA_LEVEL_M,
  VERTICAL_EXAGGERATION,
  detailOffsetM,
  detailSeedFor,
  metersToNormalized,
  sampleMacroMeters,
  summarizeTerrain,
} from '../src/app/engine/terrain';
import { rollMinigameSlots, type MinigameRule } from '../src/app/engine/minigame-slots';
import { ROW_LINK_M, SIDE_YARD_M, TERRACE_RUN_MAX, tierPlacement, type SettlementTierId } from '../src/app/engine/settlement-tiers';
import { Biome, DEFAULT_WORLD_SETTINGS, ZONE_SCALE, boundsFromTiles, type MapNode, type WorldData } from '../src/app/models/world.models';

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
  assert(area.version === '0.7.0', 'version string');
  assert(area.units.seaLevel === SEA_LEVEL && area.units.seaLevel === 0.36, 'normalized sea level');
  assert(area.units.seaLevelM === SEA_LEVEL_M && area.units.seaLevelM === 0, 'sea level metres');
  assert(area.units.heightDatum === 'sea', 'height datum');
  assert(area.units.verticalExaggeration === VERTICAL_EXAGGERATION, 'vertical exaggeration');
  assert(area.units.verticalExaggeration > 0 && area.units.verticalExaggeration < 1, 'exaggeration is a gentle compression');
  assert(area.units.detailSeed === detailSeedFor(world.seed), 'detail seed is world-anchored');
  assert(area.units.detailSeed !== place.seed, 'detail seed is not the place seed');
  const heightM = area.layers.heightM;
  assert(heightM.enc === 'b64i16le' && heightM.quantM === HEIGHT_QUANT_M, 'heightM encoding');
  assert(heightM.w === area.layers.height.w && heightM.h === area.layers.height.h, 'heightM lattice');
  assert(heightM.originInner.x === area.layers.height.originInner.x && heightM.originInner.y === area.layers.height.originInner.y, 'heightM origin');
  assert(/verticalExaggeration/.test(heightM.note) && /detailSeed/.test(heightM.note), 'heightM note');
  const metres = decodeB64I16(heightM.data);
  assert(metres.length === heightM.w * heightM.h, 'heightM size');
  for (let i = 0; i < metres.length; i++) {
    const m = metres[i]! * heightM.quantM;
    const raw = area.layers.height.raw[i] ?? 0;
    if (m < 0) assert(raw < area.units.seaLevel, `wet sample ${m} normalized to ${raw}`);
    else assert(raw >= area.units.seaLevel, `dry sample ${m} normalized to ${raw}`);
  }
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
        const raw = latticeRaw(area, area.grid.originInner.x + ix + 0.5, area.grid.originInner.y + iy + 0.5);
        if (raw < area.units.seaLevel) {
          assert(biomes[gi] === Biome.Water, `ring below sea stays ${biomes[gi]} at ${key}`);
          assert((ground[gi] ?? 0) === GROUND.water, `ring below sea ground ${ground[gi]} at ${key}`);
        } else {
          assert(biomes[gi] === stored, `ring biome ${biomes[gi]} != world ${stored} at ${key}`);
        }
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
  const wx = sx / ZONE_SCALE;
  const wy = sy / ZONE_SCALE;
  const macro = sampleMacroMeters(world.heightM, world.width, world.height, wx, wy);
  const detailed = macro + detailOffsetM(wx, wy, world.seed, macro);
  const quantized = quantizeHeightM(detailed) * HEIGHT_QUANT_M;
  const expected = Math.round(metersToNormalized(quantized) * 1e5) / 1e5;
  assert(height.raw[si]! + 1e-4 >= expected - 1e-4, `lattice sample ${height.raw[si]} below terrain ${expected}`);
  assert(Math.abs((sample(wx, wy) ?? 0) - metersToNormalized(macro)) < 1e-5, 'sampler drifted from macro metres');
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
  assertPlaceContract(area, mask, ground, biomes, border);
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

const DETACHED_HOMES = new Set(['tent', 'hovel', 'cottage', 'manor']);

/** Lattice sample that contains this inner-tile point. Matches the sea-level cell count. */
function latticeRaw(area: AreaExport, x: number, y: number): number {
  const height = area.layers.height;
  const step = height.subdivMeters;
  const i = Math.max(0, Math.min(height.w - 1, Math.floor((x - height.originInner.x) / step)));
  const j = Math.max(0, Math.min(height.h - 1, Math.floor((y - height.originInner.y) / step)));
  return height.raw[i + j * height.w] ?? 0;
}

function boxGap(
  a: { x: number; y: number; w: number; d: number },
  b: { x: number; y: number; w: number; d: number },
): number {
  const sepX = a.x >= b.x + b.w ? a.x - (b.x + b.w) : b.x >= a.x + a.w ? b.x - (a.x + a.w) : 0;
  const sepY = a.y >= b.y + b.d ? a.y - (b.y + b.d) : b.y >= a.y + a.d ? b.y - (a.y + a.d) : 0;
  if (sepX === 0 && sepY === 0) return 0;
  if (sepX === 0) return sepY;
  if (sepY === 0) return sepX;
  return Math.hypot(sepX, sepY);
}

function assertPlaceContract(
  area: AreaExport,
  mask: Uint8Array,
  ground: Uint8Array,
  biomes: Uint8Array,
  border: Uint8Array,
): void {
  const sea = area.units.seaLevel;
  assert(sea === SEA_LEVEL, 'sea level');
  const gw = area.grid.w;
  const gh = area.grid.h;
  const ox = area.grid.originInner.x;
  const oy = area.grid.originInner.y;
  let playableWater = 0;
  let below = 0;
  let belowUntagged = 0;
  for (let iy = 0; iy < gh; iy++) {
    for (let ix = 0; ix < gw; ix++) {
      const gi = ix + iy * gw;
      const playable = mask[gi] === 1;
      const ring = border[gi] === 1;
      if (!playable && !ring) continue;
      const raw = latticeRaw(area, ox + ix + 0.5, oy + iy + 0.5);
      if (raw >= sea) continue;
      below++;
      const tagged = ground[gi] === GROUND.water && biomes[gi] === Biome.Water;
      if (!tagged) belowUntagged++;
    }
  }
  assert(belowUntagged === 0, `${area.area.id} ${belowUntagged} of ${below} below-sea cells are not water`);
  for (let i = 0; i < ground.length; i++) if (mask[i] === 1 && ground[i] === GROUND.water) playableWater++;
  assert(area.layers.water.present === playableWater > 0, `${area.area.id} water.present ${area.layers.water.present} vs ${playableWater} water cells`);

  const metresOf = area.layers.heightM ? decodeB64I16(area.layers.heightM.data) : null;
  const quantM = area.layers.heightM?.quantM ?? HEIGHT_QUANT_M;
  const metresAt = (x: number, y: number): number => {
    if (!metresOf || !area.layers.heightM) return 0;
    const layer = area.layers.heightM;
    const i = Math.max(0, Math.min(layer.w - 1, Math.floor((x - layer.originInner.x) / layer.subdivMeters)));
    const j = Math.max(0, Math.min(layer.h - 1, Math.floor((y - layer.originInner.y) / layer.subdivMeters)));
    return (metresOf[i + j * layer.w] ?? 0) * quantM;
  };
  const dry = (x: number, y: number, label: string) => {
    assert(latticeRaw(area, x, y) >= sea, `${area.area.id} ${label} at ${x},${y} is below sea (${latticeRaw(area, x, y)})`);
    const metres = metresAt(x, y);
    assert(metres >= SEA_CLEARANCE_M - 1e-6, `${area.area.id} ${label} at ${x},${y} is ${metres} m, under the ${SEA_CLEARANCE_M} m pad`);
  };
  for (const building of area.buildings) {
    for (let y = building.structureY; y < building.structureY + building.structureD; y++) {
      for (let x = building.structureX; x < building.structureX + building.structureW; x++) {
        dry(x + 0.5, y + 0.5, `${building.id} ${building.specialty ?? building.type}`);
      }
    }
    const lot = building.lot;
    if (lot) {
      for (let y = lot.y; y < lot.y + lot.d; y++) {
        for (let x = lot.x; x < lot.x + lot.w; x++) dry(x + 0.5, y + 0.5, `${building.id} lot`);
      }
    }
  }
  for (let iy = 0; iy < gh; iy++) {
    for (let ix = 0; ix < gw; ix++) {
      const gi = ix + iy * gw;
      if (mask[gi] !== 1) continue;
      if (ground[gi] !== GROUND.road && ground[gi] !== GROUND.dirt) continue;
      dry(ox + ix + 0.5, oy + iy + 0.5, 'road');
    }
  }
  for (const zone of area.zones) {
    const rect = zone.rect;
    for (let y = rect.y; y < rect.y + rect.d; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const ix = Math.floor(x - ox);
        const iy = Math.floor(y - oy);
        if (ix < 0 || iy < 0 || ix >= gw || iy >= gh) continue;
        if (mask[ix + iy * gw] !== 1) continue;
        dry(x + 0.5, y + 0.5, `${zone.id} zone`);
      }
    }
  }
  const spawn = area.entries.find((entry) => entry.kind === 'spawn');
  let playableLand = 0;
  for (let i = 0; i < ground.length; i++) if (mask[i] === 1 && ground[i] !== GROUND.water) playableLand++;
  if (spawn && playableLand > 0) dry(spawn.x, spawn.y, 'spawn');
  const anchor = area.area.settlement?.respawnAnchor;
  if (anchor) dry(anchor.x, anchor.y, 'respawn');

  const seenProp = new Set<string>();
  for (const prop of area.props) {
    const key = `${prop.kit ?? prop.type}@${prop.x},${prop.y}`;
    assert(!seenProp.has(key), `${area.area.id} duplicate prop ${prop.id} ${key}`);
    seenProp.add(key);
  }

  const wagon = area.zones.find((zone) => zone.kind === 'wagon_yard');
  for (const slot of wagon?.slots ?? []) {
    const cornerX = slot.x - slot.w / 2;
    const cornerY = slot.y - slot.d / 2;
    assert(Math.abs(slot.x - (cornerX + slot.w / 2)) < 1e-6, 'slot x is a centre');
    assert(wagon && cornerX >= wagon.rect.x - 1e-6 && cornerY >= wagon.rect.y - 1e-6, `${slot.x},${slot.y} slot outside yard`);
    assert(wagon && cornerX + slot.w <= wagon.rect.x + wagon.rect.w + 1e-6, 'slot past yard');
    assert(Math.abs(slot.x - wagon!.rect.x) > 0.1, `${area.area.id} wagon slot x is the yard corner`);
  }

  for (const slot of area.minigameSlots) {
    if (slot.gameId !== 'wild_forage') continue;
    const lx = slot.x - ox;
    const ly = slot.y - oy;
    assert(Math.abs(lx - 0.5) > 0.01 || Math.abs(ly - 0.5) > 0.01, `${area.area.id} ${slot.id} forage at the grid origin`);
    const ix = Math.floor(lx);
    const iy = Math.floor(ly);
    const gi = ix + iy * gw;
    assert(mask[gi] === 1, `${slot.id} forage is not playable`);
    const g = ground[gi] ?? 0;
    assert(
      g !== GROUND.road && g !== GROUND.dirt && g !== GROUND.lot && g !== GROUND.plaza && g !== GROUND.yard && g !== GROUND.water,
      `${slot.id} forage on ${g}`,
    );
  }

  if (!area.area.settlement) return;
  const boxes = area.buildings.map((building) => ({
    id: building.specialty ?? building.type,
    detached: DETACHED_HOMES.has(building.specialty ?? ''),
    rowhouse: building.specialty === 'townhouse',
    box: { x: building.structureX, y: building.structureY, w: building.structureW, d: building.structureD },
    door: building.door,
    doorCell: building.doorCell,
  }));
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    if (!a.detached) continue;
    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue;
      const gap = boxGap(a.box, boxes[j]!.box);
      assert(gap >= SIDE_YARD_M, `${area.area.id} ${a.id} is ${gap.toFixed(2)} m from ${boxes[j]!.id}`);
    }
  }
  const row = tierPlacement(area.area.settlement.tier as SettlementTierId).row;
  if (!row.rowhouses) {
    const sameRun = (a: (typeof boxes)[number], b: (typeof boxes)[number]): boolean => {
      if (a.door !== b.door) return false;
      if (boxGap(a.box, b.box) > ROW_LINK_M) return false;
      if (a.door === 'N' || a.door === 'S') return a.box.y < b.box.y + b.box.d && b.box.y < a.box.y + a.box.d;
      return a.box.x < b.box.x + b.box.w && b.box.x < a.box.x + a.box.w;
    };
    const parent = boxes.map(() => -1);
    const find = (n: number): number => (parent[n]! < 0 ? n : (parent[n] = find(parent[n]!)));
    const unite = (i: number, j: number) => {
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[b] = a;
    };
    for (let i = 0; i < boxes.length; i++) {
      if (!boxes[i]!.rowhouse && !boxes[i]!.detached) continue;
      for (let j = i + 1; j < boxes.length; j++) {
        if (!boxes[j]!.rowhouse && !boxes[j]!.detached) continue;
        if (sameRun(boxes[i]!, boxes[j]!)) unite(i, j);
      }
    }
    const sizes = new Map<number, number>();
    for (let i = 0; i < boxes.length; i++) {
      if (!boxes[i]!.rowhouse && !boxes[i]!.detached) continue;
      const root = find(i);
      sizes.set(root, (sizes.get(root) ?? 0) + 1);
    }
    for (const size of sizes.values()) {
      assert(size <= TERRACE_RUN_MAX, `${area.area.id} terrace run of ${size} exceeds ${TERRACE_RUN_MAX}`);
    }
  }
  const step: Record<string, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const lateral: Record<string, [number, number]> = { N: [1, 0], E: [0, 1], S: [1, 0], W: [0, 1] };
  for (const building of boxes) {
    const dir = step[building.door];
    const side = lateral[building.door];
    if (!dir || !side) continue;
    let faced = false;
    for (let s = 1; s <= 6 && !faced; s++) {
      for (let off = -3; off <= 3; off++) {
        const ix = Math.floor(building.doorCell.x + dir[0] * s + side[0] * off - ox);
        const iy = Math.floor(building.doorCell.y + dir[1] * s + side[1] * off - oy);
        if (ix < 0 || iy < 0 || ix >= gw || iy >= gh) continue;
        const g = ground[ix + iy * gw] ?? 0;
        if (g === GROUND.road || g === GROUND.dirt || g === GROUND.plaza || g === GROUND.park) {
          faced = true;
          break;
        }
      }
    }
    assert(faced, `${area.area.id} ${building.id} door ${building.door} does not face a road`);
  }
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
const t16 = performance.now();
const world = generateWorld(seed, DEFAULT_WORLD_SETTINGS);
const ms16 = performance.now() - t16;
const t8 = performance.now();
generateWorld(seed, { ...DEFAULT_WORLD_SETTINGS, worldScale: 8 });
const ms8 = performance.now() - t8;
const summary = summarizeTerrain(world.heightM, world.biomes);
console.log(
  `generation scale 16 (${world.width} tiles, ${((world.width * 8) / 1000).toFixed(1)} km): ${ms16.toFixed(0)} ms; ` +
    `scale 8: ${ms8.toFixed(0)} ms`,
);
console.log(
  `height ${summary.minM.toFixed(0)}..${summary.maxM.toFixed(0)} m  land=${summary.land} shelf=${summary.shelf} ` +
    `abyss=${summary.abyss} trench=${summary.trench} mountain=${summary.mountain} snow=${summary.snow}`,
);
assert(world.settings.worldScale === 16, 'default world scale');
assert(summary.minM <= -3200, `trench floor ${summary.minM}`);
assert(summary.maxM >= 1800, `peak ${summary.maxM}`);
assert(summary.trench > 1000, 'trench cells');
assert(summary.shelf > 1000, 'shelf cells');
assert(summary.abyss > 1000, 'abyss cells');
assert(summary.snow > 1000 && summary.mountain > 1000, 'snow and mountain');
assert(summary.minM >= -4100 && summary.maxM <= 3300, 'height clamp');
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
    const benches = area.props.filter((prop) => prop.kit === 'prop_bench_1.5m');
    assert(benches.length >= 4, `town benches ${benches.length}`);
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
console.log(`jadewild water cells ${waterCells(shore)}`);
const hills = exportPlace(world, 'dunharrow');
assert(hills.layers.height.reliefBiome === 'Hills' || hills.layers.height.reliefBiome === 'Mountain' || hills.layers.height.reliefBiome === 'Snow', 'dunharrow upland biome');
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
assert(
  Math.abs(hills.layers.height.reliefMeters - RELIEF_METERS * hills.layers.height.reliefBiomeMultiplier) < 1e-6,
  `hills relief ${hills.layers.height.reliefMeters}`,
);
if (hills.layers.height.reliefBiome === 'Hills') {
  assert(hills.layers.height.reliefMeters === 30, `hills relief ${hills.layers.height.reliefMeters}`);
  assert(hills.layers.height.reliefBiomeMultiplier === 2, 'hills multiplier');
}

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
if (waterPick && waterN > 0) {
  const waterPlace = world.nodes.find((n) => n.id === waterPick!.area.id)!;
  checkShape(waterPick, waterPlace, world);
  const again = buildAreaExport(world, waterPlace, fixed);
  assert(again.meta.hash === waterPick.meta.hash, 'water place hash drifted');
  console.log(`water fixture: ${waterPick.area.name} (${waterPick.area.id}) cells=${waterN} hash=${waterPick.meta.hash}`);
} else {
  console.log('no authored place includes the sea; the deep-water fixture covers that case');
}

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

assert(town.units.detailSeed === village.units.detailSeed, 'detail seed differs between areas');
assert(town.units.verticalExaggeration === village.units.verticalExaggeration, 'exaggeration differs between areas');
const hollowNode = world.nodes.find((node) => node.id === 'hollowmere');
assert(hollowNode, 'hollowmere node');
assertSeams(world, hollowNode!);

let peakAt = 0;
let deepAt = 0;
for (let i = 0; i < world.heightM.length; i++) {
  if ((world.heightM[i] ?? 0) > (world.heightM[peakAt] ?? 0)) peakAt = i;
  if ((world.heightM[i] ?? 0) < (world.heightM[deepAt] ?? 0)) deepAt = i;
}
const peakNode = squareNode(world, 'peak', 'High Range', peakAt % world.width, Math.floor(peakAt / world.width), 3);
const deepNode = squareNode(world, 'deep', 'Trench Floor', deepAt % world.width, Math.floor(deepAt / world.width), 3);
const peak = buildAreaExport(world, peakNode, fixed);
const deep = buildAreaExport(world, deepNode, fixed);
checkShape(peak, peakNode, world);
checkShape(deep, deepNode, world);
const peakMetres = decodeB64I16(peak.layers.heightM.data);
const deepMetres = decodeB64I16(deep.layers.heightM.data);
let peakTop = -Infinity;
let deepFloor = Infinity;
for (const q of peakMetres) peakTop = Math.max(peakTop, q * HEIGHT_QUANT_M);
for (const q of deepMetres) deepFloor = Math.min(deepFloor, q * HEIGHT_QUANT_M);
assert(peakTop >= 1500, `mountain fixture peaks at ${peakTop} m`);
assert(deepFloor <= -2500, `deep fixture floor is ${deepFloor} m`);
assert([...decodeB64U8(peak.layers.biome.data)].some((b) => b === Biome.Snow || b === Biome.Mountain), 'peak fixture has snow or rock');
console.log(`peak fixture ${peakTop.toFixed(0)} m, deep fixture ${deepFloor.toFixed(0)} m`);

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
    ['area-peak.json', peak],
    ['area-deep.json', deep],
  ];
  for (const [name, area] of files) {
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(area, null, 2)}\n`);
    const bytes = statSync(path).size;
    console.log(`wrote ${path} (${bytes} bytes)`);
  }
}

assertHeightFormula(world);

function squareNode(world: WorldData, id: string, name: string, cx: number, cy: number, radius: number): MapNode {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x >= 0 && y >= 0 && x < world.width && y < world.height) tiles.push({ x, y });
    }
  }
  const bounds = boundsFromTiles(tiles);
  return {
    id,
    name,
    origin: 'generated',
    kind: 'shore',
    radius,
    seed: 4242,
    cx,
    cy,
    biome: (world.biomes[cx + cy * world.width] ?? Biome.Plains) as Biome,
    tiles,
    x0: bounds.x0,
    y0: bounds.y0,
    x1: bounds.x1,
    y1: bounds.y1,
  };
}

function assertSeams(world: WorldData, place: MapNode): void {
  const dx = (place.x1 ?? 0) + 8 < world.width ? 4 : -4;
  const tiles = (place.tiles ?? [])
    .map((tile) => ({ x: tile.x + dx, y: tile.y }))
    .filter((tile) => tile.x >= 0 && tile.y >= 0 && tile.x < world.width && tile.y < world.height);
  assert(tiles.length > 4, 'seam shift left the map');
  const bounds = boundsFromTiles(tiles);
  const shifted: MapNode = {
    ...place,
    id: `${place.id}-seam`,
    name: `${place.name} seam`,
    tiles,
    cx: place.cx + dx,
    x0: bounds.x0,
    y0: bounds.y0,
    x1: bounds.x1,
    y1: bounds.y1,
  };
  const left = buildAreaExport(world, place, fixed);
  const right = buildAreaExport(world, shifted, fixed);
  const a = decodeB64I16(left.layers.heightM.data);
  const b = decodeB64I16(right.layers.heightM.data);
  const step = left.layers.heightM.subdivMeters;
  let matched = 0;
  let compared = 0;
  for (let j = 0; j < left.layers.heightM.h; j++) {
    for (let i = 0; i < left.layers.heightM.w; i++) {
      const x = left.layers.heightM.originInner.x + i * step;
      const y = left.layers.heightM.originInner.y + j * step;
      const i2 = Math.round((x - right.layers.heightM.originInner.x) / step);
      const j2 = Math.round((y - right.layers.heightM.originInner.y) / step);
      if (i2 < 0 || j2 < 0 || i2 >= right.layers.heightM.w || j2 >= right.layers.heightM.h) continue;
      const x2 = right.layers.heightM.originInner.x + i2 * step;
      const y2 = right.layers.heightM.originInner.y + j2 * step;
      if (x2 !== x || y2 !== y) continue;
      compared++;
      const va = (a[i + j * left.layers.heightM.w] ?? 0) * HEIGHT_QUANT_M;
      const vb = (b[i2 + j2 * right.layers.heightM.w] ?? 0) * HEIGHT_QUANT_M;
      const wx = x / ZONE_SCALE;
      const wy = y / ZONE_SCALE;
      const macro = sampleMacroMeters(world.heightM, world.width, world.height, wx, wy);
      const terrain = quantizeHeightM(macro + detailOffsetM(wx, wy, world.seed, macro)) * HEIGHT_QUANT_M;
      const pad = HEIGHT_QUANT_M + 1e-6;
      if (Math.abs(va - terrain) <= pad && Math.abs(vb - terrain) <= pad) {
        assert(va === vb, `seam ${x},${y} ${va} m vs ${vb} m`);
        matched++;
      }
    }
  }
  assert(matched > 40, `only ${matched} of ${compared} overlapping samples matched`);
  console.log(`seams matched ${matched} overlapping samples (${compared} shared lattice points)`);
}

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
