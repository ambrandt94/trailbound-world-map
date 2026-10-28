import { Component, AfterViewInit, inject, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ResidentsMode } from '../../models/world.models';
import { PlayMode, PreferencesService } from '../../services/preferences.service';
import { WorldService } from '../../services/world.service';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [MatSlideToggleModule, MatSliderModule, MatButtonModule, MatIconModule, MatChipsModule],
  template: `
    <aside class="panel">
      <div class="eyebrow">Settings</div>

      <div class="section">
        <div class="label">Mode</div>
        <mat-chip-set class="mode-set">
          <mat-chip
            [highlighted]="prefs.playMode() === 'adventure'"
            (click)="setMode('adventure')"
          >
            Adventure
          </mat-chip>
          <mat-chip
            [highlighted]="prefs.playMode() === 'planet'"
            (click)="setMode('planet')"
          >
            Planet
          </mat-chip>
        </mat-chip-set>
        <p class="note">
          Adventure walks the fitted continent. Planet zooms from space on the globe.
        </p>
        @if (prefs.adventureMode()) {
          <mat-slide-toggle
            [checked]="prefs.adventureLinkNeighbors()"
            (change)="prefs.setAdventureLinkNeighbors($event.checked)"
          >
            Load adjacent regions
          </mat-slide-toggle>
        }
      </div>

      <div class="section">
        <div class="label">Residents</div>
        <mat-chip-set class="mode-set">
          <mat-chip
            [highlighted]="world.settings().residentsMode === 'perPlace'"
            (click)="setResidentsMode('perPlace')"
          >
            Per place
          </mat-chip>
          <mat-chip
            [highlighted]="world.settings().residentsMode === 'perHouse'"
            (click)="setResidentsMode('perHouse')"
          >
            Per house
          </mat-chip>
        </mat-chip-set>
        <div class="avg-grid">
          <label>
            Per place
            <input
              type="number"
              min="0"
              max="500"
              step="1"
              [value]="world.settings().avgPerPlace"
              (change)="setResidentAvg('avgPerPlace', $event)"
            />
          </label>
          <label>
            Per house
            <input
              type="number"
              min="0"
              max="20"
              step="0.1"
              [value]="world.settings().avgPerHouse"
              (change)="setResidentAvg('avgPerHouse', $event)"
            />
          </label>
        </div>
        <p class="note">
          Default is 24 people per place. Per house uses 2.5. Each place jitters ±25% from the seed. The 3–8 named residents on the map are separate from the crowd.
        </p>
      </div>

      <div class="section">
        <div class="label">Overlays</div>
        <mat-slide-toggle
          [checked]="world.showOutlines()"
          (change)="world.setOutlines($event.checked)"
        >
          Region outlines
        </mat-slide-toggle>
        <mat-slide-toggle
          [checked]="world.showPois()"
          (change)="world.setPois($event.checked)"
        >
          POI author overlay
        </mat-slide-toggle>
        <mat-slide-toggle
          [checked]="prefs.showWorldMarkers()"
          (change)="prefs.setShowWorldMarkers($event.checked)"
        >
          World markers
        </mat-slide-toggle>
        <mat-slide-toggle
          [checked]="prefs.npcChatter()"
          (change)="prefs.setNpcChatter($event.checked)"
        >
          NPC chatter
        </mat-slide-toggle>
        <mat-slide-toggle
          [checked]="prefs.spriteBuildings()"
          (change)="prefs.setSpriteBuildings($event.checked)"
        >
          Sprite buildings
        </mat-slide-toggle>
        <mat-slide-toggle
          [checked]="prefs.showHeight()"
          (change)="prefs.setShowHeight($event.checked)"
        >
          Height
        </mat-slide-toggle>
        <mat-slide-toggle
          [checked]="prefs.showContours()"
          [disabled]="!prefs.showHeight()"
          (change)="prefs.setShowContours($event.checked)"
        >
          Contour lines
        </mat-slide-toggle>
        <p class="note">Travelers, caravans, and hosts stay visible even off-screen isolation or fog. Chatter is occasional talk about places and people. Sprite buildings swaps tile roofs for the old Town Tale pictures. Height tints the flat map and street zoom; contours are optional.</p>
        <div class="slider-row">
          <span>Zones</span>
          <mat-slider min="0" max="100" step="1" discrete class="overlay-slider">
            <input matSliderThumb [value]="overlayPct()" (input)="onOverlay($any($event.target).value)" />
          </mat-slider>
        </div>
        @if (prefs.fogEnabled) {
          <div class="slider-row">
            <span>Fog</span>
            <mat-slider min="0" max="100" step="1" discrete class="overlay-slider">
              <input matSliderThumb [value]="cloudPct()" (input)="onClouds($any($event.target).value)" />
            </mat-slider>
          </div>
        }
        <div class="slider-row">
          <span>Tags</span>
          <mat-slider min="50" max="450" step="5" discrete class="overlay-slider">
            <input matSliderThumb [value]="tagPct()" (valueChange)="onTags($event)" />
          </mat-slider>
        </div>
      </div>

      <div class="section actions">
        @if (!room.connected() || room.hostControls()) {
          <button mat-stroked-button type="button" (click)="newSeed.emit()" [disabled]="room.connected()">
            <mat-icon>restart_alt</mat-icon>
            New seed
          </button>
          <button mat-stroked-button type="button" (click)="clearDetail.emit()">
            <mat-icon>layers_clear</mat-icon>
            Clear detail
          </button>
        } @else {
          <p class="note">Map rebuild controls stay with the host.</p>
        }
      </div>
    </aside>
  `,
  styles: `
    .panel {
      width: 17.5rem;
      padding: 0.9rem 1rem 1rem;
      border-radius: 14px;
      background: color-mix(in srgb, var(--tb-panel) 92%, transparent);
      backdrop-filter: blur(10px);
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      box-shadow: 0 10px 28px color-mix(in srgb, black 22%, transparent);
    }
    .eyebrow {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tb-accent-strong);
      margin-bottom: 0.65rem;
    }
    .section {
      display: grid;
      gap: 0.55rem;
      padding: 0.65rem 0;
      border-top: 1px solid color-mix(in srgb, var(--tb-ink) 8%, transparent);
    }
    .section:first-of-type {
      border-top: 0;
      padding-top: 0;
    }
    .label {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tb-muted);
      margin-bottom: 0.1rem;
    }
    mat-slide-toggle {
      display: block;
      --mat-slide-toggle-label-text-size: 0.88rem;
    }
    .mode-set {
      margin: 0;
    }
    .mode-set mat-chip {
      cursor: pointer;
    }
    .note {
      margin: 0;
      font-size: 0.72rem;
      line-height: 1.35;
      color: var(--tb-muted);
    }
    .avg-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.45rem;
    }
    .avg-grid label {
      display: grid;
      gap: 0.2rem;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--tb-muted);
    }
    .avg-grid input {
      font: inherit;
      font-weight: 500;
      letter-spacing: 0;
      text-transform: none;
      color: var(--tb-ink);
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--tb-ink) 18%, transparent);
      border-radius: 8px;
      padding: 0.28rem 0.4rem;
      width: 100%;
    }
    .slider-row {
      display: grid;
      grid-template-columns: 3.4rem 1fr;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.78rem;
      color: var(--tb-ink);
    }
    .overlay-slider {
      display: block;
      width: 100%;
      margin: 0;
    }
    .actions {
      grid-template-columns: 1fr 1fr;
      gap: 0.4rem;
    }
    .actions button {
      text-transform: none;
      min-width: 0;
      padding: 0 0.45rem;
      font-size: 0.78rem;
    }
    .actions mat-icon {
      font-size: 1rem;
      width: 1rem;
      height: 1rem;
      margin-right: 0.15rem;
    }
    :host {
      display: block;
    }
    @media (max-width: 800px) {
      .panel {
        width: 100%;
      }
    }
  `,
})
export class SettingsPanelComponent implements AfterViewInit {
  readonly prefs = inject(PreferencesService);
  readonly world = inject(WorldService);
  readonly room = inject(RoomService);
  readonly adventureOff = output<void>();
  readonly clearDetail = output<void>();
  readonly newSeed = output<void>();
  private slidersReady = false;

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      this.slidersReady = true;
    });
  }

  overlayPct(): number {
    return Math.round(this.prefs.zoneOverlay() * 100);
  }

  onOverlay(pct: number | string): void {
    const n = Number(pct);
    if (!Number.isFinite(n)) return;
    this.prefs.setZoneOverlay(n / 100);
  }

  cloudPct(): number {
    return Math.round(this.prefs.cloudCover() * 100);
  }

  onClouds(pct: number | string): void {
    const n = Number(pct);
    if (!Number.isFinite(n)) return;
    this.prefs.setCloudCover(n / 100);
  }

  tagPct(): number {
    return Math.round(this.prefs.nametagScale() * 100);
  }

  onTags(pct: number | string): void {
    if (!this.slidersReady) return;
    const n = Number(pct);
    if (!Number.isFinite(n)) return;
    this.prefs.setNametagScale(n / 100);
  }

  setMode(mode: PlayMode): void {
    if (this.prefs.playMode() === mode) return;
    this.prefs.setPlayMode(mode);
    if (mode === 'planet') this.adventureOff.emit();
  }

  setResidentsMode(mode: ResidentsMode): void {
    if (this.world.settings().residentsMode === mode) return;
    this.world.applySettings({ ...this.world.settings(), residentsMode: mode });
    this.room.republishMeta();
  }

  setResidentAvg(key: 'avgPerHouse' | 'avgPerPlace', event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.world.applySettings({ ...this.world.settings(), [key]: Number(input.value) });
    input.value = String(this.world.settings()[key]);
    this.room.republishMeta();
  }
}
