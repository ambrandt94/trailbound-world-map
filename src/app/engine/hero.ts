import { CHAR_SHEET_URLS } from './assets';
import { Facing, PlayerState } from '../models/world.models';

/** Local walker id. Hosted sessions can mint other ids later without changing look fields. */
export const LOCAL_PLAYER_ID = 'local';

export type HeroGroup = 'people' | 'folk' | 'arms' | 'beasts';

export interface HeroLook {
  key: string;
  sheet: string;
  char: number;
  group: HeroGroup;
  url: string;
}

export const HERO_GROUPS: Array<{ id: HeroGroup; label: string }> = [
  { id: 'people', label: 'People' },
  { id: 'folk', label: 'Folk' },
  { id: 'arms', label: 'Arms' },
  { id: 'beasts', label: 'Beasts' },
];

const SHEETS: Array<{ sheet: string; group: HeroGroup; n?: number }> = [
  { sheet: 'townsfolk', group: 'people' },
  { sheet: 'farmer', group: 'people' },
  { sheet: 'household', group: 'people' },
  { sheet: 'elder', group: 'people' },
  { sheet: 'bard', group: 'people' },
  { sheet: 'blacksmith', group: 'people' },
  { sheet: 'children', group: 'people' },
  { sheet: 'dwarf1', group: 'folk' },
  { sheet: 'dwarf2', group: 'folk' },
  { sheet: 'elf1', group: 'folk' },
  { sheet: 'elf2', group: 'folk' },
  { sheet: 'knights', group: 'arms' },
  { sheet: 'knights2', group: 'arms' },
  { sheet: 'executioner', group: 'arms' },
  { sheet: 'animals1', group: 'beasts' },
  { sheet: 'animals2', group: 'beasts' },
  { sheet: 'animals5', group: 'beasts' },
  { sheet: 'horse1', group: 'beasts' },
];

export const HERO_LOOKS: HeroLook[] = SHEETS.flatMap(({ sheet, group, n = 8 }) => {
  const url = CHAR_SHEET_URLS[sheet];
  if (!url) return [];
  return Array.from({ length: n }, (_, char) => ({
    key: `${sheet}:${char}`,
    sheet,
    char,
    group,
    url,
  }));
});

export const DEFAULT_HERO_LOOK = HERO_LOOKS[0]!;
export const DEFAULT_HERO_NAME = 'Wren';

export function heroLookKey(sheet: string, char: number): string {
  return `${sheet}:${char}`;
}

export function findHeroLook(sheet: string, char: number): HeroLook {
  return HERO_LOOKS.find((l) => l.sheet === sheet && l.char === char) ?? DEFAULT_HERO_LOOK;
}

/** CSS crop of the idle-down frame on a 4×2 Time Fantasy sheet. */
export function heroPortraitStyle(look: { url: string; char: number }): Record<string, string> {
  const col = (look.char % 4) * 3 + 1;
  const row = Math.floor(look.char / 4) * 4;
  return {
    'background-image': `url(${look.url})`,
    'background-size': '1200% 800%',
    'background-position': `${(col / 11) * 100}% ${(row / 7) * 100}%`,
    'background-repeat': 'no-repeat',
    'image-rendering': 'pixelated',
  };
}

export function clampHeroName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
  return name || DEFAULT_HERO_NAME;
}

export function defaultPlayerState(pos: { x: number; y: number } = { x: 80, y: 80 }): PlayerState {
  return {
    id: LOCAL_PLAYER_ID,
    name: DEFAULT_HERO_NAME,
    x: pos.x,
    y: pos.y,
    facing: 0 as Facing,
    frame: 1,
    anim: 0,
    sheet: DEFAULT_HERO_LOOK.sheet,
    char: DEFAULT_HERO_LOOK.char,
  };
}
