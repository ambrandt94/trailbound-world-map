import { Component, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-room-presence',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    @if (room.connected() && room.presence().length) {
      <aside class="dock" [class.open]="open()">
        <button
          type="button"
          class="head"
          (click)="toggle()"
          [matTooltip]="open() ? 'Collapse party list' : 'Show who is in the room'"
        >
          <span class="count tb-mono">{{ room.presence().length }}</span>
          <span class="label">{{ open() ? 'In room' : 'Party' }}</span>
          <mat-icon>{{ open() ? 'expand_more' : 'expand_less' }}</mat-icon>
        </button>
        @if (open()) {
          <ul class="list">
            @for (row of room.presence(); track row.id) {
              <li [class.you]="row.you">
                <span class="pip" [style.background]="row.color"></span>
                <span class="name">{{ row.name }}</span>
                @if (row.you) {
                  <span class="you-tag">you</span>
                }
              </li>
            }
          </ul>
        }
      </aside>
    }
  `,
  styles: `
    .dock {
      width: min(11.5rem, 42vw);
      border-radius: 12px;
      background: color-mix(in srgb, var(--tb-panel) 88%, transparent);
      backdrop-filter: blur(10px);
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      box-shadow: 0 8px 22px color-mix(in srgb, black 22%, transparent);
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      width: 100%;
      margin: 0;
      padding: 0.4rem 0.5rem 0.4rem 0.55rem;
      border: 0;
      background: transparent;
      color: var(--tb-ink);
      cursor: pointer;
      font: inherit;
      text-align: left;
    }
    .head:hover {
      background: color-mix(in srgb, var(--tb-accent) 10%, transparent);
    }
    .count {
      min-width: 1.15rem;
      padding: 0.1rem 0.35rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: var(--tb-accent-strong);
      background: color-mix(in srgb, var(--tb-accent) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--tb-accent-strong) 35%, transparent);
      text-align: center;
    }
    .label {
      flex: 1;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tb-muted);
    }
    .head mat-icon {
      font-size: 1.05rem;
      width: 1.05rem;
      height: 1.05rem;
      color: var(--tb-muted);
    }
    .list {
      margin: 0;
      padding: 0.15rem 0.45rem 0.45rem;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      max-height: 9.5rem;
      overflow: auto;
    }
    .list li {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
      padding: 0.22rem 0.3rem;
      border-radius: 8px;
    }
    .list li.you {
      background: color-mix(in srgb, var(--tb-accent) 10%, transparent);
    }
    .pip {
      flex: 0 0 auto;
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, #1a120c 55%, transparent);
      box-shadow: 0 0 0 1px color-mix(in srgb, white 18%, transparent);
    }
    .name {
      flex: 1;
      min-width: 0;
      font-size: 0.82rem;
      color: var(--tb-ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .you-tag {
      flex: 0 0 auto;
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--tb-accent-strong);
    }
  `,
})
export class RoomPresenceComponent {
  readonly room = inject(RoomService);
  /** Start collapsed so it stays out of the way. */
  readonly open = signal(false);

  toggle(): void {
    this.open.update((v) => !v);
  }
}
