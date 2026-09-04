import { Component, inject, input, output, signal } from '@angular/core';
import { NgStyle } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  HERO_GROUPS,
  HERO_LOOKS,
  HeroGroup,
  clampHeroName,
  findHeroLook,
  heroLookKey,
  heroPortraitStyle,
} from '../../engine/hero';
import { PreferencesService } from '../../services/preferences.service';

@Component({
  selector: 'app-hero-picker',
  standalone: true,
  imports: [NgStyle, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="veil" (click)="onVeil()">
      <aside class="panel" (click)="$event.stopPropagation()">
        <div class="eyebrow">{{ mode() === 'room' ? 'Room' : 'Adventure' }}</div>
        <h2>Who are you?</h2>
        <p class="lede">
          @if (mode() === 'room') {
            Pick a look and a name before you enter the lobby.
          } @else {
            Pick a look and a name. You can change this the next time you embark.
          }
        </p>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="name">
          <mat-label>Name</mat-label>
          <input matInput maxlength="24" [(ngModel)]="name" />
        </mat-form-field>
        <div class="groups">
          @for (g of groups; track g.id) {
            <button type="button" class="group" [class.on]="group() === g.id" (click)="group.set(g.id)">
              {{ g.label }}
            </button>
          }
        </div>
        <div class="grid">
          @for (look of looks(); track look.key) {
            <button
              type="button"
              class="face"
              [class.on]="selectedKey() === look.key"
              [ngStyle]="portrait(look)"
              [attr.aria-label]="look.sheet + ' ' + (look.char + 1)"
              (click)="select(look.sheet, look.char)"
            ></button>
          }
        </div>
        <div class="actions">
          <button mat-stroked-button type="button" (click)="cancel.emit()">
            {{ mode() === 'room' ? 'Leave lobby' : 'Cancel' }}
          </button>
          <button mat-flat-button color="primary" type="button" (click)="confirm()">
            {{ mode() === 'room' ? 'Enter' : 'Embark' }}
          </button>
        </div>
      </aside>
    </div>
  `,
  styles: `
    .veil {
      position: absolute;
      inset: 0;
      z-index: 6;
      display: grid;
      place-items: center;
      padding: 1rem;
      background: color-mix(in srgb, #0b1014 55%, transparent);
      pointer-events: auto;
    }
    .panel {
      width: min(44rem, 100%);
      max-height: min(48rem, 94vh);
      display: flex;
      flex-direction: column;
      padding: 1.15rem 1.2rem 1.05rem;
      border-radius: 14px;
      background: color-mix(in srgb, var(--tb-panel) 94%, transparent);
      backdrop-filter: blur(12px);
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      box-shadow: 0 12px 32px color-mix(in srgb, black 28%, transparent);
    }
    .eyebrow {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tb-accent-strong);
    }
    h2 {
      margin: 0.15rem 0 0.3rem;
      font-size: 1.35rem;
      font-weight: 650;
    }
    .lede {
      margin: 0 0 0.75rem;
      font-size: 0.88rem;
      color: var(--tb-muted);
    }
    .name {
      width: 100%;
      margin-bottom: 0.4rem;
    }
    .groups {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-bottom: 0.65rem;
    }
    .group {
      border: 1px solid color-mix(in srgb, var(--tb-ink) 12%, transparent);
      background: transparent;
      color: var(--tb-ink);
      border-radius: 999px;
      padding: 0.28rem 0.75rem;
      font: 700 0.72rem/1.2 Poppins, sans-serif;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
    }
    .group.on {
      background: color-mix(in srgb, var(--tb-accent) 18%, transparent);
      border-color: var(--tb-accent-strong);
      color: var(--tb-accent-strong);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(4.75rem, 1fr));
      gap: 0.55rem;
      overflow: auto;
      min-height: 14rem;
      max-height: min(28rem, 52vh);
      padding: 0.2rem 0.15rem 0.45rem;
    }
    .face {
      aspect-ratio: 3 / 4;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--tb-ink) 12%, transparent);
      background-color: color-mix(in srgb, var(--tb-bg) 70%, transparent);
      cursor: pointer;
      padding: 0;
      image-rendering: pixelated;
    }
    .face.on {
      border-color: var(--tb-accent-strong);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--tb-accent) 45%, transparent);
    }
    .actions {
      display: flex;
      gap: 0.45rem;
      margin-top: 0.7rem;
    }
    .actions button {
      text-transform: none;
      flex: 1;
    }
  `,
})
export class HeroPickerComponent {
  readonly prefs = inject(PreferencesService);
  readonly mode = input<'adventure' | 'room'>('adventure');
  readonly embarked = output<{ name: string; sheet: string; char: number }>();
  readonly cancel = output<void>();
  readonly groups = HERO_GROUPS;
  readonly group = signal<HeroGroup>('people');
  name = this.prefs.heroName();
  private sheet = this.prefs.heroSheet();
  private char = this.prefs.heroChar();

  constructor() {
    const look = findHeroLook(this.sheet, this.char);
    this.sheet = look.sheet;
    this.char = look.char;
    this.group.set(look.group);
  }

  looks() {
    return HERO_LOOKS.filter((l) => l.group === this.group());
  }

  selectedKey(): string {
    return heroLookKey(this.sheet, this.char);
  }

  portrait(look: { url: string; char: number }): Record<string, string> {
    return heroPortraitStyle(look);
  }

  select(sheet: string, char: number): void {
    this.sheet = sheet;
    this.char = char;
  }

  onVeil(): void {
    if (this.mode() === 'room') return;
    this.cancel.emit();
  }

  confirm(): void {
    const look = findHeroLook(this.sheet, this.char);
    this.embarked.emit({ name: clampHeroName(this.name), sheet: look.sheet, char: look.char });
  }
}
