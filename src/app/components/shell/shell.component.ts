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
  ],
  template: `
    <mat-toolbar class="topbar">
      <div class="brand">
        <mat-icon class="brand-icon">public</mat-icon>
        <div>
          <div class="title">Trailbound World Map</div>
          <div class="subtitle">Continent map · zoom out to globe</div>
        </div>
      </div>
      <span class="spacer"></span>
      <button
        mat-stroked-button
        type="button"
        [class.active]="world.showOutlines()"
        (click)="world.toggleOutlines()"
        matTooltip="Toggle region outlines. Hover always shows them."
      >
        <mat-icon>{{ world.showOutlines() ? 'visibility' : 'visibility_off' }}</mat-icon>
        Node areas
      </button>
      <button
        mat-stroked-button
        type="button"
        [class.active]="world.showPois()"
        (click)="world.togglePois()"
        matTooltip="Author view of hidden points of interest. Players will not see these."
      >
        <mat-icon>{{ world.showPois() ? 'place' : 'location_off' }}</mat-icon>
        POIs
      </button>
      <div class="time-group">
        <button
          mat-icon-button
          type="button"
          [class.active]="world.simMode() === 'paused'"
          (click)="world.setSimMode('paused')"
          matTooltip="Pause the world clock"
        >
          <mat-icon>pause</mat-icon>
        </button>
        <button
          mat-icon-button
          type="button"
          [class.active]="world.simMode() === 'play'"
          (click)="world.setSimMode('play')"
          matTooltip="Play at live speed"
        >
          <mat-icon>play_arrow</mat-icon>
        </button>
        <button
          mat-icon-button
          type="button"
          [class.active]="world.simMode() === 'fast'"
          (click)="world.setSimMode('fast')"
          matTooltip="Fast forward (8×)"
        >
          <mat-icon>fast_forward</mat-icon>
        </button>
        <button
          mat-icon-button
          type="button"
          [class.active]="world.simMode() === 'sync'"
          (click)="world.setSimMode('sync')"
          matTooltip="Synchronized: others move when you do. Space waits a turn."
        >
          <mat-icon>sync</mat-icon>
        </button>
      </div>
      <button mat-stroked-button type="button" (click)="map()?.recenter()" matTooltip="Follow the walker">
        <mat-icon>my_location</mat-icon>
        Recenter
      </button>
      <button mat-stroked-button type="button" (click)="map()?.zoomBy(1 / 1.55)" matTooltip="Zoom out">
        <mat-icon>zoom_out</mat-icon>
      </button>
      <button mat-stroked-button type="button" (click)="map()?.zoomBy(1.55)" matTooltip="Zoom in">
        <mat-icon>zoom_in</mat-icon>
      </button>
      <button
        mat-stroked-button
        type="button"
        (click)="reshuffle()"
        matTooltip="Generate a new kingdom (keeps this seed's saved places until you clear them)"
      >
        <mat-icon>restart_alt</mat-icon>
        New seed
      </button>
      <button mat-stroked-button type="button" (click)="clearGenerated()" matTooltip="Forget discovered places and baked detail tiles">
        <mat-icon>layers_clear</mat-icon>
        Clear detail
      </button>
      <button
        mat-icon-button
        type="button"
        class="theme-toggle"
        [class.active]="settingsOpen() || prefs.adventureMode()"
        [matTooltip]="settingsOpen() ? 'Close settings' : 'Settings'"
        (click)="toggleSettings()"
      >
        <mat-icon>settings</mat-icon>
      </button>
      <button
        mat-icon-button
        type="button"
        class="theme-toggle"
        [matTooltip]="prefs.isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
        (click)="prefs.toggleTheme()"
      >
        <mat-icon>{{ prefs.isDark() ? 'light_mode' : 'dark_mode' }}</mat-icon>
      </button>
    </mat-toolbar>

    <div class="layout">
      <app-map-viewport />
      <div class="overlay">
        @if (settingsOpen()) {
          <app-settings-panel (adventureOff)="map()?.leaveAdventure()" />
        }
        <app-world-setup (rebuilt)="onRebuild($event)" />
        <app-location-panel />
        <p class="hint">
          Scroll to zoom · drag to pan · WASD to walk · click a traveler to zoom in
          @if (world.simMode() === 'sync') {
            · Space waits a turn
          }
          @if (prefs.adventureMode()) {
            · Adventure: walk an edge to generate (same zoom); overworld zoom-in still asks
          }
        </p>
      </div>
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
      min-height: 4.25rem;
      padding: 0.65rem 1rem;
      background: color-mix(in srgb, var(--tb-panel) 92%, transparent);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      color: var(--tb-ink);
      gap: 0.45rem;
      flex-wrap: wrap;
      height: auto;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      min-width: 14rem;
    }
    .brand-icon {
      color: var(--tb-accent-strong);
    }
    .title {
      font-weight: 700;
      line-height: 1.1;
    }
    .subtitle {
      font-size: 0.75rem;
      color: var(--tb-muted);
    }
    .spacer {
      flex: 1;
    }
    .topbar button {
      text-transform: none;
    }
    .topbar button.active {
      background: color-mix(in srgb, var(--tb-accent) 18%, transparent);
      border-color: var(--tb-accent-strong);
    }
    .time-group {
      display: flex;
      align-items: center;
      gap: 0.05rem;
      padding: 0.1rem 0.2rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      background: color-mix(in srgb, var(--tb-panel) 70%, transparent);
    }
    .time-group button {
      color: var(--tb-ink);
    }
    .theme-toggle {
      color: var(--tb-ink);
    }
    .layout {
      position: relative;
      flex: 1;
      min-height: 0;
      padding: 1rem;
      box-sizing: border-box;
    }
    app-map-viewport {
      display: block;
      height: 100%;
    }
    .overlay {
      position: absolute;
      top: 1.85rem;
      right: 1.85rem;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.75rem;
      pointer-events: none;
    }
    app-location-panel,
    app-world-setup,
    app-settings-panel {
      pointer-events: auto;
    }
    .hint {
      margin: 0;
      max-width: 18.5rem;
      text-align: right;
      font-size: 0.75rem;
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

  toggleSettings(): void {
    this.settingsOpen.update((open) => !open);
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
