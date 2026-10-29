/**
 * Minigame spawn slots (proposal §8). Data only: no games, no input code.
 * Every rule in minigame-spawn-rules.json is applied, including game ids this
 * file does not know. Schedules stay in hours. Wild slots and ford_crossing
 * are marked peeloff.
 */
import { Rng } from './noise';
import { stageSeed } from './layout-v2';
import { tierAtLeast, type SettlementTierId } from './settlement-tiers';
import rulesFile from './minigame-spawn-rules.json';

export type MinigameScope = 'settlement' | 'wild' | 'event';
export type MinigameAnchor = 'interior' | 'exterior';

export interface MinigameRule {
  gameId: string;
  scope: MinigameScope;
  requires?: {
    tierMin?: SettlementTierId;
    building?: string;
    biome?: string[];
    overlay?: string;
    variant?: string;
    season?: string;
    treeCluster?: number;
  };
  host: { kind: 'building' | 'prop' | 'cell'; kit?: string; anchor: MinigameAnchor; fallbackKit?: string };
  perSettlement?: [number, number];
  perHa?: number;
  schedule?: { hours?: [number, number]; days?: 'all' | number[]; seasons?: string[]; weather?: string[]; event?: string | null };
  stakesByTier?: Partial<Record<SettlementTierId, 1 | 2 | 3 | 4>>;
  weight?: number;
  peeloff?: boolean;
  tags?: string[];
}

export interface MinigameSlot {
  id: string;
  gameId: string;
  scope: MinigameScope;
  host: { kind: 'building' | 'prop' | 'cell'; ref?: string; kit?: string; anchor: MinigameAnchor };
  x: number;
  y: number;
  facing?: 'N' | 'E' | 'S' | 'W';
  radiusM: number;
  schedule: { hours?: [number, number]; days?: 'all' | number[]; seasons?: string[]; weather?: string[]; event?: string | null };
  stakes: 1 | 2 | 3 | 4;
  tags: string[];
  weight: number;
  peeloff?: boolean;
}

export interface SlotHostBuilding {
  id: string;
  specialty: string;
  kit: string;
  x: number;
  y: number;
  facing?: 'N' | 'E' | 'S' | 'W';
}

export interface SlotHostProp {
  id: string;
  kit: string;
  x: number;
  y: number;
}

export interface SlotContext {
  placeSeed: number;
  tier: SettlementTierId | null;
  biome: string;
  variant: string;
  areaHa: number;
  buildings: SlotHostBuilding[];
  props: SlotHostProp[];
  /** Shore cells, forage cells, chop sites, fords. */
  cells: {
    fish: Array<{ x: number; y: number }>;
    forage: Array<{ x: number; y: number }>;
    chop: Array<{ x: number; y: number }>;
    ford: Array<{ x: number; y: number }>;
  };
  /** Extra rules appended by tests. Unknown game ids are not filtered. */
  extraRules?: MinigameRule[];
}

export const MINIGAME_RULES = rulesFile.rules as MinigameRule[];
export const MINIGAME_KIT_VERSION = rulesFile.kitVersion;

export function rollMinigameSlots(ctx: SlotContext, rules: readonly MinigameRule[] = MINIGAME_RULES): MinigameSlot[] {
  const rng = new Rng(stageSeed(ctx.placeSeed, 'minigames'));
  const slots: MinigameSlot[] = [];
  const all = [...rules, ...(ctx.extraRules ?? [])];
  for (const rule of all) {
    if (!matches(rule, ctx)) continue;
    const count = howMany(rule, ctx, rng);
    for (let n = 0; n < count; n++) {
      const slot = place(rule, ctx, n, rng);
      if (slot) slots.push(slot);
    }
  }
  slots.forEach((slot, index) => {
    slot.id = `mg${index}`;
  });
  return slots;
}

function matches(rule: MinigameRule, ctx: SlotContext): boolean {
  const need = rule.requires ?? {};
  if (need.tierMin && (!ctx.tier || !tierAtLeast(ctx.tier, need.tierMin))) return false;
  if (need.variant && need.variant !== ctx.variant) return false;
  if (need.building && !ctx.buildings.some((b) => b.specialty === need.building)) return false;
  if (need.biome && !need.biome.includes(ctx.biome)) return false;
  if (need.overlay === 'water' && !ctx.cells.fish.length) return false;
  if (need.overlay === 'ford' && !ctx.cells.ford.length) return false;
  if (need.treeCluster && !ctx.cells.chop.length) return false;
  return true;
}

function howMany(rule: MinigameRule, ctx: SlotContext, rng: Rng): number {
  if (rule.perSettlement) {
    const [lo, hi] = rule.perSettlement;
    if (hi <= lo) return lo;
    return lo + rng.int(0, hi - lo);
  }
  if (typeof rule.perHa === 'number') {
    return Math.max(1, Math.min(4, Math.round(ctx.areaHa * rule.perHa)));
  }
  return 1;
}

function place(rule: MinigameRule, ctx: SlotContext, index: number, rng: Rng): MinigameSlot | null {
  const stakes = (ctx.tier && rule.stakesByTier?.[ctx.tier]) || rule.stakesByTier?.village || 1;
  const peeloff = rule.scope === 'wild' || rule.gameId === 'ford_crossing' || rule.peeloff === true;
  const tags = [
    ...(ctx.tier ? [`tier:${ctx.tier}`] : []),
    `biome:${ctx.biome}`,
    `variant:${ctx.variant}`,
    ...(rule.tags ?? []),
    ...(rule.requires?.building ? [`bld:${rule.requires.building}`] : []),
  ];
  let host: MinigameSlot['host'] | null = null;
  let x = 0;
  let y = 0;
  let facing: MinigameSlot['facing'];
  if (rule.host.kind === 'building') {
    const matchesBuilding = ctx.buildings.filter((b) => !rule.requires?.building || b.specialty === rule.requires.building);
    const building = matchesBuilding[index % Math.max(1, matchesBuilding.length)];
    if (!building) return null;
    host = { kind: 'building', ref: building.id, kit: building.kit, anchor: rule.host.anchor };
    x = building.x;
    y = building.y;
    facing = building.facing;
  } else if (rule.host.kind === 'prop') {
    const kit = rule.host.kit ?? 'prop_signpost';
    const found = ctx.props.find((p) => p.kit === kit);
    if (found) {
      host = { kind: 'prop', ref: found.id, kit, anchor: rule.host.anchor };
      x = found.x;
      y = found.y;
    } else {
      const cell = cellFor(rule, ctx, index);
      if (!cell) return null;
      host = { kind: 'prop', kit, anchor: rule.host.anchor };
      x = cell.x;
      y = cell.y;
    }
  } else {
    const cell = cellFor(rule, ctx, index);
    if (!cell) return null;
    host = { kind: 'cell', kit: rule.host.kit, anchor: rule.host.anchor };
    x = cell.x;
    y = cell.y;
  }
  void rng;
  const slot: MinigameSlot = {
    id: '',
    gameId: rule.gameId,
    scope: rule.scope,
    host,
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    ...(facing ? { facing } : {}),
    radiusM: rule.scope === 'wild' ? 6 : 4,
    schedule: rule.schedule ?? {},
    stakes,
    tags,
    weight: rule.weight ?? 1,
  };
  if (peeloff) slot.peeloff = true;
  return slot;
}

function cellFor(rule: MinigameRule, ctx: SlotContext, index: number): { x: number; y: number } | null {
  if (rule.gameId === 'wild_fish' || rule.requires?.overlay === 'water') return ctx.cells.fish[index % Math.max(1, ctx.cells.fish.length)] ?? null;
  if (rule.gameId === 'wild_forage') return ctx.cells.forage[index % Math.max(1, ctx.cells.forage.length)] ?? null;
  if (rule.gameId === 'wild_chop' || rule.requires?.treeCluster) return ctx.cells.chop[index % Math.max(1, ctx.cells.chop.length)] ?? null;
  if (rule.gameId === 'ford_crossing' || rule.requires?.overlay === 'ford') return ctx.cells.ford[index % Math.max(1, ctx.cells.ford.length)] ?? null;
  const any = ctx.cells.forage[0] ?? ctx.cells.fish[0] ?? ctx.props[0];
  return any ? { x: any.x, y: any.y } : { x: 0, y: 0 };
}
