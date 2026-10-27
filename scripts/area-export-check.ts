/**
 * Determinism check and fixture writer for AreaExport v0.3.
 *   npx tsx scripts/area-export-check.ts
 * Writes fixtures/ when AREA_EXPORT_WRITE=1.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { Biome, DEFAULT_WORLD_SETTINGS, ZONE_SCALE, type MapNode, type WorldData } from '../src/app/models/world.models';

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
  assert(area.version === '0.3.0', 'version string');
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
  assert(area.layers.biome.legend?.length === 15, 'biome legend');
  assert(area.layers.ground.legend?.join() === GROUND_CLASSES.join(), 'ground legend');
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
  const known = SPAWN[place.id];
  if (known && spawn) {
    assert(spawn.x === known.x && spawn.y === known.y && spawn.facing === known.facing, `spawn moved ${spawn.x},${spawn.y}`);
  }
  for (const b of area.buildings) {
    const tx = Math.floor((b.structureX + b.structureW / 2) / ZONE_SCALE);
    const ty = Math.floor((b.structureY + b.structureD / 2) / ZONE_SCALE);
    assert(placeKeys.has(`${tx},${ty}`), `${b.id} building in ring ${tx},${ty}`);
  }
  for (const p of area.props) {
    const tx = Math.floor(p.x / ZONE_SCALE);
    const ty = Math.floor(p.y / ZONE_SCALE);
    assert(placeKeys.has(`${tx},${ty}`), `prop in ring ${p.type} ${tx},${ty}`);
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
    assert(longSide <= 10 && shortSide <= 8, `${b.id} structure ${b.structureW}x${b.structureD}`);
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
assert(new Set(town.buildings.map((b) => b.rotation)).size >= 2, 'town doors face more than one way');
assert(town.buildings.some((b) => b.shape === 'mask'), 'town has a non-rectangular building');
assert(
  town.buildings.some((b) => {
    if (b.type !== 'shop' || b.storeys !== 1) return false;
    const longSide = Math.max(b.structureW, b.structureD);
    const shortSide = Math.min(b.structureW, b.structureD);
    return longSide >= 6 && longSide <= 8 && shortSide >= 5 && shortSide <= 7;
  }),
  'shop is about 7x6',
);
assert(
  town.buildings.some((b) => (b.type === 'church' || b.type === 'inn' || b.type === 'town-hall') && b.storeys === 2),
  'civic building is two storeys',
);
assert([...decodeB64U8(town.layers.ground.data)].some((v) => v === GROUND.yard), 'town has yard ground');
const wild = exportPlace(world, 'hollowmere');
const shore = exportPlace(world, 'jadewild');
assert(waterCells(shore) > 0, 'jadewild has water ground');
const hills = exportPlace(world, 'dunharrow');
assert(hills.layers.height.reliefBiome === 'Hills', 'dunharrow biome');
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

if (process.env['AREA_EXPORT_WRITE'] === '1') {
  const dir = join(root, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const files: Array<[string, AreaExport]> = [
    [`area-${town.area.id}.json`, town],
    [`area-${wild.area.id}.json`, wild],
    [`area-${shore.area.id}.json`, shore],
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
