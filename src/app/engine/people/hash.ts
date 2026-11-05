const GIVEN = [
  'Wren', 'Bram', 'Pip', 'Oats', 'Lark', 'Nettle', 'Rowan', 'Ash', 'Moss', 'Briar',
  'Sedge', 'Otter', 'Hare', 'Fox', 'Dusk', 'Thorn', 'Elara', 'Kael', 'Borin', 'Sylva',
  'Gareth', 'Mira', 'Torin', 'Nyx', 'Aldric', 'Vera', 'Grim', 'Liora', 'Ida', 'Colm',
];

const FAMILY = [
  'Ash', 'Rowan', 'Moss', 'Briar', 'Thorn', 'Hale', 'Marsh', 'Keel', 'Voss', 'Quinn',
  'Hart', 'Bramble', 'Cairn', 'Dunn', 'Ell', 'Fenn', 'Grey', 'Holt', 'Ives', 'Joss',
];

export function mix32(a: number, b = 0, c = 0): number {
  let h = (a >>> 0) ^ Math.imul(b >>> 0, 0x9e3779b1) ^ Math.imul(c >>> 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function travellerSeed(worldSeed: number, partyId: string, slot: number): number {
  return mix32(worldSeed, hashString(partyId), slot + 1) || 1;
}

export function nameFromSeed(seed: number): string {
  const given = GIVEN[seed % GIVEN.length] ?? 'Ash';
  const family = FAMILY[(seed >>> 8) % FAMILY.length] ?? 'Holt';
  return `${given} ${family}`;
}

export function roleAt(mix: ReadonlyArray<{ role: string; w: number }>, seed: number): string {
  if (!mix.length) return 'laborer';
  let ticket = seed % 1000;
  for (const row of mix) {
    const span = Math.max(0, Math.round(row.w * 1000));
    if (ticket < span) return row.role;
    ticket -= span;
  }
  return mix[mix.length - 1]!.role;
}

/** Seeded opinion of home when the detail blob has no opinion rows yet. */
export function defaultOpinion(seed: number): number {
  return (seed % 81) - 40;
}

export function startingPurse(role: string, seed: number): number {
  const wage = role === 'bandit' ? 8 : role === 'merchant' ? 18 : 12;
  const base = role === 'noble' ? 80 : wage * 4;
  return Math.max(0, base + ((seed % 9) - 4));
}
