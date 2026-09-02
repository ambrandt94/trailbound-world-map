import { Component, computed, inject } from '@angular/core';
import { ENTITY_LABELS, POI_LABELS } from '../../models/world.models';
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
      <div class="clock">{{ world.simLine() }}</div>
      <dl class="facts">
        <div>
          <dt>Terrain</dt>
          <dd>{{ world.location().biomeLabel }}</dd>
        </div>
        <div>
          <dt>Coordinates</dt>
          <dd class="tb-mono">{{ coords() }}</dd>
        </div>
        <div>
          <dt>View</dt>
          <dd>{{ world.location().scaleLabel }} · {{ scaleText() }}</dd>
        </div>
        @if (world.adventureLock(); as region) {
          <div>
            <dt>Adventure</dt>
            <dd class="tb-mono">{{ region.tiles.length }} tiles · walk the edge to explore</dd>
          </div>
        }
        <div>
          <dt>People</dt>
          <dd>{{ world.simHud().wanderers }} travelers · {{ world.simHud().caravans }} caravans · {{ world.simHud().armies }} hosts</dd>
        </div>
        <div>
          <dt>Nearby</dt>
          <dd>{{ nearby() }}</dd>
        </div>
        <div>
          <dt>Map</dt>
          <dd class="tb-mono">{{ mapSize() }}</dd>
        </div>
        <div>
          <dt>Regions</dt>
          <dd>{{ authored() }} authored · {{ world.cityCount() }} cities · {{ world.chunkCount() }} detail tiles</dd>
        </div>
        <div>
          <dt>POIs</dt>
          <dd>{{ world.poiCount() }} placed · {{ world.showPois() ? 'author view' : 'hidden' }}</dd>
        </div>
      </dl>
      @if (world.location().inNode) {
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
    .status {
      font-weight: 650;
      font-size: 1.02rem;
      line-height: 1.25;
      margin-bottom: 0.85rem;
    }
    .status.uncharted {
      color: var(--tb-muted);
    }
    .clock {
      font-family: ui-monospace, monospace;
      font-size: 0.82rem;
      color: var(--tb-accent-strong);
      margin: -0.45rem 0 0.85rem;
    }
    .facts {
      display: grid;
      gap: 0.55rem;
      margin: 0 0 0.85rem;
    }
    .facts div {
      display: grid;
      gap: 0.1rem;
    }
    dt {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tb-muted);
    }
    dd {
      margin: 0;
      font-size: 0.92rem;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 0.2rem 0.65rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      border: 1px solid color-mix(in srgb, var(--tb-ink) 12%, transparent);
      background: color-mix(in srgb, var(--tb-accent) 14%, transparent);
    }
    .pill.authored {
      background: color-mix(in srgb, var(--tb-accent) 18%, transparent);
      border-color: var(--tb-accent-strong);
    }
    .pill.gate {
      background: color-mix(in srgb, var(--tb-accent) 14%, transparent);
      border-color: var(--tb-accent);
    }
    .pill.poi {
      background: color-mix(in srgb, #c39bd3 18%, transparent);
      border-color: #c39bd3;
    }
    .pill.uncharted {
      background: color-mix(in srgb, var(--tb-muted) 16%, transparent);
      border-color: color-mix(in srgb, var(--tb-ink) 12%, transparent);
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

  readonly coords = computed(() => {
    const loc = this.world.location();
    return `${loc.x.toFixed(1)}, ${loc.y.toFixed(1)}`;
  });

  readonly authored = computed(
    () => this.world.world()?.nodes.filter((n) => n.origin === 'authored').length ?? 0,
  );

  readonly mapSize = computed(() => {
    const world = this.world.world();
    if (!world) return '—';
    return `${world.width} × ${world.height} · ${world.settings.worldScale}×`;
  });

  readonly poiLabel = computed(() => {
    const kind = this.world.location().poiKind;
    return kind ? POI_LABELS[kind] : 'Point of interest';
  });

  readonly nearby = computed(() => {
    const hud = this.world.simHud();
    if (!hud.nearbyName || hud.nearbyDist == null || !hud.nearbyKind) return 'None in range';
    return `${hud.nearbyName} · ${ENTITY_LABELS[hud.nearbyKind]} · ${hud.nearbyDist.toFixed(1)}`;
  });
}
