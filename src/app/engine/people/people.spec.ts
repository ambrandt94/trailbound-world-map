/**
 * Persistent people: determinism, promotion, camps, money, save/load.
 *   node --import tsx --test src/app/engine/people/people.spec.ts
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'fake-indexeddb/auto';
import { crowdMemberSeed } from '../crowd-mix';
import { residentEntityId } from '../entities';
import {
  SCHEMA_VERSION,
  advanceHours,
  bootstrapPeople,
  conservationGap,
  emptyDetail,
  isMapToken,
  openWorldDb,
  packWorld,
  promoteStub,
  rollRelocations,
  sendToWilderness,
  totalMoney,
  unpackWorld,
  type PeopleState,
  type PlaceSeed,
} from './index';

const MIX = [
  { role: 'farmer', w: 0.5 },
  { role: 'merchant', w: 0.3 },
  { role: 'guard', w: 0.2 },
];

function iron(census = 6): PlaceSeed {
  return {
    id: 'veldcross',
    name: 'Ironmarch',
    x: 40,
    y: 50,
    census,
    named: 2,
    mix: MIX,
    crowdSeed: 0xabcd,
    namedNames: ['Wren Baker', 'Bram Cooper'],
  };
}

function gold(): PlaceSeed {
  return {
    id: 'goldmere',
    name: 'Goldmere',
    x: 80,
    y: 55,
    census: 4,
    named: 1,
    mix: MIX,
    crowdSeed: 0x1234,
  };
}

function sampleWorld(census = 6): PeopleState {
  return bootstrapPeople({
    worldSeed: 7741,
    clockHours: 8,
    places: [iron(census), gold()],
    travellers: [
      { id: 'wanderer-0', kind: 'wanderer', name: 'Pip Scout', x: 12, y: 18, destX: 20, destY: 22, speed: 1.4 },
      { id: 'wanderer-1', kind: 'wanderer', name: 'Grim Raider', x: 14, y: 19, destX: 30, destY: 24, speed: 1.5, bandit: true },
      {
        id: 'caravan-0',
        kind: 'caravan',
        name: 'Ashfen spice caravan',
        x: 41,
        y: 51,
        destX: 80,
        destY: 55,
        speed: 1.1,
        fromPlaceId: 'veldcross',
        toPlaceId: 'goldmere',
      },
      { id: 'army-0', kind: 'army', name: 'Thorn Host', x: 22, y: 33, destX: 70, destY: 40, speed: 0.9 },
    ],
  }).state;
}

describe('bootstrap determinism', () => {
  it('same seed yields the same people', () => {
    const a = bootstrapPeople({ worldSeed: 7741, places: [iron(), gold()], travellers: [] });
    const b = bootstrapPeople({ worldSeed: 7741, places: [iron(), gold()], travellers: [] });
    const pack = (state: PeopleState) =>
      [...state.people.values()]
        .sort((p, q) => (p.id < q.id ? -1 : 1))
        .map((p) => ({ id: p.id, seed: p.seed, name: p.name, role: p.role, money: p.money, home: p.home }));
    assert.deepEqual(pack(a.state), pack(b.state));
    assert.equal(a.state.people.size, 10);
    assert.equal(a.details.length, 10);
    assert.equal(a.state.clockHours, 8);
  });

  it('uses the crowd member seed and aliases the named roster', () => {
    const { state } = bootstrapPeople({ worldSeed: 7741, places: [iron(4)], travellers: [] });
    const first = state.people.get('person:veldcross:0');
    const second = state.people.get('person:veldcross:1');
    assert.ok(first && second);
    assert.equal(first.seed, crowdMemberSeed(0xabcd, 0));
    assert.equal(second.seed, crowdMemberSeed(0xabcd, 1));
    assert.notEqual(first.seed, second.seed);
    assert.equal(first.mapEntityId, residentEntityId('veldcross', 0));
    assert.equal(first.name, 'Wren Baker');
    assert.equal(second.mapEntityId, residentEntityId('veldcross', 1));
    assert.equal(state.people.get('person:veldcross:2')?.mapEntityId, undefined);
    assert.equal(state.byPlace.get('veldcross')?.length, 4);
    const detail = emptyDetail(first.id);
    assert.deepEqual(detail.attributes.str, 10);
    assert.deepEqual(detail.inventory, []);
    assert.equal(detail.skills.trade, 0);
  });

  it('keeps travellers as archetype stubs', () => {
    const state = sampleWorld();
    const lone = [...state.parties.values()].find((p) => p.id === 'wanderer-0');
    const bandit = [...state.parties.values()].find((p) => p.id === 'wanderer-1');
    const caravan = state.parties.get('caravan-0');
    const army = state.parties.get('army-0');
    assert.equal(lone?.purpose, 'lone');
    assert.equal(lone?.memberIds.length, 1);
    assert.equal(bandit?.purpose, 'bandit');
    assert.equal(caravan?.purpose, 'merchant');
    assert.equal(caravan?.memberIds.length, 3);
    assert.equal(caravan?.route?.viaRoad, true);
    assert.equal(army?.purpose, 'army');
    assert.equal(army?.memberIds.length, 2);
    assert.equal(state.people.size, 10);
    assert.equal(state.stubs.size, 1 + 1 + 3 + 2);
    for (const stub of state.stubs.values()) {
      assert.equal(stub.promotedId, undefined);
      assert.equal(state.people.has(stub.id), false);
    }
  });
});

describe('promotion', () => {
  it('promotes a stub once, deterministically from its seed', () => {
    const a = sampleWorld();
    const b = sampleWorld();
    const stub = a.stubs.get('stub:wanderer-1:0');
    assert.ok(stub);
    const purse = stub.money;
    const first = promoteStub(a, stub.id);
    const again = promoteStub(a, stub.id);
    const other = promoteStub(b, stub.id);
    assert.equal(first.core.id, again.core.id);
    assert.equal(first.core.name, other.core.name);
    assert.equal(first.core.seed, stub.seed);
    assert.equal(first.detail.schema, 1);
    assert.equal(first.detail.attributes.dex, 10);
    assert.deepEqual(first.detail.opinions, []);
    assert.equal(a.people.get(first.core.id)?.money, purse);
    assert.ok(purse > 0);
    assert.equal(a.stubs.get(stub.id)?.promotedId, first.core.id);
    assert.equal(a.stubs.get(stub.id)?.money, 0);
    assert.ok(a.parties.get('wanderer-1')?.memberIds.includes(first.core.id));
    assert.equal(conservationGap(a), 0);
    assert.equal(conservationGap(b), 0);
  });
});

describe('relocation into camps', () => {
  it('forms a camp and lets the next person join it', () => {
    const state = sampleWorld(8);
    const ids = state.byPlace.get('veldcross')!.slice(0, 2);
    const t = state.clockHours;
    const first = sendToWilderness(state, ids[0]!, t, 0);
    const second = sendToWilderness(state, ids[1]!, t, 0);
    assert.equal(first.campId, second.campId);
    const camp = state.camps.get(first.campId);
    assert.ok(camp);
    assert.ok(camp.kind === 'camp' || camp.kind === 'wagon-circle');
    assert.deepEqual(camp.memberIds.slice().sort(), ids.slice().sort());
    for (const id of ids) {
      const person = state.people.get(id)!;
      assert.deepEqual(person.home, { kind: 'camp', campId: camp.id });
      assert.deepEqual(person.location, { kind: 'at-home' });
    }
    assert.equal(state.byPlace.get('veldcross')!.includes(ids[0]!), false);
    const moves = state.ledger.filter((row) => row.type === 'relocate');
    assert.equal(moves.length, 2);
    assert.equal(conservationGap(state), 0);
  });

  it('travels in a relocating party before the camp exists', () => {
    const state = sampleWorld();
    const id = state.byPlace.get('veldcross')![0]!;
    const move = sendToWilderness(state, id, state.clockHours, 6);
    assert.equal(state.camps.has(move.campId), false);
    assert.equal(state.people.get(id)?.location.kind, 'in-party');
    const party = [...state.parties.values()].find((p) => p.purpose === 'relocating');
    assert.ok(party);
    assert.equal(party.memberIds[0], id);
    advanceHours(state, 6, [iron(), gold()]);
    assert.equal(state.camps.get(move.campId)?.memberIds.includes(id), true);
    assert.equal([...state.parties.values()].some((p) => p.purpose === 'relocating'), false);
  });

  it('dissolves a camp when its lifetime runs out', () => {
    const state = sampleWorld();
    const id = state.byPlace.get('veldcross')![0]!;
    const move = sendToWilderness(state, id, state.clockHours, 0);
    const camp = state.camps.get(move.campId)!;
    camp.expiresAtHours = state.clockHours + 10;
    advanceHours(state, 24, [iron(), gold()]);
    assert.equal(state.camps.has(camp.id), false);
    assert.equal(state.people.get(id)?.home.kind, 'none');
    assert.ok(state.ledger.some((row) => row.type === 'dissolve' && row.campId === camp.id));
    assert.equal(conservationGap(state), 0);
  });

  it('rolls the same relocations from the same seed', () => {
    const a = sampleWorld(12);
    const b = sampleWorld(12);
    rollRelocations(a, 0, [iron(12), gold()], 1000);
    rollRelocations(b, 0, [iron(12), gold()], 1000);
    const camps = (state: PeopleState) =>
      [...state.camps.values()].map((camp) => ({ id: camp.id, kind: camp.kind, members: camp.memberIds.slice().sort() }));
    assert.deepEqual(camps(a), camps(b));
    assert.ok(a.camps.size > 0);
    assert.equal(conservationGap(a), 0);
  });
});

describe('money conservation', () => {
  it('keeps the mint equal after wages, taxes, spending, and caravan trade', () => {
    const state = sampleWorld();
    const minted = state.minted;
    const before = totalMoney(state);
    const purse = state.people.get('person:veldcross:0')!.money;
    assert.equal(before, minted);
    advanceHours(state, 24 * 7, [iron(), gold()]);
    assert.equal(state.clockHours, 8 + 24 * 7);
    assert.equal(totalMoney(state), minted);
    assert.equal(conservationGap(state), 0);
    assert.notEqual(state.people.get('person:veldcross:0')!.money, purse);
    assert.ok(state.ledger.some((row) => row.type === 'wage'));
    assert.ok(state.ledger.some((row) => row.type === 'tax'));
    assert.ok(state.ledger.some((row) => row.type === 'trade'));
    assert.ok(state.wallets.crown > 0);
  });
});

describe('save and load', () => {
  it('round-trips core, clock, camps, and lazy detail without resetting to hour 8', async () => {
    const built = bootstrapPeople({
      worldSeed: 7741,
      clockHours: 8,
      places: [iron(), gold()],
      travellers: [{ id: 'wanderer-0', kind: 'wanderer', name: 'Pip Scout', x: 3, y: 4, destX: 8, destY: 9, speed: 1 }],
    });
    const state = built.state;
    advanceHours(state, 24 * 3, [iron(), gold()]);
    const promoted = promoteStub(state, 'stub:wanderer-0:0');
    const id = state.byPlace.get('veldcross')![0]!;
    sendToWilderness(state, id, state.clockHours, 0);
    const db = openWorldDb({ name: 'tb-world-entities-roundtrip', memory: true });
    const bytes = await db.save(packWorld(state), built.details.concat(promoted.detail));
    assert.ok(bytes > 500);
    const loaded = unpackWorld(await db.load(7741));
    assert.ok(loaded);
    assert.equal(loaded.clockHours, 8 + 72);
    assert.notEqual(loaded.clockHours, 8);
    assert.equal(loaded.minted, state.minted);
    assert.equal(loaded.people.size, state.people.size);
    assert.equal(loaded.people.get(promoted.core.id)?.name, promoted.core.name);
    assert.equal(loaded.camps.size, state.camps.size);
    assert.equal(loaded.wallets.crown, state.wallets.crown);
    assert.equal(JSON.stringify(loaded).includes('"attributes"'), false);
    const detail = await db.loadDetail(7741, promoted.core.id);
    assert.equal(detail?.skills.riding, 0);
    assert.equal(detail?.inventory.length, 0);
    const missing = await db.loadDetail(7741, 'person:nope');
    assert.equal(missing, null);
    await db.reset(7741);
    assert.equal(await db.load(7741), null);
    await db.close();
  });

  it('migrates a v1 homestead into a camp and keeps the clock', async () => {
    const name = 'tb-world-entities-migrate';
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('meta', { keyPath: 'worldSeed' });
        db.createObjectStore('people_core', { keyPath: 'key' });
        db.createObjectStore('people_detail', { keyPath: 'key' });
        db.createObjectStore('parties', { keyPath: 'key' });
        db.createObjectStore('homesteads', { keyPath: 'key' });
        db.createObjectStore('ledger', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('by_place', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['meta', 'people_core', 'homesteads'], 'readwrite');
        tx.objectStore('meta').put({
          schema: 1,
          worldSeed: 7741,
          clockHours: 176,
          savedAt: 1,
          minted: 40,
        });
        tx.objectStore('homesteads').put({
          key: '7741:hs-person:veldcross:0',
          placeId: 'hs-person:veldcross:0',
          personId: 'person:veldcross:0',
          x: 12,
          y: 40,
          worldSeed: 7741,
        });
        tx.objectStore('people_core').put({
          key: '7741:person:veldcross:0',
          schema: 1,
          id: 'person:veldcross:0',
          seed: 5,
          name: 'Old Homesteader',
          role: 'pioneer',
          home: { kind: 'homestead', homesteadId: 'hs-person:veldcross:0', x: 12, y: 40 },
          location: { kind: 'at-home' },
          money: 40,
          worldSeed: 7741,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });

    const db = openWorldDb({ name });
    assert.equal(db.version, SCHEMA_VERSION);
    const loaded = unpackWorld(await db.load(7741));
    assert.ok(loaded);
    assert.equal(loaded.clockHours, 176);
    assert.equal(loaded.camps.size, 1);
    const camp = [...loaded.camps.values()][0]!;
    assert.equal(camp.kind, 'camp');
    assert.deepEqual(camp.memberIds, ['person:veldcross:0']);
    assert.deepEqual(loaded.people.get('person:veldcross:0')?.home, { kind: 'camp', campId: camp.id });
    await db.close();
  });
});

describe('map tokens', () => {
  it('hides residents and keeps travellers and camps', () => {
    const resident = { id: 'resident-veldcross-0', resident: { placeId: 'veldcross' } };
    const traveller = { id: 'wanderer-0' };
    const camp = { id: 'camp-1', token: 'camp' as const };
    assert.equal(isMapToken(resident), false);
    assert.equal(isMapToken(traveller), true);
    assert.equal(isMapToken(camp), true);
  });
});

before(() => {
  assert.equal(SCHEMA_VERSION >= 2, true);
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('tb-world-entities-migrate');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});
