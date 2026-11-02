/**
 * Settlement tiers (proposal §4). One row drives radius, roads, required
 * buildings, and the home mix. City and capital are stubbed for P0: a city
 * node is labeled `city` and placed with the town row until P2.
 */
export type SettlementTierId = 'camp' | 'hamlet' | 'village' | 'town' | 'city' | 'capital';

export const TIER_ORDER: readonly SettlementTierId[] = ['camp', 'hamlet', 'village', 'town', 'city', 'capital'];

export function tierAtLeast(tier: SettlementTierId, min: SettlementTierId): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}

export interface TierRoad {
  rank: 1 | 2 | 3;
  kind: string;
  widthM: number;
  /** `layers.surface` byte. */
  surface: number;
}

export interface WeightedId {
  id: string;
  w: number;
  /** Skip this pick when the rolled building count is above this. */
  maxBuildings?: number;
  /** Only when the rolled count is at least this. */
  minBuildings?: number;
}

export interface SettlementTier {
  id: SettlementTierId;
  /** Inclusive building count. Props are not buildings. */
  buildings: [number, number];
  radiusM: number;
  plaza: { kind: 'green' | 'plaza' | 'cross'; w: number; d: number } | null;
  /** Rank 1 is the main entry road. */
  roads: TierRoad[];
  /** Full wagon yard from village up. Camp and hamlet use an open circle. */
  wagon: 'circle' | 'yard';
  wagonSize: { w: number; d: number };
  respawn: 'campfire' | 'shrine' | 'healer';
  /** Catalog ids placed before homes. */
  required: string[];
  requiredAt: Array<{ id: string; minBuildings: number }>;
  optional: WeightedId[];
  /** Residential tier weights. Keys are catalog ids. */
  homes: Record<string, number>;
  fences: string[];
  /** Street-prop counts. Lamps are every 12 m on town main roads (stage 17). */
  street: { lamps: boolean; benches: number; signposts: boolean };
  /** Market stalls rolled inside this range for the tier. */
  stalls: [number, number];
  /**
   * When true, townhouses may form an uncapped terrace. Otherwise a run of
   * attached houses stops at `TERRACE_RUN_MAX`.
   */
  rowhouses?: boolean;
  /** P0 places nothing from a stub; the planner substitutes `stubOf`. */
  implemented: boolean;
  stubOf?: SettlementTierId;
  stakes: 1 | 2 | 3 | 4;
}

export const SURFACE = {
  none: 0,
  path: 1,
  lane_gravel: 2,
  street_cobble: 3,
  avenue_flagstone: 4,
  avenue_sandstone: 5,
  processional: 6,
  plaza_flagstone: 7,
  farmland: 8,
  park_grass: 9,
  boardwalk: 10,
  oasis_grass: 11,
  ice: 12,
  hotspring_rim: 13,
} as const;

export const SURFACE_LEGEND = [
  'none',
  'path',
  'lane_gravel',
  'street_cobble',
  'avenue_flagstone',
  'avenue_sandstone',
  'processional',
  'plaza_flagstone',
  'farmland',
  'park_grass',
  'boardwalk',
  'oasis_grass',
  'ice',
  'hotspring_rim',
] as const;

const PATH: TierRoad = { rank: 3, kind: 'path', widthM: 1.5, surface: SURFACE.path };
const LANE: TierRoad = { rank: 1, kind: 'lane_gravel', widthM: 3, surface: SURFACE.lane_gravel };
const LANE2: TierRoad = { rank: 2, kind: 'lane_gravel', widthM: 3, surface: SURFACE.lane_gravel };
const STREET: TierRoad = { rank: 1, kind: 'street_cobble', widthM: 4.5, surface: SURFACE.street_cobble };

export const SETTLEMENT_TIERS: readonly SettlementTier[] = [
  {
    id: 'camp',
    buildings: [0, 3],
    radiusM: 16,
    plaza: null,
    roads: [{ rank: 1, kind: 'path', widthM: 1.5, surface: SURFACE.path }],
    wagon: 'circle',
    wagonSize: { w: 9, d: 9 },
    respawn: 'campfire',
    required: [],
    requiredAt: [],
    optional: [],
    homes: { tent: 1 },
    fences: [],
    street: { lamps: false, benches: 0, signposts: true },
    stalls: [0, 0],
    implemented: true,
    stakes: 1,
  },
  {
    id: 'hamlet',
    buildings: [3, 8],
    radiusM: 32,
    plaza: { kind: 'cross', w: 9, d: 9 },
    roads: [{ rank: 1, kind: 'path', widthM: 1.5, surface: SURFACE.path }, PATH],
    wagon: 'circle',
    wagonSize: { w: 9, d: 9 },
    respawn: 'campfire',
    required: ['barn'],
    requiredAt: [],
    optional: [
      { id: 'general_store', w: 1 },
      { id: 'smithy', w: 1 },
      { id: 'carpenter', w: 1 },
    ],
    homes: { hovel: 0.45, cottage: 0.55 },
    fences: ['wattle', 'split_rail'],
    street: { lamps: false, benches: 0, signposts: true },
    stalls: [0, 0],
    implemented: true,
    stakes: 1,
  },
  {
    id: 'village',
    buildings: [8, 25],
    radiusM: 48,
    plaza: { kind: 'green', w: 12, d: 12 },
    roads: [LANE, { rank: 2, kind: 'path', widthM: 1.5, surface: SURFACE.path }],
    wagon: 'yard',
    wagonSize: { w: 12, d: 9 },
    respawn: 'shrine',
    required: ['tavern', 'smithy', 'general_store', 'stables', 'wagonwright'],
    requiredAt: [{ id: 'temple_small', minBuildings: 12 }],
    optional: [
      { id: 'temple_small', w: 2, maxBuildings: 11 },
      { id: 'bakery', w: 3 },
      { id: 'carpenter', w: 2 },
    ],
    homes: { hovel: 0.35, cottage: 0.55, townhouse: 0.1 },
    fences: ['picket', 'wattle', 'split_rail'],
    street: { lamps: false, benches: 2, signposts: true },
    stalls: [0, 0],
    implemented: true,
    stakes: 2,
  },
  {
    id: 'town',
    buildings: [25, 80],
    radiusM: 72,
    plaza: { kind: 'plaza', w: 18, d: 24 },
    roads: [STREET, LANE2, PATH],
    wagon: 'yard',
    wagonSize: { w: 15, d: 12 },
    respawn: 'healer',
    required: [
      'tavern',
      'smithy',
      'general_store',
      'stables',
      'wagonwright',
      'town_hall',
      'temple',
      'guildhall',
      'bank',
      'healer',
      'cartographer',
    ],
    requiredAt: [],
    optional: [
      { id: 'bakery', w: 2 },
      { id: 'carpenter', w: 2 },
      { id: 'apothecary', w: 1 },
    ],
    homes: { cottage: 0.45, townhouse: 0.45, manor: 0.1 },
    fences: ['picket', 'stone_wall_low', 'hedge'],
    street: { lamps: true, benches: 4, signposts: true },
    stalls: [4, 8],
    implemented: true,
    stakes: 2,
  },
  {
    id: 'city',
    buildings: [80, 250],
    radiusM: 112,
    plaza: { kind: 'plaza', w: 24, d: 30 },
    roads: [STREET],
    wagon: 'yard',
    wagonSize: { w: 18, d: 15 },
    respawn: 'healer',
    required: [],
    requiredAt: [],
    optional: [],
    homes: {},
    fences: [],
    street: { lamps: false, benches: 0, signposts: false },
    stalls: [0, 0],
    implemented: false,
    stubOf: 'town',
    stakes: 3,
  },
  {
    id: 'capital',
    buildings: [250, 400],
    radiusM: 160,
    plaza: { kind: 'plaza', w: 24, d: 24 },
    roads: [],
    wagon: 'yard',
    wagonSize: { w: 18, d: 15 },
    respawn: 'healer',
    required: [],
    requiredAt: [],
    optional: [],
    homes: {},
    fences: [],
    street: { lamps: false, benches: 0, signposts: false },
    stalls: [0, 0],
    implemented: false,
    stakes: 4,
  },
];

const BY_ID = new Map(SETTLEMENT_TIERS.map((row) => [row.id, row]));

export function tierById(id: SettlementTierId): SettlementTier {
  const row = BY_ID.get(id);
  if (!row) throw new Error(`unknown tier ${id}`);
  return row;
}

/** Row the planner actually places. Stubs delegate to `stubOf`. */
export function tierPlacement(id: SettlementTierId): { label: SettlementTierId; row: SettlementTier; stubbed: boolean } {
  const row = tierById(id);
  if (row.implemented || !row.stubOf) return { label: id, row, stubbed: !row.implemented };
  return { label: id, row: tierById(row.stubOf), stubbed: true };
}

export function roadForRank(row: SettlementTier, rank: number): TierRoad {
  return row.roads.find((road) => road.rank === rank) ?? row.roads[row.roads.length - 1] ?? PATH;
}

/** Node kinds that receive a settlement plan. Groves, shores, and passes do not. */
/** Minimum clear gap between a detached house and any other structure. One 1.5 m module. */
export const SIDE_YARD_M = 1.5;
/** Houses closer than this along one frontage still count as one row. */
export const ROW_LINK_M = 6;
/** Attached or gapped house run length when the tier does not set `rowhouses`. */
export const TERRACE_RUN_MAX = 3;

export function tierForKind(kind: string): SettlementTierId | null {
  switch (kind) {
    case 'camp':
      return 'camp';
    case 'hamlet':
      return 'hamlet';
    case 'village':
      return 'village';
    case 'town':
      return 'town';
    case 'city':
      return 'city';
    default:
      return null;
  }
}
