/**
 * Walkable interior plans for street-scale buildings.
 *
 * Lots, doors, and wall cells are derived from the same `StreetBuilding` the
 * renderer uses for the Town Tale facade — call `generateInterior` from a
 * session/API layer; do not regenerate in UI components.
 */
import { ZONE_SCALE } from '../models/world.models';
import { Rng } from './noise';
import {
  BuildingShape,
  StreetBuilding,
  doorCols,
  footprintAt,
  inBuildingLot,
  inDoorway,
} from './buildings';

export const CELL_FLOOR = 0;
export const CELL_WALL = 1;
export const CELL_DOOR = 2;
export const CELL_VOID = 3;

const PLAYER_R = 0.055;

export interface InteriorFurnishing {
  sprite: string;
  col: number;
  row: number;
}

export interface InteriorPlan {
  id: string;
  sprite: string;
  label: string;
  ax: number;
  ay: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  doorX0: number;
  doorX1: number;
  doorY0: number;
  doorY1: number;
  footW: number;
  footD: number;
  shape: BuildingShape;
  cols: number;
  rows: number;
  cells: Uint8Array;
  floor: number;
  furniture: InteriorFurnishing[];
}

function idx(col: number, row: number, cols: number): number {
  return col + row * cols;
}

function occupied(cells: Uint8Array, cols: number, rows: number, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
  const v = cells[idx(c, r, cols)]!;
  return v !== CELL_VOID;
}

function setWall(cells: Uint8Array, cols: number, rows: number, c0: number, r0: number, c1: number, r1: number): void {
  const xa = Math.max(0, Math.min(c0, c1));
  const xb = Math.min(cols - 1, Math.max(c0, c1));
  const ya = Math.max(0, Math.min(r0, r1));
  const yb = Math.min(rows - 1, Math.max(r0, r1));
  for (let r = ya; r <= yb; r++) {
    for (let c = xa; c <= xb; c++) {
      const i = idx(c, r, cols);
      if (cells[i] === CELL_DOOR || cells[i] === CELL_VOID) continue;
      cells[i] = CELL_WALL;
    }
  }
}

function cutDoor(cells: Uint8Array, cols: number, c: number, r: number, w = 2, h = 1): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const cc = c + i;
      const rr = r + j;
      if (cc < 0 || rr < 0 || cc >= cols) continue;
      const k = idx(cc, rr, cols);
      if (cells[k] === CELL_VOID) continue;
      cells[k] = CELL_FLOOR;
    }
  }
}

function addFurn(
  list: InteriorFurnishing[],
  cells: Uint8Array,
  sprite: string,
  col: number,
  row: number,
  cols: number,
  rows: number,
): void {
  if (col < 1 || row < 1 || col >= cols - 1 || row >= rows - 1) return;
  if (cells[idx(col, row, cols)] !== CELL_FLOOR) return;
  list.push({ sprite, col, row });
}

function stampFootprint(cells: Uint8Array, cols: number, rows: number, shape: BuildingShape): void {
  cells.fill(CELL_VOID);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (footprintAt(shape, c, r, cols, rows)) cells[idx(c, r, cols)] = CELL_FLOOR;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[idx(c, r, cols)] !== CELL_FLOOR) continue;
      const edge =
        !occupied(cells, cols, rows, c - 1, r) ||
        !occupied(cells, cols, rows, c + 1, r) ||
        !occupied(cells, cols, rows, c, r - 1) ||
        !occupied(cells, cols, rows, c, r + 1);
      if (edge) cells[idx(c, r, cols)] = CELL_WALL;
    }
  }
}

function placeSouthDoor(cells: Uint8Array, cols: number, rows: number, sprite: string): void {
  const door = doorCols(cols, sprite);
  for (let r = rows - 1; r >= 0; r--) {
    let hit = false;
    for (let i = 0; i < door.w; i++) {
      const c = door.c0 + i;
      if (c < 0 || c >= cols) continue;
      if (cells[idx(c, r, cols)] !== CELL_VOID) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    for (let i = 0; i < door.w; i++) {
      const c = door.c0 + i;
      if (c < 0 || c >= cols) continue;
      if (cells[idx(c, r, cols)] === CELL_VOID) continue;
      cells[idx(c, r, cols)] = CELL_DOOR;
    }
    break;
  }
}

export function generateInterior(b: StreetBuilding): InteriorPlan {
  const cols = b.footW;
  const rows = b.footD;
  const cells = new Uint8Array(cols * rows);
  const rng = new Rng(hashId(b.id));
  stampFootprint(cells, cols, rows, b.shape);
  placeSouthDoor(cells, cols, rows, b.sprite);

  const furniture: InteriorFurnishing[] = [];
  const kind = b.sprite;
  const put = (sprite: string, col: number, row: number) => addFurn(furniture, cells, sprite, col, row, cols, rows);

  if (kind === 'tavern' || kind === 'inn' || kind === 'inn-2') {
    setWall(cells, cols, rows, 1, 1, cols - 2, 1);
    cutDoor(cells, cols, Math.floor(cols / 2) - 1, 1, 2, 1);
    put('bench', 2, rows - 3);
    put('bench', cols - 3, rows - 3);
    put('bench', 3, Math.floor(rows * 0.55));
    put('lantern', 2, 2);
    put('chest', cols - 3, 2);
  } else if (kind === 'church' || kind === 'town-hall') {
    const aisle = Math.floor(cols / 2);
    for (let r = 2; r < rows - 2; r += 2) {
      put('bench', Math.max(2, aisle - 3), r);
      put('bench', Math.min(cols - 3, aisle + 3), r);
    }
    put('lantern', 2, 2);
    put('lantern', cols - 3, 2);
    if (kind === 'town-hall') {
      setWall(cells, cols, rows, Math.floor(cols * 0.62), 1, Math.floor(cols * 0.62), rows - 2);
      cutDoor(cells, cols, Math.floor(cols * 0.62), Math.floor(rows * 0.55), 1, 2);
      put('chest', cols - 3, 2);
    }
  } else if (kind === 'shop' || kind === 'blacksmith') {
    setWall(cells, cols, rows, 1, Math.floor(rows * 0.45), cols - 2, Math.floor(rows * 0.45));
    cutDoor(cells, cols, Math.floor(cols / 2) - 1, Math.floor(rows * 0.45), 2, 1);
    put('chest', 2, 2);
    put('lantern', cols - 3, 2);
    put('bench', Math.floor(cols / 2), rows - 3);
  } else if (cols >= 12 && rows >= 8) {
    const split = Math.floor(cols * (0.42 + rng.range(0, 0.12)));
    setWall(cells, cols, rows, split, 1, split, rows - 2);
    cutDoor(cells, cols, split, Math.floor(rows * 0.55), 1, 2);
    put('chest', 2, 2);
    put('bench', 3, rows - 3);
    put('lantern', split + 2, 2);
    put('chest', cols - 3, 2);
  } else {
    put('chest', 2, 2);
    put('bench', Math.floor(cols / 2), Math.floor(rows / 2));
    put('lantern', cols - 3, 2);
  }

  return {
    id: b.id,
    sprite: b.sprite,
    label: b.label,
    ax: b.ax,
    ay: b.ay,
    x0: b.x0,
    y0: b.y0,
    x1: b.x1,
    y1: b.y1,
    doorX0: b.doorX0,
    doorX1: b.doorX1,
    doorY0: b.doorY0,
    doorY1: b.doorY1,
    footW: b.footW,
    footD: b.footD,
    shape: b.shape,
    cols,
    rows,
    cells,
    floor: rng.int(0, 7),
    furniture,
  };
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

function cellAt(plan: InteriorPlan, x: number, y: number): number {
  const col = Math.floor((x - plan.x0) * ZONE_SCALE);
  const row = Math.floor((y - plan.y0) * ZONE_SCALE);
  if (col < 0 || row < 0 || col >= plan.cols || row >= plan.rows) return CELL_VOID;
  return plan.cells[idx(col, row, plan.cols)]!;
}

function blockedInside(x: number, y: number, plan: InteriorPlan): boolean {
  if (inDoorway(x, y, plan)) return false;
  const corners: Array<[number, number]> = [
    [x - PLAYER_R, y - PLAYER_R],
    [x + PLAYER_R, y - PLAYER_R],
    [x - PLAYER_R, y + PLAYER_R],
    [x + PLAYER_R, y + PLAYER_R],
  ];
  for (const [cx, cy] of corners) {
    if (inDoorway(cx, cy, plan)) continue;
    if (!inBuildingLot(cx, cy, plan)) return true;
    const cell = cellAt(plan, cx, cy);
    if (cell === CELL_WALL || cell === CELL_VOID) return true;
  }
  return false;
}

function blockedOutside(x: number, y: number, buildings: StreetBuilding[]): boolean {
  for (const b of buildings) {
    if (inDoorway(x, y, b)) continue;
    const corners: Array<[number, number]> = [
      [x - PLAYER_R, y - PLAYER_R],
      [x + PLAYER_R, y - PLAYER_R],
      [x - PLAYER_R, y + PLAYER_R],
      [x + PLAYER_R, y + PLAYER_R],
    ];
    if (corners.some(([cx, cy]) => inBuildingLot(cx, cy, b) && !inDoorway(cx, cy, b))) return true;
  }
  return false;
}

export function resolveInteriorWalk(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  buildings: StreetBuilding[],
  inside: InteriorPlan | null,
): { x: number; y: number; enter: StreetBuilding | null; leave: boolean } {
  const blocked = (x: number, y: number) => (inside ? blockedInside(x, y, inside) : blockedOutside(x, y, buildings));
  let x = x1;
  let y = y1;
  if (blocked(x, y)) {
    if (!blocked(x1, y0)) {
      x = x1;
      y = y0;
    } else if (!blocked(x0, y1)) {
      x = x0;
      y = y1;
    } else {
      x = x0;
      y = y0;
    }
  }

  if (!inside) {
    for (const b of buildings) {
      if (inBuildingLot(x, y, b) && y < b.ay - 0.02) {
        return { x, y, enter: b, leave: false };
      }
      if (inDoorway(x, y, b) && y <= b.ay) {
        return { x, y, enter: b, leave: false };
      }
    }
    return { x, y, enter: null, leave: false };
  }

  const south = y > inside.ay + 0.03;
  const left = !inBuildingLot(x, y, inside) && !inDoorway(x, y, inside);
  if (south && (inDoorway(x, y, inside) || left)) return { x, y, enter: null, leave: true };
  return { x, y, enter: null, leave: false };
}

/** Exterior ring — those cells are the Town Tale facade, not interior partitions. */
export function isShellWall(plan: InteriorPlan, col: number, row: number): boolean {
  if (plan.cells[idx(col, row, plan.cols)] !== CELL_WALL) return false;
  const nbs: Array<[number, number]> = [
    [col - 1, row],
    [col + 1, row],
    [col, row - 1],
    [col, row + 1],
  ];
  for (const [c, r] of nbs) {
    if (c < 0 || r < 0 || c >= plan.cols || r >= plan.rows) return true;
    if (plan.cells[idx(c, r, plan.cols)] === CELL_VOID) return true;
  }
  return false;
}

export function interiorWallFill(sprite: string): string {
  if (sprite === 'church' || sprite === 'town-hall') return '#8a7a62';
  if (sprite.startsWith('cottage') || sprite === 'farm') return '#6a4e34';
  if (sprite === 'shop' || sprite === 'blacksmith') return '#5c4634';
  return '#4a3426';
}
