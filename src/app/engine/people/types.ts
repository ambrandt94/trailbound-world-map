/** Persistent people. Core stays hot; detail blobs stay lazy. Schema 1 records. */

export type PersonId = string;
export type PartyId = string;
export type PlaceId = string;
export type CampId = string;

export type Motive = 'opportunity' | 'money' | 'opinion' | 'forced';

export type Home =
  | { kind: 'town'; placeId: PlaceId; buildingId?: string }
  | { kind: 'poi'; poiId: string }
  | { kind: 'camp'; campId: CampId }
  | { kind: 'none' };

export type LocationState =
  | { kind: 'at-home' }
  | { kind: 'in-place'; placeId: PlaceId }
  | { kind: 'in-party'; partyId: PartyId }
  | { kind: 'encounter'; partyId: PartyId };

export interface Goal {
  kind: 'stay' | 'relocate' | 'travel';
  note?: string;
}

export interface HistoryRow {
  t: number;
  type: string;
  note: string;
  amount?: number;
}

/** Always loaded for every full person. */
export interface PersonCore {
  schema: 1;
  id: PersonId;
  seed: number;
  name: string;
  role: string;
  home: Home;
  location: LocationState;
  money: number;
  goal?: Goal;
  /** Named 3–8 map entity id, when this census slot aliases that roster. */
  mapEntityId?: string;
  history: HistoryRow[];
}

export interface PersonDetail {
  schema: 1;
  id: PersonId;
  attributes: Record<string, number>;
  skills: Record<string, number>;
  inventory: Array<{ itemId: string; qty: number }>;
  ownership: Array<{ assetId: string; type: 'building' | 'plot' | 'business' | 'item' }>;
  relationships: Array<{ personId: PersonId; type: string; affinity: number }>;
  knowledge: Array<{ factId: string; about?: string }>;
  opinions: Array<{ targetId: string; kind: 'person' | 'place' | 'faction'; score: number }>;
}

/** Lightweight traveller until inspect / encounter promotes them. */
export interface ArchetypeStub {
  schema: 1;
  id: string;
  seed: number;
  archetype: string;
  partyId: PartyId;
  money: number;
  promotedId?: PersonId;
}

export type PartyPurpose = 'merchant' | 'patrol' | 'pilgrim' | 'bandit' | 'lone' | 'army' | 'relocating';

export interface PendingCamp {
  campId: CampId;
  create: boolean;
  originPlaceId: string;
  founderId: PersonId;
  kind: 'camp' | 'wagon-circle';
  x: number;
  y: number;
  expiresAtHours: number;
}

export interface Party {
  schema: 1;
  id: PartyId;
  seed: number;
  purpose: PartyPurpose;
  memberIds: string[];
  route?: { from: PlaceId | 'wild'; to: PlaceId | 'wild'; viaRoad: boolean };
  x: number;
  y: number;
  destX: number;
  destY: number;
  speed: number;
  moneyHeld: number;
  mapEntityId?: string;
  departedAt?: number;
  arrivesAt?: number;
  originX?: number;
  originY?: number;
  pendingCamp?: PendingCamp;
}

/** Temporary wilderness home. Not a POI and not a generated place. */
export interface Camp {
  schema: 1;
  id: CampId;
  kind: 'camp' | 'wagon-circle';
  x: number;
  y: number;
  memberIds: PersonId[];
  foundedHours: number;
  expiresAtHours: number;
  originPlaceId: string;
}

export interface Wallets {
  schema: 1;
  crown: number;
  towns: Record<string, number>;
  camps: Record<string, number>;
}

export type LedgerType = 'wage' | 'spend' | 'tax' | 'trade' | 'relocate' | 'promote' | 'dissolve' | 'mint';

export interface LedgerEvent {
  id: number;
  t: number;
  type: LedgerType;
  amount?: number;
  personId?: PersonId;
  placeId?: string;
  partyId?: PartyId;
  campId?: CampId;
  motive?: Motive;
  from?: Home;
  to?: Home;
  note?: string;
}

export interface PlaceSeed {
  id: string;
  name: string;
  x: number;
  y: number;
  census: number;
  named: number;
  mix: Array<{ role: string; w: number }>;
  crowdSeed: number;
  namedNames?: string[];
}

export interface TravellerSeed {
  id: string;
  kind: 'wanderer' | 'caravan' | 'army';
  name: string;
  x: number;
  y: number;
  destX: number;
  destY: number;
  speed: number;
  bandit?: boolean;
  fromPlaceId?: string;
  toPlaceId?: string;
}

export interface PeopleState {
  schema: 1;
  worldSeed: number;
  clockHours: number;
  minted: number;
  people: Map<PersonId, PersonCore>;
  parties: Map<PartyId, Party>;
  camps: Map<CampId, Camp>;
  stubs: Map<string, ArchetypeStub>;
  wallets: Wallets;
  ledger: LedgerEvent[];
  byPlace: Map<string, PersonId[]>;
  places: PlaceSeed[];
  nextLedgerId: number;
}

export interface PackedWorld {
  schema: 1;
  worldSeed: number;
  clockHours: number;
  savedAt: number;
  minted: number;
  people: PersonCore[];
  parties: Party[];
  camps: Camp[];
  stubs: ArchetypeStub[];
  wallets: Wallets;
  ledger: LedgerEvent[];
  byPlace: Record<string, string[]>;
  places: PlaceSeed[];
  nextLedgerId: number;
}

export const STUB_ATTRIBUTES: Record<string, number> = {
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
};

export const STUB_SKILLS: Record<string, number> = {
  melee: 0,
  archery: 0,
  riding: 0,
  athletics: 0,
  crafting: 0,
  trade: 0,
  stealth: 0,
  lore: 0,
  medicine: 0,
  persuasion: 0,
  survival: 0,
  leadership: 0,
};

/** Copper per game day, paid by the town treasury. */
export const ROLE_WAGE: Record<string, number> = {
  farmer: 12,
  merchant: 18,
  smith: 16,
  guard: 14,
  sailor: 13,
  fisher: 11,
  noble: 22,
  pioneer: 10,
  laborer: 9,
  crafter: 15,
  scout: 8,
  bandit: 0,
};

export const TAX_OF_WAGE = 0.1;
export const SPEND_OF_WAGE = 0.4;
/** Relocations per thousand people per day. */
export const DAILY_RELOCATE_PPM = 20;

export function emptyDetail(id: PersonId): PersonDetail {
  return {
    schema: 1,
    id,
    attributes: { ...STUB_ATTRIBUTES },
    skills: { ...STUB_SKILLS },
    inventory: [],
    ownership: [],
    relationships: [],
    knowledge: [],
    opinions: [],
  };
}

export function wageFor(role: string): number {
  return ROLE_WAGE[role] ?? 10;
}
