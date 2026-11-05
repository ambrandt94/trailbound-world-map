/**
 * IndexedDB world store. Schema version 2.
 * v1: meta, people_core, people_detail, parties, homesteads, ledger, by_place.
 * v2: camps, wallets, stubs. Homestead rows become camps (Alex: no homesteads).
 */
import type { ArchetypeStub, Camp, PackedWorld, Party, PeopleState, PersonCore, PersonDetail } from './types';

export const DB_NAME = 'tb-world-entities';
export const SCHEMA_VERSION = 2;

export interface WorldStore {
  readonly version: number;
  load(seed: number): Promise<PackedWorld | null>;
  save(world: PackedWorld, details?: PersonDetail[]): Promise<number>;
  loadDetail(seed: number, id: string): Promise<PersonDetail | null>;
  reset(seed: number): Promise<void>;
  close(): Promise<void>;
}

export function openWorldDb(opts?: { name?: string; memory?: boolean }): WorldStore {
  if (opts?.memory) return new MemoryWorldStore();
  return new IdbWorldStore(opts?.name ?? DB_NAME);
}

export function packWorld(state: PeopleState): PackedWorld {
  return {
    schema: 1,
    worldSeed: state.worldSeed,
    clockHours: state.clockHours,
    savedAt: Date.now(),
    minted: state.minted,
    people: [...state.people.values()].map((person) => ({ ...person, history: person.history.map((row) => ({ ...row })) })),
    parties: [...state.parties.values()].map((party) => ({ ...party, memberIds: party.memberIds.slice() })),
    camps: [...state.camps.values()].map((camp) => ({ ...camp, memberIds: camp.memberIds.slice() })),
    stubs: [...state.stubs.values()].map((stub) => ({ ...stub })),
    wallets: {
      schema: 1,
      crown: state.wallets.crown,
      towns: { ...state.wallets.towns },
      camps: { ...state.wallets.camps },
    },
    ledger: state.ledger.map((row) => ({ ...row })),
    byPlace: Object.fromEntries([...state.byPlace].map(([id, ids]) => [id, ids.slice()])),
    places: state.places.map((place) => ({ ...place, mix: place.mix.map((row) => ({ ...row })), namedNames: place.namedNames?.slice() })),
    nextLedgerId: state.nextLedgerId,
  };
}

export function unpackWorld(packed: PackedWorld | null): PeopleState | null {
  if (!packed) return null;
  const people = new Map<string, PersonCore>();
  for (const person of packed.people) {
    people.set(person.id, {
      ...person,
      history: person.history?.slice() ?? [],
      home: normalizeHome(person.home),
    });
  }
  return {
    schema: 1,
    worldSeed: packed.worldSeed,
    clockHours: packed.clockHours,
    minted: packed.minted,
    people,
    parties: new Map(packed.parties.map((party) => [party.id, { ...party, memberIds: party.memberIds.slice() }])),
    camps: new Map(packed.camps.map((camp) => [camp.id, { ...camp, memberIds: camp.memberIds.slice() }])),
    stubs: new Map(packed.stubs.map((stub) => [stub.id, { ...stub }])),
    wallets: {
      schema: 1,
      crown: packed.wallets?.crown ?? 0,
      towns: { ...(packed.wallets?.towns ?? {}) },
      camps: { ...(packed.wallets?.camps ?? {}) },
    },
    ledger: packed.ledger.map((row) => ({ ...row })),
    byPlace: new Map(Object.entries(packed.byPlace ?? {}).map(([id, ids]) => [id, ids.slice()])),
    places: (packed.places ?? []).map((place) => ({ ...place, mix: place.mix.map((row) => ({ ...row })) })),
    nextLedgerId: packed.nextLedgerId || packed.ledger.reduce((max, row) => Math.max(max, row.id), 0) + 1,
  };
}

export function payloadBytes(world: PackedWorld, details: PersonDetail[] = []): number {
  return new TextEncoder().encode(JSON.stringify({ world, details })).length;
}

function normalizeHome(home: PersonCore['home'] | { kind: string; homesteadId?: string; placeId?: string; campId?: string; poiId?: string; x?: number; y?: number }): PersonCore['home'] {
  if (home && (home as { kind?: string }).kind === 'homestead') {
    const row = home as { homesteadId?: string };
    return { kind: 'camp', campId: row.homesteadId ?? 'camp:migrated' };
  }
  return home as PersonCore['home'];
}

class MemoryWorldStore implements WorldStore {
  readonly version = SCHEMA_VERSION;
  private readonly worlds = new Map<number, PackedWorld>();
  private readonly details = new Map<number, Map<string, PersonDetail>>();

  async load(seed: number): Promise<PackedWorld | null> {
    const row = this.worlds.get(seed);
    return row ? structuredClone(row) : null;
  }

  async save(world: PackedWorld, details?: PersonDetail[]): Promise<number> {
    const copy = structuredClone(world);
    this.worlds.set(world.worldSeed, copy);
    const bag = this.details.get(world.worldSeed) ?? new Map<string, PersonDetail>();
    for (const detail of details ?? []) bag.set(detail.id, structuredClone(detail));
    this.details.set(world.worldSeed, bag);
    return payloadBytes(copy, [...bag.values()]);
  }

  async loadDetail(seed: number, id: string): Promise<PersonDetail | null> {
    const detail = this.details.get(seed)?.get(id);
    return detail ? structuredClone(detail) : null;
  }

  async reset(seed: number): Promise<void> {
    this.worlds.delete(seed);
    this.details.delete(seed);
  }

  async close(): Promise<void> {
    /* in-memory */
  }
}

interface HomesteadRow {
  key?: string;
  placeId: string;
  personId: string;
  x: number;
  y: number;
  worldSeed: number;
}

class IdbWorldStore implements WorldStore {
  readonly version = SCHEMA_VERSION;
  private readonly name: string;
  private opening: Promise<IDBDatabase> | null = null;

  constructor(name: string) {
    this.name = name;
  }

  async load(seed: number): Promise<PackedWorld | null> {
    const db = await this.db();
    const meta = await req<PackedMeta | undefined>(db.transaction('meta', 'readonly').objectStore('meta').get(seed));
    if (!meta) return null;
    const people = (await all<StoredPerson>(db, 'people_core')).filter((row) => row.worldSeed === seed);
    const parties = (await all<StoredParty>(db, 'parties')).filter((row) => row.worldSeed === seed);
    const camps = db.objectStoreNames.contains('camps')
      ? (await all<StoredCamp>(db, 'camps')).filter((row) => row.worldSeed === seed)
      : [];
    const stubs = db.objectStoreNames.contains('stubs')
      ? (await all<StoredStub>(db, 'stubs')).filter((row) => row.worldSeed === seed)
      : [];
    const wallets = db.objectStoreNames.contains('wallets')
      ? await req<StoredWallets | undefined>(db.transaction('wallets', 'readonly').objectStore('wallets').get(seed))
      : undefined;
    const ledger = (await all<StoredLedger>(db, 'ledger')).filter((row) => row.worldSeed === seed);
    const byRows = (await all<StoredPlace>(db, 'by_place')).filter((row) => row.worldSeed === seed);
    const byPlace: Record<string, string[]> = {};
    for (const row of byRows) byPlace[row.placeId] = row.ids;
    return {
      schema: 1,
      worldSeed: seed,
      clockHours: meta.clockHours,
      savedAt: meta.savedAt,
      minted: meta.minted,
      people: people.map(stripKey),
      parties: parties.map(stripKey),
      camps: camps.map(stripKey),
      stubs: stubs.map(stripKey),
      wallets: wallets?.wallets ?? { schema: 1, crown: 0, towns: {}, camps: {} },
      ledger: ledger.map((row) => row.event),
      byPlace,
      places: meta.places ?? [],
      nextLedgerId: meta.nextLedgerId ?? ledger.reduce((max, row) => Math.max(max, row.event.id), 0) + 1,
    };
  }

  async save(world: PackedWorld, details?: PersonDetail[]): Promise<number> {
    const db = await this.db();
    const names = [...db.objectStoreNames];
    await txDone(db.transaction(names, 'readwrite'), (tx) => {
      tx.objectStore('meta').put({
        schema: SCHEMA_VERSION,
        worldSeed: world.worldSeed,
        clockHours: world.clockHours,
        savedAt: world.savedAt,
        minted: world.minted,
        places: world.places,
        nextLedgerId: world.nextLedgerId,
      } satisfies PackedMeta);
      replaceSeed(tx.objectStore('people_core'), world.worldSeed, world.people.map((person) => ({
        ...person,
        key: keyOf(world.worldSeed, person.id),
        worldSeed: world.worldSeed,
      })));
      replaceSeed(tx.objectStore('parties'), world.worldSeed, world.parties.map((party) => ({
        ...party,
        key: keyOf(world.worldSeed, party.id),
        worldSeed: world.worldSeed,
      })));
      if (db.objectStoreNames.contains('camps')) {
        replaceSeed(tx.objectStore('camps'), world.worldSeed, world.camps.map((camp) => ({
          ...camp,
          key: keyOf(world.worldSeed, camp.id),
          worldSeed: world.worldSeed,
        })));
      }
      if (db.objectStoreNames.contains('stubs')) {
        replaceSeed(tx.objectStore('stubs'), world.worldSeed, world.stubs.map((stub) => ({
          ...stub,
          key: keyOf(world.worldSeed, stub.id),
          worldSeed: world.worldSeed,
        })));
      }
      if (db.objectStoreNames.contains('wallets')) {
        tx.objectStore('wallets').put({
          worldSeed: world.worldSeed,
          wallets: world.wallets,
        } satisfies StoredWallets);
      }
      const ledger = tx.objectStore('ledger');
      const drop = ledger.openCursor();
      drop.onsuccess = () => {
        const cursor = drop.result;
        if (!cursor) {
          for (const event of world.ledger) {
            ledger.add({ worldSeed: world.worldSeed, event });
          }
          return;
        }
        const value = cursor.value as { worldSeed?: number };
        if (value.worldSeed === world.worldSeed) cursor.delete();
        cursor.continue();
      };
      const places = tx.objectStore('by_place');
      const placeCursor = places.openCursor();
      placeCursor.onsuccess = () => {
        const cursor = placeCursor.result;
        if (!cursor) {
          for (const [placeId, ids] of Object.entries(world.byPlace)) {
            places.put({
              key: keyOf(world.worldSeed, placeId),
              worldSeed: world.worldSeed,
              placeId,
              ids,
            });
          }
          return;
        }
        const value = cursor.value as { worldSeed?: number };
        if (value.worldSeed === world.worldSeed) cursor.delete();
        cursor.continue();
      };
      if (details?.length) {
        const store = tx.objectStore('people_detail');
        for (const detail of details) {
          store.put({ ...detail, key: keyOf(world.worldSeed, detail.id), worldSeed: world.worldSeed });
        }
      }
    });
    return payloadBytes(world, details ?? []);
  }

  async loadDetail(seed: number, id: string): Promise<PersonDetail | null> {
    const db = await this.db();
    const row = await req<StoredDetail | undefined>(
      db.transaction('people_detail', 'readonly').objectStore('people_detail').get(keyOf(seed, id)),
    );
    if (!row) return null;
    const { key: _key, worldSeed: _seed, ...detail } = row;
    void _key;
    void _seed;
    return detail;
  }

  async reset(seed: number): Promise<void> {
    const db = await this.db();
    const names = [...db.objectStoreNames];
    await txDone(db.transaction(names, 'readwrite'), (tx) => {
      tx.objectStore('meta').delete(seed);
      if (db.objectStoreNames.contains('wallets')) tx.objectStore('wallets').delete(seed);
      for (const name of names) {
        if (name === 'meta' || name === 'wallets') continue;
        const store = tx.objectStore(name);
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const value = cursor.value as { worldSeed?: number };
          if (value.worldSeed === seed) cursor.delete();
          cursor.continue();
        };
      }
    });
  }

  async close(): Promise<void> {
    if (!this.opening) return;
    const db = await this.opening;
    db.close();
    this.opening = null;
  }

  private db(): Promise<IDBDatabase> {
    if (!this.opening) this.opening = openIdb(this.name);
    return this.opening;
  }
}

interface PackedMeta {
  schema: number;
  worldSeed: number;
  clockHours: number;
  savedAt: number;
  minted: number;
  places?: PackedWorld['places'];
  nextLedgerId?: number;
}

interface StoredPerson extends PersonCore {
  key: string;
  worldSeed: number;
  home: PersonCore['home'];
}

type StoredParty = Party & { key: string; worldSeed: number };
type StoredCamp = Camp & { key: string; worldSeed: number };
type StoredStub = ArchetypeStub & { key: string; worldSeed: number };

interface StoredWallets {
  worldSeed: number;
  wallets: PackedWorld['wallets'];
}

interface StoredLedger {
  worldSeed: number;
  event: PackedWorld['ledger'][number];
}

interface StoredPlace {
  key: string;
  worldSeed: number;
  placeId: string;
  ids: string[];
}

interface StoredDetail extends PersonDetail {
  key: string;
  worldSeed: number;
}

function keyOf(seed: number, id: string): string {
  return `${seed}:${id}`;
}

function stripKey<T extends { key?: string; worldSeed?: number }>(row: T): T {
  const { key: _key, worldSeed: _seed, ...rest } = row;
  void _key;
  void _seed;
  return rest as T;
}

function openIdb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, SCHEMA_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      if (!tx) return;
      const old = event.oldVersion;
      if (old < 1) createV1(db);
      if (old < 2) upgradeV2(db, tx);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function createV1(db: IDBDatabase): void {
  db.createObjectStore('meta', { keyPath: 'worldSeed' });
  db.createObjectStore('people_core', { keyPath: 'key' });
  db.createObjectStore('people_detail', { keyPath: 'key' });
  db.createObjectStore('parties', { keyPath: 'key' });
  db.createObjectStore('homesteads', { keyPath: 'key' });
  db.createObjectStore('ledger', { keyPath: 'id', autoIncrement: true });
  db.createObjectStore('by_place', { keyPath: 'key' });
}

function upgradeV2(db: IDBDatabase, tx: IDBTransaction): void {
  if (!db.objectStoreNames.contains('camps')) db.createObjectStore('camps', { keyPath: 'key' });
  if (!db.objectStoreNames.contains('wallets')) db.createObjectStore('wallets', { keyPath: 'worldSeed' });
  if (!db.objectStoreNames.contains('stubs')) db.createObjectStore('stubs', { keyPath: 'key' });
  if (!db.objectStoreNames.contains('homesteads')) return;
  const rows = tx.objectStore('homesteads').getAll();
  rows.onsuccess = () => {
    for (const row of rows.result as HomesteadRow[]) {
      const campId = row.placeId;
      tx.objectStore('camps').put({
        key: keyOf(row.worldSeed, campId),
        schema: 1,
        id: campId,
        kind: 'camp',
        x: row.x,
        y: row.y,
        memberIds: [row.personId],
        foundedHours: 0,
        expiresAtHours: 24 * 30,
        originPlaceId: 'wild',
        worldSeed: row.worldSeed,
      });
      const personReq = tx.objectStore('people_core').get(keyOf(row.worldSeed, row.personId));
      personReq.onsuccess = () => {
        const person = personReq.result as StoredPerson | undefined;
        if (!person || (person.home as { kind?: string }).kind !== 'homestead') return;
        person.home = { kind: 'camp', campId };
        person.history = person.history ?? [];
        tx.objectStore('people_core').put(person);
      };
    }
  };
}

function replaceSeed(store: IDBObjectStore, seed: number, rows: unknown[]): void {
  const cursorReq = store.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) {
      for (const row of rows) store.put(row);
      return;
    }
    const value = cursor.value as { worldSeed?: number };
    if (value.worldSeed === seed) cursor.delete();
    cursor.continue();
  };
}

function all<T>(db: IDBDatabase, name: string): Promise<T[]> {
  return req<T[]>(db.transaction(name, 'readonly').objectStore(name).getAll());
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction, fill: (tx: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    fill(tx);
  });
}
