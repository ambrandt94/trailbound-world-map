import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'tb-world-map-theme';
const ADVENTURE_KEY = 'tb-world-map-adventure';
const ADJACENT_KEY = 'tb-world-map-adventure-adjacent';

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  readonly theme = signal<ThemeMode>(this.readStoredTheme());
  readonly isDark = computed(() => this.theme() === 'dark');
  readonly adventureMode = signal(this.readAdventure());
  readonly adventureLinkNeighbors = signal(this.readAdjacent());

  constructor() {
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
  }

  toggleTheme(): void {
    this.theme.update((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  setAdventureMode(on: boolean): void {
    this.adventureMode.set(on);
  }

  setAdventureLinkNeighbors(on: boolean): void {
    this.adventureLinkNeighbors.set(on);
  }

  private readStoredTheme(): ThemeMode {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return 'dark';
  }

  private readAdventure(): boolean {
    return localStorage.getItem(ADVENTURE_KEY) === '1';
  }

  private readAdjacent(): boolean {
    return localStorage.getItem(ADJACENT_KEY) === '1';
  }
}
