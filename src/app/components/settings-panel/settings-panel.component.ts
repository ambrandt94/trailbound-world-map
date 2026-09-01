import { Component, inject, output } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { PreferencesService } from '../../services/preferences.service';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [MatSlideToggleModule],
  template: `
    <aside class="panel">
      <div class="eyebrow">Settings</div>
      <p class="lede">Debug and view options for this tool.</p>
      <mat-slide-toggle
        [checked]="prefs.adventureMode()"
        (change)="onAdventure($event.checked)"
      >
        Adventure mode
      </mat-slide-toggle>
      <p class="note">
        Debug. Zoom into a mapped place to isolate it. Walk off the edge while zoomed in to generate
        a new region (zoom stays put). Zooming into uncharted land from the overworld still asks,
        then dives in close.
      </p>
      @if (prefs.adventureMode()) {
        <mat-slide-toggle
          class="sub"
          [checked]="prefs.adventureLinkNeighbors()"
          (change)="prefs.setAdventureLinkNeighbors($event.checked)"
        >
          Load adjacent regions
        </mat-slide-toggle>
        <p class="note">
          Off: only the current place is loaded; neighbors stay behind the fog until you walk into
          them. On: touching mapped places stay streamed together.
        </p>
      }
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
      margin: 0 0 0.85rem;
      font-size: 0.82rem;
      color: var(--tb-muted);
    }
    mat-slide-toggle {
      display: block;
      --mat-slide-toggle-label-text-size: 0.92rem;
    }
    mat-slide-toggle.sub {
      margin-top: 0.85rem;
    }
    .note {
      margin: 0.65rem 0 0;
      font-size: 0.78rem;
      line-height: 1.4;
      color: var(--tb-muted);
    }
  `,
})
export class SettingsPanelComponent {
  readonly prefs = inject(PreferencesService);
  readonly adventureOff = output<void>();

  onAdventure(on: boolean): void {
    this.prefs.setAdventureMode(on);
    if (!on) this.adventureOff.emit();
  }
}
