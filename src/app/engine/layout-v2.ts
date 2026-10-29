/**
 * Layout v2 (proposal §6), stages 1–13 and 17–19.
 * Deterministic from `placeSeed`: each stage draws `stageSeed(placeSeed, name)`.
 * Roads, the wagon yard, districts, and 3 m lots are placed before buildings.
 * Doors face the lot's road. Drops are counted, never silent.
 * City is stubbed onto the town row. Capital is not placed.
 */
import {
  BuildingRotation,
  Cardinal,
  placedMask,
  rotatedSize,
  rotationForFacing,
  structureBounds,
} from './building-templates';
import {
  KIT_BUILDINGS,
  KitBuilding,
  KitFamily,
  ensureKitTemplate,
  kitBuilding,
  resolveKit,
  styleForBiome,
} from './kit-catalog';
import { Rng } from './noise';
import {
  type SettlementTier,
  type SettlementTierId,
  ROW_LINK_M,
  SIDE_YARD_M,
  TERRACE_RUN_MAX,
  roadForRank,
  tierForKind,
  tierPlacement,
} from './settlement-tiers';
import { worldHeightSampler } from './world-gen';
import {
  Biome,
  MapNode,
  WorldData,
  ZONE_SCALE,
  hasNodeTile,
} from '../models/world.models';

export type PropClass = 'tree' | 'rock' | 'plant' | 'prop' | 'deco' | 'civic' | 'host' | 'hero' | 'fence_post';
export type RespawnKind = 'healer' | 'temple' | 'shrine' | 'campfire';

export interface PlanBuilding {
  catalogId: string;
  legacy: string;
  label: string;
  kit: string;
  family: KitFamily;
  resTier?: 1 | 2 | 3 | 4 | 5;
  specialty: string;
  style: string;
  district: string;
  lot: { x: number; y: number; w: number; d: number };
  frontageRank: number;
  frontage: Cardinal;
  templateId: string;
  rotation: BuildingRotation;
  anchorX: number;
  anchorY: number;
  footW: number;
  footD: number;
  storeys: number;
  /** World-aligned structure box. Spacing checks use this, not the lot. */
  structure: { x: number; y: number; w: number; d: number };
}

export interface PlanProp {
  sprite: string;
  kit: string;
  x: number;
  y: number;
  rot: number;
  scale?: number;
  variant: 'default';
  propClass: PropClass;
}

export interface PlanZone {
  id: string;
  kind: string;
  subtype?: string;
  rect: { x: number; y: number; w: number; d: number };
  slots?: Array<{ x: number; y: number; w: number; d: number; rot: number }>;
}

export interface PlanRoad {
  id: string;
  kind: string;
  rank: number;
  widthM: number;
  surface: number;
  points: [number, number][];
}

export interface RoadPaint {
  gx: number;
  gy: number;
  rank: number;
  surface: number;
  widthM: number;
}

export interface PlanSegment {
  id: string;
  kind: 'fence' | 'hedge' | 'wall' | 'palisade';
  kit: string;
  points: [number, number][];
  gates: number[];
}

export interface SettlementPlan {
  tier: SettlementTierId;
  style: string;
  variant: 'default';
  buildingCount: number;
  dropped: number;
  dropNotes: string[];
  districts: Array<{ id: string; kind: string }>;
  respawnAnchor: { x: number; y: number; kind: RespawnKind };
  roads: PlanRoad[];
  roadCells: RoadPaint[];
  zones: PlanZone[];
  buildings: PlanBuilding[];
  props: PlanProp[];
  segments: PlanSegment[];
  warnings: string[];
  plaza: { x: number; y: number; w: number; d: number } | null;
  notes: string[];
}

const DIRS: ReadonlyArray<readonly [number, number, Cardinal]> = [
  [0, -1, 'N'],
  [1, 0, 'E'],
  [0, 1, 'S'],
  [-1, 0, 'W'],
];

const cache = new Map<string, SettlementPlan | null>();

export function stageSeed(placeSeed: number, stage: string): number {
  let h = (placeSeed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < stage.length; i++) h = Math.imul(h ^ stage.charCodeAt(i), 16777619);
  return ((h ^ (h >>> 16)) >>> 0) || 1;
}

export function settlementPlan(world: WorldData, node: MapNode): SettlementPlan | null {
  const tier = tierForKind(node.kind);
  if (!tier || node.poiKind) return null;
  const key = `${node.id}:${world.seed}:${node.seed}:${node.kind}:${node.tiles?.length ?? 0}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (cache.size > 64) cache.clear();
  const plan = buildPlan(world, node, tier);
  cache.set(key, plan);
  return plan;
}

function buildPlan(world: WorldData, node: MapNode, tierId: SettlementTierId): SettlementPlan {
  const placed = tierPlacement(tierId);
  const row = placed.row;
  const style = styleForBiome(node.biome);
  const rngRoads = new Rng(stageSeed(node.seed, 'roads'));
  const rngLots = new Rng(stageSeed(node.seed, 'lots'));
  void rngLots;
  const rngBld = new Rng(stageSeed(node.seed, 'buildings'));
  const rngProps = new Rng(stageSeed(node.seed, 'street-props'));
  const rngFence = new Rng(stageSeed(node.seed, 'fences'));
  const notes: string[] = [];
  const dropNotes: string[] = [];
  const warnings: string[] = [];
  if (placed.stubbed) {
    notes.push(`${tierId} tier is stubbed in P0; layout uses the ${row.id} row.`);
  }

  const heightAt = worldHeightSampler(world);
  const center = {
    gx: Math.floor((node.cx * ZONE_SCALE) / 3),
    gy: Math.floor((node.cy * ZONE_SCALE) / 3),
  };
  const inNode = nodeCells(node, row.radiusM);
  if (!inNode.has(key(center.gx, center.gy))) inNode.add(key(center.gx, center.gy));

  const blocked = new Set<string>();
  const plazaCells = new Set<string>();
  const plaza = stampPlaza(row, center, inNode, blocked, plazaCells);

  const entries = findEntries(world, node, inNode, center);
  const mainEntry = entries[0] ?? center;
  const roadRank = new Map<string, number>();
  const roads: PlanRoad[] = [];
  let roadIndex = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const rank = i === 0 ? 1 : Math.min(2, row.roads.length > 1 ? 2 : 1);
    const spec = roadForRank(row, rank);
    const path = route(center, entry, inNode, blocked, world, heightAt, node);
    if (!path.length) {
      warnings.push(`road to entry ${i} failed`);
      continue;
    }
    const paint = path.filter((cell) => !plazaCells.has(key(cell.gx, cell.gy)));
    for (const cell of paint) {
      const k = key(cell.gx, cell.gy);
      const prev = roadRank.get(k);
      if (prev === undefined || rank < prev) roadRank.set(k, rank);
      blocked.add(k);
    }
    roads.push({
      id: `r${roadIndex++}`,
      kind: spec.kind,
      rank,
      widthM: spec.widthM,
      surface: spec.surface,
      points: collapse(paint.map((cell) => [cell.gx * 3, cell.gy * 3] as [number, number])),
    });
  }
  if (row.id !== 'camp') {
    const cross = crossRoads(center, inNode, blocked, row);
    for (const path of cross) {
      const spec = roadForRank(row, 2);
      for (const cell of path) {
        const k = key(cell.gx, cell.gy);
        if (!roadRank.has(k)) roadRank.set(k, 2);
        blocked.add(k);
      }
      roads.push({
        id: `r${roadIndex++}`,
        kind: spec.kind,
        rank: 2,
        widthM: spec.widthM,
        surface: spec.surface,
        points: collapse(path.map((cell) => [cell.gx * 3, cell.gy * 3] as [number, number])),
      });
    }
  }

  const roadCells: RoadPaint[] = [];
  for (const [k, rank] of roadRank) {
    const [gx, gy] = k.split(',').map(Number) as [number, number];
    const spec = roadForRank(row, rank === 1 ? 1 : rank >= 3 ? 3 : 2);
    const use = rank === 1 ? roadForRank(row, 1) : spec;
    roadCells.push({ gx: gx!, gy: gy!, rank, surface: use.surface, widthM: use.widthM });
  }

  const wagon = placeWagon(row, mainEntry, center, inNode, blocked, roadRank);
  if (wagon) {
    notes.push(`wagon_yard ${wagon.subtype ?? 'yard'} at the main entry`);
  } else {
    warnings.push('wagon yard missing');
  }

  const districts = [
    { id: 'market', kind: 'market' },
    { id: 'civic', kind: 'civic' },
    { id: 'craft', kind: 'craft' },
    { id: 'residential', kind: 'residential' },
  ];
  const seeds = districtSeeds(center, mainEntry, districts);

  const buildings: PlanBuilding[] = [];
  const props: PlanProp[] = [];
  const target = rollTarget(row, rngBld);
  const required = [...row.required];
  for (const extra of row.requiredAt) {
    if (target >= extra.minBuildings) required.push(extra.id);
  }
  const placeOne = (id: string, bias: 'entry' | 'core' | 'any'): boolean => {
    const spec = kitBuilding(id);
    if (!spec) {
      dropNotes.push(`${id} (unknown catalog id)`);
      return false;
    }
    const lot = findLot(spec, bias, inNode, blocked, roadCells, center, mainEntry, buildings, style, row.rowhouses === true);
    if (!lot) {
      dropNotes.push(`${id} (no lot)`);
      return false;
    }
    const built = occupy(spec, lot, style, seeds);
    buildings.push(built);
    claim(blocked, built.lot);
    return true;
  };

  for (const id of required) {
    const bias = id === 'stables' || id === 'wagonwright' || id === 'smithy' || id === 'barn' ? 'entry' : 'core';
    placeOne(id, bias);
  }
  const optionalPool = row.optional.filter((item) => {
    if (item.minBuildings !== undefined && target < item.minBuildings) return false;
    if (item.maxBuildings !== undefined && target > item.maxBuildings) return false;
    return !buildings.some((b) => b.catalogId === item.id);
  });
  const optionalCap = row.id === 'hamlet' ? 1 : 12;
  let optionalPlaced = 0;
  let guard = 0;
  while (buildings.length < target && optionalPool.length && optionalPlaced < optionalCap && guard++ < 12) {
    const pick = weighted(optionalPool, rngBld);
    if (!pick) break;
    const index = optionalPool.indexOf(pick);
    if (index >= 0) optionalPool.splice(index, 1);
    if (buildings.length >= target) break;
    if (placeOne(pick.id, 'core')) optionalPlaced++;
  }
  const stallTarget =
    row.stalls[1] > 0 ? row.stalls[0] + rngBld.int(0, row.stalls[1] - row.stalls[0]) : 0;
  const stall = kitBuilding('market_stall');
  if (stall && plaza && stallTarget > 0) {
    let placedStalls = 0;
    const edges = plazaEdgeCells(plazaCells, center);
    for (const cell of edges) {
      if (placedStalls >= stallTarget || buildings.length >= Math.max(target, required.length + stallTarget)) break;
      const k = key(cell.gx, cell.gy);
      if (blocked.has(k) && !plazaCells.has(k)) continue;
      if (roadRank.has(k)) continue;
      const frontage = faceToward(cell, center);
      const rotation = rotationForFacing('S', frontage);
      const dim = rotatedSize(stall.plotW, stall.plotD, rotation);
      const origin = stallOrigin(cell, frontage, dim.w, dim.d);
      if (!rectFree(origin.gx, origin.gy, dim.w / 3, dim.d / 3, inNode, blocked, true)) continue;
      const built = occupy(stall, { ...origin, w: dim.w, d: dim.d, frontage, rank: 1 }, style, seeds);
      built.district = 'market';
      buildings.push(built);
      claim(blocked, built.lot);
      placedStalls++;
    }
    if (placedStalls < row.stalls[0]) dropNotes.push(`market_stall ×${row.stalls[0] - placedStalls} (no plaza frontage)`);
  }
  const homeIds = Object.keys(row.homes);
  let homeGuard = 0;
  while (buildings.length < target && homeIds.length && homeGuard++ < target + 8) {
    const id = weightedHome(row.homes, rngBld);
    const order = [id, ...homeIds.filter((home) => home !== id)].sort((a, b) => footprint(b) - footprint(a));
    let placedHome = false;
    for (const home of order) {
      if (placeOne(home, 'any')) {
        placedHome = true;
        break;
      }
    }
    if (!placedHome) break;
  }
  if (buildings.length < row.buildings[0]) {
    warnings.push(`building count ${buildings.length} is under ${row.id} minimum ${row.buildings[0]}`);
  }

  yardProps(buildings, props, rngProps);
  civicProps(row, plaza, center, props, buildings);
  if (wagon) wagonProps(wagon, props, rngProps);
  const fenceName = row.fences.length ? rngFence.pick(row.fences) : '';
  const segments = fenceName ? fencesFor(buildings, fenceName) : [];
  streetProps(row, roadCells, plaza, props, rngProps);
  dedupeProps(props);

  const respawnAnchor = respawnFor(row, buildings, props, center);
  const reachable = reaches(respawnAnchor, roadCells, plazaCells, wagon, buildings);
  if (!reachable) warnings.push('respawn unreachable from the main entry');
  if (row.wagon === 'yard' && wagon) {
    const wide = wagonTouchesWideRoad(wagon, roadCells);
    if (!wide) warnings.push('wagon yard access is under 3 m');
  }

  const zones: PlanZone[] = [];
  if (plaza) {
    zones.push({
      id: plaza.kind === 'plaza' ? 'plaza' : 'green',
      kind: plaza.kind === 'plaza' ? 'plaza' : 'green',
      rect: { x: plaza.x, y: plaza.y, w: plaza.w, d: plaza.d },
    });
  }
  if (wagon) zones.push(wagon);
  for (const district of districts) {
    const lots = buildings.filter((b) => b.district === district.id);
    if (!lots.length) continue;
    zones.push({ id: district.id, kind: 'district', subtype: district.kind, rect: boundsOf(lots.map((b) => b.lot)) });
  }

  const overlap = lotOverlaps(buildings);
  if (overlap) warnings.push(`overlap ${overlap}`);
  for (const building of buildings) {
    if (building.lot.x % 3 || building.lot.y % 3 || building.lot.w % 3 || building.lot.d % 3) {
      warnings.push(`off-grid ${building.catalogId}`);
    }
  }

  return {
    tier: tierId,
    style,
    variant: 'default',
    buildingCount: buildings.length,
    dropped: dropNotes.length,
    dropNotes,
    districts: districts.filter((d) => buildings.some((b) => b.district === d.id)),
    respawnAnchor,
    roads: roads.filter((road) => road.points.length >= 2),
    roadCells,
    zones,
    buildings,
    props,
    segments,
    warnings,
    plaza: plaza ? { x: plaza.x, y: plaza.y, w: plaza.w, d: plaza.d } : null,
    notes,
  };
}

function key(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

function nodeCells(node: MapNode, radiusM: number): Set<string> {
  const cells = new Set<string>();
  const cx = node.cx * ZONE_SCALE;
  const cy = node.cy * ZONE_SCALE;
  for (const tile of node.tiles ?? []) {
    const x0 = Math.floor((tile.x * ZONE_SCALE) / 3);
    const y0 = Math.floor((tile.y * ZONE_SCALE) / 3);
    const x1 = Math.floor(((tile.x + 1) * ZONE_SCALE - 1) / 3);
    const y1 = Math.floor(((tile.y + 1) * ZONE_SCALE - 1) / 3);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const mx = gx * 3 + 1.5;
        const my = gy * 3 + 1.5;
        if (Math.hypot(mx - cx, my - cy) > radiusM) continue;
        const wx = Math.floor(mx / ZONE_SCALE);
        const wy = Math.floor(my / ZONE_SCALE);
        if (!hasNodeTile(node, wx, wy)) continue;
        cells.add(key(gx, gy));
      }
    }
  }
  return cells;
}

function stampPlaza(
  row: SettlementTier,
  center: { gx: number; gy: number },
  inNode: Set<string>,
  blocked: Set<string>,
  plazaCells: Set<string>,
): { x: number; y: number; w: number; d: number; kind: string } | null {
  if (!row.plaza) return null;
  const wCells = Math.max(1, Math.round(row.plaza.w / 3));
  const dCells = Math.max(1, Math.round(row.plaza.d / 3));
  const gx0 = center.gx - Math.floor(wCells / 2);
  const gy0 = center.gy - Math.floor(dCells / 2);
  for (let gy = gy0; gy < gy0 + dCells; gy++) {
    for (let gx = gx0; gx < gx0 + wCells; gx++) {
      const k = key(gx, gy);
      if (!inNode.has(k)) continue;
      plazaCells.add(k);
      blocked.add(k);
    }
  }
  return { x: gx0 * 3, y: gy0 * 3, w: wCells * 3, d: dCells * 3, kind: row.plaza.kind };
}

function findEntries(
  world: WorldData,
  node: MapNode,
  inNode: Set<string>,
  center: { gx: number; gy: number },
): Array<{ gx: number; gy: number }> {
  const tiles = node.tiles ?? [];
  const inside = new Set(tiles.map((t) => `${t.x},${t.y}`));
  const gates: Array<{ x: number; y: number; score: number }> = [];
  for (const tile of tiles) {
    if (!worldPath(world, tile.x, tile.y)) continue;
    let outside = 0;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      if (!inside.has(`${nx},${ny}`)) outside += worldPath(world, nx, ny) ? 2 : 1;
    }
    if (outside > 0) gates.push({ x: tile.x, y: tile.y, score: outside });
  }
  gates.sort((a, b) => b.score - a.score || b.y - a.y || a.x - b.x);
  const picked: Array<{ gx: number; gy: number }> = [];
  for (const gate of gates) {
    const cell = nearestInside(Math.floor(((gate.x + 0.5) * ZONE_SCALE) / 3), Math.floor(((gate.y + 0.5) * ZONE_SCALE) / 3), inNode);
    if (!cell) continue;
    if (picked.some((p) => Math.abs(p.gx - cell.gx) + Math.abs(p.gy - cell.gy) < 4)) continue;
    picked.push(cell);
    if (picked.length >= 4) break;
  }
  if (!picked.length) {
    let best: { gx: number; gy: number } | null = null;
    let bestD = -1;
    for (const k of inNode) {
      const [gx, gy] = k.split(',').map(Number) as [number, number];
      const dist = Math.abs(gx! - center.gx) + Math.abs(gy! - center.gy);
      if (dist > bestD) {
        bestD = dist;
        best = { gx: gx!, gy: gy! };
      }
    }
    if (best) picked.push(best);
  }
  return picked;
}

function nearestInside(gx: number, gy: number, inNode: Set<string>): { gx: number; gy: number } | null {
  if (inNode.has(key(gx, gy))) return { gx, gy };
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (inNode.has(key(gx + dx, gy + dy))) return { gx: gx + dx, gy: gy + dy };
      }
    }
  }
  return null;
}

function worldPath(world: WorldData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  return world.paths[x + y * world.width] === 1;
}

function route(
  center: { gx: number; gy: number },
  goal: { gx: number; gy: number },
  inNode: Set<string>,
  blocked: Set<string>,
  world: WorldData,
  heightAt: (x: number, y: number) => number,
  node: MapNode,
): Array<{ gx: number; gy: number }> {
  const start = nearestInside(center.gx, center.gy, inNode) ?? center;
  const path = astar(start, goal, inNode, blocked, world, heightAt);
  if (path && path.length) return path;
  return bresenham(start, goal, inNode, node);
}

function astar(
  start: { gx: number; gy: number },
  goal: { gx: number; gy: number },
  inNode: Set<string>,
  blocked: Set<string>,
  world: WorldData,
  heightAt: (x: number, y: number) => number,
): Array<{ gx: number; gy: number }> | null {
  const h = (gx: number, gy: number) => Math.abs(gx - goal.gx) + Math.abs(gy - goal.gy);
  type Node = { gx: number; gy: number; g: number; f: number };
  const open: Node[] = [{ gx: start.gx, gy: start.gy, g: 0, f: h(start.gx, start.gy) }];
  const best = new Map<string, number>([[key(start.gx, start.gy), 0]]);
  const prev = new Map<string, string>();
  let guard = 0;
  while (open.length && guard++ < 8000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    if (cur.gx === goal.gx && cur.gy === goal.gy) {
      const out: Array<{ gx: number; gy: number }> = [];
      let k = key(cur.gx, cur.gy);
      while (k) {
        const [gx, gy] = k.split(',').map(Number) as [number, number];
        out.push({ gx: gx!, gy: gy! });
        k = prev.get(k) ?? '';
      }
      return out.reverse();
    }
    for (const [dx, dy] of DIRS) {
      const nx = cur.gx + dx;
      const ny = cur.gy + dy;
      const nk = key(nx, ny);
      if (!inNode.has(nk)) continue;
      const mx = (nx * 3 + 1.5) / ZONE_SCALE;
      const my = (ny * 3 + 1.5) / ZONE_SCALE;
      const wx = Math.floor(mx);
      const wy = Math.floor(my);
      const water =
        wx >= 0 && wy >= 0 && wx < world.width && wy < world.height && world.biomes[wx + wy * world.width] === Biome.Water;
      const slope = Math.abs(
        heightAt(mx, my) - heightAt((cur.gx * 3 + 1.5) / ZONE_SCALE, (cur.gy * 3 + 1.5) / ZONE_SCALE),
      );
      const step = 1 + slope * 6 + (water ? 12 : 0) + (blocked.has(nk) ? 4 : 0);
      const ng = cur.g + step;
      if (ng >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, ng);
      prev.set(nk, key(cur.gx, cur.gy));
      open.push({ gx: nx, gy: ny, g: ng, f: ng + h(nx, ny) });
    }
  }
  return null;
}

function bresenham(
  a: { gx: number; gy: number },
  b: { gx: number; gy: number },
  inNode: Set<string>,
  _node: MapNode,
): Array<{ gx: number; gy: number }> {
  const out: Array<{ gx: number; gy: number }> = [];
  let x = a.gx;
  let y = a.gy;
  const dx = Math.abs(b.gx - a.gx);
  const dy = Math.abs(b.gy - a.gy);
  const sx = a.gx < b.gx ? 1 : -1;
  const sy = a.gy < b.gy ? 1 : -1;
  let err = dx - dy;
  for (let i = 0; i < 400; i++) {
    if (inNode.has(key(x, y))) out.push({ gx: x, gy: y });
    if (x === b.gx && y === b.gy) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

function crossRoads(
  center: { gx: number; gy: number },
  inNode: Set<string>,
  blocked: Set<string>,
  row: SettlementTier,
): Array<Array<{ gx: number; gy: number }>> {
  if (row.id === 'hamlet' || row.id === 'camp') return [];
  const arms: Array<Array<{ gx: number; gy: number }>> = [];
  for (const [dx, dy] of DIRS) {
    const arm: Array<{ gx: number; gy: number }> = [];
    for (let step = 1; step <= 8; step++) {
      const gx = center.gx + dx * step;
      const gy = center.gy + dy * step;
      const k = key(gx, gy);
      if (!inNode.has(k)) break;
      if (!blocked.has(k)) arm.push({ gx, gy });
    }
    if (arm.length) arms.push(arm);
  }
  return arms;
}

function placeWagon(
  row: SettlementTier,
  entry: { gx: number; gy: number },
  center: { gx: number; gy: number },
  inNode: Set<string>,
  blocked: Set<string>,
  roadRank: Map<string, number>,
): PlanZone | null {
  const wCells = Math.max(1, Math.round(row.wagonSize.w / 3));
  const dCells = Math.max(1, Math.round(row.wagonSize.d / 3));
  const dx = Math.sign(entry.gx - center.gx);
  const dy = Math.sign(entry.gy - center.gy);
  const candidates: Array<{ gx: number; gy: number }> = [];
  for (let step = 1; step <= 8; step++) {
    candidates.push({ gx: entry.gx - dx * step, gy: entry.gy - dy * step });
    candidates.push({ gx: entry.gx, gy: entry.gy });
  }
  const sides: Array<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const spot of candidates) {
    for (const [sx, sy] of sides) {
      const gx0 = spot.gx + sx;
      const gy0 = spot.gy + sy;
      if (!rectIn(gx0, gy0, wCells, dCells, inNode)) continue;
      let hitsRoad = false;
      for (let y = 0; y < dCells && !hitsRoad; y++) {
        for (let x = 0; x < wCells; x++) {
          if (roadRank.has(key(gx0 + x, gy0 + y))) {
            hitsRoad = true;
            break;
          }
        }
      }
      if (hitsRoad) continue;
      const touches = touchesRank(gx0, gy0, wCells, dCells, roadRank, 1) || row.wagon === 'circle';
      if (!touches && !touchesRank(gx0, gy0, wCells, dCells, roadRank, 2)) continue;
      for (let y = 0; y < dCells; y++) {
        for (let x = 0; x < wCells; x++) blocked.add(key(gx0 + x, gy0 + y));
      }
      const slots = row.wagon === 'yard' ? wagonSlots(gx0 * 3, gy0 * 3, wCells * 3, dCells * 3) : [];
      return {
        id: 'wagon-yard',
        kind: 'wagon_yard',
        subtype: row.wagon === 'circle' ? 'circle' : 'yard',
        rect: { x: gx0 * 3, y: gy0 * 3, w: wCells * 3, d: dCells * 3 },
        slots,
      };
    }
  }
  return null;
}

function rectIn(gx: number, gy: number, w: number, d: number, inNode: Set<string>): boolean {
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < w; x++) if (!inNode.has(key(gx + x, gy + y))) return false;
  }
  return w > 0 && d > 0;
}

function touchesRank(
  gx: number,
  gy: number,
  w: number,
  d: number,
  roadRank: Map<string, number>,
  rank: number,
): boolean {
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < w; x++) {
      for (const [dx, dy] of DIRS) {
        if (roadRank.get(key(gx + x + dx, gy + y + dy)) === rank) return true;
      }
    }
  }
  return false;
}

function wagonSlots(x: number, y: number, w: number, d: number): Array<{ x: number; y: number; w: number; d: number; rot: number }> {
  const alongX = w >= d;
  const slots: Array<{ x: number; y: number; w: number; d: number; rot: number }> = [];
  if (alongX) {
    const n = Math.min(6, Math.floor(w / 3));
    const rows = Math.min(2, Math.floor(d / 6));
    for (let row = 0; row < Math.max(1, rows); row++) {
      for (let i = 0; i < n && slots.length < 6; i++) {
        slots.push({ x: x + i * 3 + 1.5, y: y + row * 6 + 3, w: 3, d: 6, rot: 0 });
      }
    }
  } else {
    const n = Math.min(6, Math.floor(d / 3));
    for (let i = 0; i < n; i++) slots.push({ x: x + 3, y: y + i * 3 + 1.5, w: 6, d: 3, rot: 90 });
  }
  return slots.slice(0, 6);
}

function districtSeeds(
  center: { gx: number; gy: number },
  entry: { gx: number; gy: number },
  districts: Array<{ id: string; kind: string }>,
): Array<{ id: string; gx: number; gy: number }> {
  return districts.map((d) => {
    if (d.kind === 'market' || d.kind === 'civic') return { id: d.id, gx: center.gx + (d.kind === 'civic' ? 2 : 0), gy: center.gy };
    if (d.kind === 'craft') return { id: d.id, gx: entry.gx, gy: entry.gy };
    return { id: d.id, gx: center.gx - (entry.gx - center.gx), gy: center.gy - (entry.gy - center.gy) };
  });
}

function rollTarget(row: SettlementTier, rng: Rng): number {
  const [lo, hi] = row.buildings;
  if (hi <= lo) return lo;
  return lo + rng.int(0, hi - lo);
}

interface LotHit {
  gx: number;
  gy: number;
  w: number;
  d: number;
  frontage: Cardinal;
  rank: number;
}

function structureBox(
  spec: KitBuilding,
  lot: LotHit,
  style: string,
): { x: number; y: number; w: number; d: number } {
  const id = ensureKitTemplate(spec, style);
  const rotation = rotationForFacing('S', lot.frontage);
  const mask = placedMask(id, rotation);
  const plotX = lot.gx * 3;
  const plotY = lot.gy * 3;
  if (!mask) return { x: plotX, y: plotY, w: lot.w, d: lot.d };
  const bounds = structureBounds(mask.parts, mask.w, mask.d);
  return { x: plotX + bounds.x, y: plotY + bounds.y, w: bounds.w, d: bounds.d };
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

function detachedHome(spec: KitBuilding): boolean {
  return spec.family === 'res' && spec.id !== 'townhouse';
}

function sameRun(
  a: { x: number; y: number; w: number; d: number },
  aFront: Cardinal,
  b: { x: number; y: number; w: number; d: number },
  bFront: Cardinal,
): boolean {
  if (aFront !== bFront) return false;
  if (boxGap(a, b) > ROW_LINK_M) return false;
  if (aFront === 'N' || aFront === 'S') return a.y < b.y + b.d && b.y < a.y + a.d;
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

/** Houses along one frontage, including a 3 m side yard, count as one run. */
function rowRunSize(
  buildings: PlanBuilding[],
  box: { x: number; y: number; w: number; d: number },
  frontage: Cardinal,
): number {
  const houses = buildings.filter((building) => building.family === 'res');
  const seen = new Set<PlanBuilding>();
  const queue = houses.filter((building) => sameRun(box, frontage, building.structure, building.frontage));
  for (const building of queue) seen.add(building);
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    for (const other of houses) {
      if (seen.has(other)) continue;
      if (!sameRun(cur.structure, cur.frontage, other.structure, other.frontage)) continue;
      seen.add(other);
      queue.push(other);
    }
  }
  return seen.size;
}

/** Detached houses keep a side yard. Rows stop at the terrace cap unless the tier wants rowhouses. */
function spacingOk(
  spec: KitBuilding,
  box: { x: number; y: number; w: number; d: number },
  frontage: Cardinal,
  buildings: PlanBuilding[],
  allowTerrace: boolean,
): boolean {
  if (detachedHome(spec) && buildings.some((other) => boxGap(box, other.structure) < SIDE_YARD_M)) return false;
  if (spec.id === 'townhouse') {
    for (const other of buildings) {
      if (other.catalogId === 'townhouse') continue;
      if (boxGap(box, other.structure) < SIDE_YARD_M) return false;
    }
  }
  if (spec.family !== 'res' || allowTerrace) return true;
  return rowRunSize(buildings, box, frontage) + 1 <= TERRACE_RUN_MAX;
}

function dedupeProps(props: PlanProp[]): void {
  const seen = new Set<string>();
  let write = 0;
  for (const prop of props) {
    const key = `${prop.kit}@${prop.x},${prop.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    props[write++] = prop;
  }
  props.length = write;
}

function findLot(
  spec: KitBuilding,
  bias: 'entry' | 'core' | 'any',
  inNode: Set<string>,
  blocked: Set<string>,
  roads: RoadPaint[],
  center: { gx: number; gy: number },
  entry: { gx: number; gy: number },
  buildings: PlanBuilding[],
  style: string,
  allowTerrace: boolean,
): LotHit | null {
  let best: LotHit | null = null;
  let bestScore = Infinity;
  const roadsSorted = roads.slice().sort((a, b) => a.rank - b.rank || a.gy - b.gy || a.gx - b.gx);
  for (const road of roadsSorted) {
    if (bias === 'entry' && road.rank !== 1) continue;
    for (const side of ['N', 'E', 'S', 'W'] as const) {
      const frontage = opposite(side);
      const rotation = rotationForFacing('S', frontage);
      const dim = rotatedSize(spec.plotW, spec.plotD, rotation);
      if (dim.w % 3 || dim.d % 3) continue;
      const origin = lotOrigin(road.gx, road.gy, side, dim.w, dim.d);
      const wCells = dim.w / 3;
      const dCells = dim.d / 3;
      if (!rectFree(origin.gx, origin.gy, wCells, dCells, inNode, blocked, false)) continue;
      const hit: LotHit = { gx: origin.gx, gy: origin.gy, w: dim.w, d: dim.d, frontage, rank: road.rank };
      if (!spacingOk(spec, structureBox(spec, hit, style), hit.frontage, buildings, allowTerrace)) continue;
      const score =
        (bias === 'entry' ? Math.abs(origin.gx - entry.gx) + Math.abs(origin.gy - entry.gy) : 0) +
        (bias === 'core' ? Math.abs(origin.gx - center.gx) + Math.abs(origin.gy - center.gy) : 0) +
        road.rank * 100;
      if (score < bestScore) {
        bestScore = score;
        best = { gx: origin.gx, gy: origin.gy, w: dim.w, d: dim.d, frontage, rank: road.rank };
      }
    }
  }
  return best;
}

function opposite(side: Cardinal): Cardinal {
  if (side === 'N') return 'S';
  if (side === 'S') return 'N';
  if (side === 'E') return 'W';
  return 'E';
}

function lotOrigin(gx: number, gy: number, side: Cardinal, w: number, d: number): { gx: number; gy: number } {
  const wCells = w / 3;
  const dCells = d / 3;
  if (side === 'N') return { gx: gx - Math.floor((wCells - 1) / 2), gy: gy - dCells };
  if (side === 'S') return { gx: gx - Math.floor((wCells - 1) / 2), gy: gy + 1 };
  if (side === 'E') return { gx: gx + 1, gy: gy - Math.floor((dCells - 1) / 2) };
  return { gx: gx - wCells, gy: gy - Math.floor((dCells - 1) / 2) };
}

function rectFree(
  gx: number,
  gy: number,
  w: number,
  d: number,
  inNode: Set<string>,
  blocked: Set<string>,
  allowPlaza: boolean,
): boolean {
  if (w <= 0 || d <= 0) return false;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < w; x++) {
      const k = key(gx + x, gy + y);
      if (!inNode.has(k)) return false;
      if (blocked.has(k) && !allowPlaza) return false;
    }
  }
  return true;
}

function occupy(
  spec: KitBuilding,
  lot: LotHit,
  style: string,
  seeds: Array<{ id: string; gx: number; gy: number }>,
): PlanBuilding {
  const templateId = ensureKitTemplate(spec, style);
  const rotation = rotationForFacing('S', lot.frontage);
  const mx = lot.gx * 3 + lot.w / 2;
  const my = lot.gy * 3 + lot.d / 2;
  let district = 'residential';
  let best = Infinity;
  for (const seed of seeds) {
    const dist = Math.abs(seed.gx * 3 - mx) + Math.abs(seed.gy * 3 - my);
    if (dist < best) {
      best = dist;
      district = seed.id;
    }
  }
  if (spec.family === 'res') district = 'residential';
  if (spec.family === 'civic') district = 'civic';
  if (spec.id === 'market_stall' || spec.id === 'tavern' || spec.id === 'general_store') district = 'market';
  if (spec.family === 'work' || spec.family === 'farm') district = 'craft';
  const structure = structureBox(spec, lot, style);
  return {
    catalogId: spec.id,
    legacy: spec.legacy,
    label: spec.label,
    kit: resolveKit(spec.kit, style),
    family: spec.family,
    ...(spec.resTier ? { resTier: spec.resTier } : {}),
    specialty: spec.id,
    style,
    district,
    lot: { x: lot.gx * 3, y: lot.gy * 3, w: lot.w, d: lot.d },
    frontageRank: lot.rank,
    frontage: lot.frontage,
    templateId,
    rotation,
    anchorX: lot.gx * 3 + lot.w / 2,
    anchorY: lot.gy * 3 + lot.d - 0.01,
    footW: lot.w,
    footD: lot.d,
    storeys: spec.storeys,
    structure,
  };
}

function claim(blocked: Set<string>, lot: { x: number; y: number; w: number; d: number }): void {
  const gx0 = lot.x / 3;
  const gy0 = lot.y / 3;
  for (let y = 0; y < lot.d / 3; y++) {
    for (let x = 0; x < lot.w / 3; x++) blocked.add(key(gx0 + x, gy0 + y));
  }
}

function weighted<T extends { w: number }>(items: T[], rng: Rng): T | null {
  const sum = items.reduce((n, item) => n + item.w, 0);
  if (sum <= 0) return null;
  let roll = rng.range(0, sum);
  for (const item of items) {
    roll -= item.w;
    if (roll < 0) return item;
  }
  return items[items.length - 1] ?? null;
}

function weightedHome(weights: Record<string, number>, rng: Rng): string {
  const items = Object.entries(weights).map(([id, w]) => ({ id, w }));
  return weighted(items, rng)?.id ?? items[0]?.id ?? 'cottage';
}

function footprint(id: string): number {
  const spec = kitBuilding(id);
  return spec ? spec.plotW * spec.plotD : 0;
}

function faceToward(cell: { gx: number; gy: number }, center: { gx: number; gy: number }): Cardinal {
  const dx = center.gx - cell.gx;
  const dy = center.gy - cell.gy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'E' : 'W';
  return dy > 0 ? 'S' : 'N';
}

function stallOrigin(cell: { gx: number; gy: number }, frontage: Cardinal, w: number, d: number): LotHit {
  const wCells = w / 3;
  const dCells = d / 3;
  let gx = cell.gx;
  let gy = cell.gy;
  if (frontage === 'S') gy = cell.gy - (dCells - 1);
  else if (frontage === 'E') gx = cell.gx - (wCells - 1);
  else if (frontage === 'N') gy = cell.gy;
  else gx = cell.gx;
  return { gx, gy, w, d, frontage, rank: 1 };
}

function plazaEdgeCells(plaza: Set<string>, center: { gx: number; gy: number }): Array<{ gx: number; gy: number }> {
  const out: Array<{ gx: number; gy: number }> = [];
  for (const k of plaza) {
    const [gx, gy] = k.split(',').map(Number) as [number, number];
    const edge = DIRS.some(([dx, dy]) => !plaza.has(key(gx! + dx, gy! + dy)));
    const central = Math.abs(gx! - center.gx) + Math.abs(gy! - center.gy) <= 1;
    if (edge && !central) out.push({ gx: gx!, gy: gy! });
  }
  out.sort((a, b) => a.gy - b.gy || a.gx - b.gx);
  return out;
}

const YARD: Record<string, string[]> = {
  smithy: ['prop_anvil', 'prop_quench_barrel', 'prop_grindstone'],
  tavern: ['prop_bench_1.5m', 'prop_keg_stack', 'prop_lantern_post'],
  stables: ['prop_trough'],
  wagonwright: ['prop_cart_wood'],
};

function yardProps(buildings: PlanBuilding[], props: PlanProp[], rng: Rng): void {
  for (const building of buildings) {
    const kits = YARD[building.catalogId];
    if (!kits) continue;
    kits.forEach((kit, index) => {
      const point = inset(building, 1.5 + index * 1.5);
      props.push({
        sprite: spriteForKit(kit),
        kit,
        x: round1(point.x),
        y: round1(point.y),
        rot: rng.pick([0, 90, 180, 270]),
        variant: 'default',
        propClass: 'prop',
      });
    });
  }
}

function inset(building: PlanBuilding, dist: number): { x: number; y: number } {
  const lot = building.lot;
  const cx = lot.x + lot.w / 2;
  const cy = lot.y + lot.d / 2;
  if (building.frontage === 'S') return { x: cx, y: lot.y + dist };
  if (building.frontage === 'N') return { x: cx, y: lot.y + lot.d - dist };
  if (building.frontage === 'E') return { x: lot.x + dist, y: cy };
  return { x: lot.x + lot.w - dist, y: cy };
}

function civicProps(
  row: SettlementTier,
  plaza: { x: number; y: number; w: number; d: number; kind: string } | null,
  center: { gx: number; gy: number },
  props: PlanProp[],
  buildings: PlanBuilding[],
): void {
  const cx = (plaza ? plaza.x + plaza.w / 2 : center.gx * 3 + 1.5);
  const cy = (plaza ? plaza.y + plaza.d / 2 : center.gy * 3 + 1.5);
  if (row.respawn === 'campfire' || row.id === 'hamlet' || row.id === 'camp') {
    props.push(propAt('prop_campfire', 'campfire', cx + 1.5, cy, 0, 'prop'));
  }
  if (row.id === 'camp') {
    props.push(propAt('prop_well_simple', 'well', cx - 3, cy, 0, 'civic'));
    props.push(propAt('prop_notice_board', 'notice', cx, cy + 3, 0, 'civic'));
    props.push(propAt('prop_cart_wood', 'cart', cx + 3, cy + 1.5, 90, 'prop'));
    return;
  }
  const well = row.id === 'hamlet' ? 'prop_well_simple' : 'prop_well_roofed';
  props.push(propAt(well, 'well', cx - 1.5, cy + 1.5, 0, 'civic'));
  if (row.id !== 'hamlet') props.push(propAt('prop_notice_board', 'notice', cx + 3, cy, 0, 'civic'));
  if (row.respawn === 'shrine' || row.id === 'hamlet') {
    props.push(propAt('deco_shrine_wayside', 'shrine', cx, cy - 1.5, 0, 'deco'));
  }
  if (row.id === 'town') {
    props.push(propAt('deco_fountain_s_3x3', 'fountain', cx, cy, 0, 'deco'));
    props.push(propAt('deco_statue_s', 'statue', cx, cy - 3, 0, 'deco'));
  }
  void buildings;
}

function wagonProps(wagon: PlanZone, props: PlanProp[], rng: Rng): void {
  props.push(propAt('prop_hitching_rail_3m', 'rail', wagon.rect.x + 1.5, wagon.rect.y + 1.5, 0, 'prop'));
  props.push(propAt('prop_trough', 'trough', wagon.rect.x + wagon.rect.w - 1.5, wagon.rect.y + 1.5, 0, 'prop'));
  const slots = wagon.slots ?? [];
  slots.forEach((slot, index) => {
    if (index % 2 === 1) return;
    if (rng.chance(0.15) && index > 0) return;
    props.push(propAt('prop_cart_wood', 'cart', slot.x, slot.y, slot.rot, 'prop'));
  });
  if (wagon.subtype === 'circle' && !slots.length) {
    props.push(propAt('prop_cart_wood', 'cart', wagon.rect.x + wagon.rect.w / 2, wagon.rect.y + wagon.rect.d / 2, 0, 'prop'));
  }
}

function propAt(kit: string, sprite: string, x: number, y: number, rot: number, propClass: PropClass): PlanProp {
  return { sprite, kit, x: round1(x), y: round1(y), rot, variant: 'default', propClass };
}

function spriteForKit(kit: string): string {
  if (kit.includes('bench')) return 'bench';
  if (kit.includes('lantern') || kit.includes('lamp')) return 'lantern';
  if (kit.includes('anvil') || kit.includes('cart')) return 'market';
  return kit;
}

const FENCE_KIT: Record<string, { run: string; gate: string; kind: PlanSegment['kind'] }> = {
  picket: { run: 'prop_fence_picket_3m', gate: 'prop_fence_picket_gate_1.5m', kind: 'fence' },
  wattle: { run: 'prop_fence_wattle_3m', gate: 'prop_fence_wattle_gate_1.5m', kind: 'fence' },
  split_rail: { run: 'prop_fence_split_rail_3m', gate: 'prop_fence_split_rail_gate_1.5m', kind: 'fence' },
  stone_wall_low: { run: 'prop_fence_stone_wall_low_3m', gate: 'prop_fence_stone_wall_low_gate_1.5m', kind: 'fence' },
  hedge: { run: 'prop_fence_hedge_3m', gate: 'prop_fence_hedge_gate_1.5m', kind: 'hedge' },
};

function fencesFor(buildings: PlanBuilding[], fenceName: string): PlanSegment[] {
  const fence = FENCE_KIT[fenceName];
  if (!fence) return [];
  const segments: PlanSegment[] = [];
  for (const building of buildings) {
    const fenced = (building.resTier ?? 0) >= 2 || building.family === 'farm';
    if (!fenced) continue;
    const frontToo = building.resTier === 2 || building.resTier === 4;
    for (const edge of edges(building.lot)) {
      if (edge.side === building.frontage && !frontToo) continue;
      const gates: number[] = [];
      if (edge.side === building.frontage) gates.push(Math.floor((edge.points.length - 2) / 2));
      segments.push({
        id: `seg${segments.length}`,
        kind: fence.kind,
        kit: gates.length ? fence.gate : fence.run,
        points: edge.points,
        gates,
      });
    }
  }
  return segments;
}

function edges(lot: { x: number; y: number; w: number; d: number }): Array<{ side: Cardinal; points: [number, number][] }> {
  const span = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
    const points: [number, number][] = [];
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 3));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
    return points;
  };
  return [
    { side: 'N', points: span(lot.x, lot.y, lot.x + lot.w, lot.y) },
    { side: 'E', points: span(lot.x + lot.w, lot.y, lot.x + lot.w, lot.y + lot.d) },
    { side: 'S', points: span(lot.x, lot.y + lot.d, lot.x + lot.w, lot.y + lot.d) },
    { side: 'W', points: span(lot.x, lot.y, lot.x, lot.y + lot.d) },
  ];
}

function streetProps(row: SettlementTier, roads: RoadPaint[], plaza: { x: number; y: number; w: number; d: number } | null, props: PlanProp[], rng: Rng): void {
  if (row.street.lamps) {
    const main = roads.filter((cell) => cell.rank === 1).sort((a, b) => a.gy - b.gy || a.gx - b.gx);
    for (let i = 0; i < main.length; i += 4) {
      const cell = main[i]!;
      props.push(propAt('prop_lantern_post', 'lantern', cell.gx * 3 + 1.5, cell.gy * 3 + 1.5, rng.pick([0, 90, 180, 270]), 'deco'));
    }
  }
  if (plaza && row.street.benches > 0) {
    const yEdges = [plaza.y + plaza.d - 1.5, plaza.y + 1.5];
    let placed = 0;
    for (const y of yEdges) {
      const room = Math.max(1, Math.floor(Math.max(0, plaza.w - 3) / 3) + 1);
      const count = Math.min(room, row.street.benches - placed);
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : i / (count - 1);
        const x = plaza.x + 1.5 + t * Math.max(0, plaza.w - 3);
        props.push(propAt('prop_bench_1.5m', 'bench', x, y, 0, 'deco'));
        placed++;
      }
      if (placed >= row.street.benches) break;
    }
  }
  if (row.street.signposts) {
    for (const cell of roads) {
      let n = 0;
      for (const [dx, dy] of DIRS) {
        if (roads.some((other) => other.gx === cell.gx + dx && other.gy === cell.gy + dy)) n++;
      }
      if (n >= 3) props.push(propAt('prop_signpost', 'signpost', cell.gx * 3 + 1.5, cell.gy * 3 + 0.5, 0, 'prop'));
    }
  }
}

function respawnFor(row: SettlementTier, buildings: PlanBuilding[], props: PlanProp[], center: { gx: number; gy: number }): { x: number; y: number; kind: RespawnKind } {
  const doorOf = (id: string): { x: number; y: number } | null => {
    const building = buildings.find((b) => b.catalogId === id);
    if (!building) return null;
    return doorPoint(building);
  };
  if (row.respawn === 'healer') {
    const healer = doorOf('healer') ?? doorOf('temple') ?? doorOf('temple_small');
    if (healer) return { ...healer, kind: buildings.some((b) => b.catalogId === 'healer') ? 'healer' : 'temple' };
  }
  if (row.respawn === 'shrine' || row.id === 'village') {
    const shrine = props.find((p) => p.kit === 'deco_shrine_wayside');
    if (shrine) return { x: shrine.x, y: shrine.y, kind: 'shrine' };
    const temple = doorOf('temple_small') ?? doorOf('temple');
    if (temple) return { ...temple, kind: 'temple' };
  }
  const fire = props.find((p) => p.kit === 'prop_campfire');
  if (fire) return { x: fire.x, y: fire.y, kind: 'campfire' };
  return { x: center.gx * 3 + 1.5, y: center.gy * 3 + 1.5, kind: 'campfire' };
}

function doorPoint(building: PlanBuilding): { x: number; y: number } {
  const lot = building.lot;
  if (building.frontage === 'S') return { x: lot.x + lot.w / 2, y: lot.y + lot.d - 0.5 };
  if (building.frontage === 'N') return { x: lot.x + lot.w / 2, y: lot.y + 0.5 };
  if (building.frontage === 'E') return { x: lot.x + lot.w - 0.5, y: lot.y + lot.d / 2 };
  return { x: lot.x + 0.5, y: lot.y + lot.d / 2 };
}

function reaches(
  anchor: { x: number; y: number },
  roads: RoadPaint[],
  plaza: Set<string>,
  wagon: PlanZone | null,
  buildings: PlanBuilding[],
): boolean {
  const walk = new Set<string>();
  for (const cell of roads) walk.add(key(cell.gx, cell.gy));
  for (const k of plaza) walk.add(k);
  if (wagon) {
    const gx0 = wagon.rect.x / 3;
    const gy0 = wagon.rect.y / 3;
    for (let y = 0; y < wagon.rect.d / 3; y++) {
      for (let x = 0; x < wagon.rect.w / 3; x++) walk.add(key(gx0 + x, gy0 + y));
    }
  }
  for (const building of buildings) {
    const gx0 = building.lot.x / 3;
    const gy0 = building.lot.y / 3;
    for (let y = 0; y < building.lot.d / 3; y++) {
      for (let x = 0; x < building.lot.w / 3; x++) walk.add(key(gx0 + x, gy0 + y));
    }
  }
  if (!walk.size) return false;
  const start = roads[0] ? key(roads[0].gx, roads[0].gy) : walk.values().next().value;
  if (!start) return false;
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    const [gx, gy] = cur.split(',').map(Number) as [number, number];
    for (const [dx, dy] of DIRS) {
      const nk = key(gx! + dx, gy! + dy);
      if (!walk.has(nk) || seen.has(nk)) continue;
      seen.add(nk);
      queue.push(nk);
    }
  }
  const ax = Math.floor(anchor.x / 3);
  const ay = Math.floor(anchor.y / 3);
  return seen.has(key(ax, ay));
}

function wagonTouchesWideRoad(wagon: PlanZone, roads: RoadPaint[]): boolean {
  const gx0 = wagon.rect.x / 3;
  const gy0 = wagon.rect.y / 3;
  const w = wagon.rect.w / 3;
  const d = wagon.rect.d / 3;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < w; x++) {
      for (const [dx, dy] of DIRS) {
        const hit = roads.find((cell) => cell.gx === gx0 + x + dx && cell.gy === gy0 + y + dy && cell.rank === 1);
        if (hit && hit.widthM >= 3) return true;
      }
    }
  }
  return false;
}

function lotOverlaps(buildings: PlanBuilding[]): string {
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      const a = buildings[i]!.lot;
      const b = buildings[j]!.lot;
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y;
      if (overlap) return `${buildings[i]!.catalogId} ${buildings[j]!.catalogId}`;
    }
  }
  return '';
}

function boundsOf(lots: Array<{ x: number; y: number; w: number; d: number }>): { x: number; y: number; w: number; d: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const lot of lots) {
    x0 = Math.min(x0, lot.x);
    y0 = Math.min(y0, lot.y);
    x1 = Math.max(x1, lot.x + lot.w);
    y1 = Math.max(y1, lot.y + lot.d);
  }
  return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
}

function collapse(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    const a = out[out.length - 2];
    if (a && prev && collinear(a, prev, point)) out.pop();
    out.push(point);
  }
  return out;
}

function collinear(a: [number, number], b: [number, number], c: [number, number]): boolean {
  return (b[0] - a[0]) * (c[1] - a[1]) === (b[1] - a[1]) * (c[0] - a[0]);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

void KIT_BUILDINGS;
