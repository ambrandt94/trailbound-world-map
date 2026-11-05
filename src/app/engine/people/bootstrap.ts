import { crowdMemberSeed } from '../crowd-mix';
import { residentEntityId } from '../entities';
import { nameFromSeed, roleAt, startingPurse, travellerSeed } from './hash';
import type {
  ArchetypeStub,
  Party,
  PeopleState,
  PersonCore,
  PersonDetail,
  PlaceSeed,
  TravellerSeed,
  Wallets,
} from './types';
import { emptyDetail, wageFor } from './types';

export interface BootstrapInput {
  worldSeed: number;
  clockHours?: number;
  places: PlaceSeed[];
  travellers: TravellerSeed[];
}

export interface BootstrapResult {
  state: PeopleState;
  details: PersonDetail[];
}

export function bootstrapPeople(input: BootstrapInput): BootstrapResult {
  const state = emptyState(input.worldSeed, input.clockHours ?? 8, input.places);
  const details: PersonDetail[] = [];
  for (const place of input.places) {
    const ids: string[] = [];
    const count = Math.max(0, Math.round(place.census));
    for (let i = 0; i < count; i++) {
      const seed = crowdMemberSeed(place.crowdSeed >>> 0, i) || 1;
      const id = `person:${place.id}:${i}`;
      const named = i < place.named;
      const person: PersonCore = {
        schema: 1,
        id,
        seed,
        name: named && place.namedNames?.[i] ? place.namedNames[i]! : nameFromSeed(seed),
        role: roleAt(place.mix, seed),
        home: { kind: 'town', placeId: place.id },
        location: { kind: 'at-home' },
        money: startingPurse(roleAt(place.mix, seed), seed),
        history: [],
        ...(named ? { mapEntityId: residentEntityId(place.id, i) } : {}),
      };
      state.people.set(id, person);
      ids.push(id);
      details.push(emptyDetail(id));
    }
    state.byPlace.set(place.id, ids);
    const daily = ids.reduce((sum, id) => sum + wageFor(state.people.get(id)!.role), 0);
    state.wallets.towns[place.id] = daily * 60 + 200;
  }
  for (const traveller of input.travellers) addTraveller(state, input.worldSeed, traveller);
  state.minted = totalOf(state);
  return { state, details };
}

export function emptyState(worldSeed: number, clockHours: number, places: PlaceSeed[]): PeopleState {
  const wallets: Wallets = { schema: 1, crown: 0, towns: {}, camps: {} };
  return {
    schema: 1,
    worldSeed,
    clockHours,
    minted: 0,
    people: new Map(),
    parties: new Map(),
    camps: new Map(),
    stubs: new Map(),
    wallets,
    ledger: [],
    byPlace: new Map(),
    places: places.map((place) => ({ ...place, mix: place.mix.map((row) => ({ ...row })) })),
    nextLedgerId: 1,
  };
}

function addTraveller(state: PeopleState, worldSeed: number, traveller: TravellerSeed): void {
  const purpose = traveller.kind === 'caravan' ? 'merchant' : traveller.kind === 'army' ? 'army' : traveller.bandit ? 'bandit' : 'lone';
  const slots =
    traveller.kind === 'caravan'
      ? ['merchant', 'guard', 'laborer']
      : traveller.kind === 'army'
        ? ['guard', 'pioneer']
        : [traveller.bandit ? 'bandit' : 'scout'];
  const memberIds: string[] = [];
  const partySeed = travellerSeed(worldSeed, traveller.id, 0);
  for (let slot = 0; slot < slots.length; slot++) {
    const archetype = slots[slot]!;
    const seed = travellerSeed(worldSeed, traveller.id, slot);
    const stub: ArchetypeStub = {
      schema: 1,
      id: `stub:${traveller.id}:${slot}`,
      seed,
      archetype,
      partyId: traveller.id,
      money: startingPurse(archetype, seed),
    };
    state.stubs.set(stub.id, stub);
    memberIds.push(stub.id);
  }
  const from = traveller.fromPlaceId ?? nearestPlace(state.places, traveller.x, traveller.y);
  const to = traveller.toPlaceId ?? nearestPlace(state.places, traveller.destX, traveller.destY);
  const party: Party = {
    schema: 1,
    id: traveller.id,
    seed: partySeed,
    purpose,
    memberIds,
    x: traveller.x,
    y: traveller.y,
    destX: traveller.destX,
    destY: traveller.destY,
    speed: traveller.speed,
    moneyHeld: purpose === 'merchant' ? 160 + (partySeed % 40) : purpose === 'army' ? 40 : 0,
    mapEntityId: traveller.id,
    ...(from !== 'wild' || to !== 'wild'
      ? { route: { from, to, viaRoad: from !== 'wild' && to !== 'wild' && purpose === 'merchant' } }
      : {}),
  };
  state.parties.set(party.id, party);
}

function nearestPlace(places: PlaceSeed[], x: number, y: number): string | 'wild' {
  let best: PlaceSeed | null = null;
  let bestD = 48;
  for (const place of places) {
    const d = Math.hypot(place.x - x, place.y - y);
    if (d < bestD) {
      bestD = d;
      best = place;
    }
  }
  return best?.id ?? 'wild';
}

export function totalOf(state: PeopleState): number {
  let n = state.wallets.crown;
  for (const value of Object.values(state.wallets.towns)) n += value;
  for (const value of Object.values(state.wallets.camps)) n += value;
  for (const person of state.people.values()) n += person.money;
  for (const stub of state.stubs.values()) {
    if (!stub.promotedId) n += stub.money;
  }
  for (const party of state.parties.values()) n += party.moneyHeld;
  return n;
}

export function totalMoney(state: PeopleState): number {
  return totalOf(state);
}

export function conservationGap(state: PeopleState): number {
  return totalMoney(state) - state.minted;
}
