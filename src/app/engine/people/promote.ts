import { nameFromSeed } from './hash';
import { pushHistory, pushLedger } from './ledger';
import type { PeopleState, PersonCore, PersonDetail } from './types';
import { emptyDetail } from './types';

export interface Promotion {
  core: PersonCore;
  detail: PersonDetail;
}

/** Turn an archetype stub into a full person. The same seed always yields the same person. */
export function promoteStub(state: PeopleState, stubId: string): Promotion {
  const stub = state.stubs.get(stubId);
  if (!stub) throw new Error(`unknown stub ${stubId}`);
  if (stub.promotedId) {
    const existing = state.people.get(stub.promotedId);
    if (!existing) throw new Error(`promoted person ${stub.promotedId} is missing`);
    return { core: existing, detail: emptyDetail(existing.id) };
  }
  const id = `person:trav:${stub.seed}`;
  const purse = stub.money;
  const core: PersonCore = {
    schema: 1,
    id,
    seed: stub.seed,
    name: nameFromSeed(stub.seed),
    role: stub.archetype,
    home: { kind: 'none' },
    location: { kind: 'in-party', partyId: stub.partyId },
    money: purse,
    goal: { kind: 'travel' },
    history: [],
  };
  state.people.set(id, core);
  stub.promotedId = id;
  stub.money = 0;
  const party = state.parties.get(stub.partyId);
  if (party) {
    party.memberIds = party.memberIds.map((member) => (member === stub.id ? id : member));
  }
  const detail = emptyDetail(id);
  pushLedger(state, {
    t: state.clockHours,
    type: 'promote',
    personId: id,
    partyId: stub.partyId,
    amount: purse,
    note: `${stub.archetype} promoted`,
  });
  pushHistory(core, { t: state.clockHours, type: 'promote', note: `Promoted from ${stub.archetype}`, amount: purse });
  return { core, detail };
}
