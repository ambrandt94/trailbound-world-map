import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  MAP_STYLES,
  MAP_STYLE_LABELS,
  MapStyle,
  WORLD_SCALES,
  WorldScale,
  WorldSettings,
  clampSettings,
  worldExtent,
} from '../../models/world.models';
import { WorldService } from '../../services/world.service';

@Component({
  selector: 'app-world-setup',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatChipsModule, MatFormFieldModule, MatInputModule],
  template: `
    <aside class="panel">
      <div class="eyebrow">World setup</div>
      <p class="lede">{{ sizeLine() }}</p>
      <div class="label">Continent scale</div>
      <mat-chip-set>
        @for (s of scales; track s) {
          <mat-chip [highlighted]="draft().worldScale === s" (click)="setScale(s)">{{ s }}×</mat-chip>
        }
      </mat-chip-set>
      <div class="label">Land shape</div>
      <mat-chip-set>
        @for (style of styles; track style) {
          <mat-chip [highlighted]="draft().mapStyle === style" (click)="setStyle(style)">{{ labels[style] }}</mat-chip>
        }
      </mat-chip-set>
      <div class="fields">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>POIs</mat-label>
          <input matInput type="number" min="0" max="400" [ngModel]="draft().poiCount" (ngModelChange)="patch({ poiCount: $event })" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Travelers</mat-label>
          <input matInput type="number" min="0" max="200" [ngModel]="draft().wanderers" (ngModelChange)="patch({ wanderers: $event })" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Caravans</mat-label>
          <input matInput type="number" min="0" max="40" [ngModel]="draft().caravans" (ngModelChange)="patch({ caravans: $event })" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Hosts</mat-label>
          <input matInput type="number" min="0" max="20" [ngModel]="draft().armies" (ngModelChange)="patch({ armies: $event })" />
        </mat-form-field>
      </div>
      <div class="actions">
        <button mat-flat-button type="button" (click)="submit(false)" [disabled]="world.generating()">Rebuild</button>
        <button mat-stroked-button type="button" (click)="submit(true)" [disabled]="world.generating()">New seed</button>
      </div>
    </aside>
  `,
  styles: `
    .panel {
      width: 18.5rem;
      padding: 1rem;
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
      margin-bottom: 0.35rem;
    }
    .lede {
      margin: 0 0 0.75rem;
      font-size: 0.82rem;
      color: var(--tb-muted);
    }
    .label {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tb-muted);
      margin-bottom: 0.4rem;
    }
    mat-chip-set {
      margin-bottom: 0.75rem;
    }
    .fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.55rem;
    }
    .actions {
      display: flex;
      gap: 0.45rem;
      margin-top: 0.75rem;
    }
    .actions button {
      text-transform: none;
      flex: 1;
    }
  `,
})
export class WorldSetupComponent {
  readonly world = inject(WorldService);
  readonly scales = WORLD_SCALES;
  readonly styles = MAP_STYLES;
  readonly labels = MAP_STYLE_LABELS;
  readonly draft = signal<WorldSettings>({ ...this.world.settings() });
  readonly rebuilt = output<{ settings: WorldSettings; newSeed: boolean }>();

  sizeLine(): string {
    const n = worldExtent(this.draft().worldScale);
    return `${n} × ${n} tiles · ${MAP_STYLE_LABELS[this.draft().mapStyle]}`;
  }

  setScale(scale: WorldScale): void {
    this.patch({ worldScale: scale });
  }

  setStyle(mapStyle: MapStyle): void {
    this.patch({ mapStyle });
  }

  patch(part: Partial<WorldSettings>): void {
    this.draft.update((d) => clampSettings({ ...d, ...part }));
  }

  submit(newSeed: boolean): void {
    this.rebuilt.emit({ settings: this.draft(), newSeed });
  }
}
