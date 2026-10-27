/**
 * Street-zoom roofs, baked into the chunk canvas (16 px per inner tile).
 * Courses run along the ridge. One pitch is lit and one is shaded, and the
 * lit side follows the ridge after rotation. Walls stay a flat lip.
 */
import { ChunkData, PlacedSprite, TILE, chunkKey } from '../models/world.models';
import { isBuildingSprite } from './buildings';
import {
  BuildingPart,
  BuildingRotation,
  BuildingTemplate,
  Cardinal,
  RoofStyle,
  isStructure,
  placedMask,
  rotateRidge,
  structureBounds,
  templateById,
  templatesForType,
} from './building-templates';
import { hash2 } from './noise';

const CELL = TILE;

export type RoofMaterial = 'red-tile' | 'slate' | 'thatch' | 'wood-shingle';

type RGB = [number, number, number];

interface RoofPaint {
  litHi: RGB;
  litLo: RGB;
  shadeHi: RGB;
  shadeLo: RGB;
  seam: RGB;
  highlight: RGB;
  ridge: RGB;
  crease: RGB;
  trim: RGB;
  trimDark: RGB;
  rowH: number;
  colW: number;
  /** Vertical joints are straw breaks, not a tile grid. */
  thatch: boolean;
}

interface WallPaint {
  wall: RGB;
  wallDark: RGB;
  door: RGB;
  window: RGB;
  outline: RGB;
}

const RED: RoofPaint = {
  litHi: [228, 112, 64],
  litLo: [176, 64, 40],
  shadeHi: [112, 40, 64],
  shadeLo: [72, 24, 48],
  seam: [48, 16, 28],
  highlight: [248, 176, 120],
  ridge: [248, 214, 176],
  crease: [36, 12, 24],
  trim: [232, 196, 144],
  trimDark: [120, 72, 40],
  rowH: 4,
  colW: 5,
  thatch: false,
};

const SLATE: RoofPaint = {
  litHi: [176, 188, 196],
  litLo: [112, 128, 140],
  shadeHi: [64, 78, 98],
  shadeLo: [36, 46, 64],
  seam: [20, 24, 32],
  highlight: [220, 228, 232],
  ridge: [236, 240, 242],
  crease: [16, 18, 28],
  trim: [196, 188, 172],
  trimDark: [72, 68, 64],
  rowH: 3,
  colW: 4,
  thatch: false,
};

const THATCH: RoofPaint = {
  litHi: [232, 184, 72],
  litLo: [184, 128, 40],
  shadeHi: [120, 88, 32],
  shadeLo: [72, 56, 24],
  seam: [56, 40, 16],
  highlight: [248, 220, 140],
  ridge: [248, 232, 184],
  crease: [40, 28, 12],
  trim: [160, 104, 40],
  trimDark: [88, 52, 20],
  rowH: 5,
  colW: 7,
  thatch: true,
};

const WOOD: RoofPaint = {
  litHi: [196, 132, 68],
  litLo: [148, 88, 44],
  shadeHi: [104, 64, 44],
  shadeLo: [64, 36, 32],
  seam: [40, 24, 16],
  highlight: [228, 176, 112],
  ridge: [236, 204, 152],
  crease: [32, 18, 14],
  trim: [212, 168, 104],
  trimDark: [96, 56, 28],
  rowH: 5,
  colW: 6,
  thatch: false,
};

const MATERIALS: Record<RoofMaterial, RoofPaint> = {
  'red-tile': RED,
  slate: SLATE,
  thatch: THATCH,
  'wood-shingle': WOOD,
};

const THATCH_WALL: WallPaint = {
  wall: [228, 210, 174],
  wallDark: [107, 68, 40],
  door: [106, 58, 28],
  window: [143, 212, 210],
  outline: [36, 22, 14],
};

const RED_WALL: WallPaint = {
  wall: [240, 226, 196],
  wallDark: [92, 58, 40],
  door: [90, 48, 24],
  window: [154, 216, 220],
  outline: [36, 22, 14],
};

const SLATE_WALL: WallPaint = {
  wall: [217, 211, 198],
  wallDark: [74, 70, 62],
  door: [78, 52, 36],
  window: [183, 228, 234],
  outline: [26, 22, 18],
};

const SOOT_WALL: WallPaint = {
  wall: [196, 180, 154],
  wallDark: [58, 42, 34],
  door: [61, 36, 22],
  window: [232, 160, 80],
  outline: [22, 18, 14],
};

const roofCache = new Map<string, HTMLCanvasElement>();

function wallFor(type: string): WallPaint {
  if (type === 'church' || type === 'town-hall') return SLATE_WALL;
  if (type === 'blacksmith') return SOOT_WALL;
  if (type.startsWith('cottage') || type === 'farm') return THATCH_WALL;
  return RED_WALL;
}

/** Red, slate, thatch, wood. Weights follow the building type; the roll is the place seed. */
export function roofMaterialFor(type: string, templateId: string, ax: number, ay: number): RoofMaterial {
  const weights = weightsFor(type);
  let seed = 2166136261;
  for (let i = 0; i < templateId.length; i++) seed = Math.imul(seed ^ templateId.charCodeAt(i), 16777619);
  const h = hash2(Math.round(ax), Math.round(ay), seed >>> 0);
  let sum = 0;
  for (const w of weights) sum += w;
  let t = h * sum;
  const order: RoofMaterial[] = ['red-tile', 'slate', 'thatch', 'wood-shingle'];
  for (let i = 0; i < order.length; i++) {
    t -= weights[i]!;
    if (t < 0) return order[i]!;
  }
  return 'red-tile';
}

function weightsFor(type: string): [number, number, number, number] {
  if (type.startsWith('cottage') || type === 'farm') return [1, 0, 5, 3];
  if (type === 'church' || type === 'town-hall') return [2, 6, 0, 1];
  if (type === 'blacksmith') return [1, 3, 0, 5];
  if (type === 'shop') return [5, 1, 1, 2];
  if (type === 'tavern') return [2, 1, 4, 3];
  if (type.startsWith('inn')) return [4, 2, 2, 3];
  return [4, 2, 1, 3];
}

function shiftPaint(src: RoofPaint, j: number): RoofPaint {
  const s = (c: RGB, warm: number): RGB => [
    clamp255(c[0] + j * warm),
    clamp255(c[1] + j * 0.35),
    clamp255(c[2] - j * 0.45),
  ];
  return {
    ...src,
    litHi: s(src.litHi, 1),
    litLo: s(src.litLo, 1),
    shadeHi: s(src.shadeHi, 0.4),
    shadeLo: s(src.shadeLo, 0.4),
    highlight: s(src.highlight, 0.8),
    ridge: s(src.ridge, 0.5),
  };
}

function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function lerp(a: RGB, b: RGB, t: number): RGB {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function quant(c: RGB): RGB {
  return [q(c[0]), q(c[1]), q(c[2])];
}

function q(n: number): number {
  const v = Math.round(n / 8) * 8;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function put(data: Uint8ClampedArray, w: number, x: number, y: number, rgb: RGB): void {
  const i = (x + y * w) * 4;
  const c = quant(rgb);
  data[i] = c[0];
  data[i + 1] = c[1];
  data[i + 2] = c[2];
  data[i + 3] = 255;
}

function outsideFacing(parts: readonly BuildingPart[], w: number, d: number, x: number, y: number): Cardinal {
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

function wallLip(part: BuildingPart, storeys: number): number {
  if (part === 'tower') return 9;
  if (storeys >= 2) return 6;
  return 5;
}

interface Pitch {
  lit: boolean;
  ridge: boolean;
  crease: boolean;
  fall: number;
  /** 0 at the high edge, 1 at the low edge. Shed uses this instead of two pitches. */
  shed: number | null;
}

function pitchAt(style: RoofStyle, perp: number, para: number, spanPerp: number, spanPara: number): Pitch {
  const midPerp = spanPerp / 2;
  const midPara = spanPara / 2;
  const dPerp = perp - midPerp;
  const dPara = para - midPara;
  if (style === 'flat') return { lit: true, ridge: false, crease: false, fall: 0.4, shed: null };
  if (style === 'shed') {
    const t = spanPerp <= 1 ? 0 : perp / (spanPerp - 1);
    return { lit: t < 0.5, ridge: perp < 2, crease: false, fall: t, shed: t };
  }
  if (style === 'cross-gable') {
    if (Math.abs(dPerp) <= Math.abs(dPara)) {
      const fall = midPerp <= 0 ? 0 : Math.min(1, Math.abs(dPerp) / midPerp);
      return { lit: dPerp < 0, ridge: Math.abs(dPerp) < 1.35, crease: dPerp > 0 && fall < 0.2, fall, shed: null };
    }
    const fall = midPara <= 0 ? 0 : Math.min(1, Math.abs(dPara) / midPara);
    return { lit: dPara < 0, ridge: Math.abs(dPara) < 1.35, crease: dPara > 0 && fall < 0.2, fall, shed: null };
  }
  if (style === 'hip') {
    const ridgeHalf = Math.max(CELL * 0.5, (spanPara - spanPerp) / 2);
    const onRidge = Math.abs(dPerp) < 1.35 && Math.abs(dPara) < ridgeHalf;
    const side = Math.abs(dPara) > Math.abs(dPerp) + 0.5;
    const d = side ? dPara : dPerp;
    const span = side ? midPara : midPerp;
    const fall = span <= 0 ? 0 : Math.min(1, Math.abs(d) / span);
    return { lit: d < 0, ridge: onRidge, crease: !onRidge && d > 0 && fall < 0.2, fall, shed: null };
  }
  const fall = midPerp <= 0 ? 0 : Math.min(1, Math.abs(dPerp) / midPerp);
  return { lit: dPerp < 0, ridge: Math.abs(dPerp) < 1.35, crease: dPerp > 0 && fall < 0.2, fall, shed: null };
}

function courseColor(mat: RoofPaint, pitch: Pitch, perp: number, para: number, px: number, py: number, salt: number): RGB {
  if (pitch.ridge) return mat.ridge;
  if (pitch.crease) return mat.crease;
  let rgb: RGB;
  if (pitch.shed !== null) rgb = lerp(mat.litHi, mat.shadeLo, pitch.shed);
  else rgb = lerp(pitch.lit ? mat.litHi : mat.shadeHi, pitch.lit ? mat.litLo : mat.shadeLo, pitch.fall);
  const row = Math.floor(perp / mat.rowH);
  const stagger = row & 1 ? mat.colW >> 1 : 0;
  const rowPos = ((Math.floor(perp) % mat.rowH) + mat.rowH) % mat.rowH;
  const colPos = ((Math.floor(para) + stagger) % mat.colW + mat.colW) % mat.colW;
  const seamH = rowPos === mat.rowH - 1;
  const seamV = colPos === mat.colW - 1;
  if (seamH) rgb = lerp(rgb, mat.seam, 0.88);
  else if (seamV && !mat.thatch) rgb = lerp(rgb, mat.seam, 0.75);
  else if (mat.thatch && hash2(Math.floor(para / 3), row, salt) > 0.78) rgb = lerp(rgb, mat.seam, 0.55);
  else if (rowPos === 0 && (pitch.lit || (pitch.shed !== null && pitch.shed < 0.55))) rgb = lerp(rgb, mat.highlight, 0.7);
  else if (((px ^ py) & 1) === 0) rgb = lerp(rgb, pitch.lit ? mat.highlight : mat.seam, 0.16);
  return rgb;
}

function rasterRoof(template: BuildingTemplate, rotation: BuildingRotation, material: RoofMaterial, ax: number, ay: number): HTMLCanvasElement {
  const mask = placedMask(template.id, rotation);
  const canvas = document.createElement('canvas');
  if (!mask) return canvas;
  const { parts, w, d } = mask;
  canvas.width = w * CELL;
  canvas.height = d * CELL;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const pix = img.data;
  const bounds = structureBounds(parts, w, d);
  const ridge = rotateRidge(template.roof.ridge, rotation);
  const style = template.roof.style;
  const salt = Math.round(hash2(Math.round(ax), Math.round(ay), 91) * 997);
  const jitter = (hash2(Math.round(ax), Math.round(ay), salt + 3) - 0.5) * 22;
  const mat = shiftPaint(MATERIALS[material], jitter);
  const wall = wallFor(template.type);
  const spanPerp = (ridge === 'E-W' ? bounds.d : bounds.w) * CELL;
  const spanPara = (ridge === 'E-W' ? bounds.w : bounds.d) * CELL;
  const originPerp = (ridge === 'E-W' ? bounds.y : bounds.x) * CELL;
  const originPara = (ridge === 'E-W' ? bounds.x : bounds.y) * CELL;
  const structAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= d) return false;
    return isStructure(parts[y * w + x]!);
  };

  for (let r = 0; r < d; r++) {
    for (let c = 0; c < w; c++) {
      const part = parts[r * w + c]!;
      if (!isStructure(part)) continue;
      const n = structAt(c, r - 1);
      const e = structAt(c + 1, r);
      const s = structAt(c, r + 1);
      const wv = structAt(c - 1, r);
      const lip = !s ? wallLip(part, template.storeys) : 0;
      const facing = part === 'door' || part === 'window' ? outsideFacing(parts, w, d, c, r) : null;
      for (let py = 0; py < CELL; py++) {
        for (let px = 0; px < CELL; px++) {
          const gx = c * CELL + px;
          const gy = r * CELL + py;
          const inWall = lip > 0 && py >= CELL - lip;
          let rgb: RGB;
          if (inWall) {
            rgb = py === CELL - lip ? wall.wallDark : wall.wall;
          } else if (trimPixel(px, py, n, e, s, wv, lip)) {
            rgb = trimOuter(px, py, n, e, s, wv, lip) ? mat.trimDark : mat.trim;
          } else {
            const perp = (ridge === 'E-W' ? gy : gx) - originPerp;
            const para = (ridge === 'E-W' ? gx : gy) - originPara;
            const pitch = pitchAt(style, perp, para, spanPerp, spanPara);
            rgb = courseColor(mat, pitch, perp, para, px, py, salt);
            if (style === 'flat' && px + py < CELL * 0.65) rgb = lerp(rgb, mat.litHi, 0.28);
          }
          if (part === 'tower' && !inWall && px >= 4 && px < CELL - 4 && py >= 4 && py < CELL - 4) rgb = mat.ridge;
          if (part === 'tower' && px >= 7 && px <= 8 && py >= 3 && py <= 7) rgb = wall.outline;
          if (facing && openingPixel(facing, px, py, part)) rgb = part === 'door' ? wall.door : wall.window;
          if (edgePixel(px, py, n, e, s, wv)) rgb = wall.outline;
          put(pix, canvas.width, gx, gy, rgb);
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function trimPixel(px: number, py: number, n: boolean, e: boolean, s: boolean, w: boolean, lip: number): boolean {
  if (!n && py < 2) return true;
  if (!w && px < 2) return true;
  if (!e && px >= CELL - 2) return true;
  if (!s && lip > 0 && py >= CELL - lip - 2 && py < CELL - lip) return true;
  if (!s && lip === 0 && py >= CELL - 2) return true;
  return false;
}

function trimOuter(px: number, py: number, n: boolean, e: boolean, s: boolean, w: boolean, lip: number): boolean {
  if (!n && py === 0) return true;
  if (!w && px === 0) return true;
  if (!e && px === CELL - 1) return true;
  if (!s && lip > 0 && py === CELL - lip - 1) return true;
  if (!s && lip === 0 && py === CELL - 1) return true;
  return false;
}

function edgePixel(px: number, py: number, n: boolean, e: boolean, s: boolean, w: boolean): boolean {
  if (!n && py === 0) return true;
  if (!s && py === CELL - 1) return true;
  if (!w && px === 0) return true;
  if (!e && px === CELL - 1) return true;
  return false;
}

function openingPixel(facing: Cardinal, px: number, py: number, part: BuildingPart): boolean {
  const thick = Math.round((part === 'door' ? 0.4 : 0.2) * CELL);
  const inset = Math.round((part === 'door' ? 0.18 : 0.28) * CELL);
  if (facing === 'S') return px >= inset && px < CELL - inset && py >= CELL - thick;
  if (facing === 'N') return px >= inset && px < CELL - inset && py < thick;
  if (facing === 'E') return py >= inset && py < CELL - inset && px >= CELL - thick;
  return py >= inset && py < CELL - inset && px < thick;
}

function roofCanvas(template: BuildingTemplate, rotation: BuildingRotation, material: RoofMaterial, ax: number, ay: number): HTMLCanvasElement {
  const key = `${template.id}|${rotation}|${material}|${Math.round(ax)}|${Math.round(ay)}`;
  const hit = roofCache.get(key);
  if (hit) return hit;
  const canvas = rasterRoof(template, rotation, material, ax, ay);
  roofCache.set(key, canvas);
  return canvas;
}

/** Stamp every building whose plot touches this chunk. Roofs are not redrawn per frame. */
export function paintChunkRoofs(ctx: CanvasRenderingContext2D, chunk: ChunkData, chunks: Map<string, ChunkData>): void {
  const size = chunk.size;
  const originX = chunk.wx * size;
  const originY = chunk.wy * size;
  ctx.imageSmoothingEnabled = false;
  for (let wy = chunk.wy - 2; wy <= chunk.wy + 2; wy++) {
    for (let wx = chunk.wx - 2; wx <= chunk.wx + 2; wx++) {
      const other = chunks.get(chunkKey(wx, wy));
      if (!other) continue;
      for (const spr of other.sprites) blitSprite(ctx, spr, other, originX, originY, size);
    }
  }
}

function blitSprite(
  ctx: CanvasRenderingContext2D,
  spr: PlacedSprite,
  owner: ChunkData,
  originX: number,
  originY: number,
  size: number,
): void {
  if (!isBuildingSprite(spr.sprite)) return;
  const tmpl = (spr.templateId && templateById(spr.templateId)) || templatesForType(spr.sprite)[0];
  if (!tmpl) return;
  const rotation = spr.rotation ?? 0;
  const mask = placedMask(tmpl.id, rotation);
  if (!mask) return;
  const plotW = spr.footW ?? mask.w;
  const plotD = spr.footD ?? mask.d;
  const ax = owner.wx * owner.size + spr.x;
  const ay = owner.wy * owner.size + spr.y;
  const plotX = ax - plotW / 2;
  const plotY = ay - plotD;
  if (plotX + plotW <= originX || plotX >= originX + size || plotY + plotD <= originY || plotY >= originY + size) return;
  const material = roofMaterialFor(tmpl.type, tmpl.id, ax, ay);
  const roof = roofCanvas(tmpl, rotation, material, ax, ay);
  ctx.drawImage(roof, (plotX - originX) * TILE, (plotY - originY) * TILE);
}
