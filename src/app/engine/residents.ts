/**
 * Town census for the crowd export. Pure functions — no Angular, and no draws
 * from the sim RNG (`Rng` in world.service). Named residents (the 3–8 real
 * map entities from `residentCountFor`) are a separate tier:
 * crowd = max(0, count − named).
 */
import { settlementLayout } from './buildings';
import {
  DEFAULT_AVG_PER_HOUSE,
  DEFAULT_AVG_PER_PLACE,
  MapNode,
  ResidentsMode,
  clampAvg,
} from '../models/world.models';

/** Half-width of the seeded resident multiplier. Factor is in [0.75, 1.25]. */
export const RESIDENT_JITTER = 0.25;
/** Structure area (m²) that counts as one home slot. Larger dwellings repeat. */
export const DWELLING_SLOT_M2 = 30;

export interface ResidentDefaults {
  residentsMode: ResidentsMode;
  avgPerHouse: number;
  avgPerPlace: number;
}

/** Per-place choice stored by place id, outside the seed-scoped node list. */
export interface ResidentOverride {
  mode: ResidentsMode;
  avg: number;
}

export interface AreaPoint {
  x: number;
  y: number;
}

/** Deterministic multiplier in [1 − jitter, 1 + jitter] from the world seed and place id. */
export function seededJitter(seed: number, placeId: string): number {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < placeId.length; i++) h = Math.imul(h ^ placeId.charCodeAt(i), 16777619);
  const unit = ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  return 1 + (unit * 2 - 1) * RESIDENT_JITTER;
}

/**
 * Census for one place.
 * perPlace: round(avg × 1 × jitter). perHouse: round(avg × house count × jitter).
 */
export function residentCensus(args: {
  seed: number;
  placeId: string;
  mode: ResidentsMode;
  avg: number;
  houses: number;
}): number {
  const avg = Number.isFinite(args.avg) ? args.avg : 0;
  const houses = args.mode === 'perHouse' ? Math.max(0, args.houses) : 1;
  const raw = avg * houses * seededJitter(args.seed, args.placeId);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

/**
 * Bodies the controller spawns locally. Named residents are already real
 * entities and are not part of this crowd.
 */
export function crowdSize(count: number, named: number): number {
  const census = Number.isFinite(count) ? Math.round(count) : 0;
  const known = Number.isFinite(named) ? Math.max(0, Math.round(named)) : 0;
  return Math.max(0, census - known);
}

export function resolveResidentParams(
  defaults: ResidentDefaults,
  override: ResidentOverride | null | undefined,
): { mode: ResidentsMode; avg: number } {
  if (override) return { mode: override.mode, avg: override.avg };
  const mode = defaults.residentsMode === 'perHouse' ? 'perHouse' : 'perPlace';
  return { mode, avg: mode === 'perHouse' ? defaults.avgPerHouse : defaults.avgPerPlace };
}

export function isSettlementKind(kind: string | null | undefined): boolean {
  return kind === 'city' || kind === 'town' || kind === 'hamlet';
}

/** Dwellings in the street layout. Same roster the chunk baker stamps. */
export function countDwellings(node: MapNode, worldSeed: number): number {
  if (!isSettlementKind(node.kind)) return 0;
  return settlementLayout(node, worldSeed).filter((building) => isDwellingType(building.sprite)).length;
}

/** Cottages, houses, and farmhouses. Inns, shops, and halls are not homes. */
export function isDwellingType(type: string): boolean {
  return type === 'farm' || type.startsWith('house-') || type.startsWith('cottage-');
}

/** Repeat a dwelling's building index once per `DWELLING_SLOT_M2` of structure, at least once. */
export function dwellingWeight(structureW: number, structureD: number): number {
  const area = Math.max(1, structureW * structureD);
  return Math.max(1, Math.round(area / DWELLING_SLOT_M2));
}

export function dwellingHomes(
  buildings: ReadonlyArray<{ type: string; structureW: number; structureD: number }>,
): number[] {
  const homes: number[] = [];
  buildings.forEach((building, index) => {
    if (!isDwellingType(building.type)) return;
    const slots = dwellingWeight(building.structureW, building.structureD);
    for (let i = 0; i < slots; i++) homes.push(index);
  });
  return homes;
}

export function clampResidentAvg(raw: unknown, mode: ResidentsMode): number {
  return mode === 'perHouse'
    ? clampAvg(raw, DEFAULT_AVG_PER_HOUSE, 0, 20)
    : clampAvg(raw, DEFAULT_AVG_PER_PLACE, 0, 500);
}

/** Place-id map. Entries survive a new seed because the key is not the seed. */
export function parseResidentOverrides(raw: string | null): Record<string, ResidentOverride> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ResidentOverride> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!id || !value || typeof value !== 'object') continue;
      const row = value as { mode?: unknown; avg?: unknown };
      const mode = row.mode === 'perHouse' || row.mode === 'perPlace' ? row.mode : null;
      if (!mode) continue;
      out[id] = { mode, avg: clampResidentAvg(row.avg, mode) };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Gathering points in area metres (offset from the area inner origin, y down).
 * Order is plaza, then markets, tavern doors, and wells.
 */
export function crowdHotspots(input: {
  originX: number;
  originY: number;
  buildings: ReadonlyArray<{ type: string; doorCell: { x: number; y: number } }>;
  props: ReadonlyArray<{ type: string; x: number; y: number }>;
  /** Absolute inner-tile centre of the plaza, or null when the place has none. */
  plaza: { x: number; y: number } | null;
}): AreaPoint[] {
  const spots: AreaPoint[] = [];
  if (input.plaza) spots.push(toArea(input.plaza.x, input.plaza.y, input.originX, input.originY));
  const markets = input.props.filter((prop) => prop.type === 'market');
  const wells = input.props.filter((prop) => prop.type === 'well');
  const taverns = input.buildings.filter((building) => building.type === 'tavern' || building.type.startsWith('tavern-'));
  for (const prop of sortPoints(markets)) spots.push(toArea(prop.x, prop.y, input.originX, input.originY));
  for (const building of sortDoors(taverns)) {
    spots.push(toArea(building.doorCell.x + 0.5, building.doorCell.y + 0.5, input.originX, input.originY));
  }
  for (const prop of sortPoints(wells)) spots.push(toArea(prop.x, prop.y, input.originX, input.originY));
  return spots;
}

function toArea(absX: number, absY: number, originX: number, originY: number): AreaPoint {
  return {
    x: Math.round((absX - originX) * 1000) / 1000,
    y: Math.round((absY - originY) * 1000) / 1000,
  };
}

function sortPoints<T extends { x: number; y: number }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
}

function sortDoors<T extends { doorCell: { x: number; y: number } }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => a.doorCell.y - b.doorCell.y || a.doorCell.x - b.doorCell.x);
}
