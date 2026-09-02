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
  boundsFromRadius,
  boundsFromTiles,
  chunkKey,
  isInstancedZone,
  lerp,
  nodeBounds,
  smoothstep,
} from '../models/world.models';
import { AssetLibrary, drawCharFrame } from './assets';
import { kindColor } from './entities';
import { biomeSeason, blobLocal, decoFor, FLOORS, GROUPS, overlayGroup, tileSrc } from './tileset';

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

function grassSrc(biome: Biome): { sx: number; sy: number } {
  return tileSrc(GROUPS.plateau, biomeSeason(biome === Biome.Water ? Biome.Plains : biome), 1, 1);
}

function pathSeason(biome: Biome): number {
  return biomeSeason(biome);
}

/** Overworld bake budget: 384 cells × 16px ≈ 6k canvas, enough for 4-tile cells at 8×. */
const WORLD_BAKE_MAX_CELLS = 384;

function worldBakeStep(width: number, maxCells: number): number {
  const minStep = Math.max(1, Math.ceil(width / maxCells));
  for (let s = minStep; s <= width; s++) {
    if (width % s === 0) return s;
  }
  return minStep;
}

function worldWrapShifts(cameraX: number, halfW: number, width: number): number[] {
  const shifts = [0];
  if (cameraX - halfW < 0) shifts.push(-width);
  if (cameraX + halfW > width) shifts.push(width);
  return shifts;
}

function fogIdentity(tiles: Array<{ x: number; y: number }>): string {
  let minX = 1e9;
  let minY = 1e9;
  let maxX = -1e9;
  let maxY = -1e9;
  let sum = 0;
  for (const t of tiles) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x);
    maxY = Math.max(maxY, t.y);
    sum = (sum + t.x * 734287 + t.y * 912991) | 0;
  }
  return `${tiles.length}:${minX},${minY},${maxX},${maxY}:${sum}:fog4`;
}

export class WorldRenderer {
  worldBake: HTMLCanvasElement | null = null;
  private readonly chunkBakes = new Map<string, HTMLCanvasElement>();
  private isoLayer: HTMLCanvasElement | null = null;
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogOx = 0;
  private fogOy = 0;
  private fogKey = '';

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
        } else if ((biome === Biome.Hills || biome === Biome.Heath) && deco === 2) {
          const d = decoFor(biome, 'pebble');
          stampTile(d.sx, d.sy, cx, cy);
        } else if (biome === Biome.Water && deco === 5) {
          const d = decoFor(biome, 'ripple');
          stampTile(d.sx, d.sy, cx, cy);
        } else if (biome === Biome.Marsh && deco === 6) {
          const d = decoFor(biome, 'lily');
          stampTile(d.sx, d.sy, cx, cy);
        }
      }
    }

    this.worldBake = canvas;
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
      hoveredId: string | null;
      hoveredPoiId: string | null;
      hoveredEntityId: string | null;
      detailNode: MapNode | null;
      entities: MapEntity[];
      chunks?: Map<string, ChunkData>;
      isolateChunk?: { wx: number; wy: number } | null;
      isolateTiles?: Array<{ x: number; y: number }> | null;
    },
  ): void {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b1014';
    ctx.fillRect(0, 0, viewW, viewH);

    const isolated = opts.isolateTiles?.length
      ? opts.isolateTiles
      : opts.isolateChunk
        ? [{ x: opts.isolateChunk.wx, y: opts.isolateChunk.wy }]
        : null;

    if (isolated) {
      const isoKeys = new Set(isolated.map((t) => chunkKey(t.x, t.y)));
      const layer = this.ensureIsoLayer(viewW, viewH);
      const lctx = layer.getContext('2d');
      if (!lctx) return;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, viewW, viewH);
      lctx.imageSmoothingEnabled = false;
      lctx.save();
      lctx.translate(viewW / 2, viewH / 2);
      lctx.scale(camera.scale, camera.scale);
      lctx.translate(-camera.x * TILE, -camera.y * TILE);
      this.drawVisibleChunks(lctx, camera, viewW, viewH, world, 1, isoKeys);
      this.drawChunkSprites(lctx, camera, viewW, viewH, world, 1, opts.chunks, isoKeys);
      this.drawEntities(lctx, opts.entities, camera, viewW, viewH, player, opts.hoveredEntityId);
      this.applyFogMask(lctx, isolated);
      lctx.restore();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(layer, 0, 0);
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
      if (camera.x - halfW < 0) ctx.drawImage(this.worldBake, -wpx, 0, wpx, hpx);
      if (camera.x + halfW > world.width) ctx.drawImage(this.worldBake, wpx, 0, wpx, hpx);
    }

    const featureAlpha = smoothstep(0.35, 1.35, camera.scale);
    const detailT = smoothstep(DETAIL_START, DETAIL_END, camera.scale);
    const halfW = viewW / (2 * camera.scale) / TILE;
    const wrapShifts = worldWrapShifts(camera.x, halfW, world.width);
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
      this.drawChunkSprites(ctx, camera, viewW, viewH, world, detailT, opts.chunks);
    }

    for (const shift of wrapShifts) {
      ctx.save();
      ctx.translate(shift * TILE, 0);
      this.drawOutlines(ctx, world.nodes, camera.scale, opts.showOutlines, opts.hoveredId, detailT, opts.detailNode);
      this.drawPois(ctx, world, camera.scale, opts.showPois, opts.hoveredPoiId, opts.detailNode);
      this.drawEntities(ctx, opts.entities, camera, viewW, viewH, player, opts.hoveredEntityId, shift);
      ctx.restore();
    }
    ctx.restore();
  }

  private ensureIsoLayer(viewW: number, viewH: number): HTMLCanvasElement {
    const w = Math.max(1, Math.ceil(viewW));
    const h = Math.max(1, Math.ceil(viewH));
    if (!this.isoLayer || this.isoLayer.width !== w || this.isoLayer.height !== h) {
      this.isoLayer = document.createElement('canvas');
      this.isoLayer.width = w;
      this.isoLayer.height = h;
    }
    return this.isoLayer;
  }

  private applyFogMask(ctx: CanvasRenderingContext2D, tiles: Array<{ x: number; y: number }>): void {
    const mask = this.fogFor(tiles);
    if (!mask) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask.canvas, mask.ox, mask.oy);
    ctx.restore();
  }

  private fogFor(
    tiles: Array<{ x: number; y: number }>,
  ): { canvas: HTMLCanvasElement; ox: number; oy: number } | null {
    if (!tiles.length) return null;
    const key = fogIdentity(tiles);
    if (this.fogCanvas && this.fogKey === key) {
      return { canvas: this.fogCanvas, ox: this.fogOx, oy: this.fogOy };
    }
    const bounds = boundsFromTiles(tiles);
    const pad = TILE * 2.4;
    const ox = bounds.x0 * TILE - pad;
    const oy = bounds.y0 * TILE - pad;
    const width = Math.max(1, Math.ceil((bounds.x1 - bounds.x0 + 1) * TILE + pad * 2));
    const height = Math.max(1, Math.ceil((bounds.y1 - bounds.y0 + 1) * TILE + pad * 2));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const mctx = canvas.getContext('2d');
    if (!mctx) return null;
    const stamp = document.createElement('canvas');
    stamp.width = width;
    stamp.height = height;
    const sctx = stamp.getContext('2d');
    if (!sctx) return null;
    sctx.fillStyle = '#fff';
    const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
    const inset = TILE * 0.4;
    const rad = TILE * 0.48;
    for (const t of tiles) {
      const n = set.has(`${t.x},${t.y - 1}`);
      const e = set.has(`${t.x + 1},${t.y}`);
      const s = set.has(`${t.x},${t.y + 1}`);
      const w = set.has(`${t.x - 1},${t.y}`);
      const x0 = t.x * TILE - ox + (w ? 0 : inset);
      const y0 = t.y * TILE - oy + (n ? 0 : inset);
      const x1 = (t.x + 1) * TILE - ox - (e ? 0 : inset);
      const y1 = (t.y + 1) * TILE - oy - (s ? 0 : inset);
      const ww = Math.max(2, x1 - x0);
      const hh = Math.max(2, y1 - y0);
      sctx.beginPath();
      sctx.roundRect(x0, y0, ww, hh, Math.min(rad, ww / 2, hh / 2));
      sctx.fill();
    }
    mctx.clearRect(0, 0, width, height);
    mctx.filter = 'blur(6px)';
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(stamp, 0, 0);
    mctx.filter = 'none';
    this.fogCanvas = canvas;
    this.fogKey = key;
    this.fogOx = ox;
    this.fogOy = oy;
    return { canvas, ox, oy };
  }

  forgetChunk(wx: number, wy: number): void {
    this.chunkBakes.delete(chunkKey(wx, wy));
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
  ): void {
    if (!chunks) return;
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const x0 = Math.max(0, Math.floor(camera.x - halfW - 1));
    const y0 = Math.max(0, Math.floor(camera.y - halfH - 2));
    const x1 = Math.min(world.width - 1, Math.floor(camera.x + halfW + 1));
    const y1 = Math.min(world.height - 1, Math.floor(camera.y + halfH + 1));
    const drawn: Array<{ sprite: string; x: number; y: number }> = [];
    for (let wy = y0; wy <= y1; wy++) {
      for (let wx = x0; wx <= x1; wx++) {
        if (allowed && !allowed.has(chunkKey(wx, wy))) continue;
        const chunk = chunks.get(chunkKey(wx, wy));
        if (!chunk) continue;
        for (const spr of chunk.sprites) {
          drawn.push({
            sprite: spr.sprite,
            x: wx + spr.x / chunk.size,
            y: wy + spr.y / chunk.size,
          });
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
      const k = spriteWorldScale(img);
      ctx.scale(k, k);
      ctx.drawImage(img, -img.width / 2, -img.height);
      ctx.restore();
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

  private drawOutlines(
    ctx: CanvasRenderingContext2D,
    nodes: MapNode[],
    scale: number,
    show: boolean,
    hoveredId: string | null,
    detailT: number,
    detailNode: MapNode | null,
  ): void {
    for (const node of nodes) {
      const hovered = node.id === hoveredId;
      const isActive = detailNode?.id === node.id;
      const authored = node.origin === 'authored';
      const city = node.kind === 'city' || node.kind === 'town';
      const instanced = isInstancedZone(node);
      const mapped = city || instanced;
      if (!show && !hovered && !(isActive && detailT > 0.35) && !mapped) continue;
      ctx.save();
      if (hovered || instanced) {
        ctx.beginPath();
        this.addNodeTiles(ctx, node);
        ctx.fillStyle = instanced ? 'rgba(125, 206, 160, 0.16)' : authored ? 'rgba(212, 146, 79, 0.12)' : 'rgba(125, 206, 160, 0.1)';
        ctx.fill();
      }
      this.traceNode(ctx, node);
      ctx.strokeStyle =
        hovered || isActive
          ? authored
            ? 'rgba(224, 168, 106, 0.95)'
            : 'rgba(125, 206, 160, 0.95)'
          : instanced
            ? 'rgba(125, 206, 160, 0.72)'
            : authored
              ? 'rgba(212, 146, 79, 0.55)'
              : 'rgba(125, 206, 160, 0.4)';
      ctx.lineWidth = (hovered || isActive ? 2.2 : mapped ? 1.7 : 1.2) / scale;
      ctx.setLineDash(hovered || isActive || mapped ? [] : [5 / scale, 4 / scale]);
      ctx.stroke();
      if (hovered || (mapped && scale < 1.35)) {
        const b = nodeBounds(node);
        ctx.setLineDash([]);
        ctx.fillStyle = '#f3efe6';
        ctx.font = `${Math.max(10, 11 / scale)}px Poppins, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(node.name, node.cx * TILE, b.y0 * TILE - 5 / scale);
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
  ): void {
    if (!show && !hoveredPoiId) return;
    for (const poi of world.pois) {
      const hovered = poi.id === hoveredPoiId;
      const isActive = detailNode?.id === poi.id;
      if (!show && !hovered && !isActive) continue;
      if (isActive && scale >= DETAIL_START) continue;
      const px = poi.x * TILE;
      const py = poi.y * TILE;
      const color = poiColor(poi.kind);
      const s = Math.max(4.5, 9 / scale);
      ctx.save();
      if (hovered || isActive) {
        const b = boundsFromRadius(poi.x, poi.y, poi.radius);
        ctx.beginPath();
        ctx.rect(b.x0 * TILE, b.y0 * TILE, (b.x1 - b.x0) * TILE, (b.y1 - b.y0) * TILE);
        ctx.strokeStyle = color.replace('1)', '0.55)');
        ctx.lineWidth = 1.4 / scale;
        ctx.setLineDash([4 / scale, 3 / scale]);
        ctx.stroke();
      }
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#1a120c';
      ctx.lineWidth = 1.4 / scale;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.restore();
      if (hovered || isActive || scale >= 0.85) {
        ctx.fillStyle = '#f3efe6';
        ctx.font = `${Math.max(9, 10 / scale)}px Poppins, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(poi.name, px, py - s - 6 / scale);
        if (hovered || scale >= 1.4) {
          ctx.fillStyle = 'rgba(195, 155, 211, 0.95)';
          ctx.font = `${Math.max(8, 8.5 / scale)}px Poppins, sans-serif`;
          ctx.fillText(POI_LABELS[poi.kind], px, py - s - 16 / scale);
        }
      }
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
    type Mark = { y: number; kind: 'player' | 'actor'; e?: MapEntity; mx?: number; my?: number; sheet?: string; char?: number; facing?: number; frame?: number };
    const marks: Mark[] = [{ y: player.y, kind: 'player' }];
    for (const e of entities) {
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) {
        const vis = e.members.some((m) => m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1);
        if (!vis) continue;
      }
      marks.push({ y: e.y, kind: 'actor', e, mx: e.x, my: e.y, sheet: e.sheet, char: e.char, facing: e.facing, frame: e.frame });
      for (const m of e.members) {
        marks.push({ y: m.y, kind: 'actor', e, mx: m.x, my: m.y, sheet: m.sheet, char: m.char, facing: m.facing, frame: m.frame });
      }
    }
    marks.sort((a, b) => a.y - b.y);
    for (const mark of marks) {
      if (mark.kind === 'player') {
        this.drawPlayer(ctx, player, camera.scale);
        continue;
      }
      const e = mark.e!;
      const mx = mark.mx!;
      const my = mark.my!;
      const hovered = e.id === hoveredId;
      if (pinT > 0.05 && mark.sheet === e.sheet && mark.char === e.char) {
        ctx.save();
        ctx.globalAlpha = pinT;
        const r = (e.kind === 'army' ? 11 : e.kind === 'caravan' ? 9.5 : 7.5) / camera.scale;
        ctx.beginPath();
        ctx.arc(mx * TILE, my * TILE, r, 0, Math.PI * 2);
        ctx.fillStyle = kindColor(e.kind);
        ctx.fill();
        ctx.lineWidth = 1.4 / camera.scale;
        ctx.strokeStyle = '#1a120c';
        ctx.stroke();
        ctx.restore();
      }
      if (spriteT > 0.04) {
        const sheet = this.assets.sheet(mark.sheet!);
        if (sheet) {
          const screenH = lerp(12, e.kind === 'caravan' || e.kind === 'army' ? 34 : 28, spriteT);
          const h = screenH / camera.scale;
          const w = (sheet.frameW / sheet.frameH) * h;
          ctx.save();
          ctx.globalAlpha = Math.max(spriteT, 0.35);
          drawCharFrame(ctx, sheet, mark.char!, mark.facing ?? 0, mark.frame ?? 1, mx * TILE - w / 2, my * TILE - h + 2 / camera.scale, w, h);
          ctx.restore();
        }
      }
      if (hovered && mark.sheet === e.sheet && mark.char === e.char) {
        ctx.fillStyle = '#f3efe6';
        ctx.font = `${Math.max(9, 10 / camera.scale)}px Poppins, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(e.name, mx * TILE, my * TILE - 10 / camera.scale);
      }
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, player: PlayerState, scale: number): void {
    const px = player.x * TILE;
    const py = player.y * TILE;
    const pinT = 1 - smoothstep(0.45, 2.4, scale);
    if (pinT > 0.04) {
      ctx.save();
      ctx.globalAlpha = pinT;
      const r = Math.max(3.2, 7 / scale);
      ctx.beginPath();
      ctx.arc(px, py - 2 / scale, r, 0, Math.PI * 2);
      ctx.fillStyle = '#e8c37a';
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
    if (spriteT > 0.04) {
      const spr = this.assets.player;
      const screenH = lerp(16, 28, spriteT);
      const h = screenH / scale;
      const w = (spr.width / spr.height) * h;
      ctx.save();
      ctx.globalAlpha = Math.max(spriteT, 1 - pinT);
      ctx.drawImage(spr, px - w / 2, py - h + 2 / scale, w, h);
      ctx.restore();
    }
  }
}

function poiColor(kind: PoiKind): string {
  switch (kind) {
    case 'ruins':
    case 'graves':
    case 'battlefield':
      return 'rgba(196, 154, 108, 1)';
    case 'mansion':
      return 'rgba(176, 137, 196, 1)';
    case 'shrine':
    case 'treehouse':
      return 'rgba(125, 206, 160, 1)';
    case 'cave':
    case 'hideout':
      return 'rgba(154, 171, 159, 1)';
    case 'homestead':
      return 'rgba(224, 168, 106, 1)';
    case 'abandoned-camp':
    case 'military-camp':
      return 'rgba(232, 145, 90, 1)';
    default:
      return 'rgba(195, 155, 211, 1)';
  }
}
