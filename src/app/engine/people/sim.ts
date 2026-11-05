import { applyEconomy } from './economy';
import { arriveDue, decayCamps, moveRelocating, rollRelocations } from './relocate';
import type { PeopleState, PlaceSeed } from './types';

/** Closed-form catch-up. Wages and relocation rolls land on each midnight. */
export function advanceHours(state: PeopleState, hours: number, places: PlaceSeed[]): void {
  if (!(hours > 0)) return;
  const end = state.clockHours + hours;
  let cursor = state.clockHours;
  let guard = 0;
  while (cursor < end && guard < 4000) {
    guard += 1;
    const midnight = (Math.floor(cursor / 24) + 1) * 24;
    const slice = Math.min(end, midnight);
    state.clockHours = slice;
    arriveDue(state, slice);
    moveRelocating(state, slice);
    if (slice === midnight && midnight <= end) {
      const dayIndex = Math.floor(cursor / 24);
      applyEconomy(state, dayIndex, places, midnight);
      rollRelocations(state, dayIndex, places, undefined, midnight);
      decayCamps(state, midnight);
    }
    cursor = slice;
  }
  state.clockHours = end;
  arriveDue(state, end);
  moveRelocating(state, end);
  decayCamps(state, end);
}
