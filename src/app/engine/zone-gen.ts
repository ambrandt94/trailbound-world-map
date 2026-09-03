import { Biome, MapNode, NodeKind, PlacedSprite, PoiKind, WorldData, ZoneData, ZONE_SCALE } from '../models/world.models';
import { Rng } from './noise';

function zidx(x: number, y: number, size: number): number {
  return x + y * size;
}

function inZ(x: number, y: number, size: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function sampleWorldBiome(world: WorldData, node: MapNode, zx: number, zy: number): Biome {
  const worldX = node.cx - node.radius + (zx + 0.5) / ZONE_SCALE;
  const worldY = node.cy - node.radius + (zy + 0.5) / ZONE_SCALE;
  const ix = Math.min(world.width - 1, Math.max(0, Math.floor(worldX)));
  const iy = Math.min(world.height - 1, Math.max(0, Math.floor(worldY)));
  return world.biomes[ix + iy * world.width] as Biome;
}

function stampDisk(grid: Uint8Array, size: number, cx: number, cy: number, r: number, value: number): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y1 = Math.min(size - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) grid[zidx(x, y, size)] = value;
    }
  }
}

function stampLine(grid: Uint8Array, size: number, x0: number, y0: number, x1: number, y1: number, width: number, value = 1): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    stampDisk(grid, size, x, y, width, value);
  }
}

function stampWinding(grid: Uint8Array, size: number, rng: Rng, width: number, value = 1): void {
  let x = rng.range(4, size - 4);
  let y = rng.range(4, size - 4);
  const steps = Math.floor(size * rng.range(0.8, 1.4));
  let ang = rng.range(0, Math.PI * 2);
  for (let i = 0; i < steps; i++) {
    ang += rng.range(-0.35, 0.35);
    x += Math.cos(ang) * 1.4;
    y += Math.sin(ang) * 1.4;
    if (!inZ(Math.floor(x), Math.floor(y), size)) {
      x = Math.min(size - 5, Math.max(5, x));
      y = Math.min(size - 5, Math.max(5, y));
      ang += Math.PI * 0.5;
    }
    stampDisk(grid, size, x, y, width, value);
  }
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
    return [
      'town-hall',
      'church',
      'tavern',
      'inn',
      'inn-2',
      'shop',
      'blacksmith',
      ...(rng.chance(0.5) ? ['market'] : []),
      ...houses,
    ];
  }
  if (kind === 'town') {
    return ['inn', 'shop', 'tavern', rng.pick(houses), rng.pick(houses), rng.pick(houses), 'farm'];
  }
  if (kind === 'hamlet') return [rng.pick(houses), rng.pick(houses), 'farm', 'well'];
  return ['farm', rng.pick(houses), 'house-7'];
}

export function generateZone(world: WorldData, node: MapNode): ZoneData {
  const size = Math.max(32, Math.round(node.radius * 2 * ZONE_SCALE));
  const tiles = new Uint8Array(size * size);
  const paths = new Uint8Array(size * size);
  const cobble = new Uint8Array(size * size);
  const sprites: PlacedSprite[] = [];
  const rng = new Rng(node.seed ^ (world.seed * 13));
  const mid = size / 2;
  const streetFloor = rng.int(0, 3);
  const plazaFloor = rng.int(4, 7);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let b = sampleWorldBiome(world, node, x, y);
      if (node.kind === 'city' || node.kind === 'town') {
        const d = Math.hypot(x - mid, y - mid) / (size * 0.5);
        if (d < 0.72 && b !== Biome.Water) b = Biome.Plains;
      }
      tiles[zidx(x, y, size)] = b;
    }
  }

  const settlement = node.kind === 'city' || node.kind === 'town' || node.kind === 'hamlet' || node.kind === 'camp';
  const layout = rng.int(0, 3);

  if (node.poiKind) {
    stampPoi(node.poiKind, tiles, paths, cobble, sprites, size, mid, rng);
  } else if (settlement) {
    const roadW = node.kind === 'city' ? 1.9 : node.kind === 'town' ? 1.35 : 1.05;
    if (layout === 0) {
      stampLine(paths, size, 3, mid, size - 4, mid, roadW);
      stampLine(paths, size, mid, 3, mid, size - 4, roadW);
    } else if (layout === 1) {
      stampLine(paths, size, 3, mid * 0.72, size - 4, mid * 1.12, roadW);
      stampLine(paths, size, mid * 0.55, 3, mid * 1.2, size - 4, roadW * 0.85);
    } else if (layout === 2) {
      stampWinding(paths, size, rng, roadW);
      stampLine(paths, size, mid, 4, mid, size - 5, roadW * 0.8);
    } else {
      stampLine(paths, size, 4, mid, size - 5, mid, roadW);
      stampLine(paths, size, mid * 0.4, mid, mid * 0.4, size - 5, roadW * 0.75);
    }
    if (node.kind === 'city') {
      stampDisk(cobble, size, mid, mid, size * 0.12, 2);
      const ring = size * 0.28;
      for (let a = 0; a < 16; a++) {
        const t0 = (a / 16) * Math.PI * 2;
        const t1 = ((a + 1) / 16) * Math.PI * 2;
        stampLine(
          paths,
          size,
          mid + Math.cos(t0) * ring,
          mid + Math.sin(t0) * ring * 0.78,
          mid + Math.cos(t1) * ring,
          mid + Math.sin(t1) * ring * 0.78,
          1.2,
        );
      }
    } else if (node.kind === 'town') {
      stampDisk(cobble, size, mid, mid, size * 0.08, 2);
    }
    for (let i = 0; i < size * size; i++) {
      if (paths[i] && cobble[i] !== 2) cobble[i] = 1;
    }

    const buildings = cityBuildings(node.kind, rng);
    const count = node.kind === 'city' ? 11 : node.kind === 'town' ? 6 : node.kind === 'hamlet' ? 4 : 3;
    const slots: Array<[number, number]> = [];
    if (node.kind === 'city' || node.kind === 'town') slots.push([mid, mid - size * 0.04]);
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rng.range(-0.12, 0.12);
      const dist = size * (node.kind === 'city' ? 0.22 : 0.18) + rng.range(-size * 0.04, size * 0.05);
      slots.push([mid + Math.cos(ang) * dist, mid + Math.sin(ang) * dist * 0.74]);
    }
    for (let i = 0; i < slots.length; i++) {
      const [x, y] = slots[i]!;
      if (!inZ(Math.floor(x), Math.floor(y), size)) continue;
      sprites.push({ sprite: buildings[i % buildings.length]!, x, y });
    }
    sprites.push({ sprite: 'well', x: mid + size * 0.06, y: mid + size * 0.05 });
    if (node.kind === 'city' || node.kind === 'town') {
      sprites.push({ sprite: 'lantern', x: mid - size * 0.1, y: mid });
      sprites.push({ sprite: 'lantern', x: mid + size * 0.1, y: mid + 1 });
      sprites.push({ sprite: 'bench', x: mid + 2, y: mid + size * 0.08 });
      if (rng.chance(0.7)) sprites.push({ sprite: 'market', x: mid - size * 0.08, y: mid + size * 0.07 });
    }
  } else if (node.kind === 'grove' || node.kind === 'meadow') {
    stampWinding(paths, size, rng, 0.95);
    if (rng.chance(0.65) || node.biome === Biome.Marsh) {
      stampDisk(tiles, size, mid + rng.range(-6, 6), mid + rng.range(-4, 8), rng.range(4, 8), Biome.Water);
    }
    stampDisk(tiles, size, mid, mid, size * 0.1, node.biome === Biome.DarkForest ? Biome.Meadow : Biome.Plains);
  } else if (node.kind === 'shore' && node.origin !== 'generated') {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (y > mid + 4 + Math.sin(x * 0.18) * 3) tiles[zidx(x, y, size)] = Biome.Water;
        else if (y > mid - 2) tiles[zidx(x, y, size)] = Biome.Sand;
      }
    }
    stampLine(paths, size, 4, mid - 4, size - 5, mid - 2, 1.2);
    sprites.push({ sprite: 'bridge', x: mid, y: mid + 8 });
  } else if (node.kind === 'pass') {
    stampLine(paths, size, mid - 2, 3, mid + 4, size - 4, 1.1);
    stampDisk(tiles, size, mid, mid, 5, Biome.Hills);
  }

  const pool = treePool(node.biome);
  const treeChance =
    node.poiKind === 'treehouse'
      ? 0.11
      : settlement && !node.poiKind
        ? 0.012
        : node.kind === 'grove'
          ? 0.09
          : node.biome === Biome.DarkForest
            ? 0.08
            : 0.035;
  for (let y = 3; y < size - 3; y += 2) {
    for (let x = 3; x < size - 3; x += 2) {
      if (cobble[zidx(x, y, size)]) continue;
      const b = tiles[zidx(x, y, size)] as Biome;
      if (b === Biome.Water) continue;
      const edge = Math.hypot(x - mid, y - mid) / (size * 0.5);
      if (!rng.chance(treeChance + (edge > 0.7 ? 0.04 : 0))) continue;
      sprites.push({
        sprite: rng.pick(pool),
        x: x + rng.range(-0.4, 0.4),
        y: y + rng.range(-0.2, 0.4),
      });
    }
  }

  const clutter = settlement ? 12 : 28;
  for (let i = 0; i < clutter; i++) {
    const x = rng.range(4, size - 4);
    const y = rng.range(4, size - 4);
    if (cobble[zidx(Math.floor(x), Math.floor(y), size)]) continue;
    const b = tiles[zidx(Math.floor(x), Math.floor(y), size)] as Biome;
    if (b === Biome.Water) {
      if (rng.chance(0.5)) sprites.push({ sprite: 'reed', x, y });
      continue;
    }
    if (node.biome === Biome.Marsh) sprites.push({ sprite: rng.pick(['reed', 'mushroom-dark', 'plant-1']), x, y });
    else if (node.biome === Biome.Heath || node.biome === Biome.Hills) {
      sprites.push({ sprite: rng.pick(['rock-1', 'rock-3', 'flower-autumn', 'rock-4']), x, y });
    } else if (node.biome === Biome.Snow || node.biome === Biome.Taiga) {
      sprites.push({ sprite: rng.pick(['rock-snow', 'winter-6', 'rock-3']), x, y });
    } else if (rng.chance(0.35)) sprites.push({ sprite: rng.pick(['rock-1', 'rock-3', 'rock-4']), x, y });
    else sprites.push({ sprite: rng.pick(['flower-1', 'flower-7', 'plant-1', 'mushroom-1']), x, y });
  }

  sprites.sort((a, b) => a.y - b.y || a.x - b.x);
  return { nodeId: node.id, size, tiles, paths, cobble, sprites, streetFloor, plazaFloor };
}

function stampPoi(
  kind: PoiKind,
  tiles: Uint8Array,
  paths: Uint8Array,
  cobble: Uint8Array,
  sprites: PlacedSprite[],
  size: number,
  mid: number,
  rng: Rng,
): void {
  const scatter = (list: string[], n: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      sprites.push({
        sprite: rng.pick(list),
        x: mid + rng.range(-spread, spread),
        y: mid + rng.range(-spread * 0.75, spread * 0.75),
      });
    }
  };
  stampDisk(cobble, size, mid, mid, Math.max(5, size * 0.09), 2);
  stampLine(paths, size, 3, mid, size - 4, mid, 1.15);
  switch (kind) {
    case 'ruins':
      sprites.push({ sprite: 'church', x: mid, y: mid - 2 });
      sprites.push({ sprite: 'town-hall', x: mid + size * 0.08, y: mid + 3 });
      scatter(['rock-4', 'rock-3', 'rock-1', 'chest', 'fence'], 14, size * 0.2);
      break;
    case 'mansion':
      sprites.push({ sprite: 'inn-2', x: mid, y: mid });
      sprites.push({ sprite: 'house-8', x: mid + size * 0.12, y: mid + 4 });
      sprites.push({ sprite: 'lantern', x: mid - size * 0.08, y: mid + 2 });
      scatter(['plant-1', 'flower-1', 'bench', 'fence'], 10, size * 0.16);
      break;
    case 'abandoned-camp':
      sprites.push({ sprite: 'farm', x: mid - 3, y: mid });
      sprites.push({ sprite: 'lantern', x: mid + 4, y: mid - 2 });
      scatter(['chest', 'bench', 'rock-1', 'fence'], 9, 12);
      break;
    case 'shrine':
      sprites.push({ sprite: 'church', x: mid, y: mid - size * 0.06 });
      sprites.push({ sprite: 'well', x: mid + size * 0.08, y: mid + 4 });
      scatter(['flower-1', 'flower-7', 'plant-1', 'lantern'], 16, size * 0.16);
      break;
    case 'cave':
      stampDisk(tiles, size, mid, mid, 8, Biome.Mountain);
      sprites.push({ sprite: 'rock-4', x: mid, y: mid + 2 });
      sprites.push({ sprite: 'rock-3', x: mid - 5, y: mid + 1 });
      scatter(['rock-4', 'rock-3', 'rock-snow', 'chest'], 14, 12);
      break;
    case 'graves':
      sprites.push({ sprite: 'church', x: mid, y: mid - 3 });
      scatter(['fence', 'rock-1', 'rock-3', 'chest', 'flower-1'], 16, size * 0.16);
      break;
    case 'homestead':
      sprites.push({ sprite: 'farm', x: mid - 4, y: mid - 2 });
      sprites.push({ sprite: 'house-1', x: mid + 6, y: mid - 1 });
      sprites.push({ sprite: 'well', x: mid + 2, y: mid + 5 });
      scatter(['fence', 'plant-1', 'flower-7', 'bench'], 10, 12);
      break;
    case 'hideout':
      stampDisk(tiles, size, mid, mid, 6, Biome.DarkForest);
      sprites.push({ sprite: 'house-7', x: mid, y: mid });
      sprites.push({ sprite: 'chest', x: mid + 5, y: mid + 3 });
      scatter(['lantern', 'rock-1', 'chest'], 8, 9);
      break;
    case 'treehouse':
      sprites.push({ sprite: 'house-3', x: mid - 2, y: mid });
      sprites.push({ sprite: 'house-5', x: mid + 8, y: mid + 4 });
      scatter(['summer-11', 'forest-1', 'forest-2', 'summer-1', 'lantern'], 18, size * 0.2);
      break;
    case 'battlefield':
      sprites.push({ sprite: 'fence', x: mid, y: mid });
      sprites.push({ sprite: 'chest', x: mid + 4, y: mid - 3 });
      scatter(['rock-3', 'rock-1', 'chest', 'fence', 'lantern'], 18, size * 0.22);
      break;
    case 'military-camp':
      stampLine(paths, size, mid, 4, mid, size - 5, 1.1);
      sprites.push({ sprite: 'farm', x: mid, y: mid - 3 });
      sprites.push({ sprite: 'house-7', x: mid + size * 0.1, y: mid + 2 });
      scatter(['lantern', 'chest', 'bench', 'fence'], 12, size * 0.14);
      break;
  }
}
