import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-room-panel',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  template: `
    <div class="veil" (click)="closed.emit()">
      <aside class="panel" (click)="$event.stopPropagation()">
        <div class="eyebrow">Room</div>
        <h2>Online lobby</h2>
        <p class="lede">
          Share a 4-digit PIN. Everyone loads the same kingdom and starts in Ashfen.
        </p>

        @if (room.connected()) {
          <div class="pin-box">
            <span class="label">PIN</span>
            <span class="pin tb-mono">{{ room.pin() }}</span>
            @if (room.isHost()) {
              <span class="badge">Host</span>
            }
          </div>
          <div class="roster">
            <div class="label">In room</div>
            <ul>
              @for (name of room.rosterNames(); track name + $index) {
                <li>{{ name }}</li>
              }
            </ul>
          </div>
          <div class="actions">
            <button mat-stroked-button type="button" (click)="leave()">Leave room</button>
            <button mat-flat-button color="primary" type="button" (click)="closed.emit()">Keep PIN</button>
          </div>
        } @else {
          <div class="join">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="pin-field">
              <mat-label>Join PIN</mat-label>
              <input
                matInput
                inputmode="numeric"
                maxlength="4"
                placeholder="0000"
                [(ngModel)]="joinPin"
                (keydown.enter)="join()"
              />
            </mat-form-field>
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="join()">Join</button>
          </div>
          <div class="host-block">
            <div class="label">Host</div>
            @if (!hostReady()) {
              <p class="note">Create is locked. Enter the host key (only the owner has this).</p>
              <div class="join">
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="pin-field">
                  <mat-label>Host key</mat-label>
                  <input
                    matInput
                    type="password"
                    autocomplete="off"
                    [(ngModel)]="hostKey"
                    (keydown.enter)="unlock()"
                  />
                </mat-form-field>
                <button mat-flat-button color="primary" type="button" [disabled]="busy()" (click)="unlock()">
                  Unlock
                </button>
              </div>
            } @else {
              <button mat-flat-button color="primary" type="button" [disabled]="busy()" (click)="create()">
                <mat-icon>add</mat-icon>
                Create room
              </button>
            }
          </div>
          @if (room.error()) {
            <p class="err">{{ room.error() }}</p>
          }
          @if (busy()) {
            <p class="note">Connecting…</p>
          }
          <div class="actions">
            <button mat-stroked-button type="button" (click)="closed.emit()">Cancel</button>
          </div>
        }
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
      width: min(22rem, 100%);
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      padding: 1rem 1.05rem 0.95rem;
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
      margin: 0;
      font-size: 1.15rem;
      font-weight: 650;
    }
    .lede {
      margin: 0;
      font-size: 0.82rem;
      color: var(--tb-muted);
      line-height: 1.35;
    }
    .pin-box {
      display: flex;
      align-items: baseline;
      gap: 0.55rem;
      padding: 0.55rem 0.65rem;
      border-radius: 12px;
      background: color-mix(in srgb, var(--tb-bg) 55%, transparent);
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
    }
    .label {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tb-muted);
    }
    .pin {
      font-size: 1.55rem;
      font-weight: 700;
      letter-spacing: 0.18em;
      color: var(--tb-ink);
    }
    .badge {
      margin-left: auto;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tb-accent-strong);
    }
    .roster ul {
      margin: 0.25rem 0 0;
      padding: 0 0 0 1rem;
      font-size: 0.86rem;
    }
    .join {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.45rem;
      align-items: start;
    }
    .pin-field {
      width: 100%;
    }
    .actions {
      display: flex;
      gap: 0.45rem;
      justify-content: flex-end;
      margin-top: 0.2rem;
    }
    .actions.stack {
      flex-direction: column;
      align-items: stretch;
    }
    .actions button {
      text-transform: none;
    }
    .err {
      margin: 0;
      font-size: 0.78rem;
      color: #ffb4b4;
    }
    .note {
      margin: 0;
      font-size: 0.78rem;
      color: var(--tb-muted);
    }
    .host-block {
      display: grid;
      gap: 0.4rem;
      padding-top: 0.35rem;
      border-top: 1px solid color-mix(in srgb, var(--tb-ink) 8%, transparent);
    }
    .host-block .label {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tb-muted);
    }
  `,
})
export class RoomPanelComponent {
  readonly room = inject(RoomService);
  readonly closed = output<void>();
  joinPin = '';
  hostKey = '';
  readonly busy = signal(false);
  readonly hostReady = signal(this.room.canCreate());

  unlock(): void {
    if (this.room.tryUnlockHost(this.hostKey)) {
      this.hostReady.set(true);
      this.hostKey = '';
      this.room.error.set(null);
      this.room.status.set('idle');
    } else {
      this.room.error.set('Wrong host key.');
      this.room.status.set('error');
    }
  }

  async create(): Promise<void> {
    this.busy.set(true);
    try {
      await this.room.create(this.hostKey);
      this.hostReady.set(this.room.canCreate());
    } finally {
      this.busy.set(false);
    }
  }

  async join(): Promise<void> {
    this.busy.set(true);
    try {
      await this.room.join(this.joinPin);
    } finally {
      this.busy.set(false);
    }
  }

  async leave(): Promise<void> {
    this.busy.set(true);
    try {
      await this.room.leave();
    } finally {
      this.busy.set(false);
    }
  }
}
