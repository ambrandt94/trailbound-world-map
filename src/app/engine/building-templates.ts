/**
 * Hand-authored building stamps.
 *
 * Edit the ASCII in `STAMPS`. Each character is one inner tile (1 m).
 * North is the first row; east is to the right. See docs/building-templates.md.
 *
 *   # yard    . floor    W wall    D door    o window    T tower    (space) void
 *
 * Placement rotates a stamp in 90° steps so its door faces the street.
 * The stamp's bounding box is the plot; cells that are not yard or void are structure.
 */
export type Cardinal = 'N' | 'E' | 'S' | 'W';

export type RoofStyle = 'gable' | 'hip' | 'shed' | 'flat' | 'cross-gable';
export type RoofRidge = 'E-W' | 'N-S';
export type BuildingRotation = 0 | 90 | 180 | 270;

export const PART_LEGEND = ['void', 'yard', 'floor', 'wall', 'door', 'window', 'tower'] as const;
export type BuildingPart = (typeof PART_LEGEND)[number];

export const PART_CODE: Record<BuildingPart, number> = {
  void: 0,
  yard: 1,
  floor: 2,
  wall: 3,
  door: 4,
  window: 5,
  tower: 6,
};

/** Metres of wall per storey when a stamp does not override it. */
export const METERS_PER_STOREY = 2.8;
/**
 * Hand-authored Town Tale stamps stay within 10×8 m.
 * Kit shells (P0 tavern, stables, temple, guildhall, …) may be larger, up to this.
 * 15 covers the town temple and guildhall (9×15 and 12×15). City heroes stay later.
 */
export const KIT_STRUCTURE_MAX = 15;

const PART_CHAR: Record<string, BuildingPart> = {
  ' ': 'void',
  '#': 'yard',
  '.': 'floor',
  W: 'wall',
  D: 'door',
  o: 'window',
  T: 'tower',
};

const CARDINALS: Cardinal[] = ['N', 'E', 'S', 'W'];

export interface RoofSpec {
  style: RoofStyle;
  /** Ridge axis in template space, before placement rotation. */
  ridge: RoofRidge;
}

export interface Opening {
  x: number;
  y: number;
  facing: Cardinal;
}

export interface BuildingTemplate {
  id: string;
  /** Legacy sprite / roster key (`cottage-1`, `shop`, …). */
  type: string;
  label: string;
  /** Plot width and depth in inner tiles. The ASCII stamp is exactly this size. */
  w: number;
  d: number;
  ascii: readonly string[];
  parts: BuildingPart[];
  storeys: number;
  wallHeightM: number;
  roof: RoofSpec;
  doors: Opening[];
  windows: Opening[];
  /** Facing of the primary door in template space. */
  doorFacing: Cardinal;
}

interface StampSource {
  id: string;
  type: string;
  label: string;
  storeys: number;
  roof: RoofSpec;
  ascii: readonly string[];
}

/**
 * Starter set. One stamp per roster type; cottages, the common houses, and
 * the shop have extra variants. Alex can add a row here without touching placement.
 */
const STAMPS: StampSource[] = [
  {
    id: 'cottage-1-a',
    type: 'cottage-1',
    label: 'Cottage',
    storeys: 1,
    roof: { style: 'gable', ridge: 'E-W' },
    ascii: [
      '##########',
      '##WoWWoW##',
      '##W....W##',
      '##W....W##',
      '##W....W##',
      '##WWDDWW##',
      '##########',
      '##########',
    ],
  },
  {
    id: 'cottage-1-b',
    type: 'cottage-1',
    label: 'Cottage',
    storeys: 1,
    roof: { style: 'gable', ridge: 'E-W' },
    ascii: [
      '##########',
      '##WoWW####',
      '##W..WWW##',
      '##W....W##',
      '##W....o##',
      '##WWDDWW##',
      '##########',
      '##########',
    ],
  },
  {
    id: 'cottage-1-c',
    type: 'cottage-1',
    label: 'Cottage',
    storeys: 1,
    roof: { style: 'hip', ridge: 'E-W' },
    ascii: [
      '##########',
      '##WWWWWW##',
      '##W....o##',
      '##W....D##',
      '##W....o##',
      '##WWWWWW##',
      '##########',
      '##########',
    ],
  },
  {
    id: 'cottage-2-a',
    type: 'cottage-2',
    label: 'Cottage',
    storeys: 1,
    roof: { style: 'gable', ridge: 'N-S' },
    ascii: [
      '##########',
      '##WWWWWW##',
      '##o....o##',
      '##W....W##',
      '##o....W##',
      '##WWDDWW##',
      '##########',
      '##########',
    ],
  },
  {
    id: 'cottage-2-b',
    type: 'cottage-2',
    label: 'Cottage',
    storeys: 1,
    roof: { style: 'shed', ridge: 'E-W' },
    ascii: [
      '##########',
      '###WWWWW##',
      '##WW...W##',
      '##W....W##',
      '##o....o##',
      '##WDDWWW##',
      '##########',
      '##########',
    ],
  },
  {
    id: 'cottage-3-a',
    type: 'cottage-3',
    label: 'Cottage',
    storeys: 1,
    roof: { style: 'hip', ridge: 'N-S' },
    ascii: [
      '##########',
      '##WWWWWW##',
      '##W....W##',
      '##o....o##',
      '##W....W##',
      '##WWDDWW##',
      '##########',
      '##########',
    ],
  },
  {
    id: 'cottage-3-b',
    type: 'cottage-3',
    label: 'Cottage',
    storeys: 1,
    roof: { style: 'gable', ridge: 'E-W' },
    ascii: [
      '##########',
      '##ToWWWW##',
      '##T....W##',
      '##W....o##',
      '##W....W##',
      '##WWDDWW##',
      '##########',
      '##########',
    ],
  },
  {
    id: 'house-1-a',
    type: 'house-1',
    label: 'House',
    storeys: 2,
    roof: { style: 'gable', ridge: 'E-W' },
    ascii: [
      '############',
      '##WWoWWoWW##',
      '##o......o##',
      '##W......W##',
      '##W......W##',
      '##o......o##',
      '##WWDDWWWW##',
      '############',
      '############',
      '############',
    ],
  },
  {
    id: 'house-1-b',
    type: 'house-1',
    label: 'House',
    storeys: 2,
    roof: { style: 'cross-gable', ridge: 'E-W' },
    ascii: [
      '############',
      '##TWWWWWWW##',
      '##T......o##',
      '##W......W##',
      '##W......W##',
      '##o......o##',
      '##WWDDWWWW##',
      '############',
      '############',
      '############',
    ],
  },
  {
    id: 'house-2-a',
    type: 'house-2',
    label: 'House',
    storeys: 1,
    roof: { style: 'gable', ridge: 'N-S' },
    ascii: [
      '###########',
      '##WWWWWWW##',
      '##o.....o##',
      '##W.....W##',
      '##W.....W##',
      '##o.....o##',
      '##WWWDWWW##',
      '###########',
      '###########',
    ],
  },
  {
    id: 'house-2-b',
    type: 'house-2',
    label: 'House',
    storeys: 2,
    roof: { style: 'gable', ridge: 'E-W' },
    ascii: [
      '############',
      '##WWWWWW####',
      '##o....o####',
      '##W....WWW##',
      '##W......o##',
      '##W......W##',
      '##WWDDWWWW##',
      '############',
      '############',
    ],
  },
  {
    id: 'house-3-a',
    type: 'house-3',
    label: 'House',
    storeys: 1,
    roof: { style: 'gable', ridge: 'E-W' },
    ascii: [
      '###########',
      '##WoWoWoW##',
      '##W.....W##',
      '##o.....o##',
      '##W.....W##',
      '##WWDDWWW##',
      '###########',
      '###########',
    ],
  },
  {
    id: 'house-5-a',
    type: 'house-5',
    label: 'House',
    storeys: 2,
    roof: { style: 'hip', ridge: 'E-W' },
    ascii: [
      '############',
      '##WWWWWWWW##',
      '##o......o##',
      '##W......W##',
      '##W......W##',
      '##o......o##',
      '##WWDDWWWW##',
      '############',
      '############',
    ],
  },
  {
    id: 'house-7-a',
    type: 'house-7',
    label: 'House',
    storeys: 2,
    roof: { style: 'cross-gable', ridge: 'N-S' },
    ascii: [
      '############',
      '##WWoWWoWW##',
      '##o......o##',
      '##W......W##',
      '##W......W##',
      '##W......W##',
      '##o......o##',
      '##WWDDWWWW##',
      '############',
      '############',
    ],
  },
  {
    id: 'house-8-a',
    type: 'house-8',
    label: 'House',
    storeys: 2,
    roof: { style: 'hip', ridge: 'N-S' },
    ascii: [
      '############',
      '####WWWWWW##',
      '####W....W##',
      '##WWW....W##',
      '##W......o##',
      '##W......W##',
      '##WWWWDDWW##',
      '############',
      '############',
    ],
  },
  {
    id: 'shop-a',
    type: 'shop',
    label: 'Shop',
    storeys: 1,
    roof: { style: 'shed', ridge: 'E-W' },
    ascii: [
      '###########',
      '##WoWoWoW##',
      '##W.....W##',
      '##o.....o##',
      '##W.....W##',
      '##W.....W##',
      '##WWDDDWW##',
      '###########',
      '###########',
    ],
  },
  {
    id: 'shop-b',
    type: 'shop',
    label: 'Shop',
    storeys: 1,
    roof: { style: 'gable', ridge: 'E-W' },
    ascii: [
      '###########',
      '##WWWWWW###',
      '##o....o###',
      '##W....WWW#',
      '##W......o#',
      '##W......W#',
      '##WWDDDWW##',
      '###########',
      '###########',
    ],
  },
  {
    id: 'blacksmith-a',
    type: 'blacksmith',
    label: 'Smithy',
    storeys: 1,
    roof: { style: 'shed', ridge: 'N-S' },
    ascii: [
      '############',
      '##WWWWWWW###',
      '##o.....o###',
      '##W.....W###',
      '##W.....W###',
      '##o.....o###',
      '##WWDDWWW###',
      '############',
      '############',
      '############',
    ],
  },
  {
    id: 'inn-a',
    type: 'inn',
    label: 'Inn',
    storeys: 2,
    roof: { style: 'cross-gable', ridge: 'E-W' },
    ascii: [
      '##############',
      '##WWWWWWW#####',
      '##W.....W#####',
      '##W.....W#####',
      '##W.....WWWo##',
      '##o........W##',
      '##W.....WWWW##',
      '##WWDDWWW#####',
      '##############',
      '##############',
      '##############',
      '##############',
    ],
  },
  {
    id: 'inn-2-a',
    type: 'inn-2',
    label: 'Inn',
    storeys: 2,
    roof: { style: 'gable', ridge: 'E-W' },
    ascii: [
      '############',
      '##WWWWWWWW##',
      '##o......o##',
      '##W......W##',
      '##W......W##',
      '##o......o##',
      '##WWDDWWWW##',
      '############',
      '############',
    ],
  },
  {
    id: 'tavern-a',
    type: 'tavern',
    label: 'Tavern',
    storeys: 2,
    roof: { style: 'gable', ridge: 'N-S' },
    ascii: [
      '############',
      '##WWWWWWWW##',
      '##o......o##',
      '##W......W##',
      '##W......W##',
      '##o......o##',
      '##WWWDDWWW##',
      '############',
      '############',
      '############',
    ],
  },
  {
    id: 'church-a',
    type: 'church',
    label: 'Church',
    storeys: 2,
    roof: { style: 'cross-gable', ridge: 'N-S' },
    ascii: [
      '##############',
      '##WWWWWWWWWW##',
      '##o...TT...o##',
      '##W...TT...W##',
      '##WWWWWWWWWW##',
      '#####W....W###',
      '#####W....W###',
      '#####WWDDWW###',
      '##############',
      '##############',
      '##############',
      '##############',
    ],
  },
  {
    id: 'town-hall-a',
    type: 'town-hall',
    label: 'Town hall',
    storeys: 2,
    roof: { style: 'hip', ridge: 'E-W' },
    ascii: [
      '##############',
      '##WWWW##WWWW##',
      '##W..W##W..W##',
      '##W..W##W..W##',
      '##W..WWWW..W##',
      '##W........W##',
      '##o........o##',
      '##WWWWDDWWWW##',
      '##############',
      '##############',
      '##############',
      '##############',
    ],
  },
  {
    id: 'farm-a',
    type: 'farm',
    label: 'Farmhouse',
    storeys: 1,
    roof: { style: 'gable', ridge: 'E-W' },
    ascii: [
      '############',
      '##WoWWoW####',
      '##W....W####',
      '##o....o####',
      '##W....W####',
      '##WWDDWW####',
      '############',
      '############',
      '############',
      '############',
    ],
  },
];

export function isStructure(part: BuildingPart): boolean {
  return part === 'floor' || part === 'wall' || part === 'door' || part === 'window' || part === 'tower';
}

export function rotateCardinal(dir: Cardinal, rotation: BuildingRotation): Cardinal {
  const steps = rotation / 90;
  return CARDINALS[(CARDINALS.indexOf(dir) + steps) % 4]!;
}

export function rotateRidge(ridge: RoofRidge, rotation: BuildingRotation): RoofRidge {
  if (rotation === 90 || rotation === 270) return ridge === 'E-W' ? 'N-S' : 'E-W';
  return ridge;
}

/** Clockwise steps that turn `from` into `to`. */
export function rotationForFacing(from: Cardinal, to: Cardinal): BuildingRotation {
  const steps = (CARDINALS.indexOf(to) - CARDINALS.indexOf(from) + 4) % 4;
  return (steps * 90) as BuildingRotation;
}

export function rotateParts(
  parts: readonly BuildingPart[],
  w: number,
  d: number,
  rotation: BuildingRotation,
): { parts: BuildingPart[]; w: number; d: number } {
  let cur: BuildingPart[] = parts.slice();
  let cw = w;
  let cd = d;
  const turns = rotation / 90;
  for (let s = 0; s < turns; s++) {
    const nw = cd;
    const nd = cw;
    const next: BuildingPart[] = new Array(nw * nd);
    for (let y = 0; y < cd; y++) {
      for (let x = 0; x < cw; x++) {
        const nx = cd - 1 - y;
        const ny = x;
        next[ny * nw + nx] = cur[y * cw + x]!;
      }
    }
    cur = next;
    cw = nw;
    cd = nd;
  }
  return { parts: cur, w: cw, d: cd };
}

export interface Aabb {
  x: number;
  y: number;
  w: number;
  d: number;
}

export function structureBounds(parts: readonly BuildingPart[], w: number, d: number): Aabb {
  let minX = w;
  let minY = d;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < w; x++) {
      if (!isStructure(parts[y * w + x]!)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 0, d: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, d: maxY - minY + 1 };
}

export function structureIsRect(parts: readonly BuildingPart[], w: number): boolean {
  const b = structureBounds(parts, w, Math.floor(parts.length / w));
  if (!b.w || !b.d) return false;
  for (let y = b.y; y < b.y + b.d; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      if (!isStructure(parts[y * w + x]!)) return false;
    }
  }
  return true;
}

function outside(parts: readonly BuildingPart[], w: number, d: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= w || y >= d) return true;
  const part = parts[y * w + x]!;
  return part === 'void' || part === 'yard';
}

function openingFacing(id: string, parts: readonly BuildingPart[], w: number, d: number, x: number, y: number): Cardinal {
  const opts: Array<{ dir: Cardinal; nx: number; ny: number }> = [
    { dir: 'N', nx: x, ny: y - 1 },
    { dir: 'E', nx: x + 1, ny: y },
    { dir: 'S', nx: x, ny: y + 1 },
    { dir: 'W', nx: x - 1, ny: y },
  ];
  const open = opts.filter((o) => outside(parts, w, d, o.nx, o.ny));
  if (!open.length) {
    throw new Error(`${id} opening at ${x},${y} has no outside neighbour`);
  }
  open.sort((a, b) => {
    const edge = (o: { dir: Cardinal; nx: number; ny: number }) => {
      if (o.dir === 'N') return y;
      if (o.dir === 'S') return d - 1 - y;
      if (o.dir === 'W') return x;
      return w - 1 - x;
    };
    return edge(a) - edge(b);
  });
  return open[0]!.dir;
}

function compile(src: StampSource): BuildingTemplate {
  const d = src.ascii.length;
  const w = src.ascii[0]?.length ?? 0;
  if (!w || !d) throw new Error(`${src.id} is empty`);
  const parts: BuildingPart[] = [];
  for (let y = 0; y < d; y++) {
    const row = src.ascii[y] ?? '';
    if (row.length !== w) throw new Error(`${src.id} row ${y} is ${row.length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x]!;
      const part = PART_CHAR[ch];
      if (!part) throw new Error(`${src.id} row ${y} has unknown '${ch}'`);
      parts.push(part);
    }
  }
  const doors: Opening[] = [];
  const windows: Opening[] = [];
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < w; x++) {
      const part = parts[y * w + x]!;
      if (part !== 'door' && part !== 'window') continue;
      const facing = openingFacing(src.id, parts, w, d, x, y);
      const opening = { x, y, facing };
      if (part === 'door') doors.push(opening);
      else windows.push(opening);
    }
  }
  if (!doors.length) throw new Error(`${src.id} has no door`);
  const counts = new Map<Cardinal, number>();
  for (const door of doors) counts.set(door.facing, (counts.get(door.facing) ?? 0) + 1);
  let doorFacing: Cardinal = doors[0]!.facing;
  let best = -1;
  for (const dir of CARDINALS) {
    const n = counts.get(dir) ?? 0;
    if (n > best) {
      best = n;
      doorFacing = dir;
    }
  }
  const bounds = structureBounds(parts, w, d);
  const kit = src.id.startsWith('bld_') || src.id.startsWith('kit:');
  const minSide = kit ? 2 : 4;
  const maxW = kit ? KIT_STRUCTURE_MAX : 10;
  const maxD = kit ? KIT_STRUCTURE_MAX : 8;
  if (bounds.w < minSide || bounds.d < minSide) throw new Error(`${src.id} structure ${bounds.w}×${bounds.d} is too small`);
  if (bounds.w > maxW || bounds.d > maxD) {
    throw new Error(`${src.id} structure ${bounds.w}×${bounds.d} exceeds ${maxW}×${maxD}`);
  }
  return {
    id: src.id,
    type: src.type,
    label: src.label,
    w,
    d,
    ascii: src.ascii,
    parts,
    storeys: src.storeys,
    wallHeightM: Math.round(src.storeys * METERS_PER_STOREY * 10) / 10,
    roof: src.roof,
    doors,
    windows,
    doorFacing,
  };
}

export const BUILDING_TEMPLATES: BuildingTemplate[] = STAMPS.map(compile);

const BY_ID = new Map(BUILDING_TEMPLATES.map((t) => [t.id, t]));
const BY_TYPE = new Map<string, BuildingTemplate[]>();
for (const t of BUILDING_TEMPLATES) {
  const list = BY_TYPE.get(t.type);
  if (list) list.push(t);
  else BY_TYPE.set(t.type, [t]);
}

export function templateById(id: string): BuildingTemplate | undefined {
  return BY_ID.get(id);
}

/** Register a generated kit shell. Placement reads it by id; it does not join legacy sprite variants. */
export function registerTemplate(tmpl: BuildingTemplate): void {
  if (BY_ID.has(tmpl.id)) return;
  BY_ID.set(tmpl.id, tmpl);
  const list = BY_TYPE.get(tmpl.type);
  if (list) list.push(tmpl);
  else BY_TYPE.set(tmpl.type, [tmpl]);
}

export function templatesForType(type: string): BuildingTemplate[] {
  return BY_TYPE.get(type) ?? [];
}

export function templateTypes(): string[] {
  return [...BY_TYPE.keys()];
}

const MASKS = new Map<string, { parts: BuildingPart[]; w: number; d: number }>();

/** Rotated stamp, cached. Placement and hit tests share this. */
export function placedMask(id: string, rotation: BuildingRotation): { parts: BuildingPart[]; w: number; d: number } | null {
  const key = `${id}:${rotation}`;
  const hit = MASKS.get(key);
  if (hit) return hit;
  const tmpl = BY_ID.get(id);
  if (!tmpl) return null;
  const mask = rotateParts(tmpl.parts, tmpl.w, tmpl.d, rotation);
  MASKS.set(key, mask);
  return mask;
}

export function rotatedSize(w: number, d: number, rotation: BuildingRotation): { w: number; d: number } {
  return rotation === 90 || rotation === 270 ? { w: d, d: w } : { w, d };
}
