import type { Home, LedgerEvent, LedgerType, Motive, PeopleState, PersonCore } from './types';

export function pushLedger(
  state: PeopleState,
  row: Omit<LedgerEvent, 'id'> & { type: LedgerType },
): LedgerEvent {
  const event: LedgerEvent = { ...row, id: state.nextLedgerId++ };
  state.ledger.push(event);
  if (state.ledger.length > 4000) state.ledger.splice(0, state.ledger.length - 4000);
  return event;
}

export function pushHistory(person: PersonCore, row: { t: number; type: string; note: string; amount?: number }): void {
  person.history.push(row);
  if (person.history.length > 8) person.history.splice(0, person.history.length - 8);
}

export function rememberMove(
  state: PeopleState,
  person: PersonCore,
  t: number,
  motive: Motive,
  from: Home,
  to: Home,
  campId?: string,
): void {
  pushLedger(state, {
    t,
    type: 'relocate',
    personId: person.id,
    motive,
    from,
    to,
    campId,
    note: `${motive} · ${from.kind} → ${to.kind}`,
  });
  pushHistory(person, { t, type: 'relocate', note: `${motive}: ${from.kind} → ${to.kind}` });
}
