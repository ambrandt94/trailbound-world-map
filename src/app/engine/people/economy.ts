import { pushHistory, pushLedger } from './ledger';
import type { PeopleState, PlaceSeed } from './types';
import { SPEND_OF_WAGE, TAX_OF_WAGE, wageFor } from './types';

/** One game-day of wages, spending, tax, and caravan trade. Integer copper only. */
export function applyEconomy(state: PeopleState, dayIndex: number, places: PlaceSeed[], t: number): void {
  for (const place of places) {
    let wages = 0;
    let spent = 0;
    let tax = 0;
    const ids = state.byPlace.get(place.id) ?? [];
    for (const id of ids) {
      const person = state.people.get(id);
      if (!person || person.home.kind !== 'town' || person.home.placeId !== place.id) continue;
      if (person.location.kind !== 'at-home') continue;
      const wage = wageFor(person.role);
      const treasury = state.wallets.towns[place.id] ?? 0;
      const paid = Math.min(wage, Math.max(0, treasury));
      const taxPart = Math.floor(paid * TAX_OF_WAGE);
      const spendPart = Math.floor(paid * SPEND_OF_WAGE);
      const net = paid - taxPart - spendPart;
      person.money += net;
      state.wallets.towns[place.id] = treasury - paid + spendPart;
      state.wallets.crown += taxPart;
      wages += paid;
      spent += spendPart;
      tax += taxPart;
      if (paid > 0) {
        pushHistory(person, {
          t,
          type: 'wage',
          amount: net,
          note: `wage ${paid}, spent ${spendPart}, tax ${taxPart}`,
        });
      }
    }
    if (wages > 0) pushLedger(state, { t, type: 'wage', amount: wages, placeId: place.id, note: 'town wages' });
    if (spent > 0) pushLedger(state, { t, type: 'spend', amount: spent, placeId: place.id, note: 'household spending' });
    if (tax > 0) pushLedger(state, { t, type: 'tax', amount: tax, placeId: place.id, note: 'tax to the crown' });
  }
  for (const party of state.parties.values()) {
    if (party.purpose !== 'merchant' || !party.route?.viaRoad) continue;
    const dest = party.route.to;
    if (dest === 'wild') continue;
    const treasury = state.wallets.towns[dest];
    if (treasury === undefined) continue;
    const qty = 8 + ((party.seed + dayIndex * 17) >>> 0) % 13;
    const selling = ((party.seed + dayIndex) & 1) === 0;
    const paid = selling ? Math.min(qty, party.moneyHeld) : Math.min(qty, Math.max(0, treasury));
    if (paid <= 0) continue;
    if (selling) {
      party.moneyHeld -= paid;
      state.wallets.towns[dest] = treasury + paid;
    } else {
      party.moneyHeld += paid;
      state.wallets.towns[dest] = treasury - paid;
    }
    pushLedger(state, {
      t,
      type: 'trade',
      amount: paid,
      partyId: party.id,
      placeId: dest,
      note: selling ? 'caravan sold to town' : 'town bought from caravan',
    });
  }
}
