/**
 * AreaExport v0.4 — deterministic place payload for the Trailbound controller.
 * Engine-only (no Angular). Types in this file are the schema source of truth.
 *
 * Street chunks are baked here in (y, x) order, twice, so shared edges do not
 * depend on which neighbour the live session happened to generate first.
 * v0.3 adds a visual border ring and a 2 m height lattice sampled from the
 * world-gen FBM. New fields are always written; 0.2 readers should ignore them.
 */
import {
  Biome,
  ChunkData,
  MapNode,
  PlacedSprite,
  Vec2,
  WorldData,
  ZONE_SCALE,
  boundsFromTiles,
  chunkKey,
  tileKey,
} from '../models/world.models';
import { BuildingShape, buildingLabel, isBuildingSprite } from './buildings';
import {
  PART_CODE,
  PART_LEGEND,
  placedMask,
  rotateCardinal,
  rotateRidge,
  structureBounds,
  structureIsRect,
  templateById,
  templatesForType,
  type BuildingRotation,
  type RoofStyle,
} from './building-templates';
import { generateChunk, neighborMap } from './chunk-gen';
import { hash2 } from './noise';
import { SEASON, biomeSeason } from './tileset';
import { worldHeightSampler } from './world-gen';

/** Schema version. The controller rejects an unknown major version. */
export const AREA_EXPORT_VERSION = '0.4.0';
/**
 * Visual continuation around the playable place, in world tiles.
 * 4 × ZONE_SCALE = 32 inner tiles = 32 m on each side. Not walkable.
 */
export const BORDER_WORLD_TILES = 4;
/** Height lattice spacing. One inner tile is 1 m, so this is 2 m. */
export const HEIGHT_SUBDIV_METERS = 2;
/** Optional controller micro-relief amplitude. Not baked into `raw`. */
export const HEIGHT_DETAIL_METERS = 0.4;
/**
 * Minimum normalized window for the relief remap. A place whose continental
 * delta is smaller than this is not stretched across the full reliefMeters.
 */
export const HEIGHT_SOFT_MIN_SPAN = 0.12;
/** Percentile clip of the height lattice before the span is widened. */
export const HEIGHT_PERCENTILE_LO = 0.02;
export const HEIGHT_PERCENTILE_HI = 0.98;
/** Extra fraction of the span added on each side of the remap window. */
export const HEIGHT_RANGE_PAD = 0.05;
/** Date stamped into `source.build` (not a git sha). */
export const AREA_EXPORT_BUILD = '2026-10-27';
/** Alex: 1 inner tile = 1 metre. */
export const METERS_PER_TILE = 1;
/**
 * Normalized sea reference used when an area has no Water world tile.
 * world-gen treats height < 0.33 as water before style overrides; 0.36 matches
 * the approved contract's seaLevel field.
 */
export const SEA_LEVEL = 0.36;
/**
 * Local relief span for an area before the per-biome multiplier.
 * The continental elevation readout (ELEVATION_SPAN_M, ×3200) is not used.
 */
export const RELIEF_METERS = 15;
/** How many fixed-order chunk passes to run so edges see their neighbours. */
export const AREA_CHUNK_PASSES = 2;

/** Hills and peaks rise above the 15 m base. 1 keeps a plains town near 15 m. */
export const RELIEF_BIOME_MULT: Record<Biome, number> = {
  [Biome.Water]: 1,
  [Biome.Sand]: 1,
  [Biome.Plains]: 1,
  [Biome.Meadow]: 1,
  [Biome.Forest]: 1.15,
  [Biome.DarkForest]: 1.15,
  [Biome.Hills]: 2,
  [Biome.Heath]: 1.35,
  [Biome.Marsh]: 1,
  [Biome.Mountain]: 3,
  [Biome.Snow]: 2.25,
  [Biome.Taiga]: 1.35,
  [Biome.Desert]: 1.15,
  [Biome.Jungle]: 1.15,
  [Biome.Ashlands]: 1.5,
};

export const BIOME_NAMES = [
  'Water',
  'Sand',
  'Plains',
  'Meadow',
  'Forest',
  'DarkForest',
  'Hills',
  'Heath',
  'Marsh',
  'Mountain',
  'Snow',
  'Taiga',
  'Desert',
  'Jungle',
  'Ashlands',
] as const;

export const GROUND_CLASSES = ['grass', 'dirt', 'road', 'lot', 'plaza', 'water', 'sand', 'rock', 'yard'] as const;
export type GroundClass = (typeof GROUND_CLASSES)[number];

export const GROUND: Record<GroundClass, number> = {
  grass: 0,
  dirt: 1,
  road: 2,
  lot: 3,
  plaza: 4,
  water: 5,
  sand: 6,
  rock: 7,
  yard: 8,
};

export type Cardinal = 'N' | 'E' | 'S' | 'W';
export type AreaSeason = 'summer' | 'autumn' | 'winter' | 'lush';

export interface EncodedU8 {
  enc: 'b64u8';
  data: string;
  legend?: string[];
}

export interface AreaExport {
  type: 'trailbound.area';
  version: string;
  source: {
    app: 'world-map';
    build: string;
    seed: number;
    worldScale: number;
    mapStyle: string;
    zoneScale: number;
    settings: {
      poiCount: number;
      wanderers: number;
      caravans: number;
      armies: number;
      customLandSketch: boolean;
    };
  };
  area: {
    id: string;
    name: string;
    kind: MapNode['kind'];
    origin: MapNode['origin'];
    biome: string;
    /** Playable place. The visual ring is grid data, not another node. */
    nodeIds: string[];
    /** Inclusive world-tile bounds of the playable place (MapNode x1/y1 are exclusive). */
    worldBounds: { x0: number; y0: number; x1: number; y1: number };
    worldTiles: [number, number][];
    /**
     * North-west inner tile of the expanded grid (place AABB plus the border ring).
     * Equals `grid.originInner`. Absolute building and entry coordinates are unchanged.
     */
    innerOrigin: { x: number; y: number };
    placeSeed: number;
    /**
     * Visual ring width in world tiles. Readers of older payloads should treat a
     * missing value as 0. v0.3 writes 4 (32 m).
     */
    borderWorldTiles: number;
  };
  units: {
    zoneScale: number;
    metersPerTile: number;
    upAxis: 'y';
    gridAxes: 'x-right,y-down';
    seaLevel: number;
  };
  grid: {
    w: number;
    h: number;
    /** Absolute inner tile of cell (0, 0). Equals `area.innerOrigin`. */
    originInner: { x: number; y: number };
    /** 1 = playable place tile, 0 = otherwise. */
    mask: EncodedU8;
    /**
     * Same encoding as `mask`. 1 = border-ring cell with world terrain, 0 = not ring
     * (playable or void). Missing on 0.2 payloads (no ring).
     */
    borderMask: EncodedU8;
  };
  layers: {
    biome: EncodedU8;
    ground: EncodedU8;
    height: {
      /** v0.2 was `world-tile-corners`. v0.3 writes `world-subdiv`. */
      sampling: 'world-tile-corners' | 'world-subdiv';
      /** Present for `world-subdiv`. Spacing of `raw` in metres (inner tiles). */
      subdivMeters: number;
      w: number;
      h: number;
      /**
       * Sample [0], absolute inner-tile metres. v0.2 stored a world-tile corner.
       * v0.3 stores the same point as `originInner` (one subdiv sample outside the grid).
       */
      originCorner: { x: number; y: number };
      /** Lattice origin in absolute inner-tile metres. Equals `originCorner` in v0.3. */
      originInner: { x: number; y: number };
      /** Normalized samples, row-major `i + j * w`. */
      raw: number[];
      /** v0.3 writes `normalized`. Metres come from minRaw/maxRaw and reliefMeters. */
      heightUnit: 'normalized';
      /** Remap window. Not necessarily the min/max of `raw`. */
      minRaw: number;
      maxRaw: number;
      reliefBaseMeters: number;
      reliefBiomeMultiplier: number;
      reliefBiome: string;
      reliefMeters: number;
      /** Optional micro-relief amplitude in metres. Not included in `raw`. */
      detailMeters: number;
      note: string;
    };
    water: {
      /** Local metres above height.minRaw, using the same remap as the terrain. */
      level: number;
      /** Normalized height the surface was taken from. */
      raw: number;
      fromBiome: true;
      present: boolean;
      note: string;
    };
  };
  roads: {
    worldTiles: [number, number][];
    polylines: AreaRoadPolyline[];
    floors: { street: number; plaza: number };
  };
  buildings: AreaBuilding[];
  props: AreaProp[];
  pois: AreaPoi[];
  entries: AreaEntry[];
  neighbors: AreaNeighbor[];
  /**
   * People near the place, in zone metres. Omitted from `meta.hash`.
   * A download includes this so standalone play has residents and travelers.
   * Missing means the controller shows no NPCs.
   */
  npcs?: AreaNpcSnapshot;
  /** Set only for a live session. Omitted from `meta.hash`. */
  session?: { sid: string; live: 1 };
  meta: {
    exportedAt: string;
    timeOfDayHours: number;
    season: AreaSeason;
    hash: string;
    notes: string[];
  };
}

export interface AreaRoadPolyline {
  id: string;
  kind: 'street' | 'road';
  width: number;
  points: [number, number][];
}

export interface AreaTiles {
  w: number;
  h: number;
  enc: 'b64u8';
  data: string;
  /** Index order for the mask bytes. Same as `PART_LEGEND`. */
  legend: string[];
}

export interface AreaBuilding {
  id: string;
  /** Legacy roster key (`cottage-1`, `shop`, …). */
  type: string;
  templateId: string;
  /**
   * South-centre of the structure AABB, absolute inner tiles.
   * v0.1 used this same anchor for a solid lot whose door was always south.
   */
  x: number;
  y: number;
  /** Structure AABB size in metres. v0.1 readers extrude this box. */
  footW: number;
  footD: number;
  /** North-west corner of the plot (minimum x, minimum y). */
  plotX: number;
  plotY: number;
  plotW: number;
  plotD: number;
  /** North-west corner of the structure AABB. */
  structureX: number;
  structureY: number;
  structureW: number;
  structureD: number;
  shape: BuildingShape | 'mask';
  rotation: BuildingRotation;
  /** Primary door after rotation. */
  door: Cardinal;
  /** Absolute inner tile of the primary door cell. */
  doorCell: { x: number; y: number };
  label: string;
  storeys: number;
  wallHeightM: number;
  roof: { style: RoofStyle; ridge: 'E-W' | 'N-S' };
  /** World-aligned plot mask. Rotation is already applied. */
  tiles: AreaTiles;
}

export interface AreaProp {
  type: string;
  class: 'tree' | 'rock' | 'plant' | 'prop';
  x: number;
  y: number;
}

export interface AreaPoi {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
}

export interface AreaEntry {
  id: string;
  kind: 'spawn' | 'edge';
  x: number;
  y: number;
  facing?: Cardinal;
  side?: Cardinal;
  toWorldTile?: [number, number];
}

export interface AreaNeighbor {
  nodeId: string;
  name: string;
  side: Cardinal;
}

export interface AreaNpcSnapshot {
  frame: 'zone-m';
  asOfHours: number;
  list: AreaNpc[];
}

export interface AreaNpc {
  id: string;
  name: string;
  kind: 'wanderer' | 'caravan' | 'army';
  look: { sheet: string; char: number };
  phase: 'near' | 'in' | 'inside';
  pos: { x: number; z: number };
  yaw: number;
  speed: number;
  intent: object;
  iv: number;
  members?: { n: number; show: number; looks: { sheet: string; char: number }[] };
}

export interface AreaExportOptions {
  /** Stored on meta. Not part of the content hash. */
  exportedAt?: string;
  /** World-clock hours. Not part of the content hash. */
  timeOfDayHours?: number;
  /** Defaults to `world.nodes`. Used only for neighbour metadata. */
  nodes?: MapNode[];
}

const NOTES = [
  'Street chunks are regenerated in (y, x) order for two passes. Edges do not depend on which neighbour the session generated first.',
  'Spawn is the road or dirt cell nearest the place centroid, otherwise the nearest walkable cell. The live walker is not baked in, so the same seed and place hash the same.',
  `reliefMeters is ${RELIEF_METERS} times the highest per-biome multiplier among the place biome and its world tiles. Hills use ${RELIEF_BIOME_MULT[Biome.Hills]} and mountains use ${RELIEF_BIOME_MULT[Biome.Mountain]}, so they rise above the ${RELIEF_METERS} m base. This is not the continental elevationMeters scale.`,
  'Water level is derived. See layers.water.note. world-map does not store a water line or depth.',
  'Road polylines are not traced in 0.1.0. Ground classes road and dirt are the road mask. roads.worldTiles are the coarse world-grid flags.',
  'The border ring is visual only. Walkable cells are grid.mask (1 = place tile). grid.borderMask uses the same encoding (1 = ring cell with world terrain, 0 = void or playable) and is not walkable. The controller should use Catmull-Rom on layers.height.',
  'The ring copies the world-tile biome and a simplified ground (grass, sand, rock, dirt, water, and road along world paths). It has no buildings and no props. Neighbour names stay metadata. Void cells are 0 in both masks; ignore their biome and ground bytes.',
  'Desert maps to ground class sand. Mountain maps to rock. Other dry land is grass unless a path, lot, plaza, or yard overrides it. Snow stays grass.',
  'v0.2 buildings add a human-scale structure inside a larger plot. footW/footD are the structure AABB. tiles is the world-aligned mask (yard, floor, wall, door, window, tower). rotation is 0, 90, 180, or 270. door and doorCell are the opening after that rotation.',
  'Season is the tileset row for the place biome (summer, autumn, winter, lush), not a simulated calendar.',
  'meta.exportedAt, meta.timeOfDayHours, npcs, and session are excluded from meta.hash.',
];

const HEIGHT_NOTE =
  'sampling is world-subdiv. raw is normalized (heightUnit normalized): the world-gen FBM plus land-mask evaluated at fractional world-tile coordinates, not a bilinear of stored WorldData.heights. ' +
  `Samples are every ${HEIGHT_SUBDIV_METERS} m. Sample [0] is originInner in absolute inner-tile metres, and originCorner equals originInner. ` +
  'The lattice covers the expanded grid plus one subdiv sample of apron on each side. ' +
  'Controller: Catmull-Rom across the lattice, then y = clamp((raw - minRaw) / (maxRaw - minRaw), 0, 1) * reliefMeters. ' +
  `minRaw/maxRaw are the percentile clip from ${HEIGHT_PERCENTILE_LO} to ${HEIGHT_PERCENTILE_HI}, widened so the span is at least ${HEIGHT_SOFT_MIN_SPAN}, then padded by ${HEIGHT_RANGE_PAD * 100}% of that span on each side, so a small continental delta does not become a full reliefMeters cliff. ` +
  `detailMeters (${HEIGHT_DETAIL_METERS}) is optional micro-relief amplitude and is not baked into raw. Water stays flat at layers.water.level.`;

/**
 * Fold one inner tile into a surface class.
 * Cobble wins over paths. A world-road path is `road`; any other path is `dirt`.
 */
export function groundClass(biome: Biome, path: boolean, cobble: number, worldRoad: boolean): number {
  if (cobble === 2) return GROUND.plaza;
  if (cobble === 1) return GROUND.lot;
  if (cobble === 3) return GROUND.yard;
  if (path && worldRoad) return GROUND.road;
  if (path) return GROUND.dirt;
  if (biome === Biome.Water) return GROUND.water;
  if (biome === Biome.Sand || biome === Biome.Desert) return GROUND.sand;
  if (biome === Biome.Mountain) return GROUND.rock;
  return GROUND.grass;
}

export function propClass(sprite: string): AreaProp['class'] {
  if (/^(tree-|forest-|summer-|winter-|autumn-)/.test(sprite)) return 'tree';
  if (sprite.startsWith('rock')) return 'rock';
  if (sprite.startsWith('flower') || sprite.startsWith('plant') || sprite === 'reed') return 'plant';
  return 'prop';
}

export function buildAreaExport(world: WorldData, place: MapNode, opts: AreaExportOptions = {}): AreaExport {
  const tiles = uniqueTiles(place.tiles ?? []);
  if (!tiles.length) throw new Error(`Place ${place.id} has no tiles to export`);
  if (!world.heights || world.heights.length !== world.width * world.height) {
    throw new Error('WorldData.heights is required for area export');
  }

  const bounds = boundsFromTiles(tiles);
  const x0 = bounds.x0;
  const y0 = bounds.y0;
  const x1 = bounds.x1;
  const y1 = bounds.y1;
  const border = BORDER_WORLD_TILES;
  const gx0 = x0 - border;
  const gy0 = y0 - border;
  const gx1 = x1 + border;
  const gy1 = y1 + border;
  const gw = (gx1 - gx0) * ZONE_SCALE;
  const gh = (gy1 - gy0) * ZONE_SCALE;
  const originX = gx0 * ZONE_SCALE;
  const originY = gy0 * ZONE_SCALE;
  const originInner = { x: originX, y: originY };
  const inPlace = new Set(tiles.map((t) => tileKey(t.x, t.y)));
  const chunks = bakeAreaChunks(world, tiles);

  const mask = new Uint8Array(gw * gh);
  const borderMask = new Uint8Array(gw * gh);
  const biomeGrid = new Uint8Array(gw * gh);
  const ground = new Uint8Array(gw * gh);
  const buildings: AreaBuilding[] = [];
  const props: AreaProp[] = [];
  const seenBuildings = new Set<string>();
  let streetFloor = 0;
  let plazaFloor = 4;
  let floorsTaken = false;

  for (const t of tiles) {
    const chunk = chunks.get(chunkKey(t.x, t.y));
    if (!chunk || chunk.size !== ZONE_SCALE) continue;
    if (!floorsTaken && chunk.nodeId === place.id) {
      streetFloor = chunk.streetFloor;
      plazaFloor = chunk.plazaFloor;
      floorsTaken = true;
    }
    const ox = (t.x - gx0) * ZONE_SCALE;
    const oy = (t.y - gy0) * ZONE_SCALE;
    const worldRoad = inWorld(world, t.x, t.y) && world.paths[t.x + t.y * world.width] === 1;
    for (let ly = 0; ly < ZONE_SCALE; ly++) {
      for (let lx = 0; lx < ZONE_SCALE; lx++) {
        const li = lx + ly * ZONE_SCALE;
        const gi = ox + lx + (oy + ly) * gw;
        mask[gi] = 1;
        borderMask[gi] = 0;
        const biome = (chunk.tiles[li] ?? Biome.Plains) as Biome;
        biomeGrid[gi] = biome;
        ground[gi] = groundClass(biome, chunk.paths[li] === 1, chunk.cobble[li] ?? 0, worldRoad);
      }
    }
    for (const spr of chunk.sprites) pushSprite(buildings, props, seenBuildings, t, spr);
  }

  for (let wy = gy0; wy < gy1; wy++) {
    for (let wx = gx0; wx < gx1; wx++) {
      if (inPlace.has(tileKey(wx, wy))) continue;
      const ox = (wx - gx0) * ZONE_SCALE;
      const oy = (wy - gy0) * ZONE_SCALE;
      const inside = inWorld(world, wx, wy);
      const biome = inside ? ((world.biomes[wx + wy * world.width] ?? Biome.Plains) as Biome) : Biome.Water;
      for (let ly = 0; ly < ZONE_SCALE; ly++) {
        for (let lx = 0; lx < ZONE_SCALE; lx++) {
          const gi = ox + lx + (oy + ly) * gw;
          if (!inside) {
            mask[gi] = 0;
            borderMask[gi] = 0;
            biomeGrid[gi] = 0;
            ground[gi] = 0;
            continue;
          }
          mask[gi] = 0;
          borderMask[gi] = 1;
          biomeGrid[gi] = biome;
          const road = ringRoadCell(world, wx, wy, lx, ly);
          ground[gi] = groundClass(biome, road, 0, road);
        }
      }
    }
  }

  buildings.sort((a, b) => a.y - b.y || a.x - b.x || a.type.localeCompare(b.type));
  buildings.forEach((b, i) => {
    b.id = `b${i}`;
  });
  props.sort((a, b) => a.y - b.y || a.x - b.x || a.type.localeCompare(b.type));

  const relief = reliefFor(world, place, tiles);
  const height = sampleSubdiv(world, originInner, gw, gh);
  const range = softHeightRange(height.raw);
  const water = deriveWater(world, gx0, gy0, gx1, gy1, ground, mask, range.minRaw, range.maxRaw, relief.meters);
  const entries = deriveEntries(originX, originY, gw, gh, mask, ground);
  const season = seasonFor(place.biome);

  const area: AreaExport = {
    type: 'trailbound.area',
    version: AREA_EXPORT_VERSION,
    source: {
      app: 'world-map',
      build: AREA_EXPORT_BUILD,
      seed: world.seed,
      worldScale: world.settings.worldScale,
      mapStyle: world.settings.mapStyle,
      zoneScale: ZONE_SCALE,
      settings: {
        poiCount: world.settings.poiCount,
        wanderers: world.settings.wanderers,
        caravans: world.settings.caravans,
        armies: world.settings.armies,
        customLandSketch: !!world.settings.landSketch,
      },
    },
    area: {
      id: place.id,
      name: place.name,
      kind: place.kind,
      origin: place.origin,
      biome: biomeName(place.biome),
      nodeIds: [place.id],
      worldBounds: { x0, y0, x1: x1 - 1, y1: y1 - 1 },
      worldTiles: tiles.map((t) => [t.x, t.y]),
      innerOrigin: originInner,
      placeSeed: place.seed,
      borderWorldTiles: border,
    },
    units: {
      zoneScale: ZONE_SCALE,
      metersPerTile: METERS_PER_TILE,
      upAxis: 'y',
      gridAxes: 'x-right,y-down',
      seaLevel: SEA_LEVEL,
    },
    grid: {
      w: gw,
      h: gh,
      originInner,
      mask: encodeLayer(mask),
      borderMask: encodeLayer(borderMask),
    },
    layers: {
      biome: encodeLayer(biomeGrid, [...BIOME_NAMES]),
      ground: encodeLayer(ground, [...GROUND_CLASSES]),
      height: {
        sampling: 'world-subdiv',
        subdivMeters: HEIGHT_SUBDIV_METERS,
        w: height.w,
        h: height.h,
        originCorner: height.originInner,
        originInner: height.originInner,
        raw: height.raw,
        heightUnit: 'normalized',
        minRaw: range.minRaw,
        maxRaw: range.maxRaw,
        reliefBaseMeters: RELIEF_METERS,
        reliefBiomeMultiplier: relief.mult,
        reliefBiome: biomeName(relief.biome),
        reliefMeters: relief.meters,
        detailMeters: HEIGHT_DETAIL_METERS,
        note: HEIGHT_NOTE,
      },
      water,
    },
    roads: {
      worldTiles: tiles.filter((t) => inWorld(world, t.x, t.y) && world.paths[t.x + t.y * world.width] === 1).map((t) => [t.x, t.y]),
      polylines: [],
      floors: { street: streetFloor, plaza: plazaFloor },
    },
    buildings,
    props,
    pois: poisInside(world, inPlace),
    entries,
    neighbors: neighborMeta(opts.nodes ?? world.nodes, place, inPlace),
    meta: {
      exportedAt: opts.exportedAt ?? new Date().toISOString(),
      timeOfDayHours: round3(opts.timeOfDayHours ?? 8),
      season,
      hash: '',
      notes: NOTES,
    },
  };
  area.meta.hash = contentHash(area);
  return area;
}

/** Bake every tile of a place in a fixed order, twice, into a fresh chunk map. */
export function bakeAreaChunks(world: WorldData, tiles: Vec2[]): Map<string, ChunkData> {
  const sorted = uniqueTiles(tiles);
  const chunks = new Map<string, ChunkData>();
  for (let pass = 0; pass < AREA_CHUNK_PASSES; pass++) {
    for (const t of sorted) {
      const chunk = generateChunk(world, t.x, t.y, neighborMap(chunks, t.x, t.y));
      chunks.set(chunkKey(t.x, t.y), chunk);
    }
  }
  return chunks;
}

/**
 * sha1 of the canonical payload. `exportedAt`, `timeOfDayHours`, `hash`, `npcs`,
 * and `session` are omitted, so a live snapshot does not change the place hash.
 */
export function contentHash(area: AreaExport): string {
  const copy = JSON.parse(JSON.stringify(area)) as AreaExport;
  delete copy.npcs;
  delete copy.session;
  copy.meta = {
    ...copy.meta,
    hash: undefined as unknown as string,
    exportedAt: undefined as unknown as string,
    timeOfDayHours: undefined as unknown as number,
  };
  return `sha1:${sha1Hex(new TextEncoder().encode(stableStringify(copy)))}`;
}

export function encodeB64U8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >>> 18) & 63]!;
    out += B64[(n >>> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >>> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? B64[n & 63]! : '=';
  }
  return out;
}

export function decodeB64U8(data: string): Uint8Array {
  const clean = data.replace(/=+$/, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i] ?? 'A');
    const b = B64.indexOf(clean[i + 1] ?? 'A');
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]!) : 0;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]!) : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out.push((n >>> 16) & 255);
    if (i + 2 < clean.length) out.push((n >>> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

function encodeLayer(bytes: Uint8Array, legend?: string[]): EncodedU8 {
  return legend ? { enc: 'b64u8', data: encodeB64U8(bytes), legend } : { enc: 'b64u8', data: encodeB64U8(bytes) };
}

function uniqueTiles(tiles: Vec2[]): Vec2[] {
  const seen = new Set<string>();
  const out: Vec2[] = [];
  for (const t of tiles) {
    const key = tileKey(t.x, t.y);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: t.x, y: t.y });
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

function buildingRecord(spr: PlacedSprite, anchorX: number, anchorY: number): AreaBuilding {
  const tmpl = (spr.templateId && templateById(spr.templateId)) || templatesForType(spr.sprite)[0];
  if (!tmpl) throw new Error(`no template for ${spr.sprite}`);
  const rotation: BuildingRotation = spr.rotation ?? 0;
  const mask = placedMask(tmpl.id, rotation);
  if (!mask) throw new Error(`no mask for ${tmpl.id}`);
  const plotW = mask.w;
  const plotD = mask.d;
  const plotX = Math.round(anchorX - plotW / 2);
  const plotY = Math.round(anchorY - plotD);
  const bounds = structureBounds(mask.parts, mask.w, mask.d);
  const structureX = plotX + bounds.x;
  const structureY = plotY + bounds.y;
  const bytes = new Uint8Array(mask.parts.length);
  const doors: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < mask.parts.length; i++) {
    bytes[i] = PART_CODE[mask.parts[i]!]!;
    if (mask.parts[i] === 'door') doors.push({ x: i % mask.w, y: Math.floor(i / mask.w) });
  }
  let doorX = structureX;
  let doorY = structureY + Math.max(0, bounds.d - 1);
  if (doors.length) {
    const meanX = doors.reduce((sum, door) => sum + door.x, 0) / doors.length;
    const meanY = doors.reduce((sum, door) => sum + door.y, 0) / doors.length;
    doors.sort((a, b) => Math.hypot(a.x - meanX, a.y - meanY) - Math.hypot(b.x - meanX, b.y - meanY));
    doorX = plotX + doors[0]!.x;
    doorY = plotY + doors[0]!.y;
  }
  return {
    id: '',
    type: spr.sprite,
    templateId: tmpl.id,
    x: round3(structureX + bounds.w / 2),
    y: round3(structureY + bounds.d),
    footW: bounds.w,
    footD: bounds.d,
    plotX,
    plotY,
    plotW,
    plotD,
    structureX,
    structureY,
    structureW: bounds.w,
    structureD: bounds.d,
    shape: structureIsRect(mask.parts, mask.w) ? 'rect' : 'mask',
    rotation,
    door: rotateCardinal(tmpl.doorFacing, rotation),
    doorCell: { x: doorX, y: doorY },
    label: buildingLabel(spr.sprite),
    storeys: tmpl.storeys,
    wallHeightM: tmpl.wallHeightM,
    roof: { style: tmpl.roof.style, ridge: rotateRidge(tmpl.roof.ridge, rotation) },
    tiles: {
      w: mask.w,
      h: mask.d,
      enc: 'b64u8',
      data: encodeB64U8(bytes),
      legend: [...PART_LEGEND],
    },
  };
}

function pushSprite(
  buildings: AreaBuilding[],
  props: AreaProp[],
  seen: Set<string>,
  tile: Vec2,
  spr: PlacedSprite,
): void {
  const x = round3(tile.x * ZONE_SCALE + spr.x);
  const y = round3(tile.y * ZONE_SCALE + spr.y);
  if (isBuildingSprite(spr.sprite)) {
    const key = `${spr.templateId ?? spr.sprite}:${x}:${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    buildings.push(buildingRecord(spr, x, y));
    return;
  }
  props.push({ type: spr.sprite, class: propClass(spr.sprite), x, y });
}

function reliefFor(world: WorldData, place: MapNode, tiles: Vec2[]): { biome: Biome; mult: number; meters: number } {
  let biome = place.biome;
  let mult = RELIEF_BIOME_MULT[biome] ?? 1;
  for (const t of tiles) {
    if (!inWorld(world, t.x, t.y)) continue;
    const b = world.biomes[t.x + t.y * world.width] as Biome;
    const m = RELIEF_BIOME_MULT[b] ?? 1;
    if (m > mult) {
      mult = m;
      biome = b;
    }
  }
  return { biome, mult, meters: round3(RELIEF_METERS * mult) };
}

/**
 * Height lattice for the expanded grid. Sample [0] sits one `subdivMeters`
 * step outside the grid on both axes (the apron). Spacing is inner-tile metres.
 */
function sampleSubdiv(
  world: WorldData,
  gridOrigin: { x: number; y: number },
  gw: number,
  gh: number,
): { w: number; h: number; originInner: { x: number; y: number }; raw: number[] } {
  const step = HEIGHT_SUBDIV_METERS;
  const originInner = { x: gridOrigin.x - step, y: gridOrigin.y - step };
  const w = gw / step + 3;
  const h = gh / step + 3;
  if (!Number.isInteger(w) || !Number.isInteger(h)) {
    throw new Error('height lattice is not aligned to subdivMeters');
  }
  const sample = worldHeightSampler(world);
  const raw: number[] = [];
  for (let j = 0; j < h; j++) {
    const wy = (originInner.y + j * step) / ZONE_SCALE;
    for (let i = 0; i < w; i++) {
      const wx = (originInner.x + i * step) / ZONE_SCALE;
      raw.push(round5(sample(wx, wy)));
    }
  }
  return { w, h, originInner, raw };
}

/** Percentile clip, then widen so a tiny local delta is not the full relief. */
export function softHeightRange(raw: readonly number[]): { minRaw: number; maxRaw: number } {
  if (!raw.length) return { minRaw: 0, maxRaw: round5(HEIGHT_SOFT_MIN_SPAN) };
  const sorted = [...raw].sort((a, b) => a - b);
  const lo = percentile(sorted, HEIGHT_PERCENTILE_LO);
  const hi = percentile(sorted, HEIGHT_PERCENTILE_HI);
  const mid = (lo + hi) / 2;
  const span = Math.max(hi - lo, HEIGHT_SOFT_MIN_SPAN);
  const pad = span * HEIGHT_RANGE_PAD;
  let minRaw = round5(mid - span / 2 - pad);
  let maxRaw = round5(mid + span / 2 + pad);
  if (!(maxRaw > minRaw)) maxRaw = round5(minRaw + HEIGHT_SOFT_MIN_SPAN);
  return { minRaw, maxRaw };
}

function percentile(sorted: readonly number[], p: number): number {
  const last = sorted.length - 1;
  const idx = last * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  if (lo === hi) return a;
  const t = idx - lo;
  return a * (1 - t) + b * t;
}

/** Half-width of a ring road, close to the wilderness path radius in chunk-gen. */
const RING_ROAD_RADIUS = 0.9;

/**
 * Cheap wilderness path: straight segments between the same hub and gates
 * chunk-gen uses, so a ring road meets a place road at the shared edge.
 * No lots, yards, or buildings.
 */
function ringRoadCell(world: WorldData, wx: number, wy: number, lx: number, ly: number): boolean {
  if (!worldPathAt(world, wx, wy)) return false;
  const size = ZONE_SCALE;
  const seed = world.seed;
  const hub = roadHub(wx, wy, size, seed);
  const px = lx + 0.5;
  const py = ly + 0.5;
  const gates: Array<[number, number]> = [];
  if (worldPathAt(world, wx, wy - 1)) gates.push([nsGateX(wx, wy, size, seed), 0]);
  if (worldPathAt(world, wx, wy + 1)) gates.push([nsGateX(wx, wy + 1, size, seed), size]);
  if (worldPathAt(world, wx - 1, wy)) gates.push([0, ewGateY(wx, wy, size, seed)]);
  if (worldPathAt(world, wx + 1, wy)) gates.push([size, ewGateY(wx + 1, wy, size, seed)]);
  if (!gates.length) return Math.hypot(px - hub.x, py - hub.y) <= 1.15;
  for (const [gx, gy] of gates) {
    if (distToSeg(px, py, hub.x, hub.y, gx, gy) <= RING_ROAD_RADIUS) return true;
  }
  return false;
}

function worldPathAt(world: WorldData, x: number, y: number): boolean {
  return inWorld(world, x, y) && world.paths[x + y * world.width] === 1;
}

function roadHub(wx: number, wy: number, size: number, seed: number): { x: number; y: number } {
  return {
    x: size * 0.5 + (hash2(wx, wy, seed + 7) - 0.5) * 2.4,
    y: size * 0.5 + (hash2(wx, wy, seed + 11) - 0.5) * 2.4,
  };
}

function nsGateX(wx: number, southWy: number, size: number, seed: number): number {
  return size * 0.5 + (hash2(wx, southWy, seed + 19) - 0.5) * size * 0.52;
}

function ewGateY(eastWx: number, wy: number, size: number, seed: number): number {
  return size * 0.5 + (hash2(eastWx, wy, seed + 23) - 0.5) * size * 0.52;
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-8) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** `x1` and `y1` are exclusive world-tile bounds of the exported grid. */
function deriveWater(
  world: WorldData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ground: Uint8Array,
  mask: Uint8Array,
  rawMin: number,
  rawMax: number,
  reliefMeters: number,
): AreaExport['layers']['water'] {
  let present = false;
  for (let i = 0; i < ground.length; i++) {
    if (mask[i] && ground[i] === GROUND.water) {
      present = true;
      break;
    }
  }
  let waterRaw = Number.POSITIVE_INFINITY;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!inWorld(world, x, y)) continue;
      if ((world.biomes[x + y * world.width] as Biome) !== Biome.Water) continue;
      waterRaw = Math.min(waterRaw, world.heights[x + y * world.width] ?? SEA_LEVEL);
    }
  }
  const usedFallback = waterRaw === Number.POSITIVE_INFINITY;
  const raw = round5(usedFallback ? SEA_LEVEL : waterRaw);
  const level = toRelief(raw, rawMin, rawMax, reliefMeters);
  const note = present
    ? usedFallback
      ? 'Water shows up on playable inner tiles but no Water world tile sits in the exported grid (place plus border ring). level is SEA_LEVEL (0.36) remapped with height.minRaw, height.maxRaw, and reliefMeters. world-map stores no water line.'
      : 'Derived from the lowest WorldData.heights sample on a Water world tile in the exported grid (place plus border ring), then remapped with (raw - minRaw) / (maxRaw - minRaw) * reliefMeters. Those cells stay flat. world-map stores no water line or depth.'
    : 'No water cells in the playable mask. level is still SEA_LEVEL (0.36) remapped with height.minRaw and height.maxRaw so a controller has a water line. world-map stores no water line.';
  return { level, raw, fromBiome: true, present, note };
}

function toRelief(raw: number, min: number, max: number, meters: number): number {
  const span = max - min;
  if (!(span > 1e-8)) return 0;
  const t = Math.min(1, Math.max(0, (raw - min) / span));
  return round4(t * meters);
}

function deriveEntries(originX: number, originY: number, gw: number, gh: number, mask: Uint8Array, ground: Uint8Array): AreaEntry[] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let iy = 0; iy < gh; iy++) {
    for (let ix = 0; ix < gw; ix++) {
      if (!mask[ix + iy * gw]) continue;
      sx += ix + 0.5;
      sy += iy + 0.5;
      n++;
    }
  }
  const cx = n ? sx / n : gw / 2;
  const cy = n ? sy / n : gh / 2;
  const spawnCell = pickSpawn(gw, gh, mask, ground, cx, cy);
  const spawnX = round3(originX + spawnCell.x + 0.5);
  const spawnY = round3(originY + spawnCell.y + 0.5);
  const entries: AreaEntry[] = [
    {
      id: 'player',
      kind: 'spawn',
      x: spawnX,
      y: spawnY,
      facing: facingToward(spawnCell.x + 0.5, spawnCell.y + 0.5, cx, cy),
    },
  ];
  const sides: Array<{ side: Cardinal; dx: number; dy: number }> = [
    { side: 'N', dx: 0, dy: -1 },
    { side: 'E', dx: 1, dy: 0 },
    { side: 'S', dx: 0, dy: 1 },
    { side: 'W', dx: -1, dy: 0 },
  ];
  for (const dir of sides) {
    let best: { ix: number; iy: number; d: number } | null = null;
    for (let iy = 0; iy < gh; iy++) {
      for (let ix = 0; ix < gw; ix++) {
        const gi = ix + iy * gw;
        if (!mask[gi]) continue;
        const g = ground[gi];
        if (g !== GROUND.road && g !== GROUND.dirt) continue;
        const nx = ix + dir.dx;
        const ny = iy + dir.dy;
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && mask[nx + ny * gw]) continue;
        const d = (ix + 0.5 - cx) ** 2 + (iy + 0.5 - cy) ** 2;
        if (!best || d < best.d) best = { ix, iy, d };
      }
    }
    if (!best) continue;
    const wx = Math.floor((originX + best.ix) / ZONE_SCALE);
    const wy = Math.floor((originY + best.iy) / ZONE_SCALE);
    entries.push({
      id: `edge-${dir.side.toLowerCase()}`,
      kind: 'edge',
      side: dir.side,
      x: round3(originX + best.ix + 0.5),
      y: round3(originY + best.iy + 0.5),
      facing: dir.side,
      toWorldTile: [wx + dir.dx, wy + dir.dy],
    });
  }
  return entries;
}

function pickSpawn(
  gw: number,
  gh: number,
  mask: Uint8Array,
  ground: Uint8Array,
  cx: number,
  cy: number,
): { x: number; y: number } {
  const rank = [GROUND.road, GROUND.dirt, GROUND.plaza, GROUND.lot, GROUND.grass, GROUND.sand, GROUND.rock, GROUND.water];
  for (const want of rank) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let iy = 0; iy < gh; iy++) {
      for (let ix = 0; ix < gw; ix++) {
        const gi = ix + iy * gw;
        if (!mask[gi] || ground[gi] !== want) continue;
        const d = (ix + 0.5 - cx) ** 2 + (iy + 0.5 - cy) ** 2;
        if (!best || d < best.d) best = { x: ix, y: iy, d };
      }
    }
    if (best) return best;
  }
  return { x: Math.floor(cx), y: Math.floor(cy) };
}

function facingToward(x: number, y: number, tx: number, ty: number): Cardinal {
  const dx = tx - x;
  const dy = ty - y;
  if (dx * dx + dy * dy < 0.25) return 'N';
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'E' : 'W';
  return dy > 0 ? 'S' : 'N';
}

function poisInside(world: WorldData, inPlace: Set<string>): AreaPoi[] {
  const out: AreaPoi[] = [];
  for (const poi of world.pois) {
    if (!inPlace.has(tileKey(Math.floor(poi.x), Math.floor(poi.y)))) continue;
    out.push({
      id: poi.id,
      kind: poi.kind,
      name: poi.name,
      x: round3(poi.x * ZONE_SCALE),
      y: round3(poi.y * ZONE_SCALE),
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function neighborMeta(nodes: MapNode[], place: MapNode, mine: Set<string>): AreaNeighbor[] {
  const owner = new Map<string, MapNode>();
  for (const node of nodes) {
    if (node.id === place.id) continue;
    for (const t of node.tiles ?? []) {
      const key = tileKey(t.x, t.y);
      if (!owner.has(key)) owner.set(key, node);
    }
  }
  const counts = new Map<string, { node: MapNode; n: number; e: number; s: number; w: number }>();
  const dirs: Array<[number, number, 'n' | 'e' | 's' | 'w']> = [
    [0, -1, 'n'],
    [1, 0, 'e'],
    [0, 1, 's'],
    [-1, 0, 'w'],
  ];
  for (const key of mine) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    for (const [dx, dy, side] of dirs) {
      const other = owner.get(tileKey(x + dx, y + dy));
      if (!other) continue;
      let row = counts.get(other.id);
      if (!row) {
        row = { node: other, n: 0, e: 0, s: 0, w: 0 };
        counts.set(other.id, row);
      }
      row[side]++;
    }
  }
  const sides: Array<['N' | 'E' | 'S' | 'W', 'n' | 'e' | 's' | 'w']> = [
    ['N', 'n'],
    ['E', 'e'],
    ['S', 's'],
    ['W', 'w'],
  ];
  const out: AreaNeighbor[] = [];
  for (const row of counts.values()) {
    let side: Cardinal = 'N';
    let best = -1;
    for (const [label, key] of sides) {
      const n = row[key];
      if (n > best) {
        best = n;
        side = label;
      }
    }
    if (best <= 0) continue;
    out.push({ nodeId: row.node.id, name: row.node.name, side });
  }
  out.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  return out;
}

function seasonFor(biome: Biome): AreaSeason {
  switch (biomeSeason(biome)) {
    case SEASON.winter:
      return 'winter';
    case SEASON.autumn:
      return 'autumn';
    case SEASON.lush:
      return 'lush';
    default:
      return 'summer';
  }
}

function biomeName(biome: Biome): string {
  return BIOME_NAMES[biome] ?? `Biome${biome}`;
}

function inWorld(world: WorldData, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.width && y < world.height;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return value;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function sha1Hex(bytes: Uint8Array): string {
  const bitLen = bytes.length * 8;
  let len = bytes.length + 1;
  while (len % 64 !== 56) len++;
  len += 8;
  const buf = new Uint8Array(len);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(len - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(len - 4, bitLen >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let i = 0; i < buf.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 80; t++) w[t] = rotl((w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!) >>> 0, 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t++) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = ((b & c) | (~b & d)) >>> 0;
        k = 0x5a827999;
      } else if (t < 40) {
        f = (b ^ c ^ d) >>> 0;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = ((b & c) | (b & d) | (c & d)) >>> 0;
        k = 0x8f1bbcdc;
      } else {
        f = (b ^ c ^ d) >>> 0;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[t]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, '0')).join('');
}

function rotl(n: number, s: number): number {
  return ((n << s) | (n >>> (32 - s))) >>> 0;
}
