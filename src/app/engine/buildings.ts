import { ChunkData, MapNode, NodeKind, PlacedSprite, PoiKind, TILE, WorldData, ZONE_SCALE, hasNodeTile } from '../models/world.models';
import { settlementPlan } from './layout-v2';
import {
  BuildingPart,
  BuildingRotation,
  BuildingTemplate,
  Cardinal,
  isStructure,
  placedMask,
  rotationForFacing,
  rotatedSize,
  templateById,
  templatesForType,
} from './building-templates';
import { Rng } from './noise';

/**
 * Street-scale buildings + walkable interiors.
 *
 * Town Tale sprites are front-facing (roof up, door on the south sill). The
 * ground lot (footW × footD) is the wall box in inner tiles — not the full
 * sprite, which includes eaves, chimneys, stalls, and grass. `shell` maps that
 * wall box onto the PNG so interiors, collision, and the drawn facade share
 * one footprint. A future API can call `settlementLayout` / `makeStreetBuilding`
 * / `generateInterior` without any renderer.
 *
 * A person sprite is ~2 inner tiles tall; a cottage is a 2-room plan, civic
 * buildings are halls with several rooms.
 */
export type BuildingShape = 'rect' | 't-south' | 'l-east';

/** Wall / door box as fractions of the Town Tale sprite (0 = left/top). */
export interface BuildingShell {
  wallL: number;
  wallR: number;
  /** Top of the facade walls (below the roof) — used for cutaway, not lot depth. */
  wallT: number;
  /** Bottom of the foundation (above the grass strip). */
  wallB: number;
  /** Door as a fraction of the wall-box width. */
  doorL: number;
  doorR: number;
  shape: BuildingShape;
}

export interface BuildingDef {
  sprite: string;
  /** Ground lot width in inner-zone tiles (door-facing south). */
  footW: number;
  /** Ground lot depth in inner-zone tiles, north of the door anchor. */
  footD: number;
  shell: BuildingShell;
}

export interface PlacedBuilding extends BuildingDef {
  x: number;
  y: number;
  templateId: string;
  rotation: BuildingRotation;
  kit?: string;
  label?: string;
  family?: 'res' | 'shop' | 'work' | 'civic' | 'cap' | 'farm';
  resTier?: 1 | 2 | 3 | 4 | 5;
  specialty?: string;
  style?: string;
  district?: string;
  lot?: { x: number; y: number; w: number; d: number };
  frontageRank?: number;
}

const COTTAGE_SHELL: BuildingShell = {
  wallL: 0.17,
  wallR: 0.83,
  wallT: 0.5,
  wallB: 0.935,
  doorL: 0.4,
  doorR: 0.6,
  shape: 'rect',
};

const BUILDINGS: Record<string, BuildingDef> = {
  'cottage-1': { sprite: 'cottage-1', footW: 10, footD: 8, shell: COTTAGE_SHELL },
  'cottage-2': { sprite: 'cottage-2', footW: 10, footD: 8, shell: COTTAGE_SHELL },
  'cottage-3': { sprite: 'cottage-3', footW: 10, footD: 8, shell: { ...COTTAGE_SHELL, wallB: 0.93 } },
  'house-1': {
    sprite: 'house-1',
    footW: 14,
    footD: 10,
    shell: { wallL: 0.16, wallR: 0.9, wallT: 0.4, wallB: 0.955, doorL: 0.1, doorR: 0.32, shape: 'rect' },
  },
  'house-2': {
    sprite: 'house-2',
    footW: 14,
    footD: 10,
    shell: { wallL: 0.14, wallR: 0.88, wallT: 0.4, wallB: 0.95, doorL: 0.36, doorR: 0.58, shape: 'rect' },
  },
  'house-3': {
    sprite: 'house-3',
    footW: 12,
    footD: 10,
    shell: { wallL: 0.16, wallR: 0.86, wallT: 0.38, wallB: 0.95, doorL: 0.38, doorR: 0.62, shape: 'rect' },
  },
  'house-5': {
    sprite: 'house-5',
    footW: 16,
    footD: 11,
    shell: { wallL: 0.12, wallR: 0.9, wallT: 0.4, wallB: 0.95, doorL: 0.34, doorR: 0.54, shape: 'rect' },
  },
  'house-7': {
    sprite: 'house-7',
    footW: 18,
    footD: 12,
    shell: { wallL: 0.1, wallR: 0.9, wallT: 0.42, wallB: 0.95, doorL: 0.38, doorR: 0.58, shape: 'rect' },
  },
  'house-8': {
    sprite: 'house-8',
    footW: 16,
    footD: 11,
    shell: { wallL: 0.12, wallR: 0.88, wallT: 0.4, wallB: 0.95, doorL: 0.36, doorR: 0.58, shape: 'rect' },
  },
  shop: {
    sprite: 'shop',
    footW: 16,
    footD: 10,
    shell: { wallL: 0.3, wallR: 0.97, wallT: 0.36, wallB: 0.94, doorL: 0.06, doorR: 0.28, shape: 'rect' },
  },
  blacksmith: {
    sprite: 'blacksmith',
    footW: 16,
    footD: 11,
    shell: { wallL: 0.12, wallR: 0.9, wallT: 0.4, wallB: 0.95, doorL: 0.34, doorR: 0.56, shape: 'rect' },
  },
  inn: {
    sprite: 'inn',
    footW: 22,
    footD: 14,
    shell: { wallL: 0.04, wallR: 0.97, wallT: 0.34, wallB: 0.95, doorL: 0.2, doorR: 0.36, shape: 'l-east' },
  },
  'inn-2': {
    sprite: 'inn-2',
    footW: 16,
    footD: 12,
    shell: { wallL: 0.12, wallR: 0.9, wallT: 0.38, wallB: 0.95, doorL: 0.36, doorR: 0.58, shape: 'rect' },
  },
  tavern: {
    sprite: 'tavern',
    footW: 18,
    footD: 13,
    shell: { wallL: 0.1, wallR: 0.9, wallT: 0.38, wallB: 0.95, doorL: 0.4, doorR: 0.6, shape: 'rect' },
  },
  church: {
    sprite: 'church',
    footW: 18,
    footD: 14,
    shell: { wallL: 0.06, wallR: 0.94, wallT: 0.36, wallB: 0.95, doorL: 0.4, doorR: 0.6, shape: 't-south' },
  },
  'town-hall': {
    sprite: 'town-hall',
    footW: 22,
    footD: 16,
    shell: { wallL: 0.05, wallR: 0.95, wallT: 0.34, wallB: 0.95, doorL: 0.4, doorR: 0.6, shape: 't-south' },
  },
  farm: {
    sprite: 'farm',
    footW: 18,
    footD: 12,
    shell: { wallL: 0.1, wallR: 0.9, wallT: 0.4, wallB: 0.95, doorL: 0.38, doorR: 0.58, shape: 'rect' },
  },
};

const DEFAULT_SHELL: BuildingShell = {
  wallL: 0.14,
  wallR: 0.86,
  wallT: 0.44,
  wallB: 0.94,
  doorL: 0.38,
  doorR: 0.62,
  shape: 'rect',
};

const HOUSES = ['house-1', 'house-2', 'house-3', 'house-5', 'house-7', 'house-8'] as const;
const COTTAGES = ['cottage-1', 'cottage-2', 'cottage-3'] as const;

export const BUILDING_LABELS: Record<string, string> = {
  'cottage-1': 'Cottage',
  'cottage-2': 'Cottage',
  'cottage-3': 'Cottage',
  'house-1': 'House',
  'house-2': 'House',
  'house-3': 'House',
  'house-5': 'House',
  'house-7': 'House',
  'house-8': 'House',
  shop: 'Shop',
  blacksmith: 'Smithy',
  inn: 'Inn',
  'inn-2': 'Inn',
  tavern: 'Tavern',
  church: 'Church',
  'town-hall': 'Town hall',
  farm: 'Farmhouse',
};

export interface StreetBuilding {
  id: string;
  sprite: string;
  label: string;
  templateId: string;
  rotation: BuildingRotation;
  /** Primary door after rotation. */
  door: Cardinal;
  ax: number;
  ay: number;
  /** Axis-aligned plot, inner tiles. */
  footW: number;
  footD: number;
  shape: BuildingShape;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  doorX0: number;
  doorX1: number;
  doorY0: number;
  doorY1: number;
}

export function isBuildingSprite(name: string): boolean {
  return name in BUILDINGS;
}

export function buildingDef(name: string): BuildingDef | undefined {
  return BUILDINGS[name];
}

export function buildingLabel(sprite: string): string {
  return BUILDING_LABELS[sprite] ?? 'Building';
}

export function buildingShell(sprite?: string): BuildingShell {
  return (sprite ? BUILDINGS[sprite]?.shell : undefined) ?? DEFAULT_SHELL;
}

export function doorInnerWidth(footW: number, sprite?: string): number {
  const shell = buildingShell(sprite);
  return Math.max(2, Math.min(footW - 2, Math.round((shell.doorR - shell.doorL) * footW)));
}

export function doorCols(footW: number, sprite?: string): { c0: number; w: number } {
  const shell = buildingShell(sprite);
  const w = doorInnerWidth(footW, sprite);
  const c0 = Math.round(shell.doorL * footW);
  return { c0: Math.max(1, Math.min(footW - w - 1, c0)), w };
}

/** True if an inner-tile cell sits on the building's ground plan (not eaves / void corners). */
export function footprintAt(shape: BuildingShape, col: number, row: number, cols: number, rows: number): boolean {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
  const u = (col + 0.5) / cols;
  const v = (row + 0.5) / rows;
  if (shape === 't-south') {
    if (v < 0.6) return true;
    return u >= 0.3 && u <= 0.7;
  }
  if (shape === 'l-east') {
    if (u < 0.66) return true;
    return v >= 0.46;
  }
  return true;
}

export function inBuildingAabb(x: number, y: number, b: { x0: number; x1: number; y0: number; y1: number }): boolean {
  return x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
}

export function makeStreetBuilding(wx: number, wy: number, spr: PlacedSprite, size: number): StreetBuilding | null {
  const def = BUILDINGS[spr.sprite];
  const tmpl = (spr.templateId && templateById(spr.templateId)) || templatesForType(spr.sprite)[0];
  if (!def && !tmpl && spr.footW == null) return null;
  const rotation: BuildingRotation = spr.rotation ?? 0;
  const footW = spr.footW ?? tmpl?.w ?? def?.footW ?? 14;
  const footD = spr.footD ?? tmpl?.d ?? def?.footD ?? 10;
  const shell = def?.shell ?? DEFAULT_SHELL;
  const ax = wx + spr.x / size;
  const ay = wy + spr.y / size;
  const worldW = footW / ZONE_SCALE;
  const worldD = footD / ZONE_SCALE;
  const x0 = ax - worldW / 2;
  const y0 = ay - worldD;
  const door = doorWorldRect(tmpl?.id, rotation, x0, y0, footW);
  return {
    id: `${wx}:${wy}:${spr.sprite}:${spr.templateId ?? ''}:${spr.x.toFixed(2)}:${spr.y.toFixed(2)}`,
    sprite: spr.sprite,
    label: buildingLabel(spr.sprite),
    templateId: tmpl?.id ?? spr.sprite,
    rotation,
    door: door.facing,
    ax,
    ay,
    footW,
    footD,
    shape: shell.shape,
    x0,
    x1: ax + worldW / 2,
    y0,
    y1: ay,
    doorX0: door.x0,
    doorX1: door.x1,
    doorY0: door.y0,
    doorY1: door.y1,
  };
}

function doorWorldRect(
  templateId: string | undefined,
  rotation: BuildingRotation,
  x0: number,
  y0: number,
  footW: number,
): { x0: number; x1: number; y0: number; y1: number; facing: Cardinal } {
  const mask = templateId ? placedMask(templateId, rotation) : null;
  const cell = 1 / ZONE_SCALE;
  if (!mask) {
    const { c0, w } = doorCols(footW);
    return {
      facing: 'S',
      x0: x0 + c0 * cell,
      x1: x0 + (c0 + w) * cell,
      y0: y0 - 0.12,
      y1: y0 + cell,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let facing: Cardinal = 'S';
  let count = 0;
  for (let r = 0; r < mask.d; r++) {
    for (let c = 0; c < mask.w; c++) {
      if (mask.parts[r * mask.w + c] !== 'door') continue;
      minX = Math.min(minX, c);
      minY = Math.min(minY, r);
      maxX = Math.max(maxX, c + 1);
      maxY = Math.max(maxY, r + 1);
      facing = openingSide(mask.parts, mask.w, mask.d, c, r);
      count++;
    }
  }
  if (!count) {
    return { facing: 'S', x0: x0 + cell, x1: x0 + 3 * cell, y0: y0 + (mask.d - 1) * cell, y1: y0 + mask.d * cell };
  }
  const pad = 0.07;
  const out = 0.18;
  let dx0 = x0 + minX * cell - pad;
  let dy0 = y0 + minY * cell - pad;
  let dx1 = x0 + maxX * cell + pad;
  let dy1 = y0 + maxY * cell + pad;
  if (facing === 'S') dy1 += out;
  else if (facing === 'N') dy0 -= out;
  else if (facing === 'E') dx1 += out;
  else dx0 -= out;
  return { facing, x0: dx0, x1: dx1, y0: dy0, y1: dy1 };
}

function openingSide(parts: readonly BuildingPart[], w: number, d: number, x: number, y: number): Cardinal {
  const opts: Array<{ dir: Cardinal; nx: number; ny: number }> = [
    { dir: 'N', nx: x, ny: y - 1 },
    { dir: 'E', nx: x + 1, ny: y },
    { dir: 'S', nx: x, ny: y + 1 },
    { dir: 'W', nx: x - 1, ny: y },
  ];
  for (const o of opts) {
    if (o.nx < 0 || o.ny < 0 || o.nx >= w || o.ny >= d) return o.dir;
    const part = parts[o.ny * w + o.nx]!;
    if (part === 'void' || part === 'yard') return o.dir;
  }
  return 'S';
}

export function collectStreetBuildings(
  chunks: Map<string, ChunkData>,
  cx: number,
  cy: number,
  radius = 3,
): StreetBuilding[] {
  const x0 = Math.floor(cx - radius);
  const y0 = Math.floor(cy - radius);
  const x1 = Math.floor(cx + radius);
  const y1 = Math.floor(cy + radius);
  const out: StreetBuilding[] = [];
  for (let wy = y0; wy <= y1; wy++) {
    for (let wx = x0; wx <= x1; wx++) {
      const chunk = chunks.get(`${wx},${wy}`);
      if (!chunk) continue;
      for (const spr of chunk.sprites) {
        if (!isBuildingSprite(spr.sprite)) continue;
        const b = makeStreetBuilding(wx, wy, spr, chunk.size);
        if (b) out.push(b);
      }
    }
  }
  return out;
}

export function inDoorway(x: number, y: number, b: { doorX0: number; doorX1: number; doorY0: number; doorY1: number }): boolean {
  return x >= b.doorX0 && x < b.doorX1 && y >= b.doorY0 && y < b.doorY1;
}

export function inBuildingLot(
  x: number,
  y: number,
  b: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    shape: BuildingShape;
    footW: number;
    footD: number;
    templateId?: string;
    rotation?: BuildingRotation;
  },
): boolean {
  if (!inBuildingAabb(x, y, b)) return false;
  const col = Math.floor((x - b.x0) * ZONE_SCALE + 1e-6);
  const row = Math.floor((y - b.y0) * ZONE_SCALE + 1e-6);
  const mask = b.templateId ? placedMask(b.templateId, b.rotation ?? 0) : null;
  if (mask) {
    if (col < 0 || row < 0 || col >= mask.w || row >= mask.d) return false;
    return isStructure(mask.parts[row * mask.w + col]!);
  }
  return footprintAt(b.shape, col, row, b.footW, b.footD);
}

/**
 * Facade draw vs interior lot. Wall-box matching made Town Tale sprites read too
 * tall/wide on the street; interiors keep `footW`/`footD` and the sprite sits
 * on the same south-center anchor at this fraction of that match.
 */
const EXTERIOR_DRAW = 0.8;

/** Canvas scale so the sprite's wall box — not the eaves — tracks the lot. */
export function buildingDrawScale(sprite: string, img: HTMLImageElement, footW?: number): number {
  const def = BUILDINGS[sprite];
  const w = footW ?? def?.footW ?? 14;
  const shell = def?.shell ?? DEFAULT_SHELL;
  const wallWpx = Math.max(1, img.width * (shell.wallR - shell.wallL));
  return (((w / ZONE_SCALE) * TILE) / wallWpx) * EXTERIOR_DRAW;
}

/** Sprite-pixel origin that puts the wall-box south-center on the draw point. */
export function buildingDrawOrigin(sprite: string, img: HTMLImageElement): { ox: number; oy: number } {
  const shell = buildingShell(sprite);
  return {
    ox: img.width * (shell.wallL + shell.wallR) * 0.5,
    oy: img.height * shell.wallB,
  };
}

export function buildingRoofFrac(sprite: string): number {
  return buildingShell(sprite).wallT;
}

export function settlementPlaza(kind: NodeKind): { w: number; h: number } {
  if (kind === 'city') return { w: 16, h: 13 };
  if (kind === 'town') return { w: 12, h: 10 };
  if (kind === 'hamlet') return { w: 8, h: 7 };
  return { w: 6, h: 5 };
}

function lotInside(node: MapNode, x: number, y: number, footW: number, footD: number): boolean {
  const x0 = x - footW / 2;
  const x1 = x + footW / 2;
  const y0 = y - footD;
  const y1 = y + 1.4;
  const wx0 = Math.floor(x0 / ZONE_SCALE);
  const wy0 = Math.floor(y0 / ZONE_SCALE);
  const wx1 = Math.floor((x1 - 0.01) / ZONE_SCALE);
  const wy1 = Math.floor((y1 - 0.01) / ZONE_SCALE);
  for (let wy = wy0; wy <= wy1; wy++) {
    for (let wx = wx0; wx <= wx1; wx++) {
      if (!hasNodeTile(node, wx, wy)) return false;
    }
  }
  return true;
}

function lotsOverlap(a: PlacedBuilding, x: number, y: number, footW: number, footD: number, gap: number): boolean {
  const ax0 = a.x - a.footW / 2 - gap;
  const ax1 = a.x + a.footW / 2 + gap;
  const ay0 = a.y - a.footD - gap;
  const ay1 = a.y + 1.2 + gap;
  const bx0 = x - footW / 2;
  const bx1 = x + footW / 2;
  const by0 = y - footD;
  const by1 = y + 1.2;
  return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
}

function fits(node: MapNode, placed: PlacedBuilding[], x: number, y: number, footW: number, footD: number, gap: number): boolean {
  if (!lotInside(node, x, y, footW, footD)) return false;
  return !placed.some((b) => lotsOverlap(b, x, y, footW, footD, gap));
}

function bldg(name: string): BuildingDef {
  return BUILDINGS[name]!;
}

function roster(kind: NodeKind, tileCount: number, rng: Rng): BuildingDef[] {
  const house = () => bldg(rng.pick(HOUSES));
  const cottage = () => bldg(rng.pick(COTTAGES));
  if (kind === 'city') {
    const n = Math.max(8, Math.min(16, Math.round(tileCount / 22)));
    const out: BuildingDef[] = [bldg('town-hall'), bldg('church'), bldg('inn'), bldg('shop'), bldg('blacksmith'), bldg('tavern')];
    if (rng.chance(0.7)) out.push(bldg('inn-2'));
    if (rng.chance(0.55)) out.push(bldg('house-7'));
    for (let i = 0; i < n; i++) out.push(i % 5 === 0 ? cottage() : house());
    return out;
  }
  if (kind === 'town') {
    const n = Math.max(4, Math.min(8, Math.round(tileCount / 28)));
    const out: BuildingDef[] = [bldg('inn'), bldg('shop'), bldg('tavern'), bldg('church')];
    for (let i = 0; i < n; i++) out.push(house());
    if (rng.chance(0.6)) out.push(bldg('farm'));
    return out;
  }
  if (kind === 'hamlet') {
    return [cottage(), house(), bldg('farm'), cottage()];
  }
  return [bldg('farm'), house(), rng.chance(0.45) ? cottage() : house()];
}

function lotSlots(node: MapNode, plaza: { w: number; h: number }, rng: Rng): Array<{ x: number; y: number }> {
  const cx = node.cx * ZONE_SCALE;
  const cy = node.cy * ZONE_SCALE;
  const slots: Array<{ x: number; y: number }> = [];
  const push = (x: number, y: number) => {
    slots.push({ x: x + rng.range(-0.45, 0.45), y: y + rng.range(-0.3, 0.3) });
  };

  push(cx, cy - plaza.h * 0.5);
  push(cx + plaza.w * 0.62, cy - 1.2);
  push(cx - plaza.w * 0.62, cy - 1.2);
  push(cx + plaza.w * 0.38, cy + plaza.h * 0.42);
  push(cx - plaza.w * 0.38, cy + plaza.h * 0.42);

  const b = node.tiles?.length
    ? { x0: node.x0, y0: node.y0, x1: node.x1, y1: node.y1 }
    : { x0: Math.floor(node.cx - node.radius), y0: Math.floor(node.cy - node.radius), x1: Math.ceil(node.cx + node.radius), y1: Math.ceil(node.cy + node.radius) };

  const colStep = 2.1;
  const rowStep = 2.35;
  for (let wy = b.y0; wy < b.y1; wy += 1) {
    for (let wx = b.x0; wx < b.x1; wx += 1) {
      if (!hasNodeTile(node, wx, wy)) continue;
      const ix = (wx + 0.5) * ZONE_SCALE;
      const iy = (wy + 0.38) * ZONE_SCALE;
      if (Math.abs(ix - cx) < plaza.w * 0.42 && Math.abs(iy - cy) < plaza.h * 0.42) continue;
      if ((wx + wy) % 2 === 0) push(ix, iy);
      if (Math.abs(iy - cy) < 4) push(ix + rng.pick([-colStep, colStep]), cy - plaza.h * 0.48);
      if (Math.abs(ix - cx) < 4) push(cx + rng.pick([-plaza.w * 0.55, plaza.w * 0.55]), iy - rowStep);
    }
  }
  return slots;
}

/** Deterministic street layout for a place; every chunk of the node must agree. */
const layoutCache = new Map<string, PlacedBuilding[]>();

export function settlementLayout(node: MapNode, world: WorldData): PlacedBuilding[] {
  const plan = settlementPlan(world, node);
  if (plan) {
    return plan.buildings.map((b) => {
      const def = BUILDINGS[b.legacy] ?? bldg('cottage-1');
      return {
        ...def,
        sprite: b.legacy,
        footW: b.footW,
        footD: b.footD,
        x: b.anchorX,
        y: b.anchorY,
        templateId: b.templateId,
        rotation: b.rotation,
        kit: b.kit,
        label: b.label,
        family: b.family,
        ...(b.resTier ? { resTier: b.resTier } : {}),
        specialty: b.specialty,
        style: b.style,
        district: b.district,
        lot: b.lot,
        frontageRank: b.frontageRank,
      };
    });
  }
  return legacySettlementLayout(node, world.seed);
}

function legacySettlementLayout(node: MapNode, worldSeed: number): PlacedBuilding[] {
  const key = `${node.id}:${worldSeed}:${node.tiles?.length ?? 0}:${node.cx.toFixed(2)}:${node.cy.toFixed(2)}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  if (layoutCache.size > 48) layoutCache.clear();
  const rng = new Rng((node.seed ^ (worldSeed * 13) ^ 0xb10b1e) >>> 0);
  const plaza = settlementPlaza(node.kind);
  const gap = node.kind === 'city' ? 1.8 : node.kind === 'town' ? 2.4 : 3.2;
  const wanted = roster(node.kind, node.tiles?.length ?? 32, rng);
  const slots = lotSlots(node, plaza, rng);
  const placed: PlacedBuilding[] = [];
  wanted.forEach((def, index) => {
    const salt = (node.seed ^ Math.imul(worldSeed, 13) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
    const ordered = orderedTemplates(def.sprite, salt);
    const attempt = (x: number, y: number) => {
      for (const tmpl of ordered) {
        const built = placeTemplate(node, placed, def, tmpl, x, y, salt, gap);
        if (!built) continue;
        placed.push(built);
        return true;
      }
      return false;
    };
    let found = false;
    for (const slot of slots) {
      if (attempt(slot.x, slot.y)) {
        found = true;
        break;
      }
    }
    if (!found) {
      for (let i = 0; i < 18 && !found; i++) {
        const x = node.cx * ZONE_SCALE + rng.range(-node.radius * ZONE_SCALE * 0.7, node.radius * ZONE_SCALE * 0.7);
        const y = node.cy * ZONE_SCALE + rng.range(-node.radius * ZONE_SCALE * 0.55, node.radius * ZONE_SCALE * 0.45);
        if (attempt(x, y)) found = true;
      }
    }
  });
  layoutCache.set(key, placed);
  return placed;
}

function orderedTemplates(type: string, salt: number): BuildingTemplate[] {
  const variants = templatesForType(type);
  if (variants.length < 2) return variants;
  const start = new Rng(salt || 1).int(0, variants.length - 1);
  return variants.map((_, i) => variants[(start + i) % variants.length]!);
}

function snapAnchor(x: number, y: number, w: number, d: number): { x: number; y: number } {
  const x0 = Math.round(x - w / 2);
  const y0 = Math.round(y - d);
  return { x: x0 + w / 2, y: y0 + d };
}

/** Distance from a plot edge to the nearest street axis or plaza. Lower is closer. */
function edgeDistance(node: MapNode, x: number, y: number, w: number, d: number, side: Cardinal): number {
  const x0 = x - w / 2;
  const y0 = y - d;
  let px = x;
  let py = y;
  if (side === 'N') py = y0;
  else if (side === 'E') {
    px = x0 + w;
    py = y0 + d / 2;
  } else if (side === 'W') {
    px = x0;
    py = y0 + d / 2;
  }
  const mx = node.cx * ZONE_SCALE;
  const my = node.cy * ZONE_SCALE;
  const plaza = settlementPlaza(node.kind);
  const rx0 = mx - plaza.w * 0.5;
  const ry0 = my - plaza.h * 0.45;
  const dx = Math.max(rx0 - px, 0, px - (rx0 + plaza.w));
  const dy = Math.max(ry0 - py, 0, py - (ry0 + plaza.h));
  return Math.min(Math.abs(py - my), Math.abs(px - mx), Math.hypot(dx, dy));
}

function facingOrder(node: MapNode, x: number, y: number, w: number, d: number, salt: number): Cardinal[] {
  const scored = (['N', 'E', 'S', 'W'] as const).map((side) => ({
    side,
    score: edgeDistance(node, x, y, w, d, side),
  }));
  scored.sort((a, b) => a.score - b.score || a.side.localeCompare(b.side));
  const best = scored[0]!.score;
  const tied = scored.filter((s) => s.score <= best + 0.85);
  const pick = tied.length > 1 ? new Rng((salt ^ Math.round(x * 8) ^ Math.round(y * 8)) >>> 0 || 1).pick(tied).side : scored[0]!.side;
  return [pick, ...scored.map((s) => s.side).filter((s) => s !== pick)];
}

function placeTemplate(
  node: MapNode,
  placed: PlacedBuilding[],
  def: BuildingDef,
  tmpl: BuildingTemplate,
  x: number,
  y: number,
  salt: number,
  gap: number,
): PlacedBuilding | null {
  const seen = new Set<BuildingRotation>();
  const facings = [
    ...facingOrder(node, x, y, tmpl.w, tmpl.d, salt),
    ...facingOrder(node, x, y, tmpl.d, tmpl.w, salt ^ 17),
  ];
  for (const facing of facings) {
    const rotation = rotationForFacing(tmpl.doorFacing, facing);
    if (seen.has(rotation)) continue;
    seen.add(rotation);
    const dim = rotatedSize(tmpl.w, tmpl.d, rotation);
    const anchor = snapAnchor(x, y, dim.w, dim.d);
    if (!fits(node, placed, anchor.x, anchor.y, dim.w, dim.d, gap)) continue;
    return { ...def, footW: dim.w, footD: dim.d, x: anchor.x, y: anchor.y, templateId: tmpl.id, rotation };
  }
  return null;
}

function facingToward(fromX: number, fromY: number, toX: number, toY: number, salt: number): Cardinal {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.abs(ax - ay) < 1.25) {
    const opts: Cardinal[] = [];
    opts.push(dx >= 0 ? 'E' : 'W');
    opts.push(dy >= 0 ? 'S' : 'N');
    return new Rng(salt || 1).pick(opts);
  }
  if (ax > ay) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

function poiPair(kind: PoiKind): string[] {
  switch (kind) {
    case 'ruins':
      return ['church', 'town-hall'];
    case 'mansion':
      return ['inn-2', 'house-8'];
    case 'abandoned-camp':
      return ['farm'];
    case 'shrine':
    case 'graves':
    case 'temple':
    case 'crypt':
      return ['church'];
    case 'homestead':
      return ['farm', 'house-1'];
    case 'hideout':
      return ['house-7'];
    case 'treehouse':
      return ['house-3', 'house-5'];
    case 'military-camp':
      return ['farm', 'house-7'];
    case 'tower':
    case 'watchtower':
    case 'bridge-keep':
      return ['town-hall'];
    case 'wizard-tower':
      return ['inn-2'];
    case 'monastery':
      return ['church', 'house-8'];
    case 'port':
      return ['shop'];
    case 'orc-fort':
      return ['farm', 'house-7'];
    case 'trading-post':
      return ['shop'];
    case 'bandit-camp':
      return ['farm'];
    case 'ancient-gate':
      return ['town-hall', 'church'];
    default:
      return [];
  }
}

export function poiBuildingLayout(kind: PoiKind, midX: number, midY: number): PlacedBuilding[] {
  const defs = poiPair(kind)
    .map((name) => BUILDINGS[name])
    .filter((d): d is BuildingDef => !!d);
  if (!defs.length) return [];
  const salt = (kind.length * 131 + Math.round(midX * 10) + Math.round(midY * 17)) >>> 0;
  const specs = defs.map((def, i) => {
    const tmpl = orderedTemplates(def.sprite, salt ^ (i + 3))[0] ?? templatesForType(def.sprite)[0];
    return { def, tmpl };
  }).filter((s): s is { def: BuildingDef; tmpl: BuildingTemplate } => !!s.tmpl);
  if (!specs.length) return [];
  const anchors =
    specs.length === 1
      ? [{ x: midX, y: midY - 1 }]
      : (() => {
          const gap = 3.2;
          const aw = specs[0]!.tmpl.w;
          const bw = specs[1]!.tmpl.w;
          const span = aw * 0.5 + gap + bw * 0.5;
          return [
            { x: midX - span * 0.5 + aw * 0.5, y: midY - 1 },
            { x: midX + span * 0.5 - bw * 0.5, y: midY + 1.6 },
          ];
        })();
  return specs.map((spec, i) => {
    const at = anchors[i]!;
    const facing = facingToward(at.x, at.y - spec.tmpl.d / 2, midX, midY, salt ^ (i + 9));
    const rotation = rotationForFacing(spec.tmpl.doorFacing, facing);
    const dim = rotatedSize(spec.tmpl.w, spec.tmpl.d, rotation);
    const anchor = snapAnchor(at.x, at.y, dim.w, dim.d);
    return {
      ...spec.def,
      footW: dim.w,
      footD: dim.d,
      x: anchor.x,
      y: anchor.y,
      templateId: spec.tmpl.id,
      rotation,
    };
  });
}

export function toPlacedSprite(b: PlacedBuilding, originX: number, originY: number): PlacedSprite {
  return {
    sprite: b.sprite,
    x: b.x - originX,
    y: b.y - originY,
    footW: b.footW,
    footD: b.footD,
    templateId: b.templateId,
    rotation: b.rotation,
    ...(b.kit ? { kit: b.kit } : {}),
    ...(b.label ? { label: b.label } : {}),
    ...(b.family ? { family: b.family } : {}),
    ...(b.resTier ? { resTier: b.resTier } : {}),
    ...(b.specialty ? { specialty: b.specialty } : {}),
    ...(b.style ? { style: b.style } : {}),
    ...(b.district ? { district: b.district } : {}),
    ...(b.lot ? { lot: b.lot } : {}),
    ...(b.frontageRank !== undefined ? { frontageRank: b.frontageRank } : {}),
  };
}

/** Stamp yard cells of a placed building into one chunk. Streets and plaza win. */
export function stampBuildingYard(
  cobble: Uint8Array,
  paths: Uint8Array,
  size: number,
  b: PlacedBuilding,
  originX: number,
  originY: number,
): void {
  const mask = placedMask(b.templateId, b.rotation);
  if (!mask) return;
  const x0 = b.x - b.footW / 2;
  const y0 = b.y - b.footD;
  for (let r = 0; r < mask.d; r++) {
    for (let c = 0; c < mask.w; c++) {
      if (mask.parts[r * mask.w + c] !== 'yard') continue;
      const ix = Math.floor(x0 + c - originX + 1e-6);
      const iy = Math.floor(y0 + r - originY + 1e-6);
      if (ix < 0 || iy < 0 || ix >= size || iy >= size) continue;
      const i = ix + iy * size;
      if (paths[i]) continue;
      if (cobble[i] === 2) continue;
      cobble[i] = 3;
    }
  }
}

export function buildingInChunk(b: PlacedBuilding, wx: number, wy: number, size: number): boolean {
  const originX = wx * size;
  const originY = wy * size;
  return b.x >= originX && b.x < originX + size && b.y >= originY && b.y < originY + size;
}

/** True if an inner-chunk point sits on a building lot (plus padding). */
export function pointHitsBuilding(x: number, y: number, sprites: PlacedSprite[], pad = 1.1): boolean {
  for (const s of sprites) {
    const def = BUILDINGS[s.sprite];
    if (!def) continue;
    const fw = s.footW ?? def.footW;
    const fd = s.footD ?? def.footD;
    if (x >= s.x - fw / 2 - pad && x <= s.x + fw / 2 + pad && y >= s.y - fd - pad && y <= s.y + 1.4 + pad) {
      return true;
    }
  }
  return false;
}

for (const name of Object.keys(BUILDINGS)) {
  if (!templatesForType(name).length) throw new Error(`no building template for ${name}`);
}
