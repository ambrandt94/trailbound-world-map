import { Component, inject, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PreferencesService } from '../../services/preferences.service';
import { WorldService } from '../../services/world.service';
import { WorldSettings } from '../../models/world.models';
import { LocationPanelComponent } from '../location-panel/location-panel.component';
import { MapViewportComponent } from '../map-viewport/map-viewport.component';
import { SettingsPanelComponent } from '../settings-panel/settings-panel.component';
import { WorldSetupComponent } from '../world-setup/world-setup.component';
import { HeroPickerComponent } from '../hero-picker/hero-picker.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MapViewportComponent,
    LocationPanelComponent,
    WorldSetupComponent,
    SettingsPanelComponent,
    HeroPickerComponent,
  ],
  template: `
    <mat-toolbar class="topbar">
      <div class="brand">
        <mat-icon class="brand-icon">public</mat-icon>
        <div class="title">World Map</div>
      </div>
      <span class="spacer"></span>
      <div class="time-group" role="group" aria-label="World clock">
        <button
          mat-icon-button
          type="button"
          [class.active]="world.simMode() === 'paused'"
          (click)="world.setSimMode('paused')"
          matTooltip="Pause"
        >
          <mat-icon>pause</mat-icon>
        </button>
        <button
          mat-icon-button
          type="button"
          [class.active]="world.simMode() === 'play'"
          (click)="world.setSimMode('play')"
          matTooltip="Play (slow)"
        >
          <mat-icon>play_arrow</mat-icon>
        </button>
        <button
          mat-icon-button
          type="button"
          [class.active]="world.simMode() === 'fast'"
          (click)="world.setSimMode('fast')"
          matTooltip="Fast"
        >
          <mat-icon>fast_forward</mat-icon>
        </button>
        <button
          mat-icon-button
          type="button"
          [class.active]="world.simMode() === 'fastest'"
          (click)="world.setSimMode('fastest')"
          matTooltip="Fastest"
        >
          <mat-icon>speed</mat-icon>
        </button>
        <button
          mat-icon-button
          type="button"
          [class.active]="world.simMode() === 'sync'"
          (click)="world.setSimMode('sync')"
          matTooltip="Sync · Space waits a turn"
        >
          <mat-icon>sync</mat-icon>
        </button>
      </div>
      <div class="nav-group" role="group" aria-label="Camera">
        <button mat-icon-button type="button" (click)="map()?.recenter()" [matTooltip]="prefs.adventureMode() ? 'Follow walker' : 'Recenter'">
          <mat-icon>my_location</mat-icon>
        </button>
        <button mat-icon-button type="button" (click)="map()?.zoomBy(1 / 1.55)" matTooltip="Zoom out">
          <mat-icon>zoom_out</mat-icon>
        </button>
        <div class="zoom-chip" [matTooltip]="world.location().scaleLabel + ' · ' + world.location().scale.toFixed(2) + '×'">
          <span class="zoom-chip-band">{{ world.location().scaleLabel }}</span>
          <span class="zoom-chip-mult tb-mono">{{ world.location().scale.toFixed(2) }}×</span>
        </div>
        <button mat-icon-button type="button" (click)="map()?.zoomBy(1.55)" matTooltip="Zoom in">
          <mat-icon>zoom_in</mat-icon>
        </button>
      </div>
      <button
        mat-flat-button
        type="button"
        color="primary"
        class="adventure-btn"
        (click)="openAdventure()"
        matTooltip="Remake the map and dive in at Close (32×)"
      >
        <mat-icon>directions_walk</mat-icon>
        Adventure
      </button>
      <button
        mat-icon-button
        type="button"
        class="chrome-btn"
        [class.active]="settingsOpen()"
        [matTooltip]="settingsOpen() ? 'Close settings' : 'Settings'"
        (click)="toggleSettings()"
      >
        <mat-icon>settings</mat-icon>
      </button>
      <button
        mat-icon-button
        type="button"
        class="chrome-btn"
        [matTooltip]="prefs.isDark() ? 'Light mode' : 'Dark mode'"
        (click)="prefs.toggleTheme()"
      >
        <mat-icon>{{ prefs.isDark() ? 'light_mode' : 'dark_mode' }}</mat-icon>
      </button>
    </mat-toolbar>

    <div class="layout">
      <app-map-viewport />
      <div class="overlay">
        @if (settingsOpen()) {
          <app-settings-panel
            (adventureOff)="map()?.leaveAdventure()"
            (clearDetail)="clearGenerated()"
            (newSeed)="reshuffle()"
          />
        }
        <app-world-setup (rebuilt)="onRebuild($event)" />
        <app-location-panel />
        <p class="hint">
          Scroll · drag
          @if (prefs.adventureMode()) {
            · WASD · Shift sprint
          }
          @if (world.simMode() === 'sync') {
            · Space waits
          }
        </p>
      </div>
      @if (heroOpen()) {
        <app-hero-picker (cancel)="heroOpen.set(false)" (embarked)="startAdventure($event)" />
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 4;
      min-height: 3.35rem;
      padding: 0.4rem 0.85rem;
      background: color-mix(in srgb, var(--tb-panel) 92%, transparent);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      color: var(--tb-ink);
      gap: 0.4rem;
      flex-wrap: wrap;
      height: auto;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }
    .brand-icon {
      color: var(--tb-accent-strong);
      font-size: 1.35rem;
      width: 1.35rem;
      height: 1.35rem;
    }
    .title {
      font-weight: 700;
      font-size: 0.98rem;
      letter-spacing: 0.01em;
      line-height: 1;
    }
    .spacer {
      flex: 1;
    }
    .topbar button {
      text-transform: none;
    }
    .topbar button.active {
      background: color-mix(in srgb, var(--tb-accent) 18%, transparent);
      color: var(--tb-accent-strong);
    }
    .time-group,
    .nav-group {
      display: flex;
      align-items: center;
      gap: 0.05rem;
      padding: 0.08rem 0.18rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      background: color-mix(in srgb, var(--tb-bg) 55%, transparent);
    }
    .time-group button,
    .nav-group button,
    .chrome-btn {
      color: var(--tb-ink);
    }
    .zoom-chip {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 4.2rem;
      padding: 0.1rem 0.45rem;
      line-height: 1.1;
    }
    .zoom-chip-band {
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tb-accent-strong);
    }
    .zoom-chip-mult {
      font-size: 0.72rem;
      color: var(--tb-muted);
    }
    .adventure-btn {
      padding: 0 0.9rem;
    }
    .adventure-btn mat-icon {
      margin-right: 0.15rem;
    }
    .layout {
      position: relative;
      z-index: 0;
      flex: 1;
      min-height: 0;
      padding: 0.75rem;
      box-sizing: border-box;
    }
    app-map-viewport {
      position: relative;
      z-index: 0;
      display: block;
      height: 100%;
    }
    .overlay {
      position: absolute;
      z-index: 2;
      top: 1.35rem;
      right: 1.35rem;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.55rem;
      width: max-content;
      max-width: min(20rem, calc(100% - 2rem));
      max-height: calc(100% - 2.5rem);
      overflow: auto;
      pointer-events: none;
    }
    app-location-panel,
    app-world-setup,
    app-settings-panel {
      pointer-events: auto;
    }
    app-hero-picker {
      position: absolute;
      inset: 0;
      z-index: 6;
      pointer-events: auto;
    }
    .hint {
      margin: 0;
      max-width: 16rem;
      text-align: right;
      font-size: 0.7rem;
      color: var(--tb-muted);
      text-shadow: 0 1px 8px rgba(0, 0, 0, 0.45);
    }
  `,
})
export class ShellComponent {
  readonly prefs = inject(PreferencesService);
  readonly world = inject(WorldService);
  readonly map = viewChild(MapViewportComponent);
  readonly settingsOpen = signal(false);
  readonly heroOpen = signal(false);

  toggleSettings(): void {
    this.settingsOpen.update((open) => !open);
  }

  openAdventure(): void {
    this.heroOpen.set(true);
  }

  startAdventure(hero: { name: string; sheet: string; char: number }): void {
    this.heroOpen.set(false);
    this.world.applyHero(hero.name, hero.sheet, hero.char);
    this.prefs.setAdventureMode(true);
    this.onRebuild({ settings: this.world.settings(), newSeed: true });
  }

  reshuffle(): void {
    this.onRebuild({ settings: this.world.settings(), newSeed: true });
  }

  clearGenerated(): void {
    this.world.clearGenerated();
    this.map()?.clearStreamed();
  }

  onRebuild(event: { settings: WorldSettings; newSeed: boolean }): void {
    this.world.generating.set(true);
    window.setTimeout(() => {
      this.world.applySettings(event.settings);
      const seed = event.newSeed ? (this.world.currentSeed * 1103515245 + 12345) >>> 0 : this.world.currentSeed;
      this.world.rebuild(seed);
      this.map()?.reloadFromWorld();
      this.world.generating.set(false);
    }, 40);
  }
}
