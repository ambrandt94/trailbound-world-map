import { Component, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PreferencesService } from '../../services/preferences.service';
import { RoomService } from '../../services/room.service';
import { WorldService } from '../../services/world.service';
import { WorldSettings } from '../../models/world.models';
import { LocationPanelComponent } from '../location-panel/location-panel.component';
import { MapViewportComponent } from '../map-viewport/map-viewport.component';
import { SettingsPanelComponent } from '../settings-panel/settings-panel.component';
import { WorldSetupComponent } from '../world-setup/world-setup.component';
import { HeroPickerComponent } from '../hero-picker/hero-picker.component';
import { RoomPanelComponent } from '../room-panel/room-panel.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    FormsModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatInputModule,
    MapViewportComponent,
    LocationPanelComponent,
    WorldSetupComponent,
    SettingsPanelComponent,
    HeroPickerComponent,
    RoomPanelComponent,
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
        <button
          mat-icon-button
          type="button"
          (click)="map()?.recenter()"
          [matTooltip]="prefs.adventureMode() ? 'Focus on me · Close (32×)' : 'Recenter'"
        >
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
      @if (room.connected() && room.pin()) {
        <button
          type="button"
          class="pin-chip tb-mono"
          [matTooltip]="room.isHost() ? 'Your lobby PIN — click to copy' : 'Joined lobby PIN — click to copy'"
          (click)="copyPin()"
        >
          PIN {{ room.pin() }}
        </button>
      }
      <button
        mat-stroked-button
        type="button"
        class="room-btn"
        [class.active]="roomOpen() || room.connected()"
        (click)="openRoom()"
        [matTooltip]="room.connected() && room.pin() ? 'Lobby PIN ' + room.pin() : 'Create or join a lobby'"
      >
        <mat-icon>group_add</mat-icon>
        @if (room.connected() && room.pin()) {
          {{ room.pin() }}
        } @else {
          Room
        }
      </button>
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
          @if (room.connected()) {
            · Enter chat
          }
        </p>
      </div>
      @if (room.connected()) {
        <form class="chat-bar" (submit)="sendChat($event)">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="chat-field">
            <mat-label>Say something</mat-label>
            <input matInput maxlength="80" [(ngModel)]="chatDraft" name="chat" autocomplete="off" />
          </mat-form-field>
          <button mat-flat-button color="primary" type="submit">Send</button>
        </form>
      }
      @if (heroOpen()) {
        <app-hero-picker
          [mode]="heroMode()"
          (cancel)="onHeroCancel()"
          (embarked)="onHeroEmbarked($event)"
        />
      }
      @if (roomOpen()) {
        <app-room-panel (closed)="roomOpen.set(false)" />
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
    .pin-chip {
      padding: 0.35rem 0.8rem;
      border-radius: 999px;
      font-size: 0.92rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      border: 1px solid color-mix(in srgb, var(--tb-accent-strong) 55%, transparent);
      background: color-mix(in srgb, var(--tb-accent) 24%, transparent);
      color: var(--tb-accent-strong);
      cursor: pointer;
      font-family: Tiny5, 'Press Start 2P', ui-monospace, monospace;
    }
    .pin-chip:hover {
      background: color-mix(in srgb, var(--tb-accent) 34%, transparent);
    }
    .room-btn mat-icon {
      margin-right: 0.15rem;
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
      inset: 0.75rem;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.65rem;
      pointer-events: none;
    }
    .overlay > * {
      pointer-events: auto;
    }
    .hint {
      margin: 0;
      max-width: 16rem;
      text-align: right;
      font-size: 0.7rem;
      color: var(--tb-muted);
      text-shadow: 0 1px 8px rgba(0, 0, 0, 0.45);
      pointer-events: none;
    }
    .chat-bar {
      position: absolute;
      left: 50%;
      bottom: 1.1rem;
      transform: translateX(-50%);
      z-index: 5;
      display: flex;
      gap: 0.45rem;
      align-items: center;
      width: min(28rem, calc(100% - 2rem));
      padding: 0.45rem 0.55rem;
      border-radius: 12px;
      background: color-mix(in srgb, var(--tb-panel) 92%, transparent);
      backdrop-filter: blur(10px);
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      box-shadow: 0 10px 28px color-mix(in srgb, black 22%, transparent);
      pointer-events: auto;
      font-family: Tiny5, 'Press Start 2P', ui-monospace, monospace;
      font-size: 1.05rem;
      letter-spacing: 0.04em;
    }
    .chat-field {
      flex: 1;
      margin: 0;
      --mat-form-field-container-text-font: Tiny5, 'Press Start 2P', ui-monospace, monospace;
      --mat-form-field-outlined-label-text-font: Tiny5, 'Press Start 2P', ui-monospace, monospace;
      --mat-form-field-subscript-text-font: Tiny5, 'Press Start 2P', ui-monospace, monospace;
    }
    .chat-field input {
      font-family: Tiny5, 'Press Start 2P', ui-monospace, monospace;
      font-size: 1.05rem;
      letter-spacing: 0.04em;
    }
    .chat-bar button {
      text-transform: none;
      flex-shrink: 0;
      font-family: Tiny5, 'Press Start 2P', ui-monospace, monospace;
      font-size: 1rem;
      letter-spacing: 0.05em;
      min-height: 2.4rem;
      padding: 0 0.85rem;
    }
  `,
})
export class ShellComponent {
  readonly prefs = inject(PreferencesService);
  readonly world = inject(WorldService);
  readonly room = inject(RoomService);
  readonly map = viewChild(MapViewportComponent);
  readonly settingsOpen = signal(false);
  readonly heroOpen = signal(false);
  readonly heroMode = signal<'adventure' | 'room'>('adventure');
  readonly roomOpen = signal(false);
  chatDraft = '';

  constructor() {
    effect(() => {
      const rev = this.room.worldSyncRev();
      if (rev <= 0) return;
      queueMicrotask(() => this.map()?.reloadFromWorld());
    });
    effect(() => {
      if (!this.room.needsHero()) return;
      this.roomOpen.set(false);
      this.heroMode.set('room');
      this.heroOpen.set(true);
    });
  }

  toggleSettings(): void {
    this.settingsOpen.update((open) => !open);
  }

  openAdventure(): void {
    this.heroMode.set('adventure');
    this.heroOpen.set(true);
  }

  openRoom(): void {
    this.roomOpen.set(true);
  }

  copyPin(): void {
    const pin = this.room.pin();
    if (!pin) return;
    void navigator.clipboard?.writeText(pin);
  }

  onHeroCancel(): void {
    this.heroOpen.set(false);
    if (this.heroMode() === 'room') {
      void this.room.leave();
    }
  }

  onHeroEmbarked(hero: { name: string; sheet: string; char: number }): void {
    if (this.heroMode() === 'room') {
      this.heroOpen.set(false);
      this.world.applyHero(hero.name, hero.sheet, hero.char);
      this.room.finishHero();
      this.prefs.setAdventureMode(true);
      // Force a full viewport re-init so street chunks match the room's clean seed world.
      this.room.worldSyncRev.update((n) => n + 1);
      return;
    }
    this.startAdventure(hero);
  }

  startAdventure(hero: { name: string; sheet: string; char: number }): void {
    this.heroOpen.set(false);
    this.world.applyHero(hero.name, hero.sheet, hero.char);
    this.prefs.setAdventureMode(true);
    if (this.room.connected()) {
      this.map()?.reloadFromWorld();
      return;
    }
    this.onRebuild({ settings: this.world.settings(), newSeed: true });
  }

  reshuffle(): void {
    if (this.room.connected()) return;
    this.onRebuild({ settings: this.world.settings(), newSeed: true });
  }

  clearGenerated(): void {
    this.world.clearGenerated();
    this.map()?.clearStreamed();
  }

  onRebuild(event: { settings: WorldSettings; newSeed: boolean }): void {
    if (this.room.connected() && event.newSeed) return;
    if (this.room.connected() && !this.room.isHost()) return;
    this.world.generating.set(true);
    window.setTimeout(() => {
      this.world.applySettings(event.settings);
      const seed = event.newSeed ? (this.world.currentSeed * 1103515245 + 12345) >>> 0 : this.world.currentSeed;
      if (this.room.connected()) this.world.rebuildForRoom(seed);
      else this.world.rebuild(seed);
      this.map()?.reloadFromWorld();
      if (this.room.connected() && this.room.isHost()) this.room.republishMeta();
      this.world.generating.set(false);
    }, 40);
  }

  sendChat(event: Event): void {
    event.preventDefault();
    const text = this.chatDraft;
    this.chatDraft = '';
    void this.room.sendMessage(text);
  }
}
