import { Injectable, computed, effect, signal } from '@angular/core';
import { clampHeroName, DEFAULT_HERO_LOOK, DEFAULT_HERO_NAME, findHeroLook } from '../engine/hero';
import { FOG_OF_WAR_ENABLED } from '../models/world.models';

export type ThemeMode = 'light' | 'dark';
export type PlayMode = 'adventure' | 'planet';

const THEME_KEY = 'tb-world-map-theme';
const ADVENTURE_KEY = 'tb-world-map-adventure';
const ADJACENT_KEY = 'tb-world-map-adventure-adjacent';
const PLANET_KEY = 'tb-world-map-planet';
const OVERLAY_KEY = 'tb-world-map-zone-overlay';
const CLOUD_KEY = 'tb-world-map-cloud-cover';
const CLOUD_OK = 'tb-world-map-cloud-cover-ok';
const MARKERS_KEY = 'tb-world-map-world-markers';
const NAMETAG_KEY = 'tb-world-map-nametag-scale';
const CHATTER_KEY = 'tb-world-map-npc-chatter';
const HERO_NAME_KEY = 'tb-world-map-hero-name';
const HERO_SHEET_KEY = 'tb-world-map-hero-sheet';
const HERO_CHAR_KEY = 'tb-world-map-hero-char';
const PREFS_VERSION_KEY = 'tb-world-map-prefs-v';
/** Bump to clear stale gameplay prefs once, then keep persisting new choices. */
const PREFS_VERSION = '10';
const SETUP_KEY = 'tb-world-map-setup';

/** One-shot reset so new defaults (8×, adventure on) replace old saved setup. */
export function migrateWorldMapPrefs(): void {
  try {
    if (localStorage.getItem(PREFS_VERSION_KEY) === PREFS_VERSION) return;
    localStorage.removeItem(ADVENTURE_KEY);
    localStorage.removeItem(ADJACENT_KEY);
    localStorage.removeItem(PLANET_KEY);
    localStorage.removeItem(SETUP_KEY);
    localStorage.removeItem(NAMETAG_KEY);
    localStorage.setItem(PREFS_VERSION_KEY, PREFS_VERSION);
  } catch {
    /* private mode / blocked storage */
  }
}

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  readonly theme = signal<ThemeMode>(this.readStoredTheme());
  readonly isDark = computed(() => this.theme() === 'dark');
  readonly adventureMode = signal(this.readAdventure());
  readonly adventureLinkNeighbors = signal(this.readAdjacent());
  readonly planetView = signal(this.readPlanet());
  /** Adventure (walker / flat) vs planet (globe) — always one or the other. */
  readonly playMode = computed<PlayMode>(() => (this.adventureMode() ? 'adventure' : 'planet'));
  readonly zoneOverlay = signal(this.readOverlay());
  readonly cloudCover = signal(this.readClouds());
  /** Effective cloud alpha — 0 while fog is disabled. */
  readonly fogCover = computed(() => (FOG_OF_WAR_ENABLED ? this.cloudCover() : 0));
  readonly fogEnabled = FOG_OF_WAR_ENABLED;
  /** Always show traveler / caravan / host positions on the map. */
  readonly showWorldMarkers = signal(this.readWorldMarkers());
  /** Size vs the original 10px pixel nametag. Default 1.5. */
  readonly nametagScale = signal(this.readNametagScale());
  readonly npcChatter = signal(this.readNpcChatter());
  readonly heroName = signal(this.readHeroName());
  readonly heroSheet = signal(this.readHeroSheet());
  readonly heroChar = signal(this.readHeroChar());

  constructor() {
    // Collapse any legacy both-on / both-off prefs into a single play mode.
    if (this.adventureMode()) this.planetView.set(false);
    else this.planetView.set(true);

    effect(() => {
      const theme = this.theme();
      document.documentElement.dataset['theme'] = theme;
      document.documentElement.style.colorScheme = theme;
      localStorage.setItem(THEME_KEY, theme);
    });
    effect(() => {
      localStorage.setItem(ADVENTURE_KEY, this.adventureMode() ? '1' : '0');
    });
    effect(() => {
      localStorage.setItem(ADJACENT_KEY, this.adventureLinkNeighbors() ? '1' : '0');
    });
    effect(() => {
      localStorage.setItem(PLANET_KEY, this.planetView() ? '1' : '0');
    });
    effect(() => {
      localStorage.setItem(OVERLAY_KEY, String(this.zoneOverlay()));
    });
    effect(() => {
      localStorage.setItem(CLOUD_KEY, String(this.cloudCover()));
    });
    effect(() => {
      localStorage.setItem(MARKERS_KEY, this.showWorldMarkers() ? '1' : '0');
    });
    effect(() => {
      localStorage.setItem(NAMETAG_KEY, String(this.nametagScale()));
    });
    effect(() => {
      localStorage.setItem(CHATTER_KEY, this.npcChatter() ? '1' : '0');
    });
    effect(() => {
      localStorage.setItem(HERO_NAME_KEY, this.heroName());
    });
    effect(() => {
      localStorage.setItem(HERO_SHEET_KEY, this.heroSheet());
    });
    effect(() => {
      localStorage.setItem(HERO_CHAR_KEY, String(this.heroChar()));
    });
  }

  toggleTheme(): void {
    this.theme.update((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  setPlayMode(mode: PlayMode): void {
    const adventure = mode === 'adventure';
    this.adventureMode.set(adventure);
    this.planetView.set(!adventure);
  }

  setAdventureMode(on: boolean): void {
    this.setPlayMode(on ? 'adventure' : 'planet');
  }

  setAdventureLinkNeighbors(on: boolean): void {
    this.adventureLinkNeighbors.set(on);
  }

  setPlanetView(on: boolean): void {
    this.setPlayMode(on ? 'planet' : 'adventure');
  }

  setZoneOverlay(amt: number): void {
    this.zoneOverlay.set(Math.min(1, Math.max(0, amt)));
  }

  setCloudCover(amt: number): void {
    this.cloudCover.set(Math.min(1, Math.max(0, amt)));
    try {
      localStorage.setItem(CLOUD_OK, '1');
    } catch {
      /* private mode / blocked storage */
    }
  }

  setShowWorldMarkers(on: boolean): void {
    this.showWorldMarkers.set(on);
  }

  setNametagScale(amt: number): void {
    this.nametagScale.set(Math.min(4.5, Math.max(0.5, amt)));
  }

  setNpcChatter(on: boolean): void {
    this.npcChatter.set(on);
  }

  setHero(name: string, sheet: string, char: number): void {
    const look = findHeroLook(sheet, char);
    this.heroName.set(clampHeroName(name));
    this.heroSheet.set(look.sheet);
    this.heroChar.set(look.char);
  }

  private readStoredTheme(): ThemeMode {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return 'dark';
  }

  private readAdventure(): boolean {
    migrateWorldMapPrefs();
    return localStorage.getItem(ADVENTURE_KEY) !== '0';
  }

  private readAdjacent(): boolean {
    migrateWorldMapPrefs();
    return localStorage.getItem(ADJACENT_KEY) === '1';
  }

  private readPlanet(): boolean {
    migrateWorldMapPrefs();
    return localStorage.getItem(PLANET_KEY) !== '0';
  }

  private readOverlay(): number {
    migrateWorldMapPrefs();
    const raw = Number(localStorage.getItem(OVERLAY_KEY));
    if (!Number.isFinite(raw)) return 0.7;
    return Math.min(1, Math.max(0, raw));
  }

  private readClouds(): number {
    migrateWorldMapPrefs();
    const raw = Number(localStorage.getItem(CLOUD_KEY));
    if (!Number.isFinite(raw)) return 0.92;
    if (raw <= 0 && localStorage.getItem(CLOUD_OK) !== '1') return 0.92;
    return Math.min(1, Math.max(0, raw));
  }

  private readWorldMarkers(): boolean {
    migrateWorldMapPrefs();
    return localStorage.getItem(MARKERS_KEY) !== '0';
  }

  private readNametagScale(): number {
    migrateWorldMapPrefs();
    const raw = Number(localStorage.getItem(NAMETAG_KEY));
    if (!Number.isFinite(raw)) return 2.5;
    return Math.min(4.5, Math.max(0.5, raw));
  }

  private readNpcChatter(): boolean {
    migrateWorldMapPrefs();
    return localStorage.getItem(CHATTER_KEY) !== '0';
  }

  private readHeroName(): string {
    migrateWorldMapPrefs();
    return clampHeroName(localStorage.getItem(HERO_NAME_KEY) ?? DEFAULT_HERO_NAME);
  }

  private readHeroSheet(): string {
    migrateWorldMapPrefs();
    const sheet = localStorage.getItem(HERO_SHEET_KEY) ?? DEFAULT_HERO_LOOK.sheet;
    return findHeroLook(sheet, this.readHeroCharRaw()).sheet;
  }

  private readHeroChar(): number {
    return findHeroLook(localStorage.getItem(HERO_SHEET_KEY) ?? DEFAULT_HERO_LOOK.sheet, this.readHeroCharRaw()).char;
  }

  private readHeroCharRaw(): number {
    migrateWorldMapPrefs();
    const n = Number(localStorage.getItem(HERO_CHAR_KEY));
    return Number.isFinite(n) ? n : DEFAULT_HERO_LOOK.char;
  }
}
