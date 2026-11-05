import { defaultOpinion, mix32 } from './hash';
import { rememberMove } from './ledger';
import type { Camp, Home, Motive, Party, PeopleState, PersonCore, PlaceSeed } from './types';
import { DAILY_RELOCATE_PPM, wageFor } from './types';

const CAMP_LIFE_DAYS = 21;
const CAMP_JOIN_CAP = 8;

export interface WildernessMove {
  campId: string;
  motive: Motive;
}

export function sendToWilderness(state: PeopleState, personId: string, t: number, travelHours: number): WildernessMove {
  const person = state.people.get(personId);
  if (!person) throw new Error(`unknown person ${personId}`);
  const origin = originOf(person);
  const place = state.places.find((row) => row.id === origin);
  const motive = pickMotive(person, defaultOpinion(person.seed), Math.floor(t / 24));
  const existing = findCamp(state, origin, t);
  const campId = existing?.id ?? `camp:${person.id}`;
  const kind = ((person.seed + Math.floor(t)) & 1) === 0 ? 'wagon-circle' : 'camp';
  const spot = campSpot(person, place, existing);
  const pending = {
    campId,
    create: !existing,
    originPlaceId: origin,
    founderId: person.id,
    kind: existing?.kind ?? kind,
    x: spot.x,
    y: spot.y,
    expiresAtHours: existing?.expiresAtHours ?? t + CAMP_LIFE_DAYS * 24,
  };
  if (travelHours > 0) {
    const party = relocatingParty(state, person, t, travelHours, spot, pending);
    person.location = { kind: 'in-party', partyId: party.id };
    person.goal = { kind: 'relocate', note: motive };
    state.parties.set(party.id, party);
    return { campId, motive };
  }
  arriveAtCamp(state, person, pending, motive, t);
  return { campId, motive };
}

export function rollRelocations(
  state: PeopleState,
  dayIndex: number,
  places: PlaceSeed[],
  chancePpm = DAILY_RELOCATE_PPM,
  t = state.clockHours,
): void {
  const people = [...state.people.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const person of people) {
    if (person.location.kind !== 'at-home' || person.home.kind !== 'town') continue;
    const ticket = mix32(person.seed, dayIndex, 3) % 1000;
    if (ticket >= chancePpm) continue;
    const opinion = defaultOpinion(person.seed);
    const motive = pickMotive(person, opinion, dayIndex);
    const wild = motive === 'opinion' && opinion < -15 ? true : mix32(person.seed, dayIndex, 9) % 100 < 50;
    if (wild || places.length < 2) {
      sendToWilderness(state, person.id, t, 0);
      continue;
    }
    const dest = otherTown(places, person.home.placeId, person.seed, dayIndex);
    if (!dest) {
      sendToWilderness(state, person.id, t, 0);
      continue;
    }
    moveToTown(state, person, dest.id, motive, t);
  }
}

export function arriveDue(state: PeopleState, t: number): void {
  const due = [...state.parties.values()].filter(
    (party) => party.purpose === 'relocating' && party.arrivesAt !== undefined && party.arrivesAt <= t,
  );
  for (const party of due) {
    const pending = party.pendingCamp;
    const personId = party.memberIds[0];
    const person = personId ? state.people.get(personId) : undefined;
    if (person && pending) arriveAtCamp(state, person, pending, motiveOf(person), t);
    state.parties.delete(party.id);
  }
}

export function moveRelocating(state: PeopleState, t: number): void {
  for (const party of state.parties.values()) {
    if (party.purpose !== 'relocating' || party.departedAt === undefined || party.arrivesAt === undefined) continue;
    const span = Math.max(0.001, party.arrivesAt - party.departedAt);
    const u = Math.min(1, Math.max(0, (t - party.departedAt) / span));
    const x0 = party.originX ?? party.x;
    const y0 = party.originY ?? party.y;
    party.x = x0 + (party.destX - x0) * u;
    party.y = y0 + (party.destY - y0) * u;
  }
}

export function decayCamps(state: PeopleState, t: number): void {
  for (const camp of [...state.camps.values()]) {
    if (t >= camp.expiresAtHours || camp.memberIds.length === 0) dissolveCamp(state, camp.id, t);
  }
}

export function dissolveCamp(state: PeopleState, campId: string, t: number): void {
  const camp = state.camps.get(campId);
  if (!camp) return;
  for (const id of camp.memberIds) {
    const person = state.people.get(id);
    if (!person || person.home.kind !== 'camp' || person.home.campId !== campId) continue;
    const from = person.home;
    person.home = { kind: 'none' };
    person.location = { kind: 'at-home' };
    person.goal = { kind: 'stay', note: 'camp dissolved' };
    rememberMove(state, person, t, 'forced', from, person.home, campId);
  }
  delete state.wallets.camps[campId];
  state.camps.delete(campId);
  state.ledger.push({
    id: state.nextLedgerId++,
    t,
    type: 'dissolve',
    campId,
    note: 'camp lifetime ended',
  });
}

function arriveAtCamp(
  state: PeopleState,
  person: PersonCore,
  pending: Party['pendingCamp'],
  motive: Motive,
  t: number,
): void {
  if (!pending) return;
  let camp = state.camps.get(pending.campId);
  if (!camp && pending.create) {
    camp = {
      schema: 1,
      id: pending.campId,
      kind: pending.kind,
      x: pending.x,
      y: pending.y,
      memberIds: [],
      foundedHours: t,
      expiresAtHours: pending.expiresAtHours,
      originPlaceId: pending.originPlaceId,
    };
    state.camps.set(camp.id, camp);
    state.wallets.camps[camp.id] = 0;
  }
  if (!camp) {
    camp = {
      schema: 1,
      id: pending.campId,
      kind: pending.kind,
      x: pending.x,
      y: pending.y,
      memberIds: [],
      foundedHours: t,
      expiresAtHours: pending.expiresAtHours,
      originPlaceId: pending.originPlaceId,
    };
    state.camps.set(camp.id, camp);
    state.wallets.camps[camp.id] = state.wallets.camps[camp.id] ?? 0;
  }
  if (!camp.memberIds.includes(person.id) && camp.memberIds.length < CAMP_JOIN_CAP) camp.memberIds.push(person.id);
  const from = person.home;
  const to: Home = { kind: 'camp', campId: camp.id };
  leavePlace(state, person.id);
  person.home = to;
  person.location = { kind: 'at-home' };
  person.goal = { kind: 'stay' };
  rememberMove(state, person, t, motive, from, to, camp.id);
}

function moveToTown(state: PeopleState, person: PersonCore, placeId: string, motive: Motive, t: number): void {
  const from = person.home;
  leavePlace(state, person.id);
  person.home = { kind: 'town', placeId };
  person.location = { kind: 'at-home' };
  person.goal = { kind: 'stay' };
  const list = state.byPlace.get(placeId) ?? [];
  if (!list.includes(person.id)) list.push(person.id);
  state.byPlace.set(placeId, list);
  rememberMove(state, person, t, motive, from, person.home);
}

function leavePlace(state: PeopleState, personId: string): void {
  for (const [placeId, ids] of state.byPlace) {
    if (!ids.includes(personId)) continue;
    state.byPlace.set(
      placeId,
      ids.filter((id) => id !== personId),
    );
  }
}

function findCamp(state: PeopleState, origin: string, t: number): Camp | undefined {
  return [...state.camps.values()]
    .filter((camp) => camp.originPlaceId === origin && camp.memberIds.length < CAMP_JOIN_CAP && camp.expiresAtHours > t)
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
}

function campSpot(person: PersonCore, place: PlaceSeed | undefined, existing: Camp | undefined): { x: number; y: number } {
  if (existing) return { x: existing.x, y: existing.y };
  const angle = ((person.seed % 360) * Math.PI) / 180;
  const dist = 6 + (person.seed % 5);
  return {
    x: (place?.x ?? 0) + Math.cos(angle) * dist,
    y: (place?.y ?? 0) + Math.sin(angle) * dist,
  };
}

function relocatingParty(
  state: PeopleState,
  person: PersonCore,
  t: number,
  travelHours: number,
  spot: { x: number; y: number },
  pending: NonNullable<Party['pendingCamp']>,
): Party {
  const place = state.places.find((row) => row.id === originOf(person));
  const id = `reloc:${person.id}:${Math.floor(t)}`;
  return {
    schema: 1,
    id,
    seed: mix32(person.seed, Math.floor(t), 4),
    purpose: 'relocating',
    memberIds: [person.id],
    route: { from: originOf(person), to: 'wild', viaRoad: false },
    x: place?.x ?? spot.x,
    y: place?.y ?? spot.y,
    originX: place?.x ?? spot.x,
    originY: place?.y ?? spot.y,
    destX: spot.x,
    destY: spot.y,
    speed: 1.4,
    moneyHeld: 0,
    departedAt: t,
    arrivesAt: t + travelHours,
    pendingCamp: pending,
  };
}

function originOf(person: PersonCore): string {
  if (person.home.kind === 'town') return person.home.placeId;
  if (person.home.kind === 'camp') return person.home.campId;
  return 'wild';
}

function pickMotive(person: PersonCore, opinion: number, day: number): Motive {
  const wage = wageFor(person.role);
  const weights: Record<Motive, number> = {
    money: person.money < wage * 8 ? 5 : 1,
    opinion: opinion < 0 ? 4 : 1,
    opportunity: 3,
    forced: 1,
  };
  const order: Motive[] = ['money', 'opinion', 'opportunity', 'forced'];
  const total = order.reduce((sum, key) => sum + weights[key], 0);
  let ticket = mix32(person.seed, day, 2) % total;
  for (const key of order) {
    ticket -= weights[key];
    if (ticket < 0) return key;
  }
  return 'opportunity';
}

function otherTown(places: PlaceSeed[], fromId: string, seed: number, day: number): PlaceSeed | undefined {
  const options = places.filter((place) => place.id !== fromId);
  if (!options.length) return undefined;
  return options[mix32(seed, day, 5) % options.length];
}

function motiveOf(person: PersonCore): Motive {
  if (person.goal?.note === 'money' || person.goal?.note === 'opinion' || person.goal?.note === 'opportunity' || person.goal?.note === 'forced') {
    return person.goal.note;
  }
  return 'opportunity';
}

