import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { PeopleService } from '../../services/people.service';
import { WorldService } from '../../services/world.service';

@Component({
  selector: 'app-people-panel',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    <aside class="panel">
      <div class="eyebrow">People</div>
      <div class="money">
        <span class="tb-mono">{{ people.totalMoney() }}</span>
        <span>copper</span>
      </div>
      <p class="ledger" [class.bad]="people.gap() !== 0">
        @if (people.gap() === 0) {
          Ledger holds · mint {{ people.minted() }}
        } @else {
          Ledger drift {{ people.gap() }}
        }
      </p>
      <p class="counts">
        {{ people.hiddenResidents() }} hidden · {{ people.travellers() }} on the road · {{ people.campCount() }} camps
      </p>
      <div class="actions">
        <button mat-stroked-button type="button" (click)="save()">Save</button>
        <button mat-stroked-button type="button" (click)="load()">Load</button>
        <button mat-stroked-button type="button" (click)="reset()">Reset world</button>
        <button mat-stroked-button type="button" (click)="skip(1)">+1 day</button>
        <button mat-stroked-button type="button" (click)="skip(7)">+7 days</button>
      </div>
      <p class="status">{{ people.status() }}</p>
      @if (people.person(); as one) {
        <button type="button" class="back" (click)="people.backToList()">Back</button>
        <div class="who">{{ one.core.name }}</div>
        <p class="role">{{ one.core.role }} · {{ one.core.id }}</p>
        <dl>
          <div><dt>Wallet</dt><dd class="tb-mono">{{ one.core.money }}c</dd></div>
          <div><dt>Seed</dt><dd class="tb-mono">{{ one.core.seed }}</dd></div>
          <div><dt>Home</dt><dd>{{ homeText(one.core.home) }}</dd></div>
          <div><dt>Where</dt><dd>{{ whereText(one.core.location) }}</dd></div>
        </dl>
        <div class="block">
          <div class="label">Attributes</div>
          <p class="stub">{{ pairs(one.detail.attributes) }}</p>
        </div>
        <div class="block">
          <div class="label">Skills</div>
          <p class="stub">{{ pairs(one.detail.skills) }}</p>
        </div>
        <div class="block">
          <div class="label">Detail stubs</div>
          <p class="stub">
            inventory {{ one.detail.inventory.length }} · ownership {{ one.detail.ownership.length }} ·
            relationships {{ one.detail.relationships.length }} · knowledge {{ one.detail.knowledge.length }} ·
            opinions {{ one.detail.opinions.length }}
          </p>
        </div>
        <div class="block">
          <div class="label">History</div>
          @if (!one.core.history.length && !one.ledger.length) {
            <p class="stub">No events yet.</p>
          }
          @for (row of one.core.history; track row.t + row.note) {
            <p class="hist">{{ row.note }} @if (row.amount !== undefined) { <span class="tb-mono">{{ row.amount }}c</span> }</p>
          }
        </div>
      } @else {
        @if (people.selection(); as sel) {
          <div class="who">{{ sel.title }}</div>
          @for (note of sel.notes; track note) {
            <p class="role">{{ note }}</p>
          }
          <ul>
            @for (row of sel.rows; track row.id) {
              <li>
                <button type="button" (click)="open(row.id)">
                  <span>{{ row.name }}</span>
                  <span class="meta">{{ row.stub ? 'stub' : row.role }} · {{ row.money }}c</span>
                </button>
              </li>
            } @empty {
              <li class="empty">Nobody here.</li>
            }
          </ul>
        } @else {
          <p class="hint">Click a town, a party, or a camp.</p>
        }
      }
    </aside>
  `,
  styles: `
    .panel {
      width: 18rem;
      max-height: 100%;
      overflow: auto;
      padding: 0.85rem 0.95rem 1rem;
      border-radius: 14px;
      background: color-mix(in srgb, var(--tb-panel) 88%, transparent);
      backdrop-filter: blur(10px);
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      box-shadow: 0 10px 28px color-mix(in srgb, black 22%, transparent);
      color: var(--tb-ink);
    }
    .eyebrow {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tb-accent-strong);
      margin-bottom: 0.2rem;
    }
    .money {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      font-weight: 700;
      font-size: 1.35rem;
      line-height: 1.1;
    }
    .money span:last-child {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tb-muted);
    }
    .ledger,
    .counts,
    .status,
    .hint,
    .role,
    .stub,
    .hist {
      margin: 0.28rem 0 0;
      font-size: 0.75rem;
      color: var(--tb-muted);
      line-height: 1.35;
    }
    .ledger.bad {
      color: #a33b2b;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin: 0.65rem 0 0.35rem;
    }
    .actions button {
      min-height: 1.8rem;
      padding: 0 0.55rem;
      font-size: 0.72rem;
    }
    .who {
      margin-top: 0.75rem;
      font-weight: 700;
      font-size: 0.95rem;
    }
    .back {
      margin-top: 0.55rem;
      border: 0;
      background: transparent;
      color: var(--tb-accent-strong);
      font-weight: 700;
      cursor: pointer;
      padding: 0;
    }
    dl {
      display: grid;
      gap: 0.28rem;
      margin: 0.45rem 0 0;
    }
    dl div {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
    }
    dt {
      font-size: 0.66rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tb-muted);
    }
    dd {
      margin: 0;
      font-size: 0.78rem;
      text-align: right;
    }
    .label {
      margin-top: 0.55rem;
      font-size: 0.66rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tb-muted);
    }
    ul {
      list-style: none;
      margin: 0.4rem 0 0;
      padding: 0;
      display: grid;
      gap: 0.2rem;
    }
    li button {
      width: 100%;
      text-align: left;
      border: 0;
      border-radius: 8px;
      background: color-mix(in srgb, var(--tb-bg) 70%, transparent);
      color: var(--tb-ink);
      padding: 0.35rem 0.45rem;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 0.05rem;
    }
    li button:hover {
      background: color-mix(in srgb, var(--tb-accent) 18%, transparent);
    }
    .meta {
      font-size: 0.7rem;
      color: var(--tb-muted);
    }
    .empty {
      font-size: 0.75rem;
      color: var(--tb-muted);
    }
  `,
})
export class PeoplePanelComponent {
  readonly people = inject(PeopleService);
  private readonly world = inject(WorldService);

  save(): void {
    void this.people.save();
  }

  load(): void {
    void this.people.load(this.world.entities());
  }

  reset(): void {
    const data = this.world.world();
    if (!data) return;
    void this.people.reset(data, this.world.entities(), this.world.residentOverrides());
  }

  skip(days: number): void {
    void this.people.skipDays(days, this.world.entities());
  }

  open(id: string): void {
    void this.people.openPerson(id);
  }

  pairs(record: Record<string, number>): string {
    return Object.entries(record)
      .map(([key, value]) => `${key} ${value}`)
      .join(' · ');
  }

  homeText(home: { kind: string; placeId?: string; campId?: string; poiId?: string }): string {
    if (home.kind === 'town') return home.placeId ?? 'town';
    if (home.kind === 'camp') return home.campId ?? 'camp';
    if (home.kind === 'poi') return home.poiId ?? 'poi';
    return 'none';
  }

  whereText(location: { kind: string; placeId?: string; partyId?: string }): string {
    if (location.kind === 'at-home') return 'at home';
    if (location.kind === 'in-place') return location.placeId ?? 'visiting';
    if (location.kind === 'in-party') return location.partyId ?? 'in a party';
    return location.kind;
  }
}
