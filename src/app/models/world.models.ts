export const TILE = 16;
export const WORLD_BASE = 192;
export const WORLD_SCALES = [1, 2, 4, 8] as const;
export type WorldScale = (typeof WORLD_SCALES)[number];
export const ZONE_SCALE = 8;
export const MAX_SCALE = 26;
export const DIVE_SCALE = 16.4;
export const DETAIL_START = 4.2;
/** After zooming out, wait this long before a dive can mint a new place. */
export const ZOOM_OUT_DISCOVER_COOLDOWN_MS = 800;
/** Typical generated hamlet / POI blob radius in world tiles (cities are ~7–8). */
export const GENERATED_ZONE_RADIUS = 7.4;
export const DETAIL_END = 7.8;
export const ADVENTURE_ASK_SCALE = 4.2;
/** Leftover ungenerated pockets of this many tiles or fewer get absorbed. */
export const ADVENTURE_POCKET_MAX = 16;
export const FADE_START = 1.2;
export const FADE_END = 3.9;
export const WALK_SPEED = 3.2;
export const SPEED_REF_SCALE = 2.2;
export const GAME_HOURS_PER_REAL_SEC = 8 / 60;
export const PLAY_RATE = 1;
export const FAST_RATE = 8;
export const SYNC_TURN_TILES = 0.72;
export const SYNC_TURN_HOURS = 0.12;

export interface WorldSettings {
  worldScale: WorldScale;
  mapStyle: MapStyle;
  poiCount: number;
  wanderers: number;
  caravans: number;
  armies: number;
}

export const MAP_STYLES = ['continent', 'archipelago', 'isthmus', 'lakes', 'highlands'] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

export const MAP_STYLE_LABELS: Record<MapStyle, string> = {
  continent: 'Continent',
  archipelago: 'Isles',
  isthmus: 'Isthmus',
  lakes: 'Lakes',
  highlands: 'Highlands',
};

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  worldScale: 8,
  mapStyle: 'continent',
  poiCount: 48,
  wanderers: 32,
  caravans: 8,
  armies: 4,
};

export function worldExtent(scale: WorldScale): number {
  return WORLD_BASE * scale;
}

export function minScaleFor(width: number): number {
  return Math.max(0.006, 0.09 * (WORLD_BASE / width));
}

export function startScaleFor(width: number): number {
  return 0.26 * (WORLD_BASE / width);
}

export function clampSettings(raw: Partial<WorldSettings>): WorldSettings {
  const scale = WORLD_SCALES.includes(raw.worldScale as WorldScale) ? (raw.worldScale as WorldScale) : 8;
  const mapStyle = MAP_STYLES.includes(raw.mapStyle as MapStyle) ? (raw.mapStyle as MapStyle) : 'continent';
  return {
    worldScale: scale,
    mapStyle,
    poiCount: clamp(Math.round(raw.poiCount ?? DEFAULT_WORLD_SETTINGS.poiCount), 0, 400),
    wanderers: clamp(Math.round(raw.wanderers ?? DEFAULT_WORLD_SETTINGS.wanderers), 0, 200),
    caravans: clamp(Math.round(raw.caravans ?? DEFAULT_WORLD_SETTINGS.caravans), 0, 40),
    armies: clamp(Math.round(raw.armies ?? DEFAULT_WORLD_SETTINGS.armies), 0, 20),
  };
}

export type SimMode = 'paused' | 'play' | 'fast' | 'sync';
export type EntityKind = 'wanderer' | 'caravan' | 'army';
export type Facing = 0 | 1 | 2 | 3;

export interface EntityMember {
  x: number;
  y: number;
  sheet: string;
  char: number;
  facing: Facing;
  frame: number;
}

export interface MapEntity {
  id: string;
  name: string;
  kind: EntityKind;
  x: number;
  y: number;
  facing: Facing;
  frame: number;
  anim: number;
  speed: number;
  sheet: string;
  char: number;
  destX: number;
  destY: number;
  members: EntityMember[];
}

export interface SimHud {
  mode: SimMode;
  hours: number;
  day: number;
  clock: string;
  wanderers: number;
  caravans: number;
  armies: number;
  nearbyName: string | null;
  nearbyKind: EntityKind | null;
  nearbyDist: number | null;
}

export const ENTITY_LABELS: Record<EntityKind, string> = {
  wanderer: 'traveler',
  caravan: 'caravan',
  army: 'host',
};

export const SIM_LABELS: Record<SimMode, string> = {
  paused: 'Paused',
  play: 'Play',
  fast: 'Fast forward',
  sync: 'Synchronized',
};

export function formatClock(hours: number): { day: number; clock: string } {
  const day = Math.floor(hours / 24) + 1;
  const h = Math.floor(hours % 24);
  const m = Math.floor((hours % 1) * 60);
  return { day, clock: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

export function facingFromDelta(dx: number, dy: number): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 2;
  return dy < 0 ? 3 : 0;
}

export function facingVec(facing: Facing): { x: number; y: number } {
  switch (facing) {
    case 0:
      return { x: 0, y: 1 };
    case 1:
      return { x: -1, y: 0 };
    case 2:
      return { x: 1, y: 0 };
    default:
      return { x: 0, y: -1 };
  }
}

export function walkableAt(world: WorldData, x: number, y: number): boolean {
  const biome = biomeAt(world, x, y);
  return biome !== Biome.Water;
}

export enum Biome {
  Water = 0,
  Sand = 1,
  Plains = 2,
  Meadow = 3,
  Forest = 4,
  DarkForest = 5,
  Hills = 6,
  Heath = 7,
  Marsh = 8,
  Mountain = 9,
  Snow = 10,
  Taiga = 11,
}

export const BIOME_COUNT = 12;

export type NodeKind = 'city' | 'town' | 'hamlet' | 'grove' | 'camp' | 'shore' | 'meadow' | 'pass';
export type NodeOrigin = 'authored' | 'generated';

export type PoiKind =
  | 'ruins'
  | 'mansion'
  | 'abandoned-camp'
  | 'shrine'
  | 'cave'
  | 'graves'
  | 'homestead'
  | 'hideout'
  | 'treehouse'
  | 'battlefield'
  | 'military-camp';

export interface Vec2 {
  x: number;
  y: number;
}

export interface RegionBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MapNode {
  id: string;
  name: string;
  origin: NodeOrigin;
  kind: NodeKind;
  biome: Biome;
  cx: number;
  cy: number;
  radius: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tiles: Vec2[];
  seed: number;
  poiKind?: PoiKind;
}

export interface PointOfInterest {
  id: string;
  name: string;
  kind: PoiKind;
  x: number;
  y: number;
  radius: number;
  seed: number;
  biome: Biome;
}

export interface WorldFeature {
  kind: 'tree' | 'rock' | 'flower' | 'landmark';
  sprite: string;
  x: number;
  y: number;
}

export interface PlacedSprite {
  sprite: string;
  x: number;
  y: number;
}

export interface ZoneData {
  nodeId: string;
  size: number;
  tiles: Uint8Array;
  paths: Uint8Array;
  cobble: Uint8Array;
  sprites: PlacedSprite[];
  streetFloor: number;
  plazaFloor: number;
}

export interface ChunkData {
  wx: number;
  wy: number;
  size: number;
  tiles: Uint8Array;
  paths: Uint8Array;
  cobble: Uint8Array;
  sprites: PlacedSprite[];
  streetFloor: number;
  plazaFloor: number;
  nodeId: string | null;
}

export function chunkKey(wx: number, wy: number): string {
  return `${wx},${wy}`;
}

export interface AdventureRegion {
  tiles: Vec2[];
  keys: Set<string>;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function regionFromTiles(tiles: Vec2[]): AdventureRegion {
  const keys = new Set<string>();
  for (const t of tiles) keys.add(tileKey(t.x, t.y));
  return { tiles, keys, ...boundsFromTiles(tiles) };
}

export function inAdventureRegion(region: AdventureRegion | null | undefined, x: number, y: number): boolean {
  if (!region) return false;
  return region.keys.has(tileKey(Math.floor(x), Math.floor(y)));
}

/** Union of tiles in this place and every mapped place that already touches it. */
export function connectedPlaceTiles(nodes: MapNode[], start: MapNode): Vec2[] {
  const owner = new Map<string, string>();
  const byId = new Map<string, MapNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
    for (const t of node.tiles ?? []) owner.set(tileKey(t.x, t.y), node.id);
  }
  const next = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    let sa = next.get(a);
    if (!sa) {
      sa = new Set();
      next.set(a, sa);
    }
    sa.add(b);
    let sb = next.get(b);
    if (!sb) {
      sb = new Set();
      next.set(b, sb);
    }
    sb.add(a);
  };
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (const node of nodes) {
    for (const t of node.tiles ?? []) {
      for (const [dx, dy] of dirs) {
        const other = owner.get(tileKey(t.x + dx, t.y + dy));
        if (other) link(node.id, other);
      }
    }
  }
  const seen = new Set<string>([start.id]);
  const stack = [start.id];
  const tiles: Vec2[] = [];
  while (stack.length) {
    const id = stack.pop()!;
    const node = byId.get(id);
    if (!node) continue;
    for (const t of node.tiles ?? []) tiles.push(t);
    for (const nid of next.get(id) ?? []) {
      if (seen.has(nid)) continue;
      seen.add(nid);
      stack.push(nid);
    }
  }
  return tiles.length ? tiles : [...(start.tiles ?? [])];
}

export interface WorldData {
  seed: number;
  width: number;
  height: number;
  settings: WorldSettings;
  biomes: Uint8Array;
  paths: Uint8Array;
  nodes: MapNode[];
  pois: PointOfInterest[];
  features: WorldFeature[];
}

export interface PlayerState {
  x: number;
  y: number;
}

export interface CameraState {
  x: number;
  y: number;
  scale: number;
  targetX: number;
  targetY: number;
  targetScale: number;
  followPlayer: boolean;
}

export interface LocationInfo {
  x: number;
  y: number;
  viewX: number;
  viewY: number;
  biome: Biome;
  biomeLabel: string;
  inNode: boolean;
  atGate: boolean;
  nodeName: string | null;
  nodeKind: NodeKind | null;
  nodeOrigin: NodeOrigin | null;
  poiName: string | null;
  poiKind: PoiKind | null;
  scaleLabel: string;
  scale: number;
  uncharted: boolean;
}

export const BIOME_LABELS: Record<Biome, string> = {
  [Biome.Water]: 'Open water',
  [Biome.Sand]: 'Shore',
  [Biome.Plains]: 'Grassland',
  [Biome.Meadow]: 'Flower meadow',
  [Biome.Forest]: 'Woodland',
  [Biome.DarkForest]: 'Old forest',
  [Biome.Hills]: 'Hills',
  [Biome.Heath]: 'Heath',
  [Biome.Marsh]: 'Marsh',
  [Biome.Mountain]: 'Highlands',
  [Biome.Snow]: 'Snowpack',
  [Biome.Taiga]: 'Taiga',
};

export const KIND_LABELS: Record<NodeKind, string> = {
  city: 'city',
  town: 'town',
  hamlet: 'hamlet',
  grove: 'grove',
  camp: 'camp',
  shore: 'shore camp',
  meadow: 'meadow',
  pass: 'mountain pass',
};

export const POI_LABELS: Record<PoiKind, string> = {
  ruins: 'ruins',
  mansion: 'abandoned mansion',
  'abandoned-camp': 'abandoned camp',
  shrine: 'forest shrine',
  cave: 'cave entrance',
  graves: 'graves',
  homestead: 'homestead',
  hideout: 'hideout',
  treehouse: 'treehouse settlement',
  battlefield: 'battlefield',
  'military-camp': 'military camp',
};

export function biomeAt(world: WorldData, x: number, y: number): Biome {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= world.width || iy >= world.height) return Biome.Water;
  return world.biomes[ix + iy * world.width] as Biome;
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function boundsFromTiles(tiles: Vec2[]): RegionBounds {
  if (!tiles.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  let x0 = tiles[0]!.x;
  let y0 = tiles[0]!.y;
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  for (const t of tiles) {
    if (t.x < x0) x0 = t.x;
    if (t.y < y0) y0 = t.y;
    if (t.x + 1 > x1) x1 = t.x + 1;
    if (t.y + 1 > y1) y1 = t.y + 1;
  }
  return { x0, y0, x1, y1 };
}

export function boundsFromRadius(cx: number, cy: number, radius: number, aspect = 1): RegionBounds {
  const hw = Math.max(1.5, radius);
  const hh = Math.max(1.5, radius * aspect);
  return {
    x0: Math.floor(cx - hw),
    y0: Math.floor(cy - hh),
    x1: Math.ceil(cx + hw),
    y1: Math.ceil(cy + hh),
  };
}

function blobHash(x: number, y: number, seed: number): number {
  let h = Math.imul(x + seed, 374761393) + Math.imul(y, 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

const CARDINAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const DIAGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Axis-aligned octagon (squareness 0) to rectangle (1). */
function polyMetric(dx: number, dy: number, aspect: number, squareness: number): number {
  const x = dx;
  const y = dy / aspect;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const oct = Math.max(ax, ay, (ax + ay) * Math.SQRT1_2);
  const box = Math.max(ax, ay);
  return oct * (1 - squareness) + box * squareness;
}

function collectPolyTiles(
  cx: number,
  cy: number,
  reach: number,
  aspect: number,
  squareness: number,
  startX: number,
  startY: number,
  isOpen: (x: number, y: number) => boolean,
): Vec2[] {
  const padX = Math.ceil(reach + 1);
  const padY = Math.ceil(reach * Math.max(aspect, 1 / aspect) + 1);
  const x0 = Math.floor(cx) - padX;
  const y0 = Math.floor(cy) - padY;
  const x1 = Math.floor(cx) + padX;
  const y1 = Math.floor(cy) + padY;
  const inside = new Set<string>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!isOpen(x, y)) continue;
      if (polyMetric(x + 0.5 - cx, y + 0.5 - cy, aspect, squareness) > reach) continue;
      inside.add(tileKey(x, y));
    }
  }
  if (isOpen(startX, startY)) inside.add(tileKey(startX, startY));
  let ox = startX;
  let oy = startY;
  if (!inside.has(tileKey(startX, startY))) {
    let best = Infinity;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inside.has(tileKey(x, y))) continue;
        const d = Math.abs(x - startX) + Math.abs(y - startY);
        if (d < best) {
          best = d;
          ox = x;
          oy = y;
        }
      }
    }
    if (best === Infinity) return isOpen(startX, startY) ? [{ x: startX, y: startY }] : [];
  }
  const taken = new Set<string>();
  const tiles: Vec2[] = [];
  const stack: Vec2[] = [{ x: ox, y: oy }];
  while (stack.length) {
    const cur = stack.pop()!;
    const key = tileKey(cur.x, cur.y);
    if (taken.has(key) || !inside.has(key)) continue;
    taken.add(key);
    tiles.push(cur);
    for (const [dx, dy] of CARDINAL) stack.push({ x: cur.x + dx, y: cur.y + dy });
  }
  return tiles;
}

/**
 * Missing cell of a 2×2 where the new region meets a blocked (already-owned)
 * tile. Filling it stops 1-tile wilderness islands at place corners.
 */
function fillsPinchSquare(x: number, y: number, taken: Set<string>, blocked: Set<string>): boolean {
  for (const [dx, dy] of DIAGONAL) {
    const hKey = tileKey(x + dx, y);
    const vKey = tileKey(x, y + dy);
    const dKey = tileKey(x + dx, y + dy);
    const hTaken = taken.has(hKey);
    const vTaken = taken.has(vKey);
    const dTaken = taken.has(dKey);
    const hBlock = blocked.has(hKey);
    const vBlock = blocked.has(vKey);
    const dBlock = blocked.has(dKey);
    if (!(hTaken || hBlock) || !(vTaken || vBlock)) continue;
    const hasTaken = hTaken || vTaken || dTaken;
    const hasBlocked = hBlock || vBlock || dBlock;
    if (hasTaken && hasBlocked) return true;
  }
  return false;
}

function occupiedMoore(x: number, y: number, taken: Set<string>, blocked: Set<string>): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const key = tileKey(x + dx, y + dy);
      if (taken.has(key) || blocked.has(key)) n += 1;
    }
  }
  return n;
}

function shouldFillGap(
  x: number,
  y: number,
  taken: Set<string>,
  blocked: Set<string>,
): boolean {
  if (cardinalTaken(x, y, taken) >= 3 || oppositeTaken(x, y, taken)) return true;
  if (fillsPinchSquare(x, y, taken, blocked)) return true;
  return occupiedMoore(x, y, taken, blocked) >= 5;
}

function cardinalTaken(x: number, y: number, taken: Set<string>): number {
  let n = 0;
  for (const [dx, dy] of CARDINAL) {
    if (taken.has(tileKey(x + dx, y + dy))) n += 1;
  }
  return n;
}

function oppositeTaken(x: number, y: number, taken: Set<string>): boolean {
  const north = taken.has(tileKey(x, y - 1));
  const south = taken.has(tileKey(x, y + 1));
  const east = taken.has(tileKey(x + 1, y));
  const west = taken.has(tileKey(x - 1, y));
  return (north && south) || (east && west);
}

function closeTileContour(
  tiles: Vec2[],
  taken: Set<string>,
  blocked: Set<string>,
  isOpen: (x: number, y: number) => boolean,
  keep?: Vec2,
): void {
  for (let pass = 0; pass < 6; pass++) {
    const add: Vec2[] = [];
    const seen = new Set<string>();
    for (const t of tiles) {
      for (const [dx, dy] of CARDINAL) {
        const x = t.x + dx;
        const y = t.y + dy;
        const key = tileKey(x, y);
        if (seen.has(key) || taken.has(key)) continue;
        if (!isOpen(x, y)) continue;
        seen.add(key);
        if (shouldFillGap(x, y, taken, blocked)) add.push({ x, y });
      }
    }
    if (!add.length) break;
    for (const t of add) {
      const key = tileKey(t.x, t.y);
      if (taken.has(key)) continue;
      taken.add(key);
      tiles.push(t);
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    if (tiles.length <= 8) break;
    const drop: number[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]!;
      if (keep && t.x === keep.x && t.y === keep.y) continue;
      if (cardinalTaken(t.x, t.y, taken) <= 1) drop.push(i);
    }
    if (!drop.length) break;
    const maxDrop = Math.max(1, Math.floor(tiles.length * 0.18));
    const doomed = drop.slice(0, maxDrop).sort((a, b) => b - a);
    for (const idx of doomed) {
      const t = tiles[idx]!;
      taken.delete(tileKey(t.x, t.y));
      tiles.splice(idx, 1);
    }
  }
}

export function growTileBlob(
  cx: number,
  cy: number,
  radius: number,
  opts?: {
    kind?: NodeKind;
    seed?: number;
    biomes?: Uint8Array;
    width?: number;
    height?: number;
    blocked?: Set<string>;
    /** Prefer same-biome tiles. Low values keep blobs round across biome edges. */
    biomeBias?: number;
  },
): { tiles: Vec2[] } & RegionBounds {
  const w = opts?.width ?? WORLD_BASE;
  const h = opts?.height ?? WORLD_BASE;
  const seed = opts?.seed ?? 1;
  const kind = opts?.kind;
  const blocked = opts?.blocked ?? new Set<string>();
  const squareness =
    kind === 'city' || kind === 'town' ? 0.55 + blobHash(seed, 2, 11) * 0.3 :
    kind === 'hamlet' ? 0.42 + blobHash(seed, 3, 11) * 0.28 :
    kind === 'grove' || kind === 'meadow' ? 0.22 + blobHash(seed, 5, 11) * 0.22 :
    0.34 + blobHash(seed, 7, 11) * 0.28;
  const aspect = 0.82 + blobHash(seed, 13, 17) * 0.36;
  const reach = radius * (kind === 'pass' ? 0.72 : 0.88);

  const biomeBias = opts?.biomeBias ?? (kind === 'city' || kind === 'town' ? 0.9 : 0.22);

  const land = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    if (blocked.has(tileKey(x, y))) return false;
    if (!opts?.biomes) return true;
    const b = opts.biomes[x + y * w] as Biome;
    if (b === Biome.Water) return kind === 'shore';
    return true;
  };

  let sx = clamp(Math.floor(cx), 0, w - 1);
  let sy = clamp(Math.floor(cy), 0, h - 1);
  if (!land(sx, sy)) {
    let found = false;
    for (let r = 1; r < 14 && !found; r++) {
      for (let y = sy - r; y <= sy + r && !found; y++) {
        for (let x = sx - r; x <= sx + r && !found; x++) {
          if (land(x, y)) {
            sx = x;
            sy = y;
            found = true;
          }
        }
      }
    }
  }

  const want = opts?.biomes ? (opts.biomes[sx + sy * w] as Biome) : Biome.Plains;
  const inPoly = (x: number, y: number): boolean => {
    if (!land(x, y)) return false;
    if (biomeBias < 0.35 || !opts?.biomes) return true;
    if (opts.biomes[x + y * w] === want) return true;
    return polyMetric(x + 0.5 - cx, y + 0.5 - cy, aspect, squareness) <= reach * (1 - biomeBias * 0.28);
  };

  const tiles = collectPolyTiles(cx, cy, reach, aspect, squareness, sx, sy, inPoly);
  if (!tiles.length) tiles.push({ x: sx, y: sy });
  const taken = new Set<string>();
  for (const t of tiles) taken.add(tileKey(t.x, t.y));
  closeTileContour(tiles, taken, blocked, land, { x: sx, y: sy });
  const filled = fillEnclosedPockets(tiles, ADVENTURE_POCKET_MAX, blocked);
  return { tiles: filled, ...boundsFromTiles(filled) };
}

function openAdventureTile(x: number, y: number, width: number, height: number, blocked: Set<string>): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  return !blocked.has(tileKey(x, y));
}

/**
 * Grow a regular octagon/rectangle of uncharted land around a start tile.
 * Skips already-generated tiles, fills 2×2 pinch squares against neighbors so
 * 1-tile islands cannot sit in a corner, then swallows leftover pockets.
 * When `hug` is set, the polygon is shifted off that place's centroid.
 */
export function growAdventureRegion(
  sx: number,
  sy: number,
  width: number,
  height: number,
  blocked: Set<string>,
  seed: number,
  hug?: Vec2[],
): AdventureRegion {
  const startX = clamp(Math.floor(sx), 0, width - 1);
  const startY = clamp(Math.floor(sy), 0, height - 1);
  if (!openAdventureTile(startX, startY, width, height, blocked)) {
    return regionFromTiles([{ x: startX, y: startY }]);
  }

  const open = (x: number, y: number) => openAdventureTile(x, y, width, height, blocked);
  const squareness = 0.38 + blobHash(startX, startY, seed ^ 31) * 0.42;
  const aspect = 0.8 + blobHash(startX, startY, seed ^ 47) * 0.4;
  let reach = 5.5 + blobHash(startX, startY, seed) * 1.7;
  if (hug?.length) reach *= 0.72;
  let cx = startX + 0.5;
  let cy = startY + 0.5;
  if (hug?.length) {
    let hx = 0;
    let hy = 0;
    for (const t of hug) {
      hx += t.x + 0.5;
      hy += t.y + 0.5;
    }
    hx /= hug.length;
    hy /= hug.length;
    const vx = cx - hx;
    const vy = cy - hy;
    const len = Math.hypot(vx, vy) || 1;
    cx += (vx / len) * reach * 0.28;
    cy += (vy / len) * reach * 0.28;
  }

  const tiles = collectPolyTiles(cx, cy, reach, aspect, squareness, startX, startY, open);
  if (!tiles.length) tiles.push({ x: startX, y: startY });
  const taken = new Set<string>();
  for (const t of tiles) taken.add(tileKey(t.x, t.y));
  closeTileContour(tiles, taken, blocked, open, { x: startX, y: startY });
  absorbAdventurePockets(tiles, taken, blocked, width, height);
  closeTileContour(tiles, taken, blocked, open, { x: startX, y: startY });
  absorbAdventurePockets(tiles, taken, blocked, width, height);
  if (!tiles.length) tiles.push({ x: startX, y: startY });
  return regionFromTiles(tiles);
}

function absorbAdventurePockets(
  tiles: Vec2[],
  taken: Set<string>,
  blocked: Set<string>,
  width: number,
  height: number,
): void {
  const extra = fillEnclosedPockets(tiles, ADVENTURE_POCKET_MAX, blocked);
  for (const t of extra) {
    if (t.x < 0 || t.y < 0 || t.x >= width || t.y >= height) continue;
    const key = tileKey(t.x, t.y);
    if (taken.has(key) || blocked.has(key)) continue;
    taken.add(key);
    tiles.push(t);
  }
}

/**
 * Return `tiles` plus any fully enclosed holes (4-connected) up to `maxSize`.
 * `walls` (already-owned tiles) count as solid, so leftover wilderness between
 * two places is absorbed instead of left as an island.
 */
export function fillEnclosedPockets(
  tiles: Vec2[],
  maxSize = ADVENTURE_POCKET_MAX,
  walls?: Set<string>,
): Vec2[] {
  if (!tiles.length) return tiles;
  const taken = new Set<string>();
  for (const t of tiles) taken.add(tileKey(t.x, t.y));
  const holes = enclosedHoles(tiles, taken, maxSize, walls);
  if (!holes.length) return tiles;
  return tiles.concat(holes);
}

function enclosedHoles(
  tiles: Vec2[],
  taken: Set<string>,
  maxSize: number,
  walls?: Set<string>,
): Vec2[] {
  const blocked = (key: string) => taken.has(key) || !!walls?.has(key);
  const b = boundsFromTiles(tiles);
  const minX = b.x0 - 1;
  const minY = b.y0 - 1;
  const maxX = b.x1;
  const maxY = b.y1;
  const outside = new Set<string>();
  const stack: Vec2[] = [];
  for (let x = minX; x <= maxX; x++) {
    stack.push({ x, y: minY }, { x, y: maxY });
  }
  for (let y = minY + 1; y < maxY; y++) {
    stack.push({ x: minX, y }, { x: maxX, y });
  }
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.x < minX || cur.y < minY || cur.x > maxX || cur.y > maxY) continue;
    const key = tileKey(cur.x, cur.y);
    if (outside.has(key) || blocked(key)) continue;
    outside.add(key);
    for (const [dx, dy] of CARDINAL) stack.push({ x: cur.x + dx, y: cur.y + dy });
  }

  const seen = new Set<string>();
  const extra: Vec2[] = [];
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const key = tileKey(x, y);
      if (blocked(key) || outside.has(key) || seen.has(key)) continue;
      const pocket: Vec2[] = [];
      const wait: Vec2[] = [{ x, y }];
      seen.add(key);
      while (wait.length) {
        const cur = wait.pop()!;
        pocket.push(cur);
        for (const [dx, dy] of CARDINAL) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          const nk = tileKey(nx, ny);
          if (seen.has(nk) || blocked(nk) || outside.has(nk)) continue;
          if (nx < b.x0 || ny < b.y0 || nx >= b.x1 || ny >= b.y1) continue;
          seen.add(nk);
          wait.push({ x: nx, y: ny });
        }
      }
      if (!pocket.length || pocket.length > maxSize) continue;
      extra.push(...pocket);
    }
  }
  return extra;
}

export function assignNodeTiles(
  node: MapNode,
  blob: { tiles: Vec2[] } & RegionBounds,
): MapNode {
  node.tiles = blob.tiles;
  node.x0 = blob.x0;
  node.y0 = blob.y0;
  node.x1 = blob.x1;
  node.y1 = blob.y1;
  return node;
}

export function ensureNodeRegion(
  node: MapNode,
  world?: { biomes: Uint8Array; width: number; height: number },
): MapNode {
  if (node.tiles?.length) {
    const b = boundsFromTiles(node.tiles);
    node.x0 = b.x0;
    node.y0 = b.y0;
    node.x1 = b.x1;
    node.y1 = b.y1;
    return node;
  }
  return assignNodeTiles(
    node,
    growTileBlob(node.cx, node.cy, node.radius, {
      kind: node.kind,
      seed: node.seed,
      biomes: world?.biomes,
      width: world?.width,
      height: world?.height,
    }),
  );
}

export function inflateBounds(b: RegionBounds, pad: number): RegionBounds {
  return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
}

export function nodeBounds(node: MapNode): RegionBounds {
  if (node.tiles?.length) return { x0: node.x0, y0: node.y0, x1: node.x1, y1: node.y1 };
  return boundsFromRadius(node.cx, node.cy, node.radius);
}

export function approachPad(node: { radius: number }): number {
  return Math.max(2, node.radius * 0.32);
}

export function pointInBounds(b: RegionBounds, x: number, y: number): boolean {
  return x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
}

export function hasNodeTile(node: MapNode, wx: number, wy: number): boolean {
  if (!node.tiles?.length) return pointInBounds(nodeBounds(node), wx + 0.5, wy + 0.5);
  for (const t of node.tiles) {
    if (t.x === wx && t.y === wy) return true;
  }
  return false;
}

export function pointInNode(node: MapNode, x: number, y: number): boolean {
  return hasNodeTile(node, Math.floor(x), Math.floor(y));
}

export function closestOnTile(tx: number, ty: number, x: number, y: number): Vec2 {
  return {
    x: clamp(x, tx, tx + 0.999),
    y: clamp(y, ty, ty + 0.999),
  };
}

export function closestOnNode(node: MapNode, x: number, y: number): Vec2 {
  const tiles = node.tiles;
  if (!tiles?.length) {
    const b = nodeBounds(node);
    return { x: clamp(x, b.x0, b.x1 - 0.001), y: clamp(y, b.y0, b.y1 - 0.001) };
  }
  if (pointInNode(node, x, y)) return { x, y };
  let best = closestOnTile(tiles[0]!.x, tiles[0]!.y, x, y);
  let bestD = Infinity;
  for (const t of tiles) {
    const p = closestOnTile(t.x, t.y, x, y);
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function nodeContaining(nodes: MapNode[], x: number, y: number): MapNode | null {
  let best: MapNode | null = null;
  let bestA = Infinity;
  for (const node of nodes) {
    if (!pointInNode(node, x, y)) continue;
    const n = node.tiles?.length ?? (node.x1 - node.x0) * (node.y1 - node.y0);
    if (n < bestA) {
      best = node;
      bestA = n;
    }
  }
  return best;
}

/** Authored towns, discovered places, and instanced adventure zones skip generate confirms. */
export function knownPlaceAt(nodes: MapNode[], x: number, y: number): MapNode | null {
  return nodeContaining(nodes, x, y);
}

export function isInstancedZone(node: MapNode): boolean {
  return node.origin === 'generated' && !node.poiKind;
}

export function approachRadius(node: { radius: number }): number {
  return node.radius + approachPad(node);
}

export function nodeApproaching(nodes: MapNode[], x: number, y: number): MapNode | null {
  let best: MapNode | null = null;
  let bestD = Infinity;
  for (const node of nodes) {
    const pad = approachPad(node);
    const expanded = inflateBounds(nodeBounds(node), pad);
    if (!pointInBounds(expanded, x, y)) continue;
    const inside = pointInNode(node, x, y);
    if (!inside) {
      const edge = closestOnNode(node, x, y);
      const d = Math.hypot(edge.x - x, edge.y - y);
      if (d > pad) continue;
      if (d < bestD) {
        best = node;
        bestD = d;
      }
    } else if (bestD > 0) {
      best = node;
      bestD = 0;
    }
  }
  return best;
}

export function poiApproaching(pois: PointOfInterest[], x: number, y: number): PointOfInterest | null {
  let best: PointOfInterest | null = null;
  let bestD = Infinity;
  for (const poi of pois) {
    const b = boundsFromRadius(poi.x, poi.y, poi.radius);
    const pad = approachPad(poi);
    if (!pointInBounds(inflateBounds(b, pad), x, y)) continue;
    const d = Math.hypot(x - poi.x, y - poi.y);
    if (d < bestD) {
      best = poi;
      bestD = d;
    }
  }
  return best;
}

export function edgePoint(node: MapNode, x: number, y: number): Vec2 {
  return closestOnNode(node, x, y);
}

export function presentedPosition(overworld: Vec2, node: MapNode | null, scale: number): Vec2 {
  if (!node) return overworld;
  if (pointInNode(node, overworld.x, overworld.y)) return overworld;
  const edge = closestOnNode(node, overworld.x, overworld.y);
  const t = smoothstep(FADE_START, DETAIL_START, scale);
  return { x: lerp(overworld.x, edge.x, t), y: lerp(overworld.y, edge.y, t) };
}

export function presentedFocus(overworld: Vec2, _nodes: MapNode[], _pois: PointOfInterest[], _scale: number): Vec2 {
  return overworld;
}

export function poiAsNode(poi: PointOfInterest): MapNode {
  const blob = growTileBlob(poi.x, poi.y, Math.max(poi.radius, GENERATED_ZONE_RADIUS), {
    seed: poi.seed,
    kind: 'meadow',
    biomeBias: 0.18,
  });
  return {
    id: poi.id,
    name: poi.name,
    origin: 'generated',
    kind: 'meadow',
    poiKind: poi.kind,
    biome: poi.biome,
    cx: poi.x,
    cy: poi.y,
    radius: poi.radius,
    seed: poi.seed,
    tiles: blob.tiles,
    x0: blob.x0,
    y0: blob.y0,
    x1: blob.x1,
    y1: blob.y1,
  };
}

export function detailAnchor(nodes: MapNode[], pois: PointOfInterest[], x: number, y: number): MapNode | null {
  const node = nodeApproaching(nodes, x, y);
  if (node) return node;
  const poi = poiApproaching(pois, x, y);
  return poi ? poiAsNode(poi) : null;
}

export function tileCoveredByNode(nodes: MapNode[], wx: number, wy: number): MapNode | null {
  return nodeContaining(nodes, wx + 0.5, wy + 0.5);
}

export function placeTouchesTile(place: MapNode, x: number, y: number): boolean {
  for (const t of place.tiles ?? []) {
    if (Math.abs(t.x - x) + Math.abs(t.y - y) <= 1) return true;
  }
  return false;
}

export function scaleLabel(scale: number): string {
  if (scale < 0.07) return 'Continent';
  if (scale < 0.28) return 'Kingdom';
  if (scale < 0.95) return 'Region';
  if (scale < 2.4) return 'Locale';
  if (scale < 6.2) return 'District';
  if (scale < 14) return 'Street';
  return 'Close';
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
