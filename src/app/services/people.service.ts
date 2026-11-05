import { Injectable, signal } from '@angular/core';
import { bootstrapFromWorld } from '../engine/people/from-world';
import {
  advanceHours,
  arriveDue,
  conservationGap,
  emptyDetail,
  moveRelocating,
  openWorldDb,
  packWorld,
  promoteStub,
  syncMapTokens,
  totalMoney,
  unpackWorld,
  type Home,
  type LedgerEvent,
  type PeopleState,
  type PersonCore,
  type PersonDetail,
} from '../engine/people';
import type { MapEntity, WorldData } from '../models/world.models';
import type { ResidentOverride } from '../engine/residents';

export interface PeopleRow {
  id: string;
  name: string;
  role: string;
  money: number;
  stub: boolean;
  home: string;
}

export interface PeopleSelection {
  kind: 'place' | 'party' | 'camp';
  id: string;
  title: string;
  rows: PeopleRow[];
  notes: string[];
}

export interface PersonView {
  core: PersonCore;
  detail: PersonDetail;
  ledger: LedgerEvent[];
}

@Injectable({ providedIn: 'root' })
export class PeopleService {
  private readonly store = openWorldDb();
  private state: PeopleState | null = null;
  private epoch = 0;
  private readonly pendingDetails: PersonDetail[] = [];

  /** World clock adopts the saved hour instead of staying at 08:00. */
  onRestored: ((hours: number) => void) | null = null;

  readonly ready = signal(false);
  readonly rev = signal(0);
  readonly totalMoney = signal(0);
  readonly minted = signal(0);
  readonly gap = signal(0);
  readonly hiddenResidents = signal(0);
  readonly travellers = signal(0);
  readonly campCount = signal(0);
  readonly personCount = signal(0);
  readonly selection = signal<PeopleSelection | null>(null);
  readonly person = signal<PersonView | null>(null);
  readonly status = signal('People load with the world.');
  readonly saveBytes = signal(0);
  readonly saveMs = signal(0);
  readonly loadMs = signal(0);
  readonly tickMs = signal(0);

  async bind(world: WorldData, entities: MapEntity[], overrides?: Record<string, ResidentOverride>): Promise<number> {
    const epoch = ++this.epoch;
    this.ready.set(false);
    const started = performance.now();
    const saved = await this.store.load(world.seed);
    if (epoch !== this.epoch) return this.state?.clockHours ?? 8;
    if (saved) {
      this.state = unpackWorld(saved);
      this.loadMs.set(performance.now() - started);
      this.status.set(`Loaded day clock ${this.formatHours(saved.clockHours)} · ${this.loadMs().toFixed(0)} ms`);
    } else {
      const built = bootstrapFromWorld(world, entities, overrides);
      this.state = built.state;
      this.pendingDetails.push(...built.details);
      const bytes = await this.store.save(packWorld(built.state), built.details);
      if (epoch !== this.epoch) return built.state.clockHours;
      this.saveBytes.set(bytes);
      this.saveMs.set(performance.now() - started);
      this.pendingDetails.length = 0;
      this.status.set(`New world · ${this.formatBytes(bytes)}`);
    }
    this.finish(entities);
    return this.state?.clockHours ?? 8;
  }

  noteClock(hours: number, entities: MapEntity[]): void {
    const state = this.state;
    if (!state || hours + 1e-6 < state.clockHours) return;
    const prevDay = Math.floor(state.clockHours / 24);
    const nextDay = Math.floor(hours / 24);
    if (nextDay > prevDay) {
      const started = performance.now();
      advanceHours(state, hours - state.clockHours, state.places);
      this.tickMs.set(performance.now() - started);
      void this.save();
    } else {
      state.clockHours = hours;
      arriveDue(state, hours);
      moveRelocating(state, hours);
    }
    syncMapTokens(state, entities);
    if (nextDay > prevDay) this.publish();
  }

  async skipDays(days: number, entities: MapEntity[]): Promise<number> {
    const state = this.state;
    if (!state) return 8;
    const started = performance.now();
    advanceHours(state, days * 24, state.places);
    this.tickMs.set(performance.now() - started);
    syncMapTokens(state, entities);
    this.publish();
    await this.save();
    this.onRestored?.(state.clockHours);
    this.status.set(`Skipped ${days} day${days === 1 ? '' : 's'} · tick ${this.tickMs().toFixed(1)} ms`);
    return state.clockHours;
  }

  async save(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const started = performance.now();
    const details = this.pendingDetails.splice(0, this.pendingDetails.length);
    const bytes = await this.store.save(packWorld(state), details);
    this.saveBytes.set(bytes);
    this.saveMs.set(performance.now() - started);
    this.status.set(`Saved ${this.formatBytes(bytes)} in ${this.saveMs().toFixed(0)} ms`);
  }

  async load(entities: MapEntity[]): Promise<void> {
    const state = this.state;
    if (!state) return;
    const started = performance.now();
    const saved = await this.store.load(state.worldSeed);
    this.loadMs.set(performance.now() - started);
    if (!saved) {
      this.status.set('No save for this seed.');
      return;
    }
    this.state = unpackWorld(saved);
    syncMapTokens(this.state!, entities);
    this.publish();
    this.onRestored?.(saved.clockHours);
    this.status.set(`Loaded ${this.formatHours(saved.clockHours)} in ${this.loadMs().toFixed(0)} ms`);
  }

  async reset(world: WorldData, entities: MapEntity[], overrides?: Record<string, ResidentOverride>): Promise<void> {
    await this.store.reset(world.seed);
    const built = bootstrapFromWorld(world, entities, overrides);
    this.state = built.state;
    this.pendingDetails.push(...built.details);
    syncMapTokens(this.state, entities);
    this.selection.set(null);
    this.person.set(null);
    this.publish();
    await this.save();
    this.onRestored?.(8);
    this.status.set('World reset · clock 08:00');
  }

  inspectPlace(id: string, title: string): void {
    this.person.set(null);
    this.fillPlace(id, title);
  }

  inspectParty(id: string): void {
    this.person.set(null);
    this.fillParty(id);
  }

  inspectCamp(id: string): void {
    this.person.set(null);
    this.fillCamp(id);
  }

  async openPerson(id: string): Promise<void> {
    const state = this.state;
    if (!state) return;
    let detail: PersonDetail | null = null;
    if (!state.people.has(id) && state.stubs.has(id)) {
      const promoted = promoteStub(state, id);
      detail = promoted.detail;
      this.pendingDetails.push(detail);
      this.publish();
      await this.save();
    }
    const core = state.people.get(id) ?? (detail ? state.people.get(state.stubs.get(id)?.promotedId ?? '') : undefined);
    const resolved = core ?? [...state.people.values()].find((person) => person.id === state.stubs.get(id)?.promotedId);
    if (!resolved) return;
    if (!detail) detail = (await this.store.loadDetail(state.worldSeed, resolved.id)) ?? emptyDetail(resolved.id);
    this.person.set({
      core: resolved,
      detail,
      ledger: state.ledger.filter((row) => row.personId === resolved.id).slice(-12),
    });
    const sel = this.selection();
    if (sel) this.refreshSelection(sel.kind, sel.id, sel.title);
  }

  backToList(): void {
    this.person.set(null);
  }

  private finish(entities: MapEntity[]): void {
    const state = this.state;
    if (!state) return;
    syncMapTokens(state, entities);
    this.publish();
    this.ready.set(true);
    this.onRestored?.(state.clockHours);
  }

  private publish(): void {
    const state = this.state;
    if (!state) return;
    const money = totalMoney(state);
    this.totalMoney.set(money);
    this.minted.set(state.minted);
    this.gap.set(conservationGap(state));
    let hidden = 0;
    for (const person of state.people.values()) {
      if (person.home.kind === 'town' && person.location.kind === 'at-home') hidden += 1;
    }
    this.hiddenResidents.set(hidden);
    this.travellers.set([...state.stubs.values()].filter((stub) => !stub.promotedId).length + [...state.parties.values()].filter((party) => party.purpose === 'relocating').length);
    this.campCount.set(state.camps.size);
    this.personCount.set(state.people.size);
    this.rev.update((n) => n + 1);
    const person = this.person();
    if (person) {
      const core = state.people.get(person.core.id);
      if (core) {
        this.person.set({
          ...person,
          core,
          ledger: state.ledger.filter((row) => row.personId === core.id).slice(-12),
        });
      }
    }
    const sel = this.selection();
    if (sel) this.refreshSelection(sel.kind, sel.id, sel.title);
  }

  private refreshSelection(kind: PeopleSelection['kind'], id: string, title: string): void {
    if (kind === 'place') this.fillPlace(id, title);
    else if (kind === 'party') this.fillParty(id);
    else this.fillCamp(id);
  }

  private fillPlace(id: string, title: string): void {
    const state = this.state;
    if (!state) return;
    const ids = state.byPlace.get(id) ?? [];
    this.selection.set({
      kind: 'place',
      id,
      title,
      rows: ids.map((personId) => this.rowFor(personId)).filter((row): row is PeopleRow => !!row),
      notes: this.notesForPlace(id),
    });
  }

  private fillParty(id: string): void {
    const state = this.state;
    if (!state) return;
    const party = state.parties.get(id) ?? [...state.parties.values()].find((row) => row.mapEntityId === id);
    if (!party) return;
    this.selection.set({
      kind: 'party',
      id: party.id,
      title: partyLabel(party.purpose, party.id),
      rows: party.memberIds.map((memberId) => this.rowFor(memberId)).filter((row): row is PeopleRow => !!row),
      notes: [
        party.route?.viaRoad ? `Road ${party.route.from} → ${party.route.to}` : party.purpose,
        `Purse ${party.moneyHeld}c`,
      ],
    });
  }

  private fillCamp(id: string): void {
    const state = this.state;
    if (!state) return;
    const camp = state.camps.get(id);
    if (!camp) return;
    const days = Math.max(0, (camp.expiresAtHours - state.clockHours) / 24);
    this.selection.set({
      kind: 'camp',
      id,
      title: camp.kind === 'wagon-circle' ? 'Wagon circle' : 'Camp',
      rows: camp.memberIds.map((personId) => this.rowFor(personId)).filter((row): row is PeopleRow => !!row),
      notes: [`${days.toFixed(0)} days left`, `${camp.memberIds.length} members`],
    });
  }

  private rowFor(id: string): PeopleRow | null {
    const state = this.state;
    if (!state) return null;
    const person = state.people.get(id);
    if (person) {
      return {
        id: person.id,
        name: person.name,
        role: person.role,
        money: person.money,
        stub: false,
        home: homeLabel(person.home, state),
      };
    }
    const stub = state.stubs.get(id);
    if (!stub || stub.promotedId) {
      if (stub?.promotedId) return this.rowFor(stub.promotedId);
      return null;
    }
    return {
      id: stub.id,
      name: `${stub.archetype} stub`,
      role: stub.archetype,
      money: stub.money,
      stub: true,
      home: 'on the road',
    };
  }

  private notesForPlace(id: string): string[] {
    const state = this.state;
    if (!state) return [];
    const treasury = state.wallets.towns[id] ?? 0;
    return [`Treasury ${treasury}c`];
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  private formatHours(hours: number): string {
    const day = Math.floor(hours / 24) + 1;
    const h = Math.floor(hours % 24);
    const m = Math.floor((hours % 1) * 60);
    return `day ${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

function partyLabel(purpose: string, id: string): string {
  if (purpose === 'merchant') return 'Caravan';
  if (purpose === 'army') return 'Host';
  if (purpose === 'bandit') return 'Bandits';
  if (purpose === 'relocating') return 'Relocating';
  if (purpose === 'lone') return 'Traveler';
  return id;
}

function homeLabel(home: Home, state: PeopleState): string {
  if (home.kind === 'town') return state.places.find((place) => place.id === home.placeId)?.name ?? home.placeId;
  if (home.kind === 'camp') return state.camps.get(home.campId)?.kind === 'wagon-circle' ? 'wagon circle' : 'camp';
  if (home.kind === 'poi') return home.poiId;
  return 'no home';
}
