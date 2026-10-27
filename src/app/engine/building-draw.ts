/**
 * Top-down roof tiles for street zoom. One inner tile is TILE/ZONE_SCALE pixels.
 * The south edge of each roof carries a wall lip so the building reads as a solid.
 */
import { TILE, ZONE_SCALE } from '../models/world.models';
import {
  BuildingPart,
  BuildingRotation,
  BuildingTemplate,
  Cardinal,
  isStructure,
  placedMask,
  rotateRidge,
  structureBounds,
} from './building-templates';

const CELL = TILE / ZONE_SCALE;

interface Palette {
  roof: string;
  roofDark: string;
  ridge: string;
  wall: string;
  wallDark: string;
  door: string;
  window: string;
  outline: string;
}

const THATCH: Palette = {
  roof: '#c4924a',
  roofDark: '#8d6230',
  ridge: '#e2c07a',
  wall: '#e4d2ae',
  wallDark: '#6b4428',
  door: '#6a3a1c',
  window: '#8fd4d2',
  outline: '#24160e',
};

const TILE_RED: Palette = {
  roof: '#a34538',
  roofDark: '#6e2c28',
  ridge: '#d06a58',
  wall: '#f0e2c4',
  wallDark: '#5c3a28',
  door: '#5a3018',
  window: '#9ad8dc',
  outline: '#24160e',
};

const SLATE: Palette = {
  roof: '#66727c',
  roofDark: '#3e4850',
  ridge: '#a8b4bc',
  wall: '#d9d3c6',
  wallDark: '#4a463e',
  door: '#4e3424',
  window: '#b7e4ea',
  outline: '#1a1612',
};

const SOOT: Palette = {
  roof: '#4e463e',
  roofDark: '#2e2a26',
  ridge: '#8a8176',
  wall: '#c4b49a',
  wallDark: '#3a2a22',
  door: '#3d2416',
  window: '#e8a050',
  outline: '#16120e',
};

function paletteFor(type: string): Palette {
  if (type === 'church' || type === 'town-hall') return SLATE;
  if (type === 'blacksmith') return SOOT;
  if (type.startsWith('cottage') || type === 'farm') return THATCH;
  return TILE_RED;
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

/** Draw one placed stamp. `left`/`top` are the plot's north-west corner in world pixels. */
export function drawTileBuilding(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  template: BuildingTemplate,
  rotation: BuildingRotation,
): void {
  const mask = placedMask(template.id, rotation);
  if (!mask) return;
  const pal = paletteFor(template.type);
  const bounds = structureBounds(mask.parts, mask.w, mask.d);
  const ridge = rotateRidge(template.roof.ridge, rotation);
  const style = template.roof.style;
  const { parts, w, d } = mask;
  const structAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= d) return false;
    return isStructure(parts[y * w + x]!);
  };

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < d; r++) {
    for (let c = 0; c < w; c++) {
      const part = parts[r * w + c]!;
      if (!isStructure(part)) continue;
      const px = left + c * CELL;
      const py = top + r * CELL;
      const n = structAt(c, r - 1);
      const e = structAt(c + 1, r);
      const s = structAt(c, r + 1);
      const wv = structAt(c - 1, r);
      const sx = c - bounds.x;
      const sy = r - bounds.y;
      let fill = pal.roof;
      if (style !== 'flat') {
        const gable = ridge === 'E-W' ? Math.abs(sy + 0.5 - bounds.d / 2) : Math.abs(sx + 0.5 - bounds.w / 2);
        const span = (ridge === 'E-W' ? bounds.d : bounds.w) / 2;
        if (style === 'shed') {
          const along = ridge === 'E-W' ? sy / Math.max(1, bounds.d) : sx / Math.max(1, bounds.w);
          fill = along > 0.55 ? pal.roofDark : pal.roof;
        } else if (gable < 0.55) {
          fill = pal.ridge;
        } else if (gable > span * 0.62) {
          fill = pal.roofDark;
        }
        if (style === 'cross-gable') {
          const other = ridge === 'E-W' ? Math.abs(sx + 0.5 - bounds.w / 2) : Math.abs(sy + 0.5 - bounds.d / 2);
          if (other < 0.55) fill = pal.ridge;
        }
        if (style === 'hip') {
          const exposed = Number(!n) + Number(!e) + Number(!s) + Number(!wv);
          if (exposed >= 2) fill = pal.roofDark;
        }
      }
      const eave = template.storeys >= 2 ? CELL * 0.06 : CELL * 0.03;
      ctx.fillStyle = fill;
      ctx.fillRect(px - eave, py - eave, CELL + eave * 2, CELL + eave * 2);
      if (part === 'tower') {
        const m = CELL * 0.22;
        ctx.fillStyle = pal.ridge;
        ctx.fillRect(px + m, py + m, CELL - m * 2, CELL - m * 2);
        ctx.fillStyle = pal.outline;
        ctx.fillRect(px + CELL * 0.46, py + CELL * 0.18, CELL * 0.08, CELL * 0.28);
      }
      if (!s) {
        const lip = part === 'tower' ? 0.56 : template.storeys >= 2 ? 0.4 : 0.3;
        ctx.fillStyle = pal.wall;
        ctx.fillRect(px, py + CELL * (1 - lip), CELL, CELL * lip);
        ctx.fillStyle = pal.wallDark;
        ctx.fillRect(px, py + CELL * (1 - lip), CELL, Math.max(0.08, CELL * 0.08));
      }
      if (part === 'door' || part === 'window') {
        const facing = outsideFacing(parts, w, d, c, r);
        const thick = part === 'door' ? 0.4 : 0.2;
        const inset = part === 'door' ? 0.18 : 0.28;
        ctx.fillStyle = part === 'door' ? pal.door : pal.window;
        if (facing === 'S') ctx.fillRect(px + CELL * inset, py + CELL * (1 - thick), CELL * (1 - inset * 2), CELL * thick);
        else if (facing === 'N') ctx.fillRect(px + CELL * inset, py, CELL * (1 - inset * 2), CELL * thick);
        else if (facing === 'E') ctx.fillRect(px + CELL * (1 - thick), py + CELL * inset, CELL * thick, CELL * (1 - inset * 2));
        else ctx.fillRect(px, py + CELL * inset, CELL * thick, CELL * (1 - inset * 2));
      }
      const o = Math.max(0.07, CELL * 0.08);
      ctx.fillStyle = pal.outline;
      if (!n) ctx.fillRect(px, py, CELL, o);
      if (!s) ctx.fillRect(px, py + CELL - o, CELL, o);
      if (!wv) ctx.fillRect(px, py, o, CELL);
      if (!e) ctx.fillRect(px + CELL - o, py, o, CELL);
    }
  }
  ctx.restore();
}
