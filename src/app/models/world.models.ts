export const TILE = 16;
export const WORLD_BASE = 192;
export const WORLD_SCALES = [1, 2, 4, 8, 16] as const;
export type WorldScale = (typeof WORLD_SCALES)[number];
export const ZONE_SCALE = 8;
/** Close enough that a person sprite fills the view. */
export const MAX_SCALE = 160;
/** Adventure / Start adventure camera: Close band, not Person (160). */
export const CLOSE_SCALE = 32;
export const DIVE_SCALE = 16.4;
export const DETAIL_START = 4.2;
/** Padding around a place when framing the whole instance. */
export const ZONE_FIT_PAD = 2.8;
/** Extra zoom-out past a fitted zone before returning to the overworld. */
export const ZONE_LEAVE_FACTOR = 0.55;
/** After zooming out, wait this long before a dive can mint a new place. */
export const ZOOM_OUT_DISCOVER_COOLDOWN_MS = 800;
/** Typical generated hamlet / POI blob radius in world tiles (cities are larger). */
export const GENERATED_ZONE_RADIUS = 7.6;

/** Base world-tile radius for a place, before rare 2× / 4× / 8× rolls. */
export const ZONE_RADIUS: Record<NodeKind, number> = {
  city: 10.8,
  town: 6.6,
  hamlet: 4.1,
  camp: 3.5,
  grove: 4.6,
  meadow: 5.1,
  shore: 4.5,
  pass: 4.3,
};

/** Usually 1×. ~16% roll 2×, ~6% roll 4×, ~2.5% roll 8×; ~10% shrink to 0.6×. */
export function zoneSizeMult(roll: number): number {
  const u = clamp(roll, 0, 1);
  if (u < 0.025) return 8;
  if (u < 0.09) return 4;
  if (u < 0.25) return 2;
  if (u > 0.9) return 0.6;
  return 1;
}

export function zoneRadiusFor(kind: NodeKind, roll: number, jitter = 1): number {
  return ZONE_RADIUS[kind] * zoneSizeMult(roll) * jitter;
}

/** Same cap as a 1× map so 16× continents cannot mint 6k-tile POI zones. */
export const MAX_ZONE_RADIUS = WORLD_BASE * 0.2;
/** Hard ceiling for generated / POI blobs (authored cities stay as grown). */
export const MAX_GENERATED_ZONE_TILES = 640;
/** Street chunks to generate per frame so a dive does not hitch. */
export const CHUNK_STREAM_PER_FRAME = 16;

export function capZoneRadius(radius: number, width: number, height: number): number {
  const cap = Math.max(ZONE_RADIUS.hamlet, Math.min(MAX_ZONE_RADIUS, Math.min(width, height) * 0.2));
  return Math.min(Math.max(2.2, radius), cap);
}

export const DETAIL_END = 7.8;
export const ADVENTURE_ASK_SCALE = 4.2;
/** Max zoom over unexplored (cloudy) land — biome map, not street or character. */
export const CLOUD_ZOOM_CAP = 3.6;
/** Leftover ungenerated pockets of this many tiles or fewer get absorbed into isolation. */
export const ADVENTURE_POCKET_MAX = 16;
/** Smallest generated place. Land leftovers under this are sealed into the new zone. */
export const MIN_ZONE_TILES = 8;
export const FADE_START = 1.2;
export const FADE_END = 3.9;
export const WALK_SPEED = 3.2;
export const SPRINT_MULT = 2.6;
export const SPEED_REF_SCALE = 2.2;
export const GAME_HOURS_PER_REAL_SEC = 8 / 60;
export const PLAY_RATE = 0.125;
export const FAST_RATE = 1;
export const FASTEST_RATE = 8;
export const SYNC_TURN_TILES = 0.72;
export const SYNC_TURN_HOURS = 0.12;

export interface WorldSettings {
  worldScale: WorldScale;
  mapStyle: MapStyle;
  poiCount: number;
  wanderers: number;
  caravans: number;
  armies: number;
  /** Optional 0–1 silhouette used when `mapStyle` is `custom`. */
  landSketch: number[] | null;
}

/** Side length of `WorldSettings.landSketch`. */
export const LAND_SKETCH_SIZE = 40;

export const MAP_STYLES = ['continent', 'archipelago', 'isthmus', 'lakes', 'highlands', 'custom'] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

export const MAP_STYLE_LABELS: Record<MapStyle, string> = {
  continent: 'Continent',
  archipelago: 'Isles',
  isthmus: 'Isthmus',
  lakes: 'Lakes',
  highlands: 'Highlands',
  custom: 'Custom',
};

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  worldScale: 8,
  mapStyle: 'continent',
  poiCount: 48,
  wanderers: 32,
  caravans: 8,
  armies: 4,
  landSketch: null,
};

export function worldExtent(scale: WorldScale): number {
  return WORLD_BASE * scale;
}

export function minScaleFor(width: number): number {
  return Math.max(0.006, 0.09 * (WORLD_BASE / width));
}

/** Planet fills most of the view just after leaving the flat continent. */
export const GLOBE_FILL_CLOSE = 0.9;
/** Closer crop of the globe, just before the view flattens to 2D. */
export const GLOBE_FILL_NEAR = 1.28;
/** Comfortably framed planet, like a fitted place. */
export const GLOBE_FILL_FIT = 0.76;
/** Extra space around the planet at max zoom-out. */
export const GLOBE_FILL_FAR = 0.48;

/** Scale where the globe is framed like a fitted place. */
export function globeFitScaleFor(width: number): number {
  return Math.max(0.0004, minScaleFor(width) / 14);
}

/** Zoom-in past a fitted planet before the 2D map takes over. */
export function globeNearScaleFor(width: number): number {
  return minScaleFor(width) * 22;
}

/** Far-orbit floor. Wide band so planet zoom lasts like place zoom. */
export function globeMinScaleFor(width: number): number {
  return Math.max(0.00025, minScaleFor(width) / 32);
}

/** 0 = just became a globe (close-up), 1 = fitted / farther orbit. */
export function globeMorphT(scale: number, width: number): number {
  const close = minScaleFor(width);
  const fit = globeFitScaleFor(width);
  if (scale >= close) return 0;
  if (scale <= fit) return 1;
  const lo = Math.log(Math.max(1e-6, fit));
  const hi = Math.log(Math.max(fit * 1.01, close));
  return clamp((hi - Math.log(scale)) / (hi - lo), 0, 1);
}

export function globeActive(scale: number, width: number): boolean {
  return scale < minScaleFor(width);
}

/** How much of the short viewport side the planet should fill at `scale`. */
export function globeFillFor(scale: number, width: number): number {
  const near = globeNearScaleFor(width);
  const close = minScaleFor(width);
  const fit = globeFitScaleFor(width);
  const far = globeMinScaleFor(width);
  if (scale >= near) return GLOBE_FILL_NEAR;
  if (scale >= close) return logLerp(scale, close, near, GLOBE_FILL_CLOSE, GLOBE_FILL_NEAR);
  if (scale >= fit) return logLerp(scale, fit, close, GLOBE_FILL_FIT, GLOBE_FILL_CLOSE);
  return logLerp(scale, far, fit, GLOBE_FILL_FAR, GLOBE_FILL_FIT);
}

function logLerp(scale: number, loScale: number, hiScale: number, loVal: number, hiVal: number): number {
  const lo = Math.log(Math.max(1e-9, loScale));
  const hi = Math.log(Math.max(loScale * 1.01, hiScale));
  const t = clamp((Math.log(Math.max(1e-9, scale)) - lo) / (hi - lo), 0, 1);
  return loVal + (hiVal - loVal) * t;
}

export function startScaleFor(width: number): number {
  return 0.26 * (WORLD_BASE / width);
}

export function wrapX(x: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(x)) return 0;
  const w = x % width;
  return w < 0 ? w + width : w;
}

export function wrapDeltaX(from: number, to: number, width: number): number {
  let d = to - from;
  if (d > width * 0.5) d -= width;
  if (d < -width * 0.5) d += width;
  return d;
}

export function lerpWrapX(from: number, to: number, t: number, width: number): number {
  return wrapX(from + wrapDeltaX(from, to, width) * t, width);
}

export function clampLatY(y: number, height: number): number {
  return clamp(y, 0.35, Math.max(0.35, height - 0.35));
}

/** Camera scale that fits `bounds` in the viewport, with a fog-margin pad. */
export function fitScaleForBounds(
  bounds: RegionBounds,
  viewW: number,
  viewH: number,
  pad = ZONE_FIT_PAD,
): number {
  const spanX = Math.max(3, bounds.x1 - bounds.x0 + pad * 2);
  const spanY = Math.max(3, bounds.y1 - bounds.y0 + pad * 2);
  const w = Math.max(64, viewW);
  const h = Math.max(64, viewH);
  return Math.min(w / (spanX * TILE), h / (spanY * TILE));
}

export function leaveScaleForFit(fit: number): number {
  return Math.min(fit * ZONE_LEAVE_FACTOR, Math.max(0.08, fit - 0.45));
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
    landSketch: normalizeLandSketch(raw.landSketch),
  };
}

function normalizeLandSketch(raw: unknown): number[] | null {
  const n = LAND_SKETCH_SIZE * LAND_SKETCH_SIZE;
  if (!Array.isArray(raw) || raw.length !== n) return null;
  const out = new Array<number>(n);
  let ink = false;
  for (let i = 0; i < n; i++) {
    const v = clamp(Number(raw[i]) || 0, 0, 1);
    out[i] = v;
    if (v > 0.05) ink = true;
  }
  return ink ? out : null;
}

export type SimMode = 'paused' | 'play' | 'fast' | 'fastest' | 'sync';
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
  /** True while the lead is on water (boat sprite, members hidden). */
  afloat: boolean;
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
  fastest: 'Fastest',
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
  const biome = biomeAt(world, wrapX(x, world.width), y);
  return biome !== Biome.Water;
}

export function waterAt(world: WorldData, x: number, y: number): boolean {
  return biomeAt(world, wrapX(x, world.width), y) === Biome.Water;
}

/** Land or water; used by travelers that can boat. Poles stay blocked. */
export function traversableAt(world: WorldData, x: number, y: number): boolean {
  const iy = Math.floor(y);
  return iy >= 0 && iy < world.height;
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
  /** Local walker is `local`. Hosted guests can reuse this shape with other ids. */
  id: string;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  frame: number;
  anim: number;
  sheet: string;
  char: number;
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

type BlobLobe = { x: number; y: number; r: number };

type BlobShape = {
  aspect: number;
  squareness: number;
  angle: number;
  wobble: number;
  lobes: BlobLobe[];
};

function blobShapeFor(kind: NodeKind | undefined, seed: number, cx: number, cy: number, reach: number): BlobShape {
  const city = kind === 'city';
  const town = kind === 'town';
  const settled = city || town || kind === 'hamlet';
  const aspect = city
    ? 0.9 + blobHash(seed, 13, 17) * 0.22
    : kind === 'pass'
      ? 0.42 + blobHash(seed, 13, 17) * 0.22
      : 0.78 + blobHash(seed, 13, 17) * 0.44;
  const squareness = city
    ? 0.72 + blobHash(seed, 2, 11) * 0.22
    : town
      ? 0.58 + blobHash(seed, 2, 11) * 0.24
      : settled || kind === 'camp'
        ? 0.38 + blobHash(seed, 3, 11) * 0.32
        : 0.16 + blobHash(seed, 5, 11) * 0.38;
  const angle = (blobHash(seed, 19, 29) - 0.5) * Math.PI;
  const wobble = city ? 0.08 : town ? 0.16 : 0.22 + blobHash(seed, 23, 7) * 0.22;
  const lobes: BlobLobe[] = [];
  const lobeRoll = blobHash(seed, 9, 41);
  const extra = city ? (lobeRoll < 0.22 ? 1 : 0) : lobeRoll < 0.28 ? 2 : lobeRoll < 0.58 ? 1 : 0;
  for (let i = 0; i < extra; i++) {
    const a = angle + (i * 2.15 + blobHash(seed, 31 + i, 5) * 2.4);
    const dist = reach * (0.42 + blobHash(seed, 37 + i, 11) * 0.38);
    lobes.push({
      x: cx + Math.cos(a) * dist,
      y: cy + Math.sin(a) * dist * (0.72 + aspect * 0.2),
      r: reach * (0.32 + blobHash(seed, 43 + i, 13) * 0.28),
    });
  }
  return { aspect, squareness, angle, wobble, lobes };
}

function rotate2(dx: number, dy: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [dx * c - dy * s, dx * s + dy * c];
}

function inBlobShape(
  x: number,
  y: number,
  cx: number,
  cy: number,
  reach: number,
  shape: BlobShape,
  seed: number,
): boolean {
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  const [rx, ry] = rotate2(dx, dy, shape.angle);
  const n1 = blobHash(Math.floor(x * 3 + 8), Math.floor(y * 3 + 4), seed ^ 71);
  const n2 = blobHash(Math.floor(x * 7 + 2), Math.floor(y * 5 + 9), seed ^ 91);
  const bump = 1 - shape.wobble * ((n1 - 0.5) * 0.7 + (n2 - 0.5) * 0.38);
  if (polyMetric(rx, ry, shape.aspect, shape.squareness) <= reach * bump) return true;
  for (const lobe of shape.lobes) {
    const d = Math.hypot(x + 0.5 - lobe.x, y + 0.5 - lobe.y);
    if (d <= lobe.r * bump) return true;
  }
  return false;
}

function minTilesForKind(kind: NodeKind | undefined, reach: number): number {
  const byKind =
    kind === 'city' ? 40 : kind === 'town' ? 22 : kind === 'hamlet' ? 12 : kind === 'camp' ? MIN_ZONE_TILES : 10;
  const byReach = Math.max(MIN_ZONE_TILES, Math.round(reach * reach * 0.42));
  return Math.min(120, Math.max(byKind, byReach));
}

function expandToMinTiles(
  tiles: Vec2[],
  minCount: number,
  isOpen: (x: number, y: number) => boolean,
  blocked: Set<string>,
): void {
  if (tiles.length >= minCount) return;
  const taken = new Set(tiles.map((t) => tileKey(t.x, t.y)));
  const q = tiles.slice();
  let i = 0;
  while (i < q.length && tiles.length < minCount) {
    const cur = q[i++]!;
    for (const [dx, dy] of CARDINAL) {
      const x = cur.x + dx;
      const y = cur.y + dy;
      const key = tileKey(x, y);
      if (taken.has(key) || blocked.has(key) || !isOpen(x, y)) continue;
      taken.add(key);
      const next = { x, y };
      tiles.push(next);
      q.push(next);
      if (tiles.length >= minCount) return;
    }
  }
}

export function capGeneratedZoneTiles(tiles: Vec2[], cx: number, cy: number): Vec2[] {
  return trimTilesToCenter(tiles, cx, cy, MAX_GENERATED_ZONE_TILES);
}

function trimTilesToCenter(tiles: Vec2[], cx: number, cy: number, max: number): Vec2[] {
  if (tiles.length <= max) return tiles;
  const ranked = tiles.map((t) => ({ t, d: (t.x + 0.5 - cx) ** 2 + (t.y + 0.5 - cy) ** 2 }));
  ranked.sort((a, b) => a.d - b.d);
  return ranked.slice(0, max).map((r) => r.t);
}

/** Dive seed baked into `gen-x-y-*` ids, otherwise the stored centroid. */
export function placeGrowthSeed(node: MapNode): Vec2 {
  const m = /^gen-(\d+)-(\d+)/.exec(node.id);
  if (m) return { x: Number(m[1]) + 0.5, y: Number(m[2]) + 0.5 };
  return { x: node.cx, y: node.cy };
}

function tileNearerToAvoid(
  x: number,
  y: number,
  seedX: number,
  seedY: number,
  avoid: Array<{ cx: number; cy: number }>,
): boolean {
  if (!avoid.length) return false;
  const dSelf = (x + 0.5 - seedX) ** 2 + (y + 0.5 - seedY) ** 2;
  for (const o of avoid) {
    const dO = (x + 0.5 - o.cx) ** 2 + (y + 0.5 - o.cy) ** 2;
    if (dO + 2.25 < dSelf) return true;
  }
  return false;
}

function tileInOwnedSquare(x: number, y: number, set: Set<string>): boolean {
  for (const [dx, dy] of [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1],
  ] as const) {
    if (
      set.has(tileKey(x + dx, y + dy)) &&
      set.has(tileKey(x + dx + 1, y + dy)) &&
      set.has(tileKey(x + dx, y + dy + 1)) &&
      set.has(tileKey(x + dx + 1, y + dy + 1))
    ) {
      return true;
    }
  }
  return false;
}

function blobAspect(tiles: Vec2[]): number {
  if (tiles.length <= 1) return 1;
  const b = boundsFromTiles(tiles);
  const w = Math.max(1, b.x1 - b.x0);
  const h = Math.max(1, b.y1 - b.y0);
  return Math.max(w, h) / Math.min(w, h);
}

/** Drop 1-tile-wide tentacles left by Voronoi clips or contour fill. */
function pruneThinCorridors(tiles: Vec2[], seedX: number, seedY: number): Vec2[] {
  if (tiles.length <= 1) return tiles;
  const compact = tiles.length <= MIN_ZONE_TILES && blobAspect(tiles) <= 2.2;
  if (compact) return tiles;
  const set = new Set(tiles.map((t) => tileKey(t.x, t.y)));
  const solid = tiles.filter((t) => tileInOwnedSquare(t.x, t.y, set));
  if (solid.length < Math.min(MIN_ZONE_TILES, tiles.length)) {
    const core = tiles.filter(
      (t) => Math.max(Math.abs(t.x + 0.5 - seedX), Math.abs(t.y + 0.5 - seedY)) <= 2.5,
    );
    return keepTilesConnected(core.length ? core : tiles, seedX, seedY);
  }
  const kept = keepTilesConnected(solid, seedX, seedY);
  return kept.length ? kept : tiles;
}

/** Pull a Voronoi finger back toward the seed so counties stay blob-shaped. */
function clampBlobAspect(tiles: Vec2[], seedX: number, seedY: number, maxAspect = 2.2): Vec2[] {
  if (tiles.length <= 2) return tiles;
  let kept = tiles;
  for (let i = 0; i < 12; i++) {
    const aspect = blobAspect(kept);
    if (aspect <= maxAspect) break;
    const b = boundsFromTiles(kept);
    const w = Math.max(1, b.x1 - b.x0);
    const h = Math.max(1, b.y1 - b.y0);
    const longX = w >= h;
    const limit = (Math.min(w, h) * maxAspect) / 2;
    const next = kept.filter((t) => {
      const d = longX ? Math.abs(t.x + 0.5 - seedX) : Math.abs(t.y + 0.5 - seedY);
      return d <= limit + 0.01;
    });
    if (next.length < 2 || next.length === kept.length) break;
    kept = keepTilesConnected(next, seedX, seedY);
  }
  const b = boundsFromTiles(kept);
  const minDim = Math.min(Math.max(1, b.x1 - b.x0), Math.max(1, b.y1 - b.y0));
  if (minDim <= 2 && blobAspect(kept) > 2.4) {
    const core = kept.filter(
      (t) => Math.max(Math.abs(t.x + 0.5 - seedX), Math.abs(t.y + 0.5 - seedY)) <= 2.5,
    );
    kept = keepTilesConnected(core.length ? core : kept, seedX, seedY);
  }
  return kept.length ? kept : tiles;
}

function tidyPlaceTiles(tiles: Vec2[], seedX: number, seedY: number): Vec2[] {
  return clampBlobAspect(pruneThinCorridors(tiles, seedX, seedY), seedX, seedY);
}

function keepTilesConnected(tiles: Vec2[], seedX: number, seedY: number): Vec2[] {
  if (tiles.length <= 1) return tiles;
  const set = new Set(tiles.map((t) => tileKey(t.x, t.y)));
  let ox = Math.floor(seedX);
  let oy = Math.floor(seedY);
  if (!set.has(tileKey(ox, oy))) {
    let best = Infinity;
    for (const t of tiles) {
      const d = (t.x + 0.5 - seedX) ** 2 + (t.y + 0.5 - seedY) ** 2;
      if (d < best) {
        best = d;
        ox = t.x;
        oy = t.y;
      }
    }
  }
  const out: Vec2[] = [];
  const seen = new Set<string>();
  const stack: Vec2[] = [{ x: ox, y: oy }];
  while (stack.length) {
    const cur = stack.pop()!;
    const key = tileKey(cur.x, cur.y);
    if (seen.has(key) || !set.has(key)) continue;
    seen.add(key);
    out.push(cur);
    for (const [dx, dy] of CARDINAL) stack.push({ x: cur.x + dx, y: cur.y + dy });
  }
  return out.length ? out : tiles;
}

/** Drop tiles on the far side of another place so a new blob cannot wrap around it. */
export function clipBlobAwayFromPlaces(
  tiles: Vec2[],
  seedX: number,
  seedY: number,
  avoid: Array<{ cx: number; cy: number }>,
  walls?: Set<string>,
): Vec2[] {
  let kept = tiles;
  if (tiles.length && avoid.length) {
    kept = tiles.filter((t) => !tileNearerToAvoid(t.x, t.y, seedX, seedY, avoid));
    if (!kept.length) kept = [tiles[0]!];
    kept = keepTilesConnected(kept, seedX, seedY);
  }
  kept = tidyPlaceTiles(kept, seedX, seedY);
  kept = fillInteriorHoles(kept, walls);
  return keepTilesConnected(kept, seedX, seedY);
}

/** Fill any fully enclosed interior so places cannot keep donut / negative holes. */
export function fillInteriorHoles(tiles: Vec2[], walls?: Set<string>): Vec2[] {
  return fillEnclosedPockets(tiles, Number.POSITIVE_INFINITY, walls);
}

function sameTileSet(a: Vec2[], b: Vec2[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map((t) => tileKey(t.x, t.y)));
  for (const t of b) {
    if (!keys.has(tileKey(t.x, t.y))) return false;
  }
  return true;
}

/** Split saved donuts: later places keep only the side of their seed, not a ring around neighbors. */
export function separateNestedPlaces(nodes: MapNode[]): boolean {
  let changed = false;
  for (const node of nodes) {
    if (!node.tiles?.length) continue;
    const seed = placeGrowthSeed(node);
    const walls = new Set<string>();
    const avoid = nodes
      .filter((n) => n.id !== node.id && n.tiles?.length)
      .map((n) => {
        const s = placeGrowthSeed(n);
        for (const t of n.tiles ?? []) walls.add(tileKey(t.x, t.y));
        return { cx: s.x, cy: s.y };
      });
    const next = clipBlobAwayFromPlaces(node.tiles, seed.x, seed.y, avoid, walls);
    if (sameTileSet(next, node.tiles)) continue;
    const b = boundsFromTiles(next);
    node.tiles = next;
    node.x0 = b.x0;
    node.y0 = b.y0;
    node.x1 = b.x1;
    node.y1 = b.y1;
    node.cx = (b.x0 + b.x1) / 2;
    node.cy = (b.y0 + b.y1) / 2;
    changed = true;
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (node.origin === 'authored' || !node.tiles?.length) continue;
    const b = boundsFromTiles(node.tiles);
    const minDim = Math.min(Math.max(1, b.x1 - b.x0), Math.max(1, b.y1 - b.y0));
    if (minDim >= 3) continue;
    nodes.splice(i, 1);
    changed = true;
  }
  return changed;
}

function collectPolyTiles(
  cx: number,
  cy: number,
  reach: number,
  shape: BlobShape,
  seed: number,
  startX: number,
  startY: number,
  isOpen: (x: number, y: number) => boolean,
  maxTiles = Infinity,
): Vec2[] {
  let padX = Math.ceil(reach + 1);
  let padY = Math.ceil(reach * Math.max(shape.aspect, 1 / Math.max(0.2, shape.aspect)) + 1);
  for (const lobe of shape.lobes) {
    padX = Math.max(padX, Math.ceil(Math.abs(lobe.x - cx) + lobe.r + 1));
    padY = Math.max(padY, Math.ceil(Math.abs(lobe.y - cy) + lobe.r + 1));
  }
  const x0 = Math.floor(cx) - padX;
  const y0 = Math.floor(cy) - padY;
  const x1 = Math.floor(cx) + padX;
  const y1 = Math.floor(cy) + padY;
  const inside = new Set<string>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!isOpen(x, y)) continue;
      if (!inBlobShape(x, y, cx, cy, reach, shape, seed)) continue;
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
    if (tiles.length >= maxTiles) break;
    for (const [dx, dy] of CARDINAL) stack.push({ x: cur.x + dx, y: cur.y + dy });
  }
  return tiles;
}

/**
 * Missing cell of a 2×2 where the new region meets a wall (other place, water, or
 * map edge). Filling it stops 1-tile wilderness islands at place corners.
 */
function fillsPinchSquare(
  x: number,
  y: number,
  taken: Set<string>,
  isWall: (x: number, y: number) => boolean,
): boolean {
  for (const [dx, dy] of DIAGONAL) {
    const hx = x + dx;
    const hy = y;
    const vx = x;
    const vy = y + dy;
    const hSolid = taken.has(tileKey(hx, hy)) || isWall(hx, hy);
    const vSolid = taken.has(tileKey(vx, vy)) || isWall(vx, vy);
    if (!hSolid || !vSolid) continue;
    const hTaken = taken.has(tileKey(hx, hy));
    const vTaken = taken.has(tileKey(vx, vy));
    const dTaken = taken.has(tileKey(x + dx, y + dy));
    if (hTaken || vTaken || dTaken) return true;
  }
  return false;
}

function occupiedMoore(
  x: number,
  y: number,
  taken: Set<string>,
  isWall: (x: number, y: number) => boolean,
): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (taken.has(tileKey(x + dx, y + dy)) || isWall(x + dx, y + dy)) n += 1;
    }
  }
  return n;
}

function cardinalSolid(
  x: number,
  y: number,
  taken: Set<string>,
  isWall?: (x: number, y: number) => boolean,
): number {
  let n = 0;
  for (const [dx, dy] of CARDINAL) {
    const nx = x + dx;
    const ny = y + dy;
    if (taken.has(tileKey(nx, ny)) || isWall?.(nx, ny)) n += 1;
  }
  return n;
}

function shouldFillGap(
  x: number,
  y: number,
  taken: Set<string>,
  isWall: (x: number, y: number) => boolean,
): boolean {
  if (cardinalSolid(x, y, taken, isWall) >= 3 || oppositeSolid(x, y, taken, isWall)) return true;
  if (fillsPinchSquare(x, y, taken, isWall)) return true;
  return occupiedMoore(x, y, taken, isWall) >= 5;
}

function cardinalTaken(x: number, y: number, taken: Set<string>): number {
  return cardinalSolid(x, y, taken);
}

function oppositeSolid(
  x: number,
  y: number,
  taken: Set<string>,
  isWall?: (x: number, y: number) => boolean,
): boolean {
  const solid = (nx: number, ny: number) => taken.has(tileKey(nx, ny)) || !!isWall?.(nx, ny);
  const north = solid(x, y - 1);
  const south = solid(x, y + 1);
  const east = solid(x + 1, y);
  const west = solid(x - 1, y);
  return (north && south) || (east && west);
}

function landAt(
  x: number,
  y: number,
  width: number,
  height: number,
  biomes?: Uint8Array,
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  if (!biomes) return true;
  return (biomes[x + y * width] as Biome) !== Biome.Water;
}

function wallAt(
  x: number,
  y: number,
  blocked: Set<string>,
  width: number,
  height: number,
  biomes?: Uint8Array,
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return true;
  if (blocked.has(tileKey(x, y))) return true;
  if (biomes && (biomes[x + y * width] as Biome) === Biome.Water) return true;
  return false;
}

function closeTileContour(
  tiles: Vec2[],
  taken: Set<string>,
  blocked: Set<string>,
  isOpen: (x: number, y: number) => boolean,
  keep?: Vec2,
  isWall?: (x: number, y: number) => boolean,
): void {
  const wall = isWall ?? ((x, y) => blocked.has(tileKey(x, y)));
  const dirs = [...CARDINAL, ...DIAGONAL];
  for (let pass = 0; pass < 6; pass++) {
    const add: Vec2[] = [];
    const seen = new Set<string>();
    for (const t of tiles) {
      for (const [dx, dy] of dirs) {
        const x = t.x + dx;
        const y = t.y + dy;
        const key = tileKey(x, y);
        if (seen.has(key) || taken.has(key)) continue;
        if (!isOpen(x, y)) continue;
        seen.add(key);
        if (shouldFillGap(x, y, taken, wall)) add.push({ x, y });
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
    if (tiles.length <= MIN_ZONE_TILES) break;
    const drop: number[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]!;
      if (keep && t.x === keep.x && t.y === keep.y) continue;
      if (cardinalTaken(t.x, t.y, taken) > 1) continue;
      if (occupiedMoore(t.x, t.y, taken, wall) >= 3) continue;
      drop.push(i);
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

/** Swallow leftover land too small to ever be its own place (boxed in by zones, water, or the map edge). */
function absorbStrandedLand(
  tiles: Vec2[],
  taken: Set<string>,
  blocked: Set<string>,
  width: number,
  height: number,
  biomes?: Uint8Array,
  maxSize = MIN_ZONE_TILES - 1,
): void {
  if (!tiles.length) return;
  const b = boundsFromTiles(tiles);
  const pad = maxSize + 1;
  const minX = b.x0 - pad;
  const minY = b.y0 - pad;
  const maxX = b.x1 + pad;
  const maxY = b.y1 + pad;
  const visited = new Set<string>();
  const starts: Vec2[] = [];
  const dirs = [...CARDINAL, ...DIAGONAL];
  for (const t of tiles) {
    for (const [dx, dy] of dirs) {
      const x = t.x + dx;
      const y = t.y + dy;
      const key = tileKey(x, y);
      if (taken.has(key) || blocked.has(key) || visited.has(key)) continue;
      if (!landAt(x, y, width, height, biomes)) continue;
      starts.push({ x, y });
    }
  }
  for (const start of starts) {
    const sk = tileKey(start.x, start.y);
    if (visited.has(sk) || taken.has(sk)) continue;
    const component: Vec2[] = [];
    const stack = [start];
    let tooBig = false;
    while (stack.length) {
      const cur = stack.pop()!;
      const key = tileKey(cur.x, cur.y);
      if (visited.has(key)) continue;
      if (taken.has(key) || blocked.has(key)) continue;
      if (!landAt(cur.x, cur.y, width, height, biomes)) continue;
      if (cur.x < minX || cur.y < minY || cur.x > maxX || cur.y > maxY) {
        tooBig = true;
        break;
      }
      visited.add(key);
      component.push(cur);
      if (component.length > maxSize) {
        tooBig = true;
        break;
      }
      for (const [dx, dy] of CARDINAL) stack.push({ x: cur.x + dx, y: cur.y + dy });
    }
    if (tooBig || !component.length) continue;
    for (const t of component) {
      const key = tileKey(t.x, t.y);
      if (taken.has(key) || blocked.has(key)) continue;
      taken.add(key);
      tiles.push(t);
    }
  }
}

/** Close leftover land smaller than a real place, using other zones / water / the map edge as walls. */
export function sealPlaceTiles(
  tiles: Vec2[],
  blocked: Set<string>,
  width: number,
  height: number,
  biomes?: Uint8Array,
): Vec2[] {
  const out = tiles.slice();
  const taken = new Set(out.map((t) => tileKey(t.x, t.y)));
  absorbStrandedLand(out, taken, blocked, width, height, biomes);
  return fillInteriorHoles(out, blocked);
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
    maxTiles?: number;
    /** Other place centers. Tiles closer to these than to the seed are skipped. */
    avoid?: Array<{ cx: number; cy: number }>;
  },
): { tiles: Vec2[] } & RegionBounds {
  const w = opts?.width ?? WORLD_BASE;
  const h = opts?.height ?? WORLD_BASE;
  const seed = opts?.seed ?? 1;
  const kind = opts?.kind;
  const blocked = opts?.blocked ?? new Set<string>();
  const avoid = opts?.avoid ?? [];
  const reach = radius * (kind === 'pass' ? 0.9 : 1);
  const shape = blobShapeFor(kind, seed, cx, cy, reach);

  const biomeBias = opts?.biomeBias ?? (kind === 'city' || kind === 'town' ? 0.9 : 0.22);

  const land = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    if (blocked.has(tileKey(x, y))) return false;
    if (tileNearerToAvoid(x, y, cx, cy, avoid)) return false;
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
    return inBlobShape(x, y, cx, cy, reach * (1 - biomeBias * 0.28), shape, seed);
  };

  const maxTiles = opts?.maxTiles ?? Infinity;
  const tiles = collectPolyTiles(cx, cy, reach, shape, seed, sx, sy, inPoly, maxTiles);
  if (!tiles.length) tiles.push({ x: sx, y: sy });
  expandToMinTiles(
    tiles,
    minTilesForKind(kind, reach),
    (x, y) => inPoly(x, y) && inBlobShape(x, y, cx, cy, reach * 1.18, shape, seed),
    blocked,
  );
  const taken = new Set<string>();
  for (const t of tiles) taken.add(tileKey(t.x, t.y));
  const wall = (x: number, y: number) => wallAt(x, y, blocked, w, h, opts?.biomes);
  closeTileContour(tiles, taken, blocked, land, { x: sx, y: sy }, wall);
  const filled = fillInteriorHoles(tiles, blocked);
  const out = filled === tiles ? tiles : filled.slice();
  const outTaken = new Set(out.map((t) => tileKey(t.x, t.y)));
  if (!Number.isFinite(maxTiles) || out.length < maxTiles) {
    absorbStrandedLand(out, outTaken, blocked, w, h, opts?.biomes);
  }
  const capped = Number.isFinite(maxTiles) ? trimTilesToCenter(out, cx, cy, maxTiles) : out;
  const separated = clipBlobAwayFromPlaces(capped, cx, cy, avoid, blocked);
  return { tiles: separated, ...boundsFromTiles(separated) };
}

function openAdventureTile(
  x: number,
  y: number,
  width: number,
  height: number,
  blocked: Set<string>,
  biomes?: Uint8Array,
): boolean {
  if (!landAt(x, y, width, height, biomes)) return false;
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
  reach = 0,
  kind?: NodeKind,
  biomes?: Uint8Array,
): AdventureRegion {
  const startX = clamp(Math.floor(sx), 0, width - 1);
  const startY = clamp(Math.floor(sy), 0, height - 1);
  if (!openAdventureTile(startX, startY, width, height, blocked, biomes)) {
    return regionFromTiles([{ x: startX, y: startY }]);
  }

  const open = (x: number, y: number) => openAdventureTile(x, y, width, height, blocked, biomes);
  const wall = (x: number, y: number) => wallAt(x, y, blocked, width, height, biomes);
  let span = reach > 0.5 ? reach : 5.5 + blobHash(startX, startY, seed) * 2.8;
  if (hug?.length) span *= 0.78;
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
    cx += (vx / len) * span * 0.28;
    cy += (vy / len) * span * 0.28;
  }
  const shape = blobShapeFor(kind, seed, cx, cy, span);

  const tiles = collectPolyTiles(cx, cy, span, shape, seed, startX, startY, open);
  if (!tiles.length) tiles.push({ x: startX, y: startY });
  expandToMinTiles(
    tiles,
    minTilesForKind(kind, span),
    (x, y) => open(x, y) && inBlobShape(x, y, cx, cy, span * 1.2, shape, seed),
    blocked,
  );
  const taken = new Set<string>();
  for (const t of tiles) taken.add(tileKey(t.x, t.y));
  closeTileContour(tiles, taken, blocked, open, { x: startX, y: startY }, wall);
  absorbAdventurePockets(tiles, taken, blocked, width, height);
  closeTileContour(tiles, taken, blocked, open, { x: startX, y: startY }, wall);
  absorbAdventurePockets(tiles, taken, blocked, width, height);
  absorbStrandedLand(tiles, taken, blocked, width, height, biomes);
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
  if (node.poiKind && world) {
    const tiles = poiFootprintTiles(
      { kind: node.poiKind, x: node.cx, y: node.cy, seed: node.seed },
      world,
    );
    if (tiles.length) return assignNodeTiles(node, { tiles, ...boundsFromTiles(tiles) });
  }
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

export function pointInTiles(tiles: Vec2[] | undefined, x: number, y: number): boolean {
  if (!tiles?.length) return false;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  for (const t of tiles) {
    if (t.x === tx && t.y === ty) return true;
  }
  return false;
}

export function closestOnTiles(tiles: Vec2[] | undefined, x: number, y: number): Vec2 {
  if (!tiles?.length) return { x, y };
  if (pointInTiles(tiles, x, y)) return { x, y };
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

export function closestOnNode(node: MapNode, x: number, y: number): Vec2 {
  const tiles = node.tiles;
  if (!tiles?.length) {
    const b = nodeBounds(node);
    return { x: clamp(x, b.x0, b.x1 - 0.001), y: clamp(y, b.y0, b.y1 - 0.001) };
  }
  return closestOnTiles(tiles, x, y);
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

export function poiOnTile(pois: PointOfInterest[], x: number, y: number): PointOfInterest | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  let best: PointOfInterest | null = null;
  let bestD = Infinity;
  for (const poi of pois) {
    if (Math.floor(poi.x) !== tx || Math.floor(poi.y) !== ty) continue;
    const d = Math.hypot(poi.x - x, poi.y - y);
    if (d < bestD) {
      best = poi;
      bestD = d;
    }
  }
  return best;
}

/** World-tile radius of a POI's pre-defined site (mansion ≈ 3×3, battlefield ≈ 5×5 disk). */
export function poiSiteReach(kind: PoiKind): number {
  return kind === 'battlefield' || kind === 'ruins' ? 2 : 1;
}

/** Compact land tiles centered on the POI so layouts are never clipped to a blob edge. */
export function poiFootprintTiles(
  poi: { kind: PoiKind; x: number; y: number; seed: number },
  world: { width: number; height: number; biomes?: Uint8Array },
  blocked?: Set<string>,
): Vec2[] {
  const cx = Math.floor(poi.x);
  const cy = Math.floor(poi.y);
  const reach = poiSiteReach(poi.kind);
  const tiles: Vec2[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (reach > 1 && dx * dx + dy * dy > reach * reach + 1) continue;
      if (reach === 1 && dx !== 0 && dy !== 0 && blobHash(poi.seed, 11 + dx, 13 + dy) < 0.38) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      if (blocked?.has(tileKey(x, y))) continue;
      if (world.biomes && (world.biomes[x + y * world.width] as Biome) === Biome.Water && (dx || dy)) continue;
      tiles.push({ x, y });
    }
  }
  if (!tiles.some((t) => t.x === cx && t.y === cy) && !blocked?.has(tileKey(cx, cy))) {
    tiles.unshift({ x: cx, y: cy });
  }
  return tiles;
}

export function poiCovering(
  pois: PointOfInterest[],
  x: number,
  y: number,
  world: { width: number; height: number; biomes?: Uint8Array },
): PointOfInterest | null {
  const here = poiOnTile(pois, x, y);
  if (here) return here;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  for (const poi of pois) {
    const foot = poiFootprintTiles(poi, world);
    if (foot.some((t) => t.x === tx && t.y === ty)) return poi;
  }
  return null;
}

export function placesTouch(a: MapNode, b: MapNode): boolean {
  const tiles = a.tiles ?? [];
  const other = b.tiles ?? [];
  if (!tiles.length || !other.length) return false;
  const set = new Set(tiles.map((t) => tileKey(t.x, t.y)));
  for (const t of other) {
    if (set.has(tileKey(t.x, t.y))) return true;
    for (const [dx, dy] of CARDINAL) {
      if (set.has(tileKey(t.x + dx, t.y + dy))) return true;
    }
  }
  return false;
}

export function poiFootprintTouchesPlace(
  place: MapNode,
  poi: { kind: PoiKind; x: number; y: number; seed: number },
  world: { width: number; height: number; biomes?: Uint8Array },
): boolean {
  const foot = poiFootprintTiles(poi, world);
  const set = new Set((place.tiles ?? []).map((t) => tileKey(t.x, t.y)));
  if (!set.size) return false;
  for (const t of foot) {
    if (set.has(tileKey(t.x, t.y))) return true;
    for (const [dx, dy] of CARDINAL) {
      if (set.has(tileKey(t.x + dx, t.y + dy))) return true;
    }
  }
  return false;
}

/** Isolation helper: tiles of POI sites that sit on or against this place. */
export function touchingPoiTiles(nodes: MapNode[], place: MapNode): Vec2[] {
  const extra: Vec2[] = [];
  for (const node of nodes) {
    if (!node.poiKind || node.id === place.id || !node.tiles?.length) continue;
    if (!placesTouch(place, node)) continue;
    extra.push(...node.tiles);
  }
  return extra;
}

/** Snap POI nodes to their centered footprints and carve those tiles out of other generated places. */
export function settlePoiSites(
  nodes: MapNode[],
  world: { width: number; height: number; biomes?: Uint8Array },
): boolean {
  let changed = false;
  for (const node of nodes) {
    if (!node.poiKind) continue;
    const tiles = poiFootprintTiles(
      { kind: node.poiKind, x: node.cx, y: node.cy, seed: node.seed },
      world,
    );
    if (!tiles.length) continue;
    const same =
      tiles.length === (node.tiles?.length ?? 0) &&
      tiles.every((t) => node.tiles!.some((u) => u.x === t.x && u.y === t.y));
    if (same) continue;
    assignNodeTiles(node, { tiles, ...boundsFromTiles(tiles) });
    changed = true;
  }
  const claimed = new Set<string>();
  for (const node of nodes) {
    if (!node.poiKind) continue;
    for (const t of node.tiles ?? []) claimed.add(tileKey(t.x, t.y));
  }
  if (!claimed.size) return changed;
  for (const node of nodes) {
    if (node.poiKind || node.origin === 'authored' || !node.tiles?.length) continue;
    const next = node.tiles.filter((t) => !claimed.has(tileKey(t.x, t.y)));
    if (next.length === node.tiles.length) continue;
    if (!next.length) {
      node.tiles = [];
      changed = true;
      continue;
    }
    const b = boundsFromTiles(next);
    assignNodeTiles(node, { tiles: next, ...b });
    node.cx = (b.x0 + b.x1) / 2;
    node.cy = (b.y0 + b.y1) / 2;
    changed = true;
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (node.origin === 'authored' || node.tiles?.length) continue;
    nodes.splice(i, 1);
    changed = true;
  }
  return changed;
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

/** Adjacent to a place blob (including the tile itself), preferring the smaller place. */
export function nodeTouching(nodes: MapNode[], x: number, y: number): MapNode | null {
  const wx = Math.floor(x);
  const wy = Math.floor(y);
  let best: MapNode | null = null;
  let bestA = Infinity;
  for (const node of nodes) {
    if (!placeTouchesTile(node, wx, wy)) continue;
    const n = node.tiles?.length ?? (node.x1 - node.x0) * (node.y1 - node.y0);
    if (n < bestA) {
      best = node;
      bestA = n;
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

export function poiKindToNodeKind(kind: PoiKind): NodeKind {
  switch (kind) {
    case 'homestead':
      return 'hamlet';
    case 'treehouse':
    case 'shrine':
    case 'hideout':
      return 'grove';
    case 'military-camp':
    case 'abandoned-camp':
      return 'camp';
    default:
      return 'meadow';
  }
}

export function poiAsNode(
  poi: PointOfInterest,
  opts?: {
    kind?: NodeKind;
    biomes?: Uint8Array;
    width?: number;
    height?: number;
    blocked?: Set<string>;
    avoid?: Array<{ cx: number; cy: number }>;
  },
): MapNode {
  const kind = opts?.kind ?? poiKindToNodeKind(poi.kind);
  const tiles = poiFootprintTiles(poi, {
    width: opts?.width ?? WORLD_BASE,
    height: opts?.height ?? WORLD_BASE,
    biomes: opts?.biomes,
  }, opts?.blocked);
  if (!tiles.length) tiles.push({ x: Math.floor(poi.x), y: Math.floor(poi.y) });
  const blob = { tiles, ...boundsFromTiles(tiles) };
  const radius = Math.max(poiSiteReach(poi.kind) + 0.6, Math.hypot(blob.x1 - blob.x0, blob.y1 - blob.y0) / 2);
  return {
    id: poi.id,
    name: poi.name,
    origin: 'generated',
    kind,
    poiKind: poi.kind,
    biome: poi.biome,
    cx: poi.x,
    cy: poi.y,
    radius,
    seed: poi.seed,
    tiles: blob.tiles,
    x0: blob.x0,
    y0: blob.y0,
    x1: blob.x1,
    y1: blob.y1,
  };
}

export function detailAnchor(world: WorldData, x: number, y: number): MapNode | null {
  return nodeContaining(world.nodes, x, y);
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

export function scaleLabel(scale: number, width = WORLD_BASE): string {
  if (scale < globeNearScaleFor(width)) return 'Globe';
  if (scale < 0.07) return 'Continent';
  if (scale < 0.28) return 'Kingdom';
  if (scale < 0.95) return 'Region';
  if (scale < 2.4) return 'Locale';
  if (scale < 6.2) return 'District';
  if (scale < 14) return 'Street';
  if (scale < 36) return 'Close';
  return 'Person';
}

/** 0–1 position of `scale` on a log zoom slider from fitted continent to street-close. */
export function zoomProgress(scale: number, minScale: number, maxScale = MAX_SCALE): number {
  const lo = Math.log(Math.max(1e-6, minScale));
  const hi = Math.log(Math.max(minScale * 1.01, maxScale));
  return clamp((Math.log(Math.max(minScale, scale)) - lo) / (hi - lo), 0, 1);
}

function niceLength(value: number): number {
  const exp = Math.floor(Math.log10(Math.max(value, 1e-9)));
  const frac = value / 10 ** exp;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

function formatTileSpan(tiles: number): string {
  if (tiles >= 1) {
    const n = Number.isInteger(tiles) ? String(tiles) : tiles.toFixed(tiles >= 10 ? 0 : 1);
    return `${n} tile${tiles === 1 ? '' : 's'}`;
  }
  const cells = tiles * ZONE_SCALE;
  if (cells >= 1) {
    const n = Math.round(cells);
    return `${n} cell${n === 1 ? '' : 's'}`;
  }
  return `${tiles} tiles`;
}

/** Map-style distance bar: a round tile span that fits about `targetPx` on screen. */
export function mapScaleBar(
  scale: number,
  targetPx = 92,
): { px: number; tiles: number; label: string } {
  const ppt = Math.max(1e-6, scale * TILE);
  let tiles = niceLength(targetPx / ppt);
  let px = tiles * ppt;
  if (px > 128) {
    tiles = niceLength(tiles / 2);
    px = tiles * ppt;
  }
  if (px < 36) {
    tiles = niceLength(tiles * 2);
    px = tiles * ppt;
  }
  return { px: clamp(px, 28, 140), tiles, label: formatTileSpan(tiles) };
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
