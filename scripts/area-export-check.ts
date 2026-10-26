/**
 * Determinism check and fixture writer for AreaExport v0.1.
 *   npx tsx scripts/area-export-check.ts
 * Writes fixtures/ when AREA_EXPORT_WRITE=1.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AREA_EXPORT_VERSION,
  GROUND,
  GROUND_CLASSES,
  buildAreaExport,
  contentHash,
  decodeB64U8,
  type AreaExport,
} from '../src/app/engine/area-export';
import { generateWorld } from '../src/app/engine/world-gen';
import { DEFAULT_WORLD_SETTINGS, type MapNode, type WorldData } from '../src/app/models/world.models';

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

function checkShape(area: AreaExport, place: MapNode): void {
  assert(area.type === 'trailbound.area', 'type');
  assert(area.version === AREA_EXPORT_VERSION, 'version');
  assert(area.source.seed === seed, 'seed');
  assert(area.area.id === place.id, 'id');
  assert(area.units.metersPerTile === 1, 'metres');
  assert(area.grid.w * area.grid.h === decodeB64U8(area.grid.mask.data).length, 'mask size');
  assert(decodeB64U8(area.layers.biome.data).length === area.grid.w * area.grid.h, 'biome size');
  assert(decodeB64U8(area.layers.ground.data).length === area.grid.w * area.grid.h, 'ground size');
  assert(area.layers.biome.legend?.length === 15, 'biome legend');
  assert(area.layers.ground.legend?.join() === GROUND_CLASSES.join(), 'ground legend');
  assert(area.layers.height.raw.length === area.layers.height.w * area.layers.height.h, 'height size');
  assert(area.layers.height.reliefBaseMeters === 6, 'relief base');
  assert(area.entries.some((e) => e.kind === 'spawn'), 'spawn');
  assert(area.buildings.every((b) => b.rotation === 0 && b.door === 'S'), 'doors face south');
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
  checkShape(a, place);
  console.log(
    `${place.name} (${place.id}, ${place.kind}, ${place.tiles?.length ?? 0} tiles) ` +
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
const wild = exportPlace(world, 'hollowmere');
const hills = exportPlace(world, 'dunharrow');
assert(hills.layers.height.reliefBiome === 'Hills', 'dunharrow biome');
assert(hills.layers.height.reliefMeters === 10.5, `hills relief ${hills.layers.height.reliefMeters}`);
assert(hills.layers.height.reliefBiomeMultiplier === 1.75, 'hills multiplier');

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
checkShape(waterPick, waterPlace);
const again = buildAreaExport(world, waterPlace, fixed);
assert(again.meta.hash === waterPick.meta.hash, 'water place hash drifted');
console.log(`water fixture: ${waterPick.area.name} (${waterPick.area.id}) cells=${waterN} hash=${waterPick.meta.hash}`);

if (process.env['AREA_EXPORT_WRITE'] === '1') {
  const dir = join(root, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const files: Array<[string, AreaExport]> = [
    [`area-${town.area.id}.json`, town],
    [`area-${wild.area.id}.json`, wild],
    [`area-${waterPick.area.id}.json`, waterPick],
  ];
  for (const [name, area] of files) {
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(area, null, 2)}\n`);
    console.log(`wrote ${path}`);
  }
}

console.log('area export check ok');
