import {
  Biome,
  ChunkData,
  MapNode,
  NodeKind,
  PlacedSprite,
  PoiKind,
  WorldData,
  ZONE_SCALE,
  biomeAt,
  nodeBounds,
  tileCoveredByNode,
} from '../models/world.models';
import { hash2, Rng } from './noise';

function idx(x: number, y: number, size: number): number {
  return x + y * size;
}

function stampDisk(grid: Uint8Array, size: number, cx: number, cy: number, r: number, value: number): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y1 = Math.min(size - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) grid[idx(x, y, size)] = value;
    }
  }
}

function stampWorldLine(
  grid: Uint8Array,
  wx: number,
  wy: number,
  size: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  value = 1,
): void {
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
  const originX = wx * size;
  const originY = wy * size;
  for (let i = 0; i <= steps; i++) {
    const x = ax + ((bx - ax) * i) / steps - originX;
    const y = ay + ((by - ay) * i) / steps - originY;
    stampDisk(grid, size, x, y, width, value);
  }
}

function stampRect(grid: Uint8Array, size: number, x0: number, y0: number, w: number, h: number, value: number): void {
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(size - 1, Math.ceil(x0 + w));
  const yb = Math.min(size - 1, Math.ceil(y0 + h));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      grid[idx(x, y, size)] = value;
    }
  }
}

function stampCurve(
  grid: Uint8Array,
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  seed: number,
  salt: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ox = -dy / len;
  const oy = dx / len;
  const mag = (hash2(Math.round(x0 * 8), Math.round(y0 * 8), seed + salt) - 0.5) * Math.min(3.6, Math.max(1.4, len * 0.7));
  const cx = (x0 + x1) / 2 + ox * mag;
  const cy = (y0 + y1) / 2 + oy * mag;
  const steps = Math.max(10, Math.ceil(len * 2.6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    stampDisk(grid, size, x, y, width, 1);
  }
}

function nsGateX(wx: number, southWy: number, size: number, seed: number): number {
  const n = hash2(wx, southWy, seed + 19);
  return size * 0.5 + (n - 0.5) * size * 0.52;
}

function ewGateY(eastWx: number, wy: number, size: number, seed: number): number {
  const n = hash2(eastWx, wy, seed + 23);
  return size * 0.5 + (n - 0.5) * size * 0.52;
}

function stampWorldCurve(
  grid: Uint8Array,
  wx: number,
  wy: number,
  size: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  seed: number,
  salt: number,
  width: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const bends = 1.7 + hash2(seed, salt, 9) * 1.6;
  const amp = Math.min(18, Math.max(5, len * 0.14));
  const originX = wx * size;
  const originY = wy * size;
  const steps = Math.max(12, Math.ceil(len * 2.4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const env = Math.sin(t * Math.PI);
    const off = Math.sin(t * Math.PI * bends + salt) * amp * env;
    const n = (hash2(Math.round(t * 40), salt, seed) - 0.5) * amp * 0.35 * env;
    const x = ax + dx * t + px * (off + n) - originX;
    const y = ay + dy * t + py * (off + n) - originY;
    stampDisk(grid, size, x, y, width, 1);
  }
}

function hubPoint(wx: number, wy: number, size: number, seed: number): { x: number; y: number } {
  return {
    x: size * 0.5 + (hash2(wx, wy, seed + 7) - 0.5) * 2.4,
    y: size * 0.5 + (hash2(wx, wy, seed + 11) - 0.5) * 2.4,
  };
}

function treePool(biome: Biome): string[] {
  switch (biome) {
    case Biome.DarkForest:
    case Biome.Marsh:
      return ['forest-1', 'forest-2', 'forest-6', 'forest-8'];
    case Biome.Hills:
    case Biome.Heath:
      return ['autumn-1', 'autumn-8', 'autumn-11', 'summer-10'];
    case Biome.Snow:
    case Biome.Taiga:
      return ['winter-2', 'winter-6', 'winter-11'];
    case Biome.Forest:
      return ['summer-1', 'summer-3', 'summer-8', 'summer-11'];
    default:
      return ['summer-3', 'summer-8', 'summer-10', 'summer-11'];
  }
}

function cityBuildings(kind: NodeKind, rng: Rng): string[] {
  const houses = ['house-1', 'house-2', 'house-3', 'house-5', 'house-7', 'house-8'];
  if (kind === 'city') {
    return ['town-hall', 'church', 'tavern', 'inn', 'inn-2', 'shop', 'blacksmith', ...(rng.chance(0.5) ? ['market'] : []), ...houses];
  }
  if (kind === 'town') return ['inn', 'shop', 'tavern', rng.pick(houses), rng.pick(houses), rng.pick(houses), 'farm'];
  if (kind === 'hamlet') return [rng.pick(houses), rng.pick(houses), 'farm', 'well'];
  return ['farm', rng.pick(houses), 'house-7'];
}

function worldPathAt(world: WorldData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  return !!world.paths[x + y * world.width];
}

export function generateChunk(
  world: WorldData,
  wx: number,
  wy: number,
  neighbors: Map<string, ChunkData>,
): ChunkData {
  const size = ZONE_SCALE;
  const tiles = new Uint8Array(size * size);
  const paths = new Uint8Array(size * size);
  const cobble = new Uint8Array(size * size);
  const sprites: PlacedSprite[] = [];
  const rng = new Rng((wx * 73856093) ^ (wy * 19349663) ^ world.seed);
  const base = biomeAt(world, wx + 0.5, wy + 0.5);
  const node = coveringRegion(world, wx, wy);
  const layoutRng = new Rng((node?.seed ?? 1) ^ (world.seed * 13));
  const streetFloor = layoutRng.int(0, 3);
  const plazaFloor = layoutRng.int(4, 7);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let b = base;
      if (x === 0) b = mixBiome(b, biomeAt(world, wx - 0.2, wy + 0.5), x / 2);
      if (x === size - 1) b = mixBiome(b, biomeAt(world, wx + 1.2, wy + 0.5), 0.35);
      if (y === 0) b = mixBiome(b, biomeAt(world, wx + 0.5, wy - 0.2), 0.35);
      if (y === size - 1) b = mixBiome(b, biomeAt(world, wx + 0.5, wy + 1.2), 0.35);
      if (node && (node.kind === 'city' || node.kind === 'town') && b !== Biome.Water) b = Biome.Plains;
      tiles[idx(x, y, size)] = b;
    }
  }

  stitchEdgesFromNeighbors(tiles, paths, cobble, wx, wy, size, neighbors);

  stampRoadNetwork(world, node, wx, wy, size, paths);

  if (node) applyNodeOverlay(node, wx, wy, size, tiles, paths, cobble, sprites, layoutRng);

  const pool = treePool(base);
  const settlement = node && (node.kind === 'city' || node.kind === 'town' || node.kind === 'hamlet' || node.kind === 'camp');
  const treeChance = node?.poiKind === 'treehouse' ? 0.11 : settlement ? 0.014 : node?.kind === 'grove' ? 0.09 : base === Biome.DarkForest ? 0.08 : 0.04;
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      if (cobble[idx(x, y, size)] || paths[idx(x, y, size)]) continue;
      const b = tiles[idx(x, y, size)] as Biome;
      if (b === Biome.Water) continue;
      if (!rng.chance(treeChance)) continue;
      sprites.push({ sprite: rng.pick(pool), x: x + rng.range(0.1, 0.8), y: y + rng.range(0.2, 0.9) });
    }
  }

  if (!settlement) {
    for (let i = 0; i < 3; i++) {
      const x = rng.range(0.4, size - 0.4);
      const y = rng.range(0.4, size - 0.4);
      const b = tiles[idx(Math.floor(x), Math.floor(y), size)] as Biome;
      if (b === Biome.Water) {
        if (rng.chance(0.4)) sprites.push({ sprite: 'reed', x, y });
        continue;
      }
      if (rng.chance(0.4)) sprites.push({ sprite: rng.pick(['rock-1', 'rock-3', 'flower-1', 'plant-1']), x, y });
    }
  }

  sprites.sort((a, b) => a.y - b.y || a.x - b.x);
  return { wx, wy, size, tiles, paths, cobble, sprites, streetFloor, plazaFloor, nodeId: node?.id ?? null };
}

function mixBiome(a: Biome, b: Biome, t: number): Biome {
  return t > 0.5 ? b : a;
}

function coveringRegion(world: WorldData, wx: number, wy: number): MapNode | null {
  return tileCoveredByNode(world.nodes, wx, wy);
}

function wantsRoadLink(world: WorldData, wx: number, wy: number, nwx: number, nwy: number): boolean {
  return worldPathAt(world, wx, wy) && worldPathAt(world, nwx, nwy);
}

function stampCityStreets(node: MapNode, wx: number, wy: number, size: number, paths: Uint8Array): void {
  const b = nodeBounds(node);
  const x0 = b.x0 * size + 1.2;
  const y0 = b.y0 * size + 1.2;
  const x1 = b.x1 * size - 1.2;
  const y1 = b.y1 * size - 1.2;
  const mx = node.cx * size;
  const my = node.cy * size;
  const w = node.kind === 'city' ? 1.12 : node.kind === 'town' ? 0.98 : 0.88;
  stampWorldCurve(paths, wx, wy, size, x0, my, x1, my, node.seed, 1, w);
  stampWorldCurve(paths, wx, wy, size, mx, y0, mx, y1, node.seed, 2, w * 0.92);
  if (node.kind === 'city' || node.kind === 'town') {
    stampWorldCurve(
      paths,
      wx,
      wy,
      size,
      x0,
      y0 + (y1 - y0) * 0.32,
      x1,
      y1 - (y1 - y0) * 0.22,
      node.seed,
      3,
      0.82,
    );
  }
}

function stampRoadNetwork(
  world: WorldData,
  node: MapNode | null,
  wx: number,
  wy: number,
  size: number,
  paths: Uint8Array,
): void {
  const hereP = worldPathAt(world, wx, wy);
  const settlement =
    !!node && (node.kind === 'city' || node.kind === 'town' || node.kind === 'hamlet' || node.kind === 'camp');
  const pass = node?.kind === 'pass';
  const linkN = wantsRoadLink(world, wx, wy, wx, wy - 1) || pass;
  const linkE = wantsRoadLink(world, wx, wy, wx + 1, wy);
  const linkS = wantsRoadLink(world, wx, wy, wx, wy + 1) || pass;
  const linkW = wantsRoadLink(world, wx, wy, wx - 1, wy);
  if (!hereP && !settlement && !pass && !linkN && !linkE && !linkS && !linkW) return;

  const seed = world.seed;
  const hub = hubPoint(wx, wy, size, seed);
  const width = settlement ? (node?.kind === 'city' ? 1.05 : 0.92) : 0.82;
  let linked = false;
  if (linkN) {
    stampCurve(paths, size, nsGateX(wx, wy, size, seed), 0, hub.x, hub.y, width, seed, wx * 13 + wy);
    linked = true;
  }
  if (linkS) {
    stampCurve(paths, size, nsGateX(wx, wy + 1, size, seed), size, hub.x, hub.y, width, seed, wx * 17 + wy);
    linked = true;
  }
  if (linkW) {
    stampCurve(paths, size, 0, ewGateY(wx, wy, size, seed), hub.x, hub.y, width, seed, wx * 19 + wy);
    linked = true;
  }
  if (linkE) {
    stampCurve(paths, size, size, ewGateY(wx + 1, wy, size, seed), hub.x, hub.y, width, seed, wx * 23 + wy);
    linked = true;
  }
  if (hereP && !linked) stampDisk(paths, size, hub.x, hub.y, 1.15, 1);
  if ((settlement || pass) && linked) stampDisk(paths, size, hub.x, hub.y, width, 1);
}

function stitchEdgesFromNeighbors(
  tiles: Uint8Array,
  paths: Uint8Array,
  cobble: Uint8Array,
  wx: number,
  wy: number,
  size: number,
  neighbors: Map<string, ChunkData>,
): void {
  const west = neighbors.get(`${wx - 1},${wy}`);
  const east = neighbors.get(`${wx + 1},${wy}`);
  const north = neighbors.get(`${wx},${wy - 1}`);
  const south = neighbors.get(`${wx},${wy + 1}`);
  if (west) {
    for (let y = 0; y < size; y++) {
      const i = idx(0, y, size);
      const o = idx(size - 1, y, size);
      tiles[i] = west.tiles[o]!;
      if (west.paths[o]) paths[i] = 1;
      if (west.cobble[o]) cobble[i] = west.cobble[o]!;
    }
  }
  if (east) {
    for (let y = 0; y < size; y++) {
      const i = idx(size - 1, y, size);
      const o = idx(0, y, size);
      tiles[i] = east.tiles[o]!;
      if (east.paths[o]) paths[i] = 1;
      if (east.cobble[o]) cobble[i] = east.cobble[o]!;
    }
  }
  if (north) {
    for (let x = 0; x < size; x++) {
      const i = idx(x, 0, size);
      const o = idx(x, size - 1, size);
      tiles[i] = north.tiles[o]!;
      if (north.paths[o]) paths[i] = 1;
      if (north.cobble[o]) cobble[i] = north.cobble[o]!;
    }
  }
  if (south) {
    for (let x = 0; x < size; x++) {
      const i = idx(x, size - 1, size);
      const o = idx(x, 0, size);
      tiles[i] = south.tiles[o]!;
      if (south.paths[o]) paths[i] = 1;
      if (south.cobble[o]) cobble[i] = south.cobble[o]!;
    }
  }
}

function applyNodeOverlay(
  node: MapNode,
  wx: number,
  wy: number,
  size: number,
  tiles: Uint8Array,
  paths: Uint8Array,
  cobble: Uint8Array,
  sprites: PlacedSprite[],
  rng: Rng,
): void {
  const originX = wx * size;
  const originY = wy * size;
  const b = nodeBounds(node);
  const midX = ((b.x0 + b.x1) / 2) * size;
  const midY = ((b.y0 + b.y1) / 2) * size;
  const settlement = node.kind === 'city' || node.kind === 'town' || node.kind === 'hamlet' || node.kind === 'camp';

  if (node.poiKind) {
    stampPoiIntoChunk(node.poiKind, wx, wy, size, tiles, paths, cobble, sprites, midX, midY, rng);
    return;
  }

  if (settlement) {
    const lx = node.cx * size - originX;
    const ly = node.cy * size - originY;
    const plazaW = node.kind === 'city' ? 3.6 : node.kind === 'town' ? 2.8 : 2.1;
    const plazaH = node.kind === 'city' ? 3.1 : 2.4;
    if (lx > -plazaW && lx < size + plazaW && ly > -plazaH && ly < size + plazaH) {
      stampRect(cobble, size, lx - plazaW * 0.5, ly - plazaH * 0.45, plazaW, plazaH, 2);
    }
    stampCityStreets(node, wx, wy, size, paths);
    placeSettlementSprites(node, wx, wy, size, tiles, paths, cobble, sprites, rng);
  } else if (node.kind === 'shore' && node.origin !== 'generated') {
    const shoreY = node.cy * size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gy = originY + y;
        if (gy > shoreY + 3) tiles[idx(x, y, size)] = Biome.Water;
        else if (gy > shoreY - 2) tiles[idx(x, y, size)] = Biome.Sand;
      }
    }
  }
}

function placeSettlementSprites(
  node: MapNode,
  wx: number,
  wy: number,
  size: number,
  tiles: Uint8Array,
  paths: Uint8Array,
  cobble: Uint8Array,
  sprites: PlacedSprite[],
  rng: Rng,
): void {
  const buildings = cityBuildings(node.kind, rng);
  const lx = node.cx * size - wx * size;
  const ly = node.cy * size - wy * size;
  const isCenter = lx >= -1 && lx < size + 1 && ly >= -1 && ly < size + 1;
  const occupied: Array<[number, number]> = [];

  const tooClose = (x: number, y: number, min = 2.35): boolean =>
    occupied.some(([ox, oy]) => Math.hypot(x - ox, y - oy) < min);

  if (isCenter) {
    sprites.push({ sprite: buildings[0]!, x: lx, y: ly - 0.35 });
    occupied.push([lx, ly]);
    sprites.push({ sprite: 'well', x: lx + 1.55, y: ly + 1.35 });
    if (node.kind === 'city' || node.kind === 'town') {
      sprites.push({ sprite: 'lantern', x: lx - 1.35, y: ly + 0.55 });
      sprites.push({ sprite: 'lantern', x: lx + 1.7, y: ly + 0.35 });
      sprites.push({ sprite: 'bench', x: lx + 0.35, y: ly + 1.65 });
      if (rng.chance(0.7)) sprites.push({ sprite: 'market', x: lx - 1.5, y: ly + 1.7 });
    }
  }

  const cap = node.kind === 'city' ? 3 : node.kind === 'town' ? 2 : 1;
  let placed = 0;
  for (let y = 1; y < size - 1 && placed < cap; y++) {
    for (let x = 1; x < size - 1 && placed < cap; x++) {
      if (!paths[idx(x, y, size)]) continue;
      if (cobble[idx(x, y, size)] === 2) continue;
      if (!rng.chance(0.28)) continue;
      const bx = x + rng.pick([-1.1, 1.1, 0]);
      const by = y + rng.range(0.85, 1.35);
      if (bx < 0.45 || by < 0.7 || bx > size - 0.45 || by > size - 0.25) continue;
      const ix = Math.min(size - 1, Math.max(0, Math.floor(bx)));
      const iy = Math.min(size - 1, Math.max(0, Math.floor(by)));
      if (paths[idx(ix, iy, size)]) continue;
      if ((tiles[idx(ix, iy, size)] as Biome) === Biome.Water) continue;
      if (tooClose(bx, by)) continue;
      sprites.push({ sprite: buildings[(placed + 1) % buildings.length]!, x: bx, y: by });
      occupied.push([bx, by]);
      placed++;
    }
  }
}

function stampPoiIntoChunk(
  kind: PoiKind,
  wx: number,
  wy: number,
  size: number,
  tiles: Uint8Array,
  paths: Uint8Array,
  cobble: Uint8Array,
  sprites: PlacedSprite[],
  midX: number,
  midY: number,
  rng: Rng,
): void {
  const originX = wx * size;
  const originY = wy * size;
  const lx = midX - originX;
  const ly = midY - originY;
  const inChunk = lx > -6 && lx < size + 6 && ly > -8 && ly < size + 8;
  if (!inChunk) return;
  const put = (sprite: string, x: number, y: number) => {
    if (x < -4 || y < -6 || x > size + 4 || y > size + 6) return;
    sprites.push({ sprite, x, y });
  };
  switch (kind) {
    case 'ruins':
      stampDisk(cobble, size, lx, ly, 4, 1);
      put('church', lx, ly - 1);
      break;
    case 'mansion':
      stampWorldLine(paths, wx, wy, size, midX - 8, midY, midX + 8, midY, 1.1);
      put('inn-2', lx, ly);
      put('house-8', lx + 5, ly + 2);
      break;
    case 'abandoned-camp':
      put('farm', lx, ly);
      put('lantern', lx + 3, ly);
      break;
    case 'shrine':
      put('well', lx, ly);
      put('church', lx, ly - 3);
      break;
    case 'cave':
      stampDisk(tiles, size, lx, ly, 4, Biome.Mountain);
      put('rock-4', lx, ly + 1);
      break;
    case 'graves':
      put('church', lx, ly - 2);
      put('fence', lx + 2, ly);
      break;
    case 'homestead':
      put('farm', lx - 2, ly);
      put('house-1', lx + 4, ly);
      put('well', lx, ly + 3);
      break;
    case 'hideout':
      put('house-7', lx, ly);
      put('chest', lx + 2, ly + 1);
      break;
    case 'treehouse':
      put('house-3', lx, ly);
      put('house-5', lx + 4, ly + 2);
      break;
    case 'battlefield':
      put('chest', lx, ly);
      put('lantern', lx + 3, ly - 1);
      break;
    case 'military-camp':
      stampWorldLine(paths, wx, wy, size, midX - 6, midY, midX + 6, midY, 1.2);
      put('farm', lx, ly - 2);
      put('house-7', lx + 3, ly);
      break;
  }
}

export function neighborMap(chunks: Map<string, ChunkData>, wx: number, wy: number): Map<string, ChunkData> {
  const n = new Map<string, ChunkData>();
  for (const [ox, oy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const key = `${wx + ox},${wy + oy}`;
    const c = chunks.get(key);
    if (c) n.set(key, c);
  }
  return n;
}
