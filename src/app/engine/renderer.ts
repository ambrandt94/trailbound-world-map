import {
  Biome,
  CameraState,
  ChunkData,
  DETAIL_END,
  DETAIL_START,
  MapEntity,
  MapNode,
  POI_LABELS,
  PoiKind,
  PlayerState,
  TILE,
  WorldData,
  ZONE_SCALE,
  BIOME_COUNT,
  biomeAt,
  clamp,
  chunkKey,
  isInstancedZone,
  lerp,
  nodeBounds,
  smoothstep,
} from '../models/world.models';
import { ChatBubble, peerMarkerColor } from '../models/room.models';
import { LOCAL_PLAYER_ID } from './hero';
import { AssetLibrary, drawCharFrame } from './assets';
import { armyVisibleFollowers, boatChar, kindColor } from './entities';
import { buildingDrawOrigin, buildingDrawScale, buildingRoofFrac, isBuildingSprite } from './buildings';
import { CELL_DOOR, CELL_FLOOR, CELL_VOID, CELL_WALL, InteriorPlan, interiorWallFill, isShellWall } from './interior';
import { hash2 } from './noise';
import { biomeSeason, blobLocal, decoFor, FLOORS, GROUPS, overlayGroup, tileSrc } from './tileset';

const PIXEL_FONT = 'Tiny5, "Press Start 2P", ui-monospace, monospace';

type TagBox = { x: number; y: number; w: number; h: number };

function boxesOverlap(a: TagBox, b: TagBox, pad = 0): boolean {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

const NAMETAG_BASE_PX = 10;

function applyPoint(tr: DOMMatrix, x: number, y: number): { x: number; y: number } {
  return { x: tr.a * x + tr.c * y + tr.e, y: tr.b * x + tr.d * y + tr.f };
}

function applyBox(tr: DOMMatrix, b: TagBox): TagBox {
  const p = applyPoint(tr, b.x, b.y);
  const q = applyPoint(tr, b.x + b.w, b.y + b.h);
  return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
}

function drawNametag(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  opts?: { clearAbove?: number; clearBelow?: number; avoid?: TagBox[]; taken?: TagBox[]; screenPx?: number },
): TagBox | null {
  return drawTagLabel(ctx, text, x, y, scale, { ...opts, kind: 'name' });
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  opts?: { clearAbove?: number; clearBelow?: number; avoid?: TagBox[]; taken?: TagBox[]; screenPx?: number },
): TagBox | null {
  return drawTagLabel(ctx, text, x, y, scale, { ...opts, kind: 'speech' });
}

function drawTagLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  opts?: {
    clearAbove?: number;
    clearBelow?: number;
    avoid?: TagBox[];
    taken?: TagBox[];
    screenPx?: number;
    kind?: 'name' | 'speech';
  },
): TagBox | null {
  const raw = text.trim();
  if (!raw) return null;
  const kind = opts?.kind ?? 'name';
  const tr = ctx.getTransform();
  const dpr = Math.max(0.5, Math.hypot(tr.a, tr.b) / Math.max(0.001, scale));
  const screenPx = opts?.screenPx ?? NAMETAG_BASE_PX * (kind === 'speech' ? 2.8 : 2.5);
  const fontPx = Math.max(8, screenPx * dpr);
  const origin = applyPoint(tr, x, y);
  const uy = Math.hypot(tr.c, tr.d) || dpr * scale;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.font = `${fontPx}px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = (kind === 'speech' ? 16 : 13.2) * screenPx * dpr;
  let label = raw;
  while (ctx.measureText(label).width > maxW && label.length > 5) label = label.slice(0, -1);
  if (label !== raw) label = `${label.slice(0, -1)}…`;
  const tw = ctx.measureText(label).width;
  const padX = (kind === 'speech' ? 7.2 : 4.2) * dpr;
  const padY = (kind === 'speech' ? 4.2 : 2.1) * dpr;
  const tail = kind === 'speech' ? 5.5 * dpr : 0;
  const boxW = tw + padX * 2;
  const boxH = fontPx + padY * 2;
  const gap = (kind === 'speech' ? 5.5 : 3.2) * dpr;
  const clearA = (opts?.clearAbove ?? 0) * uy;
  const clearB = (opts?.clearBelow ?? 0) * uy;
  const aboveY = origin.y - clearA - gap - boxH / 2 - (kind === 'speech' ? tail * 0.35 : 0);
  const belowY = origin.y + clearB + gap + boxH / 2 + (kind === 'speech' ? tail * 0.35 : 0);
  const stackedY = aboveY - boxH - gap;
  const candidates: Array<{ cx: number; cy: number; flip: boolean }> =
    kind === 'speech'
      ? [
          { cx: origin.x, cy: aboveY, flip: false },
          { cx: origin.x, cy: stackedY, flip: false },
          { cx: origin.x + boxW * 0.55, cy: aboveY, flip: false },
          { cx: origin.x - boxW * 0.55, cy: aboveY, flip: false },
          { cx: origin.x + boxW * 0.55, cy: stackedY, flip: false },
          { cx: origin.x - boxW * 0.55, cy: stackedY, flip: false },
          { cx: origin.x, cy: belowY, flip: true },
        ]
      : [
          { cx: origin.x, cy: aboveY, flip: false },
          { cx: origin.x, cy: stackedY, flip: false },
          { cx: origin.x + boxW * 0.55, cy: aboveY, flip: false },
          { cx: origin.x - boxW * 0.55, cy: aboveY, flip: false },
          { cx: origin.x, cy: belowY, flip: true },
        ];
  const avoid = (opts?.avoid ?? []).map((b) => applyBox(tr, b));
  const taken = opts?.taken ?? [];
  let best: TagBox | null = null;
  let flip = false;
  for (const c of candidates) {
    const box: TagBox = { x: c.cx - boxW / 2, y: c.cy - boxH / 2, w: boxW, h: boxH + (kind === 'speech' ? tail : 0) };
    const hitsSprite = avoid.some((s) => boxesOverlap(box, s, 1.2 * dpr));
    const hitsTag = taken.some((s) => boxesOverlap(box, s, 2 * dpr));
    if (!hitsSprite && !hitsTag) {
      best = { x: c.cx - boxW / 2, y: c.cy - boxH / 2, w: boxW, h: boxH };
      flip = c.flip;
      break;
    }
    if (!best && !hitsSprite) {
      best = { x: c.cx - boxW / 2, y: c.cy - boxH / 2, w: boxW, h: boxH };
      flip = c.flip;
    }
  }
  if (!best) {
    best = { x: origin.x - boxW / 2, y: aboveY - boxH / 2, w: boxW, h: boxH };
  }
  const r = (kind === 'speech' ? 8 : 2.2) * dpr;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(best.x, best.y, best.w, best.h, r);
  else ctx.rect(best.x, best.y, best.w, best.h);
  if (kind === 'speech') {
    ctx.fillStyle = 'rgba(248, 241, 226, 0.96)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, 1.6 * dpr);
    ctx.strokeStyle = 'rgba(42, 28, 16, 0.78)';
    ctx.stroke();
    const midX = best.x + best.w / 2;
    ctx.beginPath();
    if (!flip) {
      ctx.moveTo(midX - 5 * dpr, best.y + best.h - 0.5);
      ctx.lineTo(midX, best.y + best.h + tail);
      ctx.lineTo(midX + 5 * dpr, best.y + best.h - 0.5);
    } else {
      ctx.moveTo(midX - 5 * dpr, best.y + 0.5);
      ctx.lineTo(midX, best.y - tail);
      ctx.lineTo(midX + 5 * dpr, best.y + 0.5);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(248, 241, 226, 0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(42, 28, 16, 0.78)';
    ctx.stroke();
    ctx.fillStyle = '#2a1c12';
  } else {
    ctx.fillStyle = 'rgba(14, 11, 9, 0.82)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = 'rgba(228, 196, 138, 0.35)';
    ctx.stroke();
    ctx.fillStyle = '#f3ead6';
  }
  ctx.fillText(label, best.x + best.w / 2, best.y + best.h / 2 + 0.4 * dpr);
  ctx.restore();
  const occupied: TagBox = {
    x: best.x,
    y: flip && kind === 'speech' ? best.y - tail : best.y,
    w: best.w,
    h: best.h + (kind === 'speech' ? tail : 0),
  };
  taken.push(occupied);
  return occupied;
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
): void {
  ctx.drawImage(img, sx, sy, TILE, TILE, dx, dy, TILE, TILE);
}

function spriteWorldScale(img: HTMLImageElement): number {
  const tall = img.height >= 160 || img.width >= 160;
  const prop = img.height < 96 && img.width < 96;
  const targetH = TILE * (tall ? 0.7 : prop ? 0.3 : 0.48);
  const targetW = TILE * (tall ? 0.62 : prop ? 0.26 : 0.42);
  return Math.min(targetH / img.height, targetW / img.width);
}

/** One sprite pixel matches one inner-zone tile pixel. */
function characterWorldH(pxH: number): number {
  return pxH / ZONE_SCALE;
}

function grassSrc(biome: Biome): { sx: number; sy: number } {
  return tileSrc(GROUPS.plateau, biomeSeason(biome === Biome.Water ? Biome.Plains : biome), 1, 1);
}

function pathSeason(biome: Biome): number {
  return biomeSeason(biome);
}

/** Overworld bake budget: 384 cells × 16px ≈ 6k canvas (8-tile cells at 16×). */
const WORLD_BAKE_MAX_CELLS = 384;

function worldBakeStep(width: number, maxCells: number): number {
  const minStep = Math.max(1, Math.ceil(width / maxCells));
  for (let s = minStep; s <= width; s++) {
    if (width % s === 0) return s;
  }
  return minStep;
}

function worldWrapShifts(cameraX: number, halfW: number, width: number, viewTilesX: number): number[] {
  if (viewTilesX >= width * 0.92) return [0];
  const shifts = [0];
  if (cameraX - halfW < 0) shifts.push(-width);
  if (cameraX + halfW > width) shifts.push(width);
  return shifts;
}

function drawBoatMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string,
  facing: number,
  kind: MapEntity['kind'],
): void {
  const s = (kind === 'army' ? 14 : kind === 'caravan' ? 12 : 10) / scale;
  ctx.save();
  ctx.translate(x * TILE, y * TILE);
  const rot = [Math.PI, -Math.PI / 2, Math.PI / 2, 0][facing & 3]!;
  ctx.rotate(rot);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.95);
  ctx.lineTo(s * 0.38, s * 0.22);
  ctx.lineTo(s * 0.22, s * 0.55);
  ctx.lineTo(-s * 0.22, s * 0.55);
  ctx.lineTo(-s * 0.38, s * 0.22);
  ctx.closePath();
  ctx.fillStyle = '#6b3d18';
  ctx.fill();
  ctx.lineWidth = 1.2 / scale;
  ctx.strokeStyle = '#1a120c';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, s * 0.28);
  ctx.lineTo(0, -s * 1.05);
  ctx.strokeStyle = '#2a1810';
  ctx.lineWidth = 1.4 / scale;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.4 / scale, -s * 0.98);
  ctx.lineTo(s * 0.72, -s * 0.12);
  ctx.lineTo(0.4 / scale, s * 0.2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#f3efe6';
  ctx.lineWidth = 0.9 / scale;
  ctx.stroke();
  ctx.restore();
}


export class WorldRenderer {
  worldBake: HTMLCanvasElement | null = null;
  zoneBake: HTMLCanvasElement | null = null;
  cloudBake: HTMLCanvasElement | null = null;
  private readonly chunkBakes = new Map<string, HTMLCanvasElement>();
  private isoLayer: HTMLCanvasElement | null = null;
  private fogLayer: HTMLCanvasElement | null = null;
  private blurLayer: HTMLCanvasElement | null = null;
  private tagScreenPx = NAMETAG_BASE_PX * 2.5;

  constructor(private readonly assets: AssetLibrary) {}

  bakeWorld(world: WorldData): void {
    const step = worldBakeStep(world.width, WORLD_BAKE_MAX_CELLS);
    this.bakeWorldTileset(world, step, TILE);
  }

  private bakeWorldTileset(world: WorldData, step: number, stamp: number): void {
    const cellsX = Math.ceil(world.width / step);
    const cellsY = Math.ceil(world.height / step);
    const cellBiomes = new Uint8Array(cellsX * cellsY);
    const cellPaths = new Uint8Array(cellsX * cellsY);
    const counts = new Array<number>(BIOME_COUNT).fill(0);

    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        counts.fill(0);
        let pathN = 0;
        let landN = 0;
        const x0 = cx * step;
        const y0 = cy * step;
        const x1 = Math.min(world.width, x0 + step);
        const y1 = Math.min(world.height, y0 + step);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const biome = world.biomes[x + y * world.width]!;
            counts[biome]++;
            if (biome !== Biome.Water) {
              landN++;
              if (world.paths[x + y * world.width]) pathN++;
            }
          }
        }
        let best = Biome.Water;
        let bestN = -1;
        for (let b = 0; b < counts.length; b++) {
          if (counts[b]! > bestN) {
            bestN = counts[b]!;
            best = b;
          }
        }
        const area = Math.max(1, (x1 - x0) * (y1 - y0));
        const waterN = counts[Biome.Water] ?? 0;
        if (waterN / area >= 0.22) best = Biome.Water;
        const i = cx + cy * cellsX;
        cellBiomes[i] = best;
        cellPaths[i] = landN && pathN / Math.max(1, landN) > 0.08 ? 1 : 0;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = cellsX * stamp;
    canvas.height = cellsY * stamp;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const g = this.assets.grasslands;
    const stampTile = (sx: number, sy: number, cx: number, cy: number) => {
      ctx.drawImage(g, sx, sy, TILE, TILE, cx * stamp, cy * stamp, stamp, stamp);
    };
    const cellAt = (cx: number, cy: number): Biome => {
      if (cy < 0 || cy >= cellsY) return Biome.Water;
      const wx = ((cx % cellsX) + cellsX) % cellsX;
      return cellBiomes[wx + cy * cellsX] as Biome;
    };

    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        const biome = cellBiomes[cx + cy * cellsX] as Biome;
        const grass = grassSrc(biome);
        stampTile(grass.sx, grass.sy, cx, cy);

        const group = overlayGroup(biome);
        if (group !== null) {
          const n = cellAt(cx, cy - 1) === biome;
          const e = cellAt(cx + 1, cy) === biome;
          const s = cellAt(cx, cy + 1) === biome;
          const w = cellAt(cx - 1, cy) === biome;
          const [lx, ly] = blobLocal(n, e, s, w);
          const src = tileSrc(group, biomeSeason(biome), lx, ly);
          stampTile(src.sx, src.sy, cx, cy);
        }

        if (cellPaths[cx + cy * cellsX] && biome !== Biome.Water) {
          const wrap = (ix: number) => ((ix % cellsX) + cellsX) % cellsX;
          const pn = cy > 0 && !!cellPaths[cx + (cy - 1) * cellsX];
          const pe = !!cellPaths[wrap(cx + 1) + cy * cellsX];
          const ps = cy + 1 < cellsY && !!cellPaths[cx + (cy + 1) * cellsX];
          const pw = !!cellPaths[wrap(cx - 1) + cy * cellsX];
          const [lx, ly] = blobLocal(pn, pe, ps, pw);
          const src = tileSrc(GROUPS.path, pathSeason(biome), lx, ly);
          stampTile(src.sx, src.sy, cx, cy);
        }

        const deco = (cx * 17 + cy * 31 + biome * 7) % 23;
        if ((biome === Biome.Plains || biome === Biome.Meadow) && deco === 0) {
          const d = decoFor(biome, 'flower');
          stampTile(d.sx, d.sy, cx, cy);
        } else if (biome === Biome.Meadow && deco === 4) {
          const d = decoFor(biome, 'leaf');
          stampTile(d.sx, d.sy, cx, cy);
        } else if ((biome === Biome.Hills || biome === Biome.Heath || biome === Biome.Desert) && deco === 2) {
          const d = decoFor(biome, 'pebble');
          stampTile(d.sx, d.sy, cx, cy);
        } else if (biome === Biome.Water && deco === 5) {
          const d = decoFor(biome, 'ripple');
          stampTile(d.sx, d.sy, cx, cy);
        } else if ((biome === Biome.Marsh || biome === Biome.Jungle) && deco === 6) {
          const d = decoFor(biome, 'lily');
          stampTile(d.sx, d.sy, cx, cy);
        }
      }
    }

    this.worldBake = canvas;
  }

  bakeZones(world: WorldData): HTMLCanvasElement | null {
    const nodes = world.nodes;
    const w = Math.max(1, Math.min(2048, world.width));
    const h = Math.max(1, Math.min(2048, world.height));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.zoneBake = canvas;
      return canvas;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const sx = w / world.width;
    const sy = h / world.height;
    const paint = (node: MapNode) => {
      const tiles = node.tiles;
      const rgb = countyRgb(node);
      const fill = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${node.poiKind ? 0.88 : 0.72})`;
      if (!tiles?.length) {
        const b = nodeBounds(node);
        ctx.fillStyle = fill;
        ctx.fillRect(b.x0 * sx, b.y0 * sy, Math.max(1, (b.x1 - b.x0) * sx), Math.max(1, (b.y1 - b.y0) * sy));
        return;
      }
      ctx.fillStyle = fill;
      for (const t of tiles) {
        ctx.fillRect(t.x * sx, t.y * sy, Math.max(1, sx), Math.max(1, sy));
      }
    };
    for (const node of nodes) {
      if (node.poiKind) continue;
      paint(node);
    }
    for (const node of nodes) {
      if (!node.poiKind) continue;
      paint(node);
    }
    this.zoneBake = canvas;
    return canvas;
  }

  bakeClouds(world: WorldData, explored: Set<string>): HTMLCanvasElement | null {
    const span = Math.max(world.width, world.height);
    const cell = Math.max(1, Math.ceil(span / 640));
    const w = Math.max(1, Math.ceil(world.width / cell));
    const h = Math.max(1, Math.ceil(world.height / cell));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.cloudBake = canvas;
      return canvas;
    }
    const img = ctx.createImageData(w, h);
    const pix = img.data;
    const seed = world.seed ^ 0xf09;
    const clear = new Uint8Array(w * h);
    for (let py = 0; py < h; py++) {
      const wy = Math.min(world.height - 1, Math.floor(py * cell + cell * 0.5));
      for (let px = 0; px < w; px++) {
        const wx = Math.min(world.width - 1, Math.floor(px * cell + cell * 0.5));
        const water = world.biomes[wx + wy * world.width] === Biome.Water;
        if (water || explored.has(`${wx},${wy}`)) clear[px + py * w] = 1;
      }
    }
    const rim = (px: number, py: number): boolean => {
      if (px > 0 && clear[px - 1 + py * w]) return true;
      if (px + 1 < w && clear[px + 1 + py * w]) return true;
      if (py > 0 && clear[px + (py - 1) * w]) return true;
      if (py + 1 < h && clear[px + (py + 1) * w]) return true;
      return false;
    };
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = px + py * w;
        const oi = i * 4;
        if (clear[i]) {
          pix[oi + 3] = 0;
          continue;
        }
        const n = hash2(px, py, seed);
        const shade = rim(px, py) ? 12 : 20 + n * 10;
        pix[oi] = shade;
        pix[oi + 1] = shade + 4;
        pix[oi + 2] = shade + 8;
        pix[oi + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.cloudBake = canvas;
    return canvas;
  }

  bakeChunk(chunk: ChunkData, neighbors: Map<string, ChunkData>, world: WorldData): void {
    const canvas = document.createElement('canvas');
    canvas.width = chunk.size * TILE;
    canvas.height = chunk.size * TILE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const g = this.assets.grasslands;
    const floors = this.assets.floors;
    const street = FLOORS[chunk.streetFloor] ?? FLOORS[0]!;
    const plaza = FLOORS[chunk.plazaFloor] ?? FLOORS[4]!;
    const size = chunk.size;

    const tileAt = (lx: number, ly: number): Biome => {
      let wx = chunk.wx;
      let wy = chunk.wy;
      let x = lx;
      let y = ly;
      if (lx < 0) {
        wx -= 1;
        x = size + lx;
      } else if (lx >= size) {
        wx += 1;
        x = lx - size;
      }
      if (ly < 0) {
        wy -= 1;
        y = size + ly;
      } else if (ly >= size) {
        wy += 1;
        y = ly - size;
      }
      if (wx === chunk.wx && wy === chunk.wy) return chunk.tiles[x + y * size] as Biome;
      const other = neighbors.get(chunkKey(wx, wy));
      if (other) return other.tiles[x + y * size] as Biome;
      return biomeAt(world, wx + 0.5, wy + 0.5);
    };

    const pathAt = (lx: number, ly: number): boolean => {
      let wx = chunk.wx;
      let wy = chunk.wy;
      let x = lx;
      let y = ly;
      if (lx < 0) {
        wx -= 1;
        x = size + lx;
      } else if (lx >= size) {
        wx += 1;
        x = lx - size;
      }
      if (ly < 0) {
        wy -= 1;
        y = size + ly;
      } else if (ly >= size) {
        wy += 1;
        y = ly - size;
      }
      if (wx === chunk.wx && wy === chunk.wy) return !!chunk.paths[x + y * size];
      const other = neighbors.get(chunkKey(wx, wy));
      if (other) return !!other.paths[x + y * size];
      if (wx < 0 || wy < 0 || wx >= world.width || wy >= world.height) return false;
      return !!world.paths[wx + wy * world.width];
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const biome = chunk.tiles[x + y * size] as Biome;
        const grass = grassSrc(biome);
        drawTile(ctx, g, grass.sx, grass.sy, x * TILE, y * TILE);
        const group = overlayGroup(biome);
        if (group !== null) {
          const n = tileAt(x, y - 1) === biome;
          const e = tileAt(x + 1, y) === biome;
          const s = tileAt(x, y + 1) === biome;
          const w = tileAt(x - 1, y) === biome;
          const [lx, ly] = blobLocal(n, e, s, w);
          const src = tileSrc(group, biomeSeason(biome), lx, ly);
          drawTile(ctx, g, src.sx, src.sy, x * TILE, y * TILE);
        }
        const floor = chunk.cobble[x + y * size];
        if (floor && biome !== Biome.Water) {
          const src = floor === 2 ? plaza : street;
          drawTile(ctx, floors, src.sx, src.sy, x * TILE, y * TILE);
        } else if (chunk.paths[x + y * size] && biome !== Biome.Water) {
          const [lx, ly] = blobLocal(pathAt(x, y - 1), pathAt(x + 1, y), pathAt(x, y + 1), pathAt(x - 1, y));
          const src = tileSrc(GROUPS.path, biomeSeason(biome), lx, ly);
          drawTile(ctx, g, src.sx, src.sy, x * TILE, y * TILE);
        }
      }
    }

    this.chunkBakes.set(chunkKey(chunk.wx, chunk.wy), canvas);
  }

  clearChunks(): void {
    this.chunkBakes.clear();
  }

  hasChunk(wx: number, wy: number): boolean {
    return this.chunkBakes.has(chunkKey(wx, wy));
  }

  draw(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    camera: CameraState,
    player: PlayerState,
    viewW: number,
    viewH: number,
    opts: {
      showOutlines: boolean;
      showPois: boolean;
      visiblePoiIds?: Set<string> | null;
      hoveredId: string | null;
      hoveredPoiId: string | null;
      hoveredEntityId: string | null;
      detailNode: MapNode | null;
      entities: MapEntity[];
      /** Drawn as pins on the unmasked canvas (e.g. travelers outside isolation). */
      markerEntities?: MapEntity[];
      chunks?: Map<string, ChunkData>;
      isolateChunk?: { wx: number; wy: number } | null;
      isolateTiles?: Array<{ x: number; y: number }> | null;
      showPlayer?: boolean;
      outlineAmt?: number;
      cloudAmt?: number;
      /** Multiplier on the original 10px nametag (2.5 = default / slider middle). */
      nametagScale?: number;
      /** Other players in an online room. */
      remotePlayers?: PlayerState[];
      /** peerId of the local walker for speech-bubble anchoring. */
      localPeerId?: string | null;
      speechBubbles?: ChatBubble[];
      interior?: InteriorPlan | null;
    },
  ): void {
    this.tagScreenPx = NAMETAG_BASE_PX * clamp(opts.nametagScale ?? 2.5, 0.5, 4.5);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#151b22';
    ctx.fillRect(0, 0, viewW, viewH);

    const isolated = opts.isolateTiles?.length
      ? opts.isolateTiles
      : opts.isolateChunk
        ? [{ x: opts.isolateChunk.wx, y: opts.isolateChunk.wy }]
        : null;

    if (isolated) {
      const isoKeys = new Set(isolated.map((t) => chunkKey(t.x, t.y)));
      const contextNodes: MapNode[] = [];
      const isoNodes: MapNode[] = [];
      for (const node of world.nodes) {
        if (this.nodeInIsolation(node, isoKeys)) isoNodes.push(node);
        else contextNodes.push(node);
      }
      ctx.save();
      ctx.translate(viewW / 2, viewH / 2);
      ctx.scale(camera.scale, camera.scale);
      ctx.translate(-camera.x * TILE, -camera.y * TILE);
      if (this.worldBake) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.34;
        ctx.drawImage(this.worldBake, 0, 0, world.width * TILE, world.height * TILE);
        ctx.globalAlpha = 1;
      }
      this.drawOutlines(
        ctx,
        contextNodes,
        camera.scale,
        opts.showOutlines,
        opts.hoveredId,
        0,
        opts.detailNode,
        opts.outlineAmt ?? 0.7,
        true,
      );
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      for (const t of isolated) {
        ctx.rect(t.x * TILE, t.y * TILE, TILE, TILE);
      }
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
      ctx.restore();

      const layer = this.ensureIsoLayer(viewW, viewH);
      const lctx = layer.getContext('2d');
      if (!lctx) return;
      const detailT = smoothstep(DETAIL_START, DETAIL_END, camera.scale);
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, viewW, viewH);
      lctx.imageSmoothingEnabled = false;
      lctx.save();
      lctx.translate(viewW / 2, viewH / 2);
      lctx.scale(camera.scale, camera.scale);
      lctx.translate(-camera.x * TILE, -camera.y * TILE);
      this.drawVisibleChunks(lctx, camera, viewW, viewH, world, 1, isoKeys);
      this.drawChunkSprites(lctx, camera, viewW, viewH, world, 1, opts.chunks, isoKeys, opts.interior);
      if (opts.interior) this.drawInterior(lctx, opts.interior);
      this.drawOutlines(
        lctx,
        isoNodes,
        camera.scale,
        opts.showOutlines,
        opts.hoveredId,
        detailT,
        opts.detailNode,
        opts.outlineAmt ?? 0.7,
      );
      this.drawEntities(
        lctx,
        opts.entities,
        camera,
        viewW,
        viewH,
        player,
        opts.hoveredEntityId,
        0,
        !!opts.showPlayer,
        opts.remotePlayers,
        opts.speechBubbles,
        opts.localPeerId,
      );
      lctx.restore();
      if (opts.interior) this.applyInteriorBlur(lctx, opts.interior, camera, viewW, viewH);
      this.applyScreenFog(lctx, isolated, camera, viewW, viewH);
      lctx.save();
      lctx.translate(viewW / 2, viewH / 2);
      lctx.scale(camera.scale, camera.scale);
      lctx.translate(-camera.x * TILE, -camera.y * TILE);
      this.drawPois(lctx, world, camera.scale, opts.showPois, opts.hoveredPoiId, opts.detailNode, opts.visiblePoiIds);
      lctx.restore();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(layer, 0, 0);
      const remote = opts.markerEntities;
      if (remote?.length) {
        ctx.save();
        ctx.translate(viewW / 2, viewH / 2);
        ctx.scale(camera.scale, camera.scale);
        ctx.translate(-camera.x * TILE, -camera.y * TILE);
        this.drawEntityPins(ctx, remote, camera, viewW, viewH, opts.hoveredEntityId);
        ctx.restore();
      }
      return;
    }

    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x * TILE, -camera.y * TILE);

    if (this.worldBake) {
      ctx.imageSmoothingEnabled = false;
      const wpx = world.width * TILE;
      const hpx = world.height * TILE;
      ctx.drawImage(this.worldBake, 0, 0, wpx, hpx);
      const halfW = viewW / (2 * camera.scale) / TILE;
      const viewTilesX = viewW / (camera.scale * TILE);
      if (viewTilesX < world.width * 0.92) {
        if (camera.x - halfW < 0) ctx.drawImage(this.worldBake, -wpx, 0, wpx, hpx);
        if (camera.x + halfW > world.width) ctx.drawImage(this.worldBake, wpx, 0, wpx, hpx);
      }
    }

    const featureAlpha = smoothstep(0.35, 1.35, camera.scale);
    const detailT = smoothstep(DETAIL_START, DETAIL_END, camera.scale);
    const halfW = viewW / (2 * camera.scale) / TILE;
    const viewTilesX = viewW / (camera.scale * TILE);
    const wrapShifts = worldWrapShifts(camera.x, halfW, world.width, viewTilesX);
    if (featureAlpha > 0.02) {
      ctx.globalAlpha = featureAlpha;
      for (const shift of wrapShifts) {
        ctx.save();
        ctx.translate(shift * TILE, 0);
        this.drawFeatures(ctx, world, camera, viewW, viewH, featureAlpha, detailT, shift);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    if (detailT > 0.02) {
      this.drawVisibleChunks(ctx, camera, viewW, viewH, world, detailT);
      this.drawChunkSprites(ctx, camera, viewW, viewH, world, detailT, opts.chunks, undefined, opts.interior);
      if (opts.interior) this.drawInterior(ctx, opts.interior);
    }

    for (const shift of wrapShifts) {
      ctx.save();
      ctx.translate(shift * TILE, 0);
      this.drawOutlines(
        ctx,
        world.nodes,
        camera.scale,
        opts.showOutlines,
        opts.hoveredId,
        detailT,
        opts.detailNode,
        opts.outlineAmt ?? 0.7,
      );
      ctx.restore();
    }

    const cloudAmt = clamp(opts.cloudAmt ?? 0.92, 0, 1);
    if (this.cloudBake && cloudAmt > 0.01) {
      const wpx = world.width * TILE;
      const hpx = world.height * TILE;
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = cloudAmt;
      for (const shift of wrapShifts) {
        ctx.save();
        ctx.translate(shift * TILE, 0);
        ctx.drawImage(this.cloudBake, 0, 0, wpx, hpx);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = smooth;
    }

    for (const shift of wrapShifts) {
      ctx.save();
      ctx.translate(shift * TILE, 0);
      this.drawEntities(
        ctx,
        opts.entities,
        camera,
        viewW,
        viewH,
        player,
        opts.hoveredEntityId,
        shift,
        !!opts.showPlayer,
        opts.remotePlayers,
        opts.speechBubbles,
        opts.localPeerId,
      );
      this.drawPois(ctx, world, camera.scale, opts.showPois, opts.hoveredPoiId, opts.detailNode, opts.visiblePoiIds);
      ctx.restore();
    }
    ctx.restore();
    if (opts.interior) this.applyInteriorBlur(ctx, opts.interior, camera, viewW, viewH);
  }

  private ensureLayer(current: HTMLCanvasElement | null, viewW: number, viewH: number): HTMLCanvasElement {
    const w = Math.max(1, Math.ceil(viewW));
    const h = Math.max(1, Math.ceil(viewH));
    if (!current || current.width !== w || current.height !== h) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      return canvas;
    }
    return current;
  }

  private ensureIsoLayer(viewW: number, viewH: number): HTMLCanvasElement {
    this.isoLayer = this.ensureLayer(this.isoLayer, viewW, viewH);
    return this.isoLayer;
  }

  private applyScreenFog(
    ctx: CanvasRenderingContext2D,
    tiles: Array<{ x: number; y: number }>,
    camera: CameraState,
    viewW: number,
    viewH: number,
  ): void {
    this.fogLayer = this.ensureLayer(this.fogLayer, viewW, viewH);
    const mask = this.fogLayer;
    const mctx = mask.getContext('2d');
    if (!mctx) return;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mask.width, mask.height);
    mctx.fillStyle = '#fff';
    mctx.save();
    mctx.translate(viewW / 2, viewH / 2);
    mctx.scale(camera.scale, camera.scale);
    mctx.translate(-camera.x * TILE, -camera.y * TILE);
    const halfW = viewW / (2 * camera.scale) / TILE + 2;
    const halfH = viewH / (2 * camera.scale) / TILE + 2;
    const x0 = camera.x - halfW;
    const x1 = camera.x + halfW;
    const y0 = camera.y - halfH;
    const y1 = camera.y + halfH;
    for (const t of tiles) {
      if (t.x + 1 < x0 || t.x > x1 || t.y + 1 < y0 || t.y > y1) continue;
      mctx.fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
    }
    mctx.restore();
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.filter = 'blur(22px)';
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  }

  private drawInterior(ctx: CanvasRenderingContext2D, plan: InteriorPlan): void {
    const floors = this.assets.floors;
    const cell = TILE / ZONE_SCALE;
    const floor = FLOORS[plan.floor] ?? FLOORS[0]!;
    const wall = interiorWallFill(plan.sprite);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        const cellKind = plan.cells[c + r * plan.cols]!;
        if (cellKind === CELL_VOID || cellKind === CELL_WALL) continue;
        const dx = (plan.x0 + c / ZONE_SCALE) * TILE;
        const dy = (plan.y0 + r / ZONE_SCALE) * TILE;
        ctx.drawImage(floors, floor.sx, floor.sy, TILE, TILE, dx, dy, cell, cell);
      }
    }
    ctx.fillStyle = wall;
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        if (plan.cells[c + r * plan.cols] !== CELL_WALL || isShellWall(plan, c, r)) continue;
        ctx.fillRect((plan.x0 + c / ZONE_SCALE) * TILE, (plan.y0 + r / ZONE_SCALE) * TILE, cell, cell);
      }
    }
    ctx.strokeStyle = '#1a120c';
    ctx.lineWidth = 0.08;
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        if (plan.cells[c + r * plan.cols] !== CELL_WALL || isShellWall(plan, c, r)) continue;
        const dx = (plan.x0 + c / ZONE_SCALE) * TILE;
        const dy = (plan.y0 + r / ZONE_SCALE) * TILE;
        ctx.strokeRect(dx + 0.15, dy + 0.15, cell - 0.3, cell - 0.3);
      }
    }
    ctx.fillStyle = '#6b4a32';
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        if (plan.cells[c + r * plan.cols] !== CELL_DOOR) continue;
        ctx.fillRect((plan.x0 + c / ZONE_SCALE) * TILE, (plan.y0 + r / ZONE_SCALE) * TILE + cell * 0.55, cell, cell * 0.45);
      }
    }
    for (const f of plan.furniture) {
      const img = this.assets.sprite(f.sprite);
      if (!img) continue;
      const x = plan.x0 + (f.col + 0.5) / ZONE_SCALE;
      const y = plan.y0 + (f.row + 0.85) / ZONE_SCALE;
      const k = (TILE / ZONE_SCALE / 16) * 1.15;
      ctx.save();
      ctx.translate(x * TILE, y * TILE);
      ctx.scale(k, k);
      ctx.drawImage(img, -img.width / 2, -img.height);
      ctx.restore();
    }
    ctx.restore();
  }

  private applyInteriorBlur(
    ctx: CanvasRenderingContext2D,
    plan: InteriorPlan,
    camera: CameraState,
    viewW: number,
    viewH: number,
  ): void {
    this.blurLayer = this.ensureLayer(this.blurLayer, viewW, viewH);
    const blur = this.blurLayer;
    const bctx = blur.getContext('2d');
    if (!bctx) return;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, blur.width, blur.height);
    bctx.imageSmoothingEnabled = true;
    bctx.filter = 'blur(10px)';
    bctx.drawImage(ctx.canvas, 0, 0);
    bctx.filter = 'none';
    bctx.fillStyle = 'rgba(12, 16, 20, 0.38)';
    bctx.fillRect(0, 0, blur.width, blur.height);
    bctx.globalCompositeOperation = 'destination-out';
    bctx.save();
    bctx.translate(viewW / 2, viewH / 2);
    bctx.scale(camera.scale, camera.scale);
    bctx.translate(-camera.x * TILE, -camera.y * TILE);
    const pad = 0.03;
    const cell = TILE / ZONE_SCALE;
    bctx.fillStyle = '#fff';
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        if (plan.cells[c + r * plan.cols] === CELL_VOID) continue;
        bctx.fillRect(
          (plan.x0 + c / ZONE_SCALE) * TILE - pad * TILE,
          (plan.y0 + r / ZONE_SCALE) * TILE - pad * TILE,
          cell + pad * 2 * TILE,
          cell + pad * 2 * TILE,
        );
      }
    }
    bctx.fillRect(plan.doorX0 * TILE - pad * TILE, plan.ay * TILE, (plan.doorX1 - plan.doorX0 + pad * 2) * TILE, 0.14 * TILE);
    bctx.restore();
    bctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(blur, 0, 0);
    ctx.restore();
  }

  forgetChunk(wx: number, wy: number): void {
    this.chunkBakes.delete(chunkKey(wx, wy));
  }

  hasChunkBake(wx: number, wy: number): boolean {
    return this.chunkBakes.has(chunkKey(wx, wy));
  }

  private drawVisibleChunks(
    ctx: CanvasRenderingContext2D,
    camera: CameraState,
    viewW: number,
    viewH: number,
    world: WorldData,
    detailT: number,
    allowed?: Set<string>,
  ): void {
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const x0 = Math.max(0, Math.floor(camera.x - halfW - 1));
    const y0 = Math.max(0, Math.floor(camera.y - halfH - 1));
    const x1 = Math.min(world.width - 1, Math.floor(camera.x + halfW + 1));
    const y1 = Math.min(world.height - 1, Math.floor(camera.y + halfH + 1));
    ctx.save();
    ctx.globalAlpha = detailT;
    for (let wy = y0; wy <= y1; wy++) {
      for (let wx = x0; wx <= x1; wx++) {
        if (allowed && !allowed.has(chunkKey(wx, wy))) continue;
        const bake = this.chunkBakes.get(chunkKey(wx, wy));
        if (!bake) continue;
        ctx.save();
        ctx.translate(wx * TILE, wy * TILE);
        ctx.scale(1 / ZONE_SCALE, 1 / ZONE_SCALE);
        ctx.drawImage(bake, -1, -1);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawChunkSprites(
    ctx: CanvasRenderingContext2D,
    camera: CameraState,
    viewW: number,
    viewH: number,
    world: WorldData,
    detailT: number,
    chunks: Map<string, ChunkData> | undefined,
    allowed?: Set<string>,
    hide?: InteriorPlan | null,
  ): void {
    if (!chunks) return;
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const pad = 3.2;
    const x0 = Math.max(0, Math.floor(camera.x - halfW - pad));
    const y0 = Math.max(0, Math.floor(camera.y - halfH - pad));
    const x1 = Math.min(world.width - 1, Math.floor(camera.x + halfW + pad));
    const y1 = Math.min(world.height - 1, Math.floor(camera.y + halfH + pad));
    const drawn: Array<{ sprite: string; x: number; y: number; footW?: number; roofOnly?: boolean }> = [];
    for (let wy = y0; wy <= y1; wy++) {
      for (let wx = x0; wx <= x1; wx++) {
        if (allowed && !allowed.has(chunkKey(wx, wy))) continue;
        const chunk = chunks.get(chunkKey(wx, wy));
        if (!chunk) continue;
        for (const spr of chunk.sprites) {
          const x = wx + spr.x / chunk.size;
          const y = wy + spr.y / chunk.size;
          const roofOnly = !!(hide && isBuildingSprite(spr.sprite) && Math.abs(x - hide.ax) < 0.04 && Math.abs(y - hide.ay) < 0.04);
          drawn.push({ sprite: spr.sprite, x, y, footW: spr.footW, roofOnly });
        }
      }
    }
    drawn.sort((a, b) => a.y - b.y || a.x - b.x);
    ctx.save();
    ctx.globalAlpha = detailT;
    for (const spr of drawn) {
      const img = this.assets.sprite(spr.sprite);
      if (!img) continue;
      ctx.save();
      ctx.translate(spr.x * TILE, spr.y * TILE);
      if (isBuildingSprite(spr.sprite)) {
        const k = buildingDrawScale(spr.sprite, img, spr.footW);
        const { ox, oy } = buildingDrawOrigin(spr.sprite, img);
        ctx.scale(k, k);
        ctx.drawImage(img, -ox, -oy);
        ctx.restore();
        if (spr.roofOnly && hide) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = '#000';
          const cell = TILE / ZONE_SCALE;
          for (let r = 0; r < hide.rows; r++) {
            for (let c = 0; c < hide.cols; c++) {
              const kind = hide.cells[c + r * hide.cols]!;
              if (kind !== CELL_FLOOR && kind !== CELL_DOOR) continue;
              ctx.fillRect(
                (hide.x0 + c / ZONE_SCALE) * TILE,
                (hide.y0 + r / ZONE_SCALE) * TILE,
                cell,
                cell,
              );
            }
          }
          ctx.restore();
          ctx.save();
          ctx.translate(spr.x * TILE, spr.y * TILE);
          ctx.scale(k, k);
          const rh = Math.max(1, Math.round(img.height * buildingRoofFrac(spr.sprite)));
          ctx.drawImage(img, 0, 0, img.width, rh, -ox, -oy, img.width, rh);
          ctx.restore();
        }
      } else {
        const k = spriteWorldScale(img);
        ctx.scale(k, k);
        ctx.drawImage(img, -img.width / 2, -img.height);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private addNodeTiles(ctx: CanvasRenderingContext2D, node: MapNode): void {
    const tiles = node.tiles;
    if (tiles?.length) {
      for (const t of tiles) {
        ctx.rect(t.x * TILE, t.y * TILE, TILE, TILE);
      }
      return;
    }
    const b = nodeBounds(node);
    ctx.rect(b.x0 * TILE, b.y0 * TILE, (b.x1 - b.x0) * TILE, (b.y1 - b.y0) * TILE);
  }

  private drawFeatures(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    camera: CameraState,
    viewW: number,
    viewH: number,
    alpha: number,
    detailT: number,
    shift = 0,
  ): void {
    const pad = 4;
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const x0 = camera.x - shift - halfW - pad;
    const x1 = camera.x - shift + halfW + pad;
    const y0 = camera.y - halfH - pad;
    const y1 = camera.y + halfH + pad;
    const hideBaked = detailT > 0.38;

    for (const f of world.features) {
      if (f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
      if (hideBaked) continue;
      if (alpha > 0.8 && detailT > 0.2 && this.hasChunk(Math.floor(f.x), Math.floor(f.y))) continue;
      const img = this.assets.sprite(f.sprite);
      if (!img) continue;
      const worldH = img.height * spriteWorldScale(img);
      const minScreen = f.kind === 'landmark' ? 14 : f.kind === 'tree' ? 7 : 11;
      const screenH = Math.max(minScreen, worldH * camera.scale);
      const h = screenH / camera.scale;
      const w = (img.width / Math.max(1, img.height)) * h;
      ctx.drawImage(img, f.x * TILE - w / 2, f.y * TILE - h, w, h);
    }
  }

  private nodeInIsolation(node: MapNode, isoKeys: Set<string>): boolean {
    const tiles = node.tiles;
    if (!tiles?.length) return false;
    for (const t of tiles) {
      if (isoKeys.has(chunkKey(t.x, t.y))) return true;
    }
    return false;
  }

  private drawOutlines(
    ctx: CanvasRenderingContext2D,
    nodes: MapNode[],
    scale: number,
    show: boolean,
    hoveredId: string | null,
    detailT: number,
    detailNode: MapNode | null,
    amt: number,
    context = false,
  ): void {
    const overlay = clamp(amt, 0, 1);
    if (overlay < 0.01 && !hoveredId && detailT < 0.35 && !context) return;
    const political = smoothstep(0.28, 1, overlay);
    for (const node of nodes) {
      const hovered = node.id === hoveredId;
      const isActive = detailNode?.id === node.id;
      const city = node.kind === 'city' || node.kind === 'town';
      const instanced = isInstancedZone(node);
      const mapped = city || instanced;
      if (overlay < 0.06 && !show && !hovered && !(isActive && detailT > 0.35) && !mapped && !context) continue;
      ctx.save();
      const rgb = countyRgb(node);
      const streetFade = context ? 1 : 1 - smoothstep(0.45, 1, detailT) * 0.82;
      const fillA = overlay * streetFade * (hovered ? 0.28 + political * 0.62 : 0.16 + political * 0.72);
      if (hovered || instanced || overlay > 0.04 || context) {
        ctx.beginPath();
        this.addNodeTiles(ctx, node);
        ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${fillA})`;
        ctx.fill();
      }
      this.traceNode(ctx, node);
      const strokeA = 0.12 + overlay * 0.88;
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 2.4;
      ctx.setLineDash(hovered || isActive || mapped || political > 0.45 || context ? [] : [5 / scale, 4 / scale]);
      ctx.strokeStyle = `rgba(16, 12, 8, ${strokeA})`;
      ctx.lineWidth = (1.6 + overlay * 3.2 + (hovered || isActive ? 0.8 : 0)) / scale;
      ctx.stroke();
      if (political > 0.4) {
        ctx.strokeStyle = `rgba(${Math.max(0, rgb[0] - 28)}, ${Math.max(0, rgb[1] - 28)}, ${Math.max(0, rgb[2] - 28)}, ${0.55 + overlay * 0.4})`;
        ctx.lineWidth = (1.05 + overlay * 1.4) / scale;
        ctx.stroke();
      }
      const showName =
        !node.poiKind &&
        (hovered ||
          isActive ||
          (overlay > 0.38 && scale < 4.2) ||
          (mapped && scale < 1.45) ||
          (context && overlay > 0.2 && scale < 10));
      if (showName) {
        const b = nodeBounds(node);
        ctx.setLineDash([]);
        const lx = node.cx * TILE;
        const ly = (b.y0 + (b.y1 - b.y0) * 0.42) * TILE;
        const label = node.poiKind ? `${node.name} · ${POI_LABELS[node.poiKind]}` : node.name;
        drawNametag(ctx, label, lx, ly, scale, { screenPx: this.tagScreenPx });
      }
      ctx.restore();
    }
  }

  private traceNode(ctx: CanvasRenderingContext2D, node: MapNode): void {
    ctx.beginPath();
    const tiles = node.tiles;
    if (!tiles?.length) {
      const b = nodeBounds(node);
      ctx.rect(b.x0 * TILE, b.y0 * TILE, (b.x1 - b.x0) * TILE, (b.y1 - b.y0) * TILE);
      return;
    }
    const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
    for (const t of tiles) {
      const x = t.x * TILE;
      const y = t.y * TILE;
      if (!set.has(`${t.x},${t.y - 1}`)) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + TILE, y);
      }
      if (!set.has(`${t.x + 1},${t.y}`)) {
        ctx.moveTo(x + TILE, y);
        ctx.lineTo(x + TILE, y + TILE);
      }
      if (!set.has(`${t.x},${t.y + 1}`)) {
        ctx.moveTo(x + TILE, y + TILE);
        ctx.lineTo(x, y + TILE);
      }
      if (!set.has(`${t.x - 1},${t.y}`)) {
        ctx.moveTo(x, y + TILE);
        ctx.lineTo(x, y);
      }
    }
  }

  private drawPois(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    scale: number,
    show: boolean,
    hoveredPoiId: string | null,
    detailNode: MapNode | null,
    visibleIds?: Set<string> | null,
  ): void {
    if (!show && !hoveredPoiId && !visibleIds?.size) return;
    for (const poi of world.pois) {
      const hovered = poi.id === hoveredPoiId;
      const isActive = detailNode?.id === poi.id;
      const revealed = !!visibleIds?.has(poi.id);
      const instanced = world.nodes.some((n) => n.id === poi.id);
      if (!show && !revealed && !hovered && !isActive) continue;
      const px = poi.x * TILE;
      const py = poi.y * TILE;
      const color = poiColor(poi.kind);
      const s = 15 / scale;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, s * 1.15, 0, Math.PI * 2);
      ctx.fillStyle = instanced ? 'rgba(18, 14, 10, 0.42)' : 'rgba(18, 14, 10, 0.28)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4 / scale;
      ctx.stroke();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#1a120c';
      ctx.lineWidth = 1.5 / scale;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.restore();
      const pin = { x: px - s * 1.2, y: py - s * 1.2, w: s * 2.4, h: s * 2.4 };
      const label =
        hovered || isActive || scale >= 0.7 || instanced ? `${poi.name} · ${POI_LABELS[poi.kind]}` : poi.name;
      drawNametag(ctx, label, px, py, scale, { clearAbove: s * 1.35, avoid: [pin], screenPx: this.tagScreenPx });
    }
  }

  /** Map pins only — used for groups outside the isolated place / fog mask. */
  private drawEntityPins(
    ctx: CanvasRenderingContext2D,
    entities: MapEntity[],
    camera: CameraState,
    viewW: number,
    viewH: number,
    hoveredId: string | null,
    shift = 0,
  ): void {
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const pad = 4;
    const x0 = camera.x - shift - halfW - pad;
    const x1 = camera.x - shift + halfW + pad;
    const y0 = camera.y - halfH - pad;
    const y1 = camera.y + halfH + pad;
    for (const e of entities) {
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
      const mx = e.x;
      const my = e.y;
      ctx.save();
      if (e.afloat) {
        drawBoatMarker(ctx, mx, my, camera.scale, kindColor(e.kind), e.facing, e.kind);
      } else {
        const r = (e.kind === 'army' ? 11 : e.kind === 'caravan' ? 9.5 : 7.5) / camera.scale;
        ctx.beginPath();
        ctx.arc(mx * TILE, my * TILE, r, 0, Math.PI * 2);
        ctx.fillStyle = kindColor(e.kind);
        ctx.fill();
        ctx.lineWidth = 1.4 / camera.scale;
        ctx.strokeStyle = '#1a120c';
        ctx.stroke();
      }
      if (e.id === hoveredId) {
        const r = (e.kind === 'army' ? 11 : e.kind === 'caravan' ? 9.5 : 7.5) / camera.scale;
        drawNametag(ctx, e.name, mx * TILE, my * TILE, camera.scale, {
          clearAbove: r + 4 / camera.scale,
          avoid: [{ x: mx * TILE - r, y: my * TILE - r, w: r * 2, h: r * 2 }],
          screenPx: this.tagScreenPx,
        });
      }
      ctx.restore();
    }
  }

  private drawEntities(
    ctx: CanvasRenderingContext2D,
    entities: MapEntity[],
    camera: CameraState,
    viewW: number,
    viewH: number,
    player: PlayerState,
    hoveredId: string | null,
    shift = 0,
    showPlayer = true,
    remotePlayers: PlayerState[] = [],
    speechBubbles: ChatBubble[] = [],
    localPeerId: string | null = null,
  ): void {
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const pad = 3;
    const x0 = camera.x - shift - halfW - pad;
    const x1 = camera.x - shift + halfW + pad;
    const y0 = camera.y - halfH - pad;
    const y1 = camera.y + halfH + pad;
    const pinT = 1 - smoothstep(0.4, 1.65, camera.scale);
    const spriteT = smoothstep(0.55, 3.4, camera.scale);
    type Mark = {
      y: number;
      kind: 'player' | 'guest' | 'actor';
      e?: MapEntity;
      guest?: PlayerState;
      mx?: number;
      my?: number;
      sheet?: string;
      char?: number;
      facing?: number;
      frame?: number;
      lead?: boolean;
    };
    const marks: Mark[] = showPlayer ? [{ y: player.y, kind: 'player' }] : [];
    for (const guest of remotePlayers) {
      if (guest.x < x0 || guest.x > x1 || guest.y < y0 || guest.y > y1) continue;
      marks.push({ y: guest.y, kind: 'guest', guest });
    }
    for (const e of entities) {
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) {
        const vis = !e.afloat && e.members.some((m) => m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1);
        if (!vis) continue;
      }
      if (e.afloat) {
        marks.push({
          y: e.y,
          kind: 'actor',
          e,
          mx: e.x,
          my: e.y,
          sheet: 'boat',
          char: boatChar(e.kind),
          facing: e.facing,
          frame: e.frame,
          lead: true,
        });
        continue;
      }
      marks.push({ y: e.y, kind: 'actor', e, mx: e.x, my: e.y, sheet: e.sheet, char: e.char, facing: e.facing, frame: e.frame, lead: true });
      const followers =
        e.kind === 'army' ? armyVisibleFollowers(camera.scale, e.members.length) : e.members.length;
      for (let i = 0; i < followers; i++) {
        const m = e.members[i]!;
        marks.push({ y: m.y, kind: 'actor', e, mx: m.x, my: m.y, sheet: m.sheet, char: m.char, facing: m.facing, frame: m.frame, lead: false });
      }
    }
    marks.sort((a, b) => a.y - b.y);
    const occupied: TagBox[] = [];
    const pending: Array<{ text: string; x: number; y: number; clearAbove: number; clearBelow: number }> = [];
    const bubblePending: Array<{ text: string; x: number; y: number; clearAbove: number; clearBelow: number }> = [];
    const scale = camera.scale;
    const anchorByPeer = new Map<string, { x: number; y: number; clearAbove: number; clearBelow: number }>();
    for (const mark of marks) {
      if (mark.kind === 'player') {
        const spr = this.drawPlayer(ctx, player, scale, localPeerId);
        if (spr) occupied.push(spr);
        const clearAbove = spr ? player.y * TILE - spr.y : 12 / scale;
        const clearBelow = spr ? spr.y + spr.h - player.y * TILE : 4 / scale;
        if (localPeerId) {
          anchorByPeer.set(localPeerId, {
            x: player.x * TILE,
            y: player.y * TILE,
            clearAbove: clearAbove + 10 / scale,
            clearBelow,
          });
        }
        continue;
      }
      if (mark.kind === 'guest' && mark.guest) {
        const g = mark.guest;
        const spr = this.drawPlayer(ctx, g, scale, null);
        if (spr) occupied.push(spr);
        const clearAbove = spr ? g.y * TILE - spr.y : 12 / scale;
        const clearBelow = spr ? spr.y + spr.h - g.y * TILE : 4 / scale;
        if (g.name && scale >= 2.8) {
          pending.push({
            text: g.name,
            x: g.x * TILE,
            y: g.y * TILE,
            clearAbove,
            clearBelow,
          });
        }
        anchorByPeer.set(g.id, {
          x: g.x * TILE,
          y: g.y * TILE,
          clearAbove: clearAbove + 10 / scale,
          clearBelow,
        });
        continue;
      }
      const e = mark.e!;
      const mx = mark.mx!;
      const my = mark.my!;
      const hovered = e.id === hoveredId;
      const actorPinT = e.afloat ? 1 - smoothstep(0.08, 0.55, scale) : pinT;
      const actorSpriteT = e.afloat ? Math.max(spriteT, smoothstep(0.14, 1.6, scale)) : spriteT;
      let sprite: TagBox | null = null;
      if (actorPinT > 0.05 && mark.lead) {
        ctx.save();
        ctx.globalAlpha = actorPinT;
        if (e.afloat) {
          drawBoatMarker(ctx, mx, my, scale, kindColor(e.kind), e.facing, e.kind);
        } else {
          const r = (e.kind === 'army' ? 11 : e.kind === 'caravan' ? 9.5 : 7.5) / scale;
          ctx.beginPath();
          ctx.arc(mx * TILE, my * TILE, r, 0, Math.PI * 2);
          ctx.fillStyle = kindColor(e.kind);
          ctx.fill();
          ctx.lineWidth = 1.4 / scale;
          ctx.strokeStyle = '#1a120c';
          ctx.stroke();
          sprite = { x: mx * TILE - r, y: my * TILE - r, w: r * 2, h: r * 2 };
        }
        ctx.restore();
      }
      if (actorSpriteT > 0.04) {
        const sheet = this.assets.sheet(mark.sheet!);
        if (sheet) {
          const worldH = characterWorldH(sheet.frameH);
          const close = e.afloat
            ? e.kind === 'wanderer'
              ? 36
              : 46
            : e.kind === 'caravan' || e.kind === 'army'
              ? 34
              : 28;
          const minScreen = lerp(e.afloat ? 16 : 12, close, actorSpriteT);
          const screenH = Math.max(minScreen, worldH * scale);
          const h = screenH / scale;
          const w = (sheet.frameW / sheet.frameH) * h;
          const dx = mx * TILE - w / 2;
          const dy = my * TILE - h + 2 / scale;
          ctx.save();
          ctx.globalAlpha = Math.max(actorSpriteT, 0.4);
          drawCharFrame(ctx, sheet, mark.char!, mark.facing ?? 0, mark.frame ?? 1, dx, dy, w, h);
          ctx.restore();
          sprite = { x: dx, y: dy, w, h };
        }
      }
      if (sprite) occupied.push(sprite);
      if (mark.lead) {
        const clearAbove = sprite ? my * TILE - sprite.y : 12 / scale;
        const clearBelow = sprite ? sprite.y + sprite.h - my * TILE : 4 / scale;
        anchorByPeer.set(e.id, {
          x: mx * TILE,
          y: my * TILE,
          clearAbove: clearAbove + 10 / scale,
          clearBelow,
        });
        if (hovered) {
          pending.push({
            text: e.name,
            x: mx * TILE,
            y: my * TILE,
            clearAbove,
            clearBelow,
          });
        }
      }
    }
    const taken: TagBox[] = [];
    for (const bubble of speechBubbles) {
      const anchor = anchorByPeer.get(bubble.peerId);
      if (!anchor) continue;
      bubblePending.push({
        text: bubble.text,
        x: anchor.x,
        y: anchor.y,
        clearAbove: anchor.clearAbove,
        clearBelow: anchor.clearBelow,
      });
    }
    for (const tag of bubblePending) {
      drawSpeechBubble(ctx, tag.text, tag.x, tag.y, scale, {
        clearAbove: tag.clearAbove,
        clearBelow: tag.clearBelow,
        avoid: occupied,
        taken,
        screenPx: this.tagScreenPx * 1.05,
      });
    }
    for (const tag of pending) {
      drawNametag(ctx, tag.text, tag.x, tag.y, scale, {
        clearAbove: tag.clearAbove,
        clearBelow: tag.clearBelow,
        avoid: occupied,
        taken,
        screenPx: this.tagScreenPx,
      });
    }
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    player: PlayerState,
    scale: number,
    localPeerId: string | null,
  ): TagBox | null {
    const px = player.x * TILE;
    const py = player.y * TILE;
    const pinT = 1 - smoothstep(0.45, 2.4, scale);
    if (pinT > 0.04) {
      ctx.save();
      ctx.globalAlpha = pinT;
      const r = Math.max(3.2, 7 / scale);
      ctx.beginPath();
      ctx.arc(px, py - 2 / scale, r, 0, Math.PI * 2);
      ctx.fillStyle = pinColorForPlayer(player, localPeerId);
      ctx.fill();
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = '#3a2414';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px, py + 8 / scale);
      ctx.lineTo(px - 5 / scale, py);
      ctx.lineTo(px + 5 / scale, py);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const spriteT = smoothstep(1.6, 5.5, scale);
    if (spriteT <= 0.04) return null;
    const sheet = this.assets.sheet(player.sheet) ?? this.assets.sheet('townsfolk');
    ctx.save();
    ctx.globalAlpha = Math.max(spriteT, 1 - pinT);
    let box: TagBox | null = null;
    if (sheet) {
      const worldH = characterWorldH(sheet.frameH);
      const minScreen = lerp(16, 28, spriteT);
      const screenH = Math.max(minScreen, worldH * scale);
      const h = screenH / scale;
      const w = (sheet.frameW / sheet.frameH) * h;
      const dx = px - w / 2;
      const dy = py - h + 2 / scale;
      drawCharFrame(ctx, sheet, player.char, player.facing, player.frame, dx, dy, w, h);
      box = { x: dx, y: dy, w, h };
    } else {
      const spr = this.assets.player;
      const worldH = characterWorldH(spr.height);
      const minScreen = lerp(16, 28, spriteT);
      const screenH = Math.max(minScreen, worldH * scale);
      const h = screenH / scale;
      const w = (spr.width / spr.height) * h;
      const dx = px - w / 2;
      const dy = py - h + 2 / scale;
      ctx.drawImage(spr, dx, dy, w, h);
      box = { x: dx, y: dy, w, h };
    }
    ctx.restore();
    return box;
  }
}

function pinColorForPlayer(player: PlayerState, localPeerId: string | null): string {
  if (localPeerId && (player.id === LOCAL_PLAYER_ID || player.id === localPeerId)) {
    return peerMarkerColor(localPeerId);
  }
  if (player.id === LOCAL_PLAYER_ID) return '#e8c37a';
  return peerMarkerColor(player.id);
}

function countyRgb(node: MapNode): [number, number, number] {
  const palette: Array<[number, number, number]> = [
    [232, 118, 96],
    [86, 186, 142],
    [236, 186, 82],
    [110, 148, 214],
    [214, 128, 176],
    [176, 196, 86],
    [240, 148, 92],
    [72, 188, 182],
    [204, 112, 98],
    [138, 178, 96],
    [222, 168, 104],
    [104, 156, 188],
    [196, 108, 148],
    [128, 188, 148],
  ];
  let h = 2166136261;
  const key = node.id + node.name;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const i = (h >>> 0) % palette.length;
  const rgb = palette[i]!;
  if (node.origin === 'authored' && (node.kind === 'city' || node.kind === 'town')) {
    return [
      Math.round(rgb[0] * 0.45 + 212 * 0.55),
      Math.round(rgb[1] * 0.45 + 146 * 0.55),
      Math.round(rgb[2] * 0.45 + 79 * 0.55),
    ];
  }
  return rgb;
}

function poiColor(kind: PoiKind): string {
  switch (kind) {
    case 'ruins':
    case 'graves':
    case 'battlefield':
    case 'crypt':
    case 'ancient-gate':
      return 'rgba(196, 154, 108, 1)';
    case 'mansion':
    case 'wizard-tower':
      return 'rgba(176, 137, 196, 1)';
    case 'shrine':
    case 'treehouse':
    case 'fey-circle':
    case 'temple':
    case 'monastery':
      return 'rgba(125, 206, 160, 1)';
    case 'cave':
    case 'hideout':
    case 'mine':
    case 'dragon-lair':
      return 'rgba(154, 171, 159, 1)';
    case 'homestead':
    case 'trading-post':
    case 'port':
      return 'rgba(224, 168, 106, 1)';
    case 'abandoned-camp':
    case 'military-camp':
    case 'bandit-camp':
    case 'orc-fort':
    case 'watchtower':
    case 'tower':
    case 'bridge-keep':
      return 'rgba(232, 145, 90, 1)';
    default:
      return 'rgba(195, 155, 211, 1)';
  }
}
