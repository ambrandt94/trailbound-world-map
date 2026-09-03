import { Component, computed, inject } from '@angular/core';
import { ENTITY_LABELS, POI_LABELS, minScaleFor, zoomProgress } from '../../models/world.models';
import { WorldService } from '../../services/world.service';

@Component({
  selector: 'app-location-panel',
  standalone: true,
  template: `
    <aside class="panel">
      <div class="eyebrow">Location</div>
      <div class="status" [class.uncharted]="world.location().uncharted">
        {{ world.statusLine() }}
      </div>
      <div class="you">{{ world.player().name }}</div>
      <div class="clock">{{ world.simLine() }}</div>
      <dl class="facts">
        <div>
          <dt>Here</dt>
          <dd>{{ world.location().biomeLabel }} · <span class="tb-mono">{{ coords() }}</span></dd>
        </div>
        <div>
          <dt>View</dt>
          <dd>{{ world.location().scaleLabel }} · {{ scaleText() }}</dd>
          <div class="zoom-track" aria-hidden="true">
            <div class="zoom-fill" [style.width.%]="zoomT() * 100"></div>
          </div>
        </div>
        <div>
          <dt>Nearby</dt>
          <dd>{{ nearby() }}</dd>
        </div>
        <div>
          <dt>People</dt>
          <dd>{{ world.simHud().wanderers }} · {{ world.simHud().caravans }} · {{ world.simHud().armies }} hosts</dd>
        </div>
      </dl>
      @if (world.adventureLock(); as region) {
        <span class="pill">{{ region.tiles.length }} tiles · leave edge for map</span>
      } @else if (world.location().inNode) {
        <span class="pill" [class.authored]="world.location().nodeOrigin === 'authored'">
          {{ world.location().nodeOrigin === 'authored' ? 'Authored zone' : 'Discovered place' }}
        </span>
      } @else if (world.location().atGate) {
        <span class="pill gate">At the gate</span>
      } @else if (world.location().poiKind) {
        <span class="pill poi">{{ poiLabel() }}</span>
      } @else {
        <span class="pill uncharted">Outside any node</span>
      }
    </aside>
  `,
  styles: `
    .panel {
      width: 16.5rem;
      padding: 0.85rem 0.95rem;
      border-radius: 14px;
      background: color-mix(in srgb, var(--tb-panel) 88%, transparent);
      backdrop-filter: blur(10px);
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      box-shadow: 0 10px 28px color-mix(in srgb, black 22%, transparent);
    }
    .eyebrow {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tb-accent-strong);
      margin-bottom: 0.25rem;
    }
    .status {
      font-weight: 650;
      font-size: 0.95rem;
      line-height: 1.25;
      margin-bottom: 0.35rem;
    }
    .status.uncharted {
      color: var(--tb-muted);
    }
    .you {
      font-size: 0.78rem;
      color: var(--tb-muted);
      margin: -0.15rem 0 0.45rem;
    }
    .clock {
      font-family: ui-monospace, monospace;
      font-size: 0.76rem;
      color: var(--tb-accent-strong);
      margin-bottom: 0.65rem;
    }
    .facts {
      display: grid;
      gap: 0.45rem;
      margin: 0 0 0.7rem;
    }
    .facts div {
      display: grid;
      gap: 0.08rem;
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
      font-size: 0.84rem;
    }
    .zoom-track {
      height: 3px;
      margin-top: 0.22rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--tb-ink) 12%, transparent);
      overflow: hidden;
    }
    .zoom-fill {
      height: 100%;
      border-radius: 999px;
      background: var(--tb-accent);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 0.18rem 0.55rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 600;
      border: 1px solid color-mix(in srgb, var(--tb-ink) 12%, transparent);
      background: color-mix(in srgb, var(--tb-accent) 14%, transparent);
    }
    .pill.authored {
      border-color: var(--tb-accent-strong);
    }
    .pill.gate {
      border-color: var(--tb-accent);
    }
    .pill.poi {
      background: color-mix(in srgb, #c39bd3 18%, transparent);
      border-color: #c39bd3;
    }
    .pill.uncharted {
      background: color-mix(in srgb, var(--tb-muted) 16%, transparent);
      color: var(--tb-muted);
    }
  `,
})
export class LocationPanelComponent {
  readonly world = inject(WorldService);

  readonly scaleText = computed(() => {
    const s = this.world.location().scale;
    const n = s < 0.05 ? s.toFixed(3) : s < 1 ? s.toFixed(2) : s.toFixed(s < 10 ? 1 : 0);
    return `${n}×`;
  });

  readonly zoomT = computed(() =>
    zoomProgress(this.world.location().scale, minScaleFor(this.world.world()?.width ?? 192)),
  );

  readonly coords = computed(() => {
    const loc = this.world.location();
    return `${loc.x.toFixed(1)}, ${loc.y.toFixed(1)}`;
  });

  readonly nearby = computed(() => {
    const hud = this.world.simHud();
    if (!hud.nearbyName || hud.nearbyDist == null || !hud.nearbyKind) return 'None in range';
    return `${hud.nearbyName} · ${ENTITY_LABELS[hud.nearbyKind]} · ${hud.nearbyDist.toFixed(1)}`;
  });

  readonly poiLabel = computed(() => {
    const kind = this.world.location().poiKind;
    return kind ? POI_LABELS[kind] : 'Point of interest';
  });
}
