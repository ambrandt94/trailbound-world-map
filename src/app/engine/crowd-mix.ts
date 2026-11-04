/**
 * Crowd role mix for AreaExport v0.8 (`population.crowd`).
 *
 * World data only: a profile name, a seed, role weights, and a tier.
 * No character recipes and no engine fields. Tune the tables in this file.
 *
 * There is no place-level industry field. The catalog specialty on each
 * placed building (smithy, tavern, barn, …) is the industry signal.
 * Water is a Sand coast, open water, a Marsh river, or a harbour building.
 * Miner and woodcutter are not roles: nothing in the catalog is a mine
 * or a timber camp, and carpenter is a crafter.
 */
import type { MapNode, WorldData } from '../models/world.models';
import { Biome } from '../models/world.models';
import type { SettlementTierId } from './settlement-tiers';

export const CROWD_PROFILE = 'trailbound' as const;

/** Mix order. Rows are emitted in this order; zero weights are left out. */
export const CROWD_ROLES = [
  'farmer',
  'merchant',
  'smith',
  'guard',
  'sailor',
  'fisher',
  'noble',
  'pioneer',
  'laborer',
  'crafter',
] as const;

export type CrowdRole = (typeof CROWD_ROLES)[number];

export interface CrowdWeight {
  role: CrowdRole;
  /** Multiple of 0.001. Thousandths across `mix` sum to 1000. */
  w: number;
}

export interface CrowdBlock {
  profile: typeof CROWD_PROFILE;
  /** Unsigned 32-bit. See `crowdSeed`. */
  seed: number;
  mix: CrowdWeight[];
  /** Region and culture are undecided. Always null in v0.8. */
  culture: null;
  tier: SettlementTierId;
}

/**
 * Base mix in thousandths (1000 = weight 1).
 * Guards rise with the tier. Nobles start at town.
 * Hamlets and villages are mostly farmer, laborer, and pioneer.
 */
export const TIER_BASE: Record<SettlementTierId, Partial<Record<CrowdRole, number>>> = {
  camp: { pioneer: 550, laborer: 300, farmer: 150 },
  hamlet: { farmer: 480, laborer: 240, pioneer: 220, crafter: 40, merchant: 20 },
  village: { farmer: 380, laborer: 200, pioneer: 160, crafter: 100, merchant: 100, smith: 30, guard: 30 },
  town: { farmer: 180, laborer: 160, pioneer: 80, crafter: 120, merchant: 160, smith: 60, guard: 140, noble: 100 },
  city: { farmer: 100, laborer: 140, pioneer: 40, crafter: 120, merchant: 200, smith: 50, guard: 180, noble: 170 },
  capital: { farmer: 50, laborer: 100, pioneer: 30, crafter: 100, merchant: 180, smith: 40, guard: 240, noble: 260 },
};

/**
 * Added once per placed building of that catalog id, in thousandths,
 * up to `cap` buildings. Homes are not listed: the tier base already
 * covers them. Healer has no crowd role.
 */
export const SPECIALTY_BUMP: Readonly<Record<string, { role: CrowdRole; milli: number; cap: number }>> = {
  general_store: { role: 'merchant', milli: 40, cap: 1 },
  bakery: { role: 'merchant', milli: 30, cap: 1 },
  tavern: { role: 'merchant', milli: 40, cap: 1 },
  bank: { role: 'merchant', milli: 40, cap: 1 },
  apothecary: { role: 'merchant', milli: 20, cap: 1 },
  cartographer: { role: 'merchant', milli: 20, cap: 1 },
  market_stall: { role: 'merchant', milli: 20, cap: 4 },
  smithy: { role: 'smith', milli: 80, cap: 2 },
  carpenter: { role: 'crafter', milli: 50, cap: 2 },
  wagonwright: { role: 'crafter', milli: 40, cap: 2 },
  stables: { role: 'laborer', milli: 30, cap: 1 },
  barn: { role: 'farmer', milli: 80, cap: 2 },
  manor: { role: 'noble', milli: 40, cap: 3 },
  town_hall: { role: 'guard', milli: 30, cap: 1 },
  guildhall: { role: 'guard', milli: 30, cap: 1 },
  temple: { role: 'guard', milli: 20, cap: 1 },
  temple_small: { role: 'guard', milli: 10, cap: 1 },
};

/**
 * Open water or a Sand coast. Sailors rise with tier; fishers are the
 * small-place share of the same shore. Thousandths, added before normalize.
 */
export const WATER_OPEN: Record<SettlementTierId, Partial<Record<CrowdRole, number>>> = {
  camp: { fisher: 160, sailor: 40 },
  hamlet: { fisher: 180, sailor: 60 },
  village: { fisher: 140, sailor: 80 },
  town: { fisher: 80, sailor: 120 },
  city: { fisher: 60, sailor: 160 },
  capital: { fisher: 40, sailor: 180 },
};

/** Marsh, and no coast, open water, or harbour. Fishers only. */
export const WATER_RIVER: Record<SettlementTierId, Partial<Record<CrowdRole, number>>> = {
  camp: { fisher: 120 },
  hamlet: { fisher: 140 },
  village: { fisher: 120 },
  town: { fisher: 70 },
  city: { fisher: 40 },
  capital: { fisher: 30 },
};

/** A dock, quay, wharf, harbour, pier, or port building, on top of the shore row. */
export const HARBOUR_EXTRA: Partial<Record<CrowdRole, number>> = { sailor: 100, fisher: 30 };

const NOBLE_TIERS = new Set<SettlementTierId>(['town', 'city', 'capital']);

/** Whole tokens in a specialty id or kit name that count as a harbour. */
const HARBOUR_TOKENS = new Set(['dock', 'wharf', 'quay', 'harbour', 'harbor', 'pier', 'port']);

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export interface CrowdWater {
  /** A place tile is wet, is Water, or touches Water. */
  shore: boolean;
  /** The site or a place tile is Sand, the coast biome. */
  coast: boolean;
  /** The site or a place tile is Marsh. Stand-in for a river until hydrology exists. */
  river: boolean;
  /** A building specialty or kit names a dock, quay, wharf, harbour, pier, or port. */
  harbour: boolean;
}

export function crowdWater(
  world: WorldData,
  place: MapNode,
  buildings: ReadonlyArray<{ specialty?: string; kit?: string }>,
): CrowdWater {
  let shore = place.biome === Biome.Water;
  let coast = place.biome === Biome.Sand;
  let river = place.biome === Biome.Marsh;
  const width = world.width;
  const height = world.height;
  for (const tile of place.tiles ?? []) {
    const at = (x: number, y: number): Biome | null => {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return world.biomes[x + y * width] as Biome;
    };
    const here = at(tile.x, tile.y);
    if (here === Biome.Water) shore = true;
    if (here === Biome.Sand) coast = true;
    if (here === Biome.Marsh) river = true;
    const metres = world.heightM[tile.x + tile.y * width];
    if (metres !== undefined && metres < 0) shore = true;
    if (at(tile.x + 1, tile.y) === Biome.Water) shore = true;
    if (at(tile.x - 1, tile.y) === Biome.Water) shore = true;
    if (at(tile.x, tile.y + 1) === Biome.Water) shore = true;
    if (at(tile.x, tile.y - 1) === Biome.Water) shore = true;
  }
  let harbour = false;
  for (const building of buildings) {
    if (isHarbour(building.specialty ?? '', building.kit ?? '')) harbour = true;
  }
  return { shore, coast, river, harbour };
}

export function placeCrowd(args: {
  worldSeed: number;
  placeId: string;
  tier: SettlementTierId;
  buildings: ReadonlyArray<{ specialty?: string; kit?: string }>;
  water: CrowdWater;
}): CrowdBlock {
  const raw = emptyRaw();
  addRow(raw, TIER_BASE[args.tier]);
  const counts = new Map<string, number>();
  for (const building of args.buildings) {
    const id = building.specialty;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of counts) {
    const bump = SPECIALTY_BUMP[id];
    if (!bump) continue;
    if (bump.role === 'noble' && !NOBLE_TIERS.has(args.tier)) continue;
    raw[bump.role] += Math.min(count, bump.cap) * bump.milli;
  }
  const open = args.water.shore || args.water.coast || args.water.harbour;
  if (open) addRow(raw, WATER_OPEN[args.tier]);
  else if (args.water.river) addRow(raw, WATER_RIVER[args.tier]);
  if (args.water.harbour) addRow(raw, HARBOUR_EXTRA);
  if (!NOBLE_TIERS.has(args.tier)) raw.noble = 0;
  return {
    profile: CROWD_PROFILE,
    seed: crowdSeed(args.worldSeed, args.placeId),
    mix: normalize(raw),
    culture: null,
    tier: args.tier,
  };
}

/** Top roles for the place panel. Percentages are rounded independently. */
export function crowdMixSummary(mix: readonly CrowdWeight[], limit = 4): string {
  const order = new Map<string, number>(CROWD_ROLES.map((role, index) => [role, index]));
  return mix
    .slice()
    .sort((a, b) => b.w - a.w || (order.get(a.role) ?? 99) - (order.get(b.role) ?? 99))
    .slice(0, limit)
    .map((row) => `${row.role} ${Math.round(row.w * 100)}%`)
    .join(' · ');
}

/**
 * Unsigned 32-bit seed for one place.
 * Not the sim RNG, and not the resident jitter: the byte string is
 * `utf8("crowd")`, `0x00`, little-endian uint32 world seed, `0x00`, `utf8(placeId)`.
 * Hash is FNV-1a 32 (offset `2166136261`, prime `16777619`), then
 * `h ^ (h >>> 16)` as uint32. A zero fold becomes `1`.
 */
export function crowdSeed(worldSeed: number, placeId: string): number {
  const tag = new TextEncoder().encode('crowd');
  const id = new TextEncoder().encode(placeId);
  const bytes = new Uint8Array(tag.length + 1 + 4 + 1 + id.length);
  let offset = 0;
  bytes.set(tag, offset);
  offset += tag.length;
  bytes[offset++] = 0;
  writeU32(bytes, offset, worldSeed);
  offset += 4;
  bytes[offset++] = 0;
  bytes.set(id, offset);
  return fold(fnv1a32(bytes));
}

/**
 * Seed for crowd member `index` (0-based).
 * FNV-1a 32 of little-endian `crowd.seed` followed by little-endian `index`,
 * then the same xor-fold as `crowdSeed`. Depends only on those two integers.
 */
export function crowdMemberSeed(seed: number, index: number): number {
  const bytes = new Uint8Array(8);
  writeU32(bytes, 0, seed);
  writeU32(bytes, 4, index);
  return fold(fnv1a32(bytes));
}

function emptyRaw(): Record<CrowdRole, number> {
  return {
    farmer: 0,
    merchant: 0,
    smith: 0,
    guard: 0,
    sailor: 0,
    fisher: 0,
    noble: 0,
    pioneer: 0,
    laborer: 0,
    crafter: 0,
  };
}

function addRow(raw: Record<CrowdRole, number>, row: Partial<Record<CrowdRole, number>>): void {
  for (const role of CROWD_ROLES) raw[role] += row[role] ?? 0;
}

function normalize(raw: Record<CrowdRole, number>): CrowdWeight[] {
  let sum = 0;
  for (const role of CROWD_ROLES) sum += raw[role];
  if (sum <= 0) return [{ role: 'laborer', w: 1 }];
  const parts = CROWD_ROLES.map((role, index) => {
    const exact = (raw[role] / sum) * 1000;
    const floor = Math.floor(exact + 1e-9);
    return { role, index, floor, frac: exact - floor, raw: raw[role] };
  });
  let used = 0;
  for (const part of parts) used += part.floor;
  const ranked = parts.filter((part) => part.raw > 0).sort((a, b) => b.frac - a.frac || a.index - b.index);
  let step = 0;
  while (used < 1000 && ranked.length) {
    ranked[step % ranked.length]!.floor += 1;
    used += 1;
    step += 1;
    if (step > 1000) break;
  }
  const mix: CrowdWeight[] = [];
  for (const part of parts) {
    if (part.floor <= 0) continue;
    mix.push({ role: part.role, w: part.floor / 1000 });
  }
  return mix;
}

function isHarbour(specialty: string, kit: string): boolean {
  const tokens = `${specialty} ${kit}`.toLowerCase().split(/[^a-z]+/);
  return tokens.some((token) => HARBOUR_TOKENS.has(token));
}

function fnv1a32(bytes: Uint8Array): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, FNV_PRIME);
  return h >>> 0;
}

function fold(h: number): number {
  return ((h ^ (h >>> 16)) >>> 0) || 1;
}

function writeU32(buf: Uint8Array, offset: number, n: number): void {
  const u = n >>> 0;
  buf[offset] = u & 0xff;
  buf[offset + 1] = (u >>> 8) & 0xff;
  buf[offset + 2] = (u >>> 16) & 0xff;
  buf[offset + 3] = (u >>> 24) & 0xff;
}
