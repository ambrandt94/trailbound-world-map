import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  ADVENTURE_ASK_SCALE,
  ADVENTURE_POCKET_MAX,
  CameraState,
  ChunkData,
  DETAIL_START,
  DIVE_SCALE,
  ZOOM_OUT_DISCOVER_COOLDOWN_MS,
  MapNode,
  MAX_SCALE,
  CLOSE_SCALE,
  CHUNK_STREAM_PER_FRAME,
  PlayerState,
  SYNC_TURN_TILES,
  TILE,
  clamp,
  chunkKey,
  biomeAt,
  capZoneRadius,
  detailAnchor,
  facingFromDelta,
  fitScaleForBounds,
  growAdventureRegion,
  connectedPlaceTiles,
  fillEnclosedPockets,
  regionFromTiles,
  leaveScaleForFit,
  minScaleFor,
  knownPlaceAt,
  moveSpeed,
  nodeContaining,
  boundsFromTiles,
  clampLatY,
  closestOnTiles,
  globeFillFor,
  globeMinScaleFor,
  globeMorphT,
  lerpWrapX,
  pointInTiles,
  presentedFocus,
  startScaleFor,
  touchingPoiTiles,
  wrapX,
  wrapDeltaX,
  zoomProgress,
  mapScaleBar,
  zoneRadiusFor,
} from '../../models/world.models';
import { AssetLibrary } from '../../engine/assets';
import { nearestEntity } from '../../engine/entities';
import { defaultPlayerState } from '../../engine/hero';
import { kindForBiome } from '../../engine/names';
import { Rng } from '../../engine/noise';
import { drawCanvasGlobe, GlobeMarker, GlobeRenderer, orbitGlobeLook, unprojectCanvasGlobe } from '../../engine/globe';
import { globeShowsWholePlanet } from '../../engine/projection';
import { WorldRenderer } from '../../engine/renderer';
import { collectStreetBuildings } from '../../engine/buildings';
import { resolveInteriorWalk } from '../../engine/interior';
import { PreferencesService } from '../../services/preferences.service';
import { RoomService } from '../../services/room.service';
import { WorldService } from '../../services/world.service';
import { selfId } from '@trystero-p2p/mqtt';
import { peerMarkerRgb } from '../../models/room.models';

/** Mix screen-center zoom (0) and cursor-locked zoom (1). */
const ZOOM_CURSOR_BIAS = 1;
const ZOOM_FOLLOW = 14;
const PAN_FOLLOW = 11;
/** Instant fraction of a wheel step so scale doesn’t only ease in. */
const ZOOM_CATCH = 0.18;

@Component({
  selector: 'app-map-viewport',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="stage">
      <canvas #globe class="globe" aria-hidden="true"></canvas>
      <canvas
        #canvas
        class="map"
        [class.locked]="world.adventurePrompt()"
        [class.dragging]="dragging"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
      ></canvas>
      @if (!loaded) {
        <div class="boot">Loading tileset…</div>
      } @else if (world.generating()) {
        <div class="boot">Generating continent…</div>
      }
      @if (world.adventurePrompt()) {
        <div class="confirm">
          <div class="card">
            <div class="eyebrow">Adventure</div>
            <h2>Generate this area?</h2>
            <p>
              This tile is uncharted. Generate a new region here and dive in close. You can keep
              walking from there.
            </p>
            <p class="coords tb-mono">{{ promptTile() }}</p>
            <div class="actions">
              <button mat-flat-button type="button" (click)="confirmEnter(true)">Generate</button>
              <button mat-stroked-button type="button" (click)="cancelEnter()">Stay on the map</button>
            </div>
          </div>
        </div>
      }
      @if (loaded && !world.generating()) {
        <div class="map-dock">
          <button
            mat-icon-button
            type="button"
            class="dock-btn"
            [class.on]="world.showOutlines()"
            (click)="world.toggleOutlines()"
            matTooltip="Region outlines"
          >
            <mat-icon>{{ world.showOutlines() ? 'grid_on' : 'grid_off' }}</mat-icon>
          </button>
          <button
            mat-icon-button
            type="button"
            class="dock-btn"
            [class.on]="world.showPois()"
            (click)="world.togglePois()"
            matTooltip="POI author overlay"
          >
            <mat-icon>{{ world.showPois() ? 'place' : 'location_off' }}</mat-icon>
          </button>
          <button
            mat-icon-button
            type="button"
            class="dock-btn"
            [class.on]="prefs.showWorldMarkers()"
            (click)="prefs.setShowWorldMarkers(!prefs.showWorldMarkers())"
            matTooltip="Travelers, caravans & hosts on the map"
          >
            <mat-icon>{{ prefs.showWorldMarkers() ? 'groups' : 'visibility_off' }}</mat-icon>
          </button>
        </div>
        <div class="zoom-hud" aria-hidden="true">
          <div class="zoom-meta">
            <span class="zoom-band">{{ zoomHud().label }}</span>
            <span class="zoom-mult tb-mono">{{ zoomHud().mult }}</span>
          </div>
          <div class="zoom-track">
            <div class="zoom-fill" [style.width.%]="zoomHud().t * 100"></div>
          </div>
          <div class="zoom-ruler">
            <span class="zoom-bar" [style.width.px]="zoomHud().barPx"></span>
            <span class="zoom-bar-label tb-mono">{{ zoomHud().barLabel }}</span>
          </div>
        </div>
        @if (prefs.adventureMode()) {
          <div class="walk-pad" aria-label="Walk controls">
            <button type="button" class="walk-btn n" (pointerdown)="holdMove($event, 'KeyW')" (pointerup)="releaseMove('KeyW')" (pointercancel)="releaseMove('KeyW')">
              <mat-icon>keyboard_arrow_up</mat-icon>
            </button>
            <button type="button" class="walk-btn w" (pointerdown)="holdMove($event, 'KeyA')" (pointerup)="releaseMove('KeyA')" (pointercancel)="releaseMove('KeyA')">
              <mat-icon>keyboard_arrow_left</mat-icon>
            </button>
            <button type="button" class="walk-btn sprint" (pointerdown)="holdMove($event, 'ShiftLeft')" (pointerup)="releaseMove('ShiftLeft')" (pointercancel)="releaseMove('ShiftLeft')" aria-label="Sprint">
              <mat-icon>directions_run</mat-icon>
            </button>
            <button type="button" class="walk-btn e" (pointerdown)="holdMove($event, 'KeyD')" (pointerup)="releaseMove('KeyD')" (pointercancel)="releaseMove('KeyD')">
              <mat-icon>keyboard_arrow_right</mat-icon>
            </button>
            <button type="button" class="walk-btn s" (pointerdown)="holdMove($event, 'KeyS')" (pointerup)="releaseMove('KeyS')" (pointercancel)="releaseMove('KeyS')">
              <mat-icon>keyboard_arrow_down</mat-icon>
            </button>
          </div>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
    .stage {
      position: relative;
      height: 100%;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      background: #0b1014;
    }
    .globe,
    .map {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
    }
    .globe {
      z-index: 0;
      pointer-events: none;
      image-rendering: pixelated;
    }
    .map {
      z-index: 1;
      image-rendering: pixelated;
      cursor: grab;
      touch-action: none;
      background: transparent;
    }
    .map.dragging {
      cursor: grabbing;
    }
    .map.locked {
      cursor: default;
    }
    .map-dock {
      position: absolute;
      top: 0.75rem;
      left: 0.75rem;
      z-index: 3;
      display: flex;
      gap: 0.2rem;
      padding: 0.2rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--tb-panel) 88%, transparent);
      backdrop-filter: blur(10px);
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      box-shadow: 0 8px 22px color-mix(in srgb, black 22%, transparent);
      pointer-events: auto;
    }
    .dock-btn {
      color: var(--tb-muted);
      width: 2.25rem;
      height: 2.25rem;
      padding: 0;
    }
    .dock-btn.on {
      color: var(--tb-accent-strong);
      background: color-mix(in srgb, var(--tb-accent) 18%, transparent);
    }
    .dock-btn mat-icon {
      font-size: 1.15rem;
      width: 1.15rem;
      height: 1.15rem;
    }
    .boot {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--tb-muted);
      font-size: 0.92rem;
      pointer-events: none;
    }
    .confirm {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      background: color-mix(in srgb, #0b1014 55%, transparent);
      padding: 1rem;
    }
    .card {
      width: min(22rem, 100%);
      padding: 1rem;
      border-radius: 14px;
      background: color-mix(in srgb, var(--tb-panel) 94%, transparent);
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
    .card h2 {
      margin: 0 0 0.45rem;
      font-size: 1.15rem;
      font-weight: 650;
    }
    .card p {
      margin: 0 0 0.75rem;
      font-size: 0.86rem;
      line-height: 1.45;
      color: var(--tb-muted);
    }
    .coords {
      font-size: 0.82rem;
      color: var(--tb-ink) !important;
    }
    .actions {
      display: flex;
      gap: 0.45rem;
    }
    .actions button {
      text-transform: none;
      flex: 1;
    }
    .zoom-hud {
      position: absolute;
      left: 0.85rem;
      bottom: 0.85rem;
      min-width: 8.8rem;
      padding: 0.55rem 0.7rem 0.6rem;
      border-radius: 12px;
      background: color-mix(in srgb, var(--tb-panel) 88%, transparent);
      backdrop-filter: blur(10px);
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      box-shadow: 0 8px 22px color-mix(in srgb, black 22%, transparent);
      pointer-events: none;
      color: var(--tb-ink);
    }
    .zoom-meta {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.65rem;
      margin-bottom: 0.4rem;
    }
    .zoom-band {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tb-accent-strong);
    }
    .zoom-mult {
      font-size: 0.78rem;
      color: var(--tb-muted);
    }
    .zoom-track {
      height: 4px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--tb-ink) 12%, transparent);
      overflow: hidden;
    }
    .zoom-fill {
      height: 100%;
      border-radius: 999px;
      background: var(--tb-accent);
    }
    .zoom-ruler {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.18rem;
      margin-top: 0.5rem;
    }
    .zoom-bar {
      display: block;
      height: 7px;
      box-sizing: border-box;
      border: 0 solid var(--tb-ink);
      border-bottom-width: 2px;
      border-left-width: 2px;
      border-right-width: 2px;
    }
    .zoom-bar-label {
      font-size: 0.7rem;
      color: var(--tb-muted);
    }
    .walk-pad {
      display: none;
    }
    @media (max-width: 800px), (pointer: coarse) {
      .zoom-hud {
        display: none;
      }
      .walk-pad {
        position: absolute;
        left: 0.55rem;
        bottom: 0.55rem;
        z-index: 4;
        display: grid;
        grid-template-columns: 2.85rem 2.85rem 2.85rem;
        grid-template-rows: 2.85rem 2.85rem 2.85rem;
        grid-template-areas:
          '. n .'
          'w sprint e'
          '. s .';
        gap: 0.28rem;
        pointer-events: auto;
        touch-action: none;
      }
      .walk-btn {
        display: grid;
        place-items: center;
        margin: 0;
        padding: 0;
        border: 1px solid color-mix(in srgb, var(--tb-ink) 12%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, var(--tb-panel) 88%, transparent);
        color: var(--tb-ink);
        box-shadow: 0 8px 18px color-mix(in srgb, black 20%, transparent);
        backdrop-filter: blur(10px);
      }
      .walk-btn:active,
      .walk-btn:focus-visible {
        background: color-mix(in srgb, var(--tb-accent) 22%, var(--tb-panel));
        color: var(--tb-accent-strong);
      }
      .walk-btn.n { grid-area: n; }
      .walk-btn.s { grid-area: s; }
      .walk-btn.w { grid-area: w; }
      .walk-btn.e { grid-area: e; }
      .walk-btn.sprint {
        grid-area: sprint;
        color: var(--tb-accent-strong);
      }
      .walk-btn mat-icon {
        font-size: 1.45rem;
        width: 1.45rem;
        height: 1.45rem;
      }
    }
  `,
})
export class MapViewportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('globe', { static: true }) globeRef!: ElementRef<HTMLCanvasElement>;

  loaded = false;
  dragging = false;

  readonly world = inject(WorldService);
  readonly zoomHud = computed(() => {
    const loc = this.world.location();
    const width = this.world.world()?.width ?? 192;
    const min = this.globeAllowed() ? globeMinScaleFor(width) : minScaleFor(width);
    const bar = mapScaleBar(loc.scale);
    return {
      label: loc.scaleLabel,
      mult: `${loc.scale.toFixed(loc.scale < 1 ? 2 : loc.scale < 10 ? 1 : 0)}×`,
      t: zoomProgress(loc.scale, min),
      barPx: bar.px,
      barLabel: bar.label,
    };
  });
  readonly prefs = inject(PreferencesService);
  readonly room = inject(RoomService);
  private readonly ngZone = inject(NgZone);
  private readonly assets = new AssetLibrary();
  private renderer: WorldRenderer | null = null;
  private globe: GlobeRenderer | null = null;
  private raf = 0;
  private lastT = 0;
  private hudAcc = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private readonly keys = new Set<string>();
  private readonly ptrs = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private dragMoved = false;
  private lastPtr = { x: 0, y: 0 };
  private viewW = 1;
  private viewH = 1;
  private syncAcc = 0;
  private edgeReturn: { x: number; y: number } | null = null;
  private isolatePlaceId: string | null = null;
  private leavingIsolation = false;
  private discoverArmed = false;
  /** Locked dive tile while zooming into uncharted land (avoids sliding into a neighbor place). */
  private pendingDiscover: { x: number; y: number } | null = null;
  private lastZoomOutAt = Number.NEGATIVE_INFINITY;
  private readonly player: PlayerState = defaultPlayerState();
  private readonly camera: CameraState = {
    x: 96,
    y: 96,
    scale: 0.26,
    targetX: 96,
    targetY: 96,
    targetScale: 0.26,
    followPlayer: false,
  };
  private resizeObs: ResizeObserver | null = null;
  private unlisten: Array<() => void> = [];
  private removeWheel: (() => void) | null = null;
  private walkerOn = false;
  private planetOn = true;
  private zoomPivot: { wx: number; wy: number; sx: number; sy: number } | null = null;
  private zoneBakeKey = '';
  private cloudBakeKey = '';
  private isoTilesCache: { key: string; tiles: { x: number; y: number }[] } | null = null;

  async ngAfterViewInit(): Promise<void> {
    await this.assets.load();
    this.ngZone.run(() => {
      this.loaded = true;
      this.world.generating.set(true);
    });
    await new Promise((r) => setTimeout(r, 40));
    const data = this.world.world() ?? this.world.init();
    this.world.repairPlaceShapes();
    const start = this.world.player();
    Object.assign(this.player, start);
    this.camera.x = start.x;
    this.camera.y = start.y;
    this.camera.targetX = start.x;
    this.camera.targetY = start.y;
    this.walkerOn = this.prefs.adventureMode();
    this.planetOn = this.globeAllowed();
    this.setFollow(this.walkerOn);
    this.renderer = new WorldRenderer(this.assets);
    this.renderer.bakeWorld(data);
    this.renderer.bakeZones(data);
    this.globe = new GlobeRenderer(this.globeRef.nativeElement);
    if (this.globe.ready) {
      this.globe.setTexture(this.renderer.worldBake);
      this.globe.setZones(this.renderer.zoneBake);
    }
    this.applyStartCamera(data, true);
    if (this.prefs.fogEnabled) {
      this.renderer.bakeClouds(data, this.world.exploredTileKeys());
      this.cloudBakeKey = this.world.fogKey();
    } else {
      this.cloudBakeKey = 'off';
      this.renderer.cloudBake = null;
    }
    this.ngZone.run(() => this.world.generating.set(false));

    this.bindKeys();
    this.observeCanvas();
    this.scheduleFit();
    this.ngZone.runOutsideAngular(() => {
      this.lastT = performance.now();
      const loop = (t: number) => {
        try {
          this.tick(t);
        } catch (err) {
          console.error(err);
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
      this.watchdog = setInterval(() => {
        const t = performance.now();
        if (t - this.lastT > 220) {
          try {
            this.tick(t);
          } catch (err) {
            console.error(err);
          }
        }
      }, 50);
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    if (this.watchdog) clearInterval(this.watchdog);
    this.resizeObs?.disconnect();
    this.removeWheel?.();
    this.removeWheel = null;
    this.unbindKeys();
    this.globe?.dispose();
    this.globe = null;
  }

  reloadFromWorld(): void {
    const data = this.world.world();
    const start = this.world.player();
    Object.assign(this.player, start);
    this.camera.x = start.x;
    this.camera.y = start.y;
    this.camera.targetX = start.x;
    this.camera.targetY = start.y;
    this.walkerOn = this.prefs.adventureMode();
    this.planetOn = this.globeAllowed();
    this.setFollow(this.walkerOn);
    this.world.clearAdventure();
    this.edgeReturn = null;
    this.isolatePlaceId = null;
    this.leavingIsolation = false;
    this.zoomPivot = null;
    this.zoneBakeKey = '';
    this.cloudBakeKey = '';
    this.isoTilesCache = null;
    this.discoverArmed = false;
    this.pendingDiscover = null;
    this.lastZoomOutAt = performance.now();
    this.renderer?.clearChunks();
    if (data) this.renderer?.bakeWorld(data);
    if (data) this.renderer?.bakeZones(data);
    if (data && this.globe?.ready) {
      this.globe.setTexture(this.renderer?.worldBake ?? null);
      this.globe.setZones(this.renderer?.zoneBake ?? null);
    }
    if (data && this.prefs.adventureMode()) this.applyStartCamera(data, true);
    else this.fitCameraScale(data?.width ?? 192, true);
    if (data && this.prefs.fogEnabled) {
      this.renderer?.bakeClouds(data, this.world.exploredTileKeys());
      this.cloudBakeKey = this.world.fogKey();
    } else {
      this.cloudBakeKey = 'off';
      if (this.renderer) this.renderer.cloudBake = null;
      this.globe?.setClouds(null);
    }
    this.scheduleFit();
  }

  clearStreamed(): void {
    this.world.forgetChunks();
    this.renderer?.clearChunks();
  }

  recenter(): void {
    if (this.usingWalker()) {
      this.focusPlayer();
      return;
    }
    const world = this.world.world();
    if (!world) return;
    this.camera.targetX = world.width / 2;
    this.camera.targetY = world.height / 2;
    this.zoomPivot = null;
    this.fitCameraScale(world.width, false);
  }

  /** Snap follow to the walker and dive to Close (32×). */
  focusPlayer(): void {
    this.setFollow(true);
    this.zoomPivot = null;
    this.camera.targetX = this.player.x;
    this.camera.targetY = this.player.y;
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
    this.setTargetScale(CLOSE_SCALE);
  }

  zoomBy(factor: number): void {
    this.applyZoom(this.camera.targetScale * factor);
  }

  promptTile(): string {
    return `${Math.floor(this.player.x)}, ${Math.floor(this.player.y)}`;
  }

  confirmEnter(snapZoom = true): void {
    const data = this.world.world();
    if (!data) return;
    const wx = Math.floor(this.player.x);
    const wy = Math.floor(this.player.y);
    const seed = data.seed ^ (wx * 73856093) ^ (wy * 19349663);
    const rng = new Rng(seed >>> 0);
    const biome = biomeAt(data, wx + 0.5, wy + 0.5);
    const kind = kindForBiome(biome, rng);
    const radius = capZoneRadius(
      zoneRadiusFor(kind, rng.next(), rng.range(0.94, 1.08)),
      data.width,
      data.height,
    );
    const region = growAdventureRegion(
      wx,
      wy,
      data.width,
      data.height,
      this.world.adventureBlocked(),
      seed,
      undefined,
      radius,
      kind,
      data.biomes,
    );
    const node = this.world.registerAdventureInstance(region, kind);
    this.world.markVisited(node);
    this.isolatePlaceId = node?.id ?? null;
    this.leavingIsolation = false;
    this.pendingDiscover = null;
    this.world.adventurePrompt.set(false);
    const tiles = node ? this.adventureTiles(data.nodes, node) : region.tiles;
    if (node) this.world.claimAdventurePockets(node, tiles);
    this.world.adventureLock.set(regionFromTiles(tiles));
    this.setFollow(true);
    if (snapZoom) {
      this.setTargetScale(DIVE_SCALE);
      this.camera.scale = DIVE_SCALE;
    }
    this.fillAndBake(tiles);
  }

  cancelEnter(): void {
    this.world.adventurePrompt.set(false);
    if (this.edgeReturn) {
      this.player.x = this.edgeReturn.x;
      this.player.y = this.edgeReturn.y;
      return;
    }
    this.setTargetScale(Math.min(this.camera.targetScale, this.adventureCap()));
  }

  private bindKeys(): void {
    this.unbindKeys();
    const onKeyDown = (e: KeyboardEvent) => {
      if (this.isMoveKey(e.code)) {
        e.preventDefault();
        this.keys.add(e.code);
        if (this.usingWalker()) this.setFollow(true);
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.add(e.code);
      if (e.code === 'Escape' && this.world.adventurePrompt()) {
        e.preventDefault();
        this.ngZone.run(() => this.cancelEnter());
      }
      if (e.code === 'Space' && this.world.simMode() === 'sync') {
        e.preventDefault();
        this.world.stepSyncTurn();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    this.unlisten.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
    );
  }

  private unbindKeys(): void {
    for (const u of this.unlisten) u();
    this.unlisten = [];
  }

  private observeCanvas(): void {
    this.resizeObs?.disconnect();
    this.removeWheel?.();
    const canvas = this.canvasRef.nativeElement;
    this.resizeObs = new ResizeObserver(() => this.fit());
    this.resizeObs.observe(canvas);
    // Wheel must be non-passive so preventDefault can stop page scroll.
    const onWheel = (e: WheelEvent) => this.onWheel(e);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    this.removeWheel = () => canvas.removeEventListener('wheel', onWheel);
  }

  private scheduleFit(): void {
    this.fit();
    requestAnimationFrame(() => {
      this.fit();
      requestAnimationFrame(() => this.fit());
    });
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, this.wheelFactor(e));
  }

  onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.world.adventurePrompt()) return;
    const canvas = this.canvasRef.nativeElement;
    const p = this.ptrPos(e);
    this.ptrs.set(e.pointerId, p);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore — capture can fail for non-primary / synthetic pointers */
    }
    if (this.ptrs.size >= 2) {
      this.dragging = false;
      this.dragMoved = true;
      this.pinchDist = this.pinchGap();
      return;
    }
    this.dragging = true;
    this.dragMoved = false;
    this.lastPtr = p;
  }

  onPointerMove(e: PointerEvent): void {
    const p = this.ptrPos(e);
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p);
    if (this.ptrs.size >= 2) {
      const next = this.pinchGap();
      if (this.pinchDist > 4 && next > 4) {
        const mid = this.pinchMid();
        this.zoomAt(mid.x, mid.y, next / this.pinchDist);
      }
      this.pinchDist = next;
      return;
    }
    this.updateHover(p.x, p.y);
    if (!this.dragging) return;
    const dx = p.x - this.lastPtr.x;
    const dy = p.y - this.lastPtr.y;
    if (Math.hypot(dx, dy) > 3) this.dragMoved = true;
    this.lastPtr = p;
    this.setFollow(false);
    this.zoomPivot = null;
    this.panBy(dx, dy);
    this.confineCameraToIsolation();
    this.refreshPendingDiscover(true);
  }

  onPointerUp(e: PointerEvent): void {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinchDist = 0;
    if (this.ptrs.size === 1) {
      const left = [...this.ptrs.values()][0]!;
      this.lastPtr = left;
      this.dragging = true;
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.dragMoved) this.onClick(e.offsetX, e.offsetY);
  }

  holdMove(e: PointerEvent, code: string): void {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.keys.add(code);
    if (this.usingWalker()) this.setFollow(true);
  }

  releaseMove(code: string): void {
    this.keys.delete(code);
  }

  private ptrPos(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private pinchGap(): number {
    const pts = [...this.ptrs.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
  }

  private pinchMid(): { x: number; y: number } {
    const pts = [...this.ptrs.values()];
    return { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
  }

  private onClick(sx: number, sy: number): void {
    if (this.prefs.adventureMode()) return;
    const worldPt = this.screenToWorld(sx, sy);
    const data = this.world.world();
    if (!data) return;
    const entity = nearestEntity(this.world.liveEntities(), worldPt.x, worldPt.y, this.entityHit());
    if (entity && (this.prefs.showWorldMarkers() || this.world.tileExplored(entity.x, entity.y))) {
      this.setFollow(false);
      this.zoomPivot = null;
      this.camera.targetX = entity.x;
      this.camera.targetY = entity.y;
      this.setTargetScale(Math.max(this.camera.targetScale, 8.4));
      return;
    }
    const node = nodeContaining(data.nodes, worldPt.x, worldPt.y);
    const visible = this.world.visiblePoiIds(this.prefs.adventureMode());
    const poiPool = data.pois.filter((p) => visible.has(p.id));
    const poi = poiPool.length ? this.hitPoi(poiPool, worldPt.x, worldPt.y) : null;
    const target = node
      ? { x: node.cx, y: node.cy }
      : poi
        ? { x: poi.x, y: poi.y }
        : null;
    if (!target) return;
    this.setFollow(false);
    this.zoomPivot = null;
    this.camera.targetX = target.x;
    this.camera.targetY = target.y;
    if (node && !this.world.placeExplored(node)) return;
    if (node) {
      this.isolatePlaceId = node.id;
      this.leavingIsolation = false;
      this.discoverArmed = false;
      this.pendingDiscover = null;
      this.world.markVisited(node);
    } else {
      this.armDiscover();
    }
    this.setTargetScale(DIVE_SCALE);
  }

  private tick(t: number): void {
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    this.syncWalkerMode();
    this.syncPlanetView();
    this.stepPlayer(dt);
    this.confinePlayerToIsolation();
    if (this.world.interior() && this.camera.scale < DETAIL_START) this.world.leaveInterior();
    this.stepSim(dt);
    this.stepCamera(dt);
    this.maybeGenerate();
    this.draw();
    this.hudAcc += dt;
    if (this.hudAcc > 0.08) {
      this.hudAcc = 0;
      if (!this.usingWalker()) {
        this.player.x = this.camera.x;
        this.player.y = this.camera.y;
      }
      const px = this.player.x;
      const py = this.player.y;
      const scale = this.camera.scale;
      this.ngZone.run(() => {
        this.world.setPlayer(px, py, {
          facing: this.player.facing,
          frame: this.player.frame,
          anim: this.player.anim,
        });
        this.world.setScale(scale);
        this.world.bumpSimHud();
      });
      if (this.room.connected() && this.usingWalker()) {
        this.room.publishPose({
          name: this.player.name,
          sheet: this.player.sheet,
          char: this.player.char,
          x: px,
          y: py,
          facing: this.player.facing,
          frame: this.player.frame,
        });
      }
    }
  }

  private stepPlayer(dt: number): void {
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (!mx && !my) {
      if (this.usingWalker()) this.player.frame = 1;
      return;
    }
    const len = Math.hypot(mx, my) || 1;
    const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = moveSpeed(this.moveSpeedBand(), sprinting);
    const world = this.world.world();
    const width = world?.width ?? 192;
    const maxY = (world?.height ?? 192) - 0.5;
    if (!this.usingWalker()) {
      this.zoomPivot = null;
      this.camera.targetX = wrapX(this.camera.targetX + (mx / len) * speed * dt, width);
      this.camera.targetY = clamp(this.camera.targetY + (my / len) * speed * dt, 0.5, maxY);
      return;
    }
    const ox = this.player.x;
    const oy = this.player.y;
    let nx = wrapX(this.player.x + (mx / len) * speed * dt, width);
    let ny = clamp(this.player.y + (my / len) * speed * dt, 0.5, maxY);
    const buildings = collectStreetBuildings(this.world.liveChunks(), nx, ny, 3);
    const walked = resolveInteriorWalk(ox, oy, nx, ny, buildings, this.world.interior());
    this.player.x = walked.x;
    this.player.y = walked.y;
    if (walked.enter) this.world.enterInterior(walked.enter);
    else if (walked.leave) this.world.leaveInterior();
    this.player.facing = facingFromDelta(mx, my);
    const moved = Math.hypot(wrapDeltaX(ox, this.player.x, width), this.player.y - oy);
    this.player.anim += moved * (sprinting ? 10.5 : 8.5);
    this.player.frame = [0, 1, 2, 1][Math.floor(this.player.anim) % 4]!;
    this.noteAdventureEdge(world);
    if (this.world.simMode() === 'sync') {
      this.syncAcc += Math.hypot(this.player.x - ox, this.player.y - oy);
      let turns = 0;
      while (this.syncAcc >= SYNC_TURN_TILES && turns < 8) {
        this.syncAcc -= SYNC_TURN_TILES;
        this.world.stepSyncTurn();
        turns += 1;
      }
    }
  }

  private stepSim(dt: number): void {
    const rate = this.world.simRate();
    if (rate <= 0) return;
    this.world.stepSimulation(dt * rate);
  }

  private stepCamera(dt: number): void {
    const world = this.world.world();
    if (this.camera.followPlayer) {
      this.zoomPivot = null;
      const view = world
        ? presentedFocus(this.player, world.nodes, world.pois, this.camera.scale)
        : this.player;
      this.camera.targetX = view.x;
      this.camera.targetY = view.y;
    }
    const zoomK = 1 - Math.exp(-dt * ZOOM_FOLLOW);
    const panK = 1 - Math.exp(-dt * PAN_FOLLOW);
    this.camera.scale += (this.camera.targetScale - this.camera.scale) * zoomK;
    const scaleEps = Math.max(1e-4, this.camera.targetScale * 0.0015);
    if (Math.abs(this.camera.scale - this.camera.targetScale) <= scaleEps) {
      this.camera.scale = this.camera.targetScale;
    }
    const width = world?.width ?? 192;
    const height = world?.height ?? 192;
    const isolating = !!this.isolatePlaceId && this.camera.scale >= DETAIL_START;
    const viewTilesX = this.viewW / (this.camera.scale * TILE);
    const wrapLon = !isolating && (this.usingGlobe() || viewTilesX < width * 0.92);
    if (this.dollyZoom()) this.zoomPivot = null;
    if (this.zoomPivot && !this.camera.followPlayer) {
      const p = this.zoomPivot;
      const held = this.cameraHolding(p.wx, p.wy, p.sx, p.sy, this.camera.scale);
      this.camera.x = wrapLon ? wrapX(held.x, width) : clamp(held.x, 0, width);
      this.camera.y = clamp(held.y, 0, height);
    } else if (wrapLon) {
      this.camera.x = lerpWrapX(this.camera.x, this.camera.targetX, panK, width);
      this.camera.targetX = wrapX(this.camera.targetX, width);
      this.camera.y += (this.camera.targetY - this.camera.y) * panK;
    } else {
      this.camera.x += (this.camera.targetX - this.camera.x) * panK;
      this.camera.y += (this.camera.targetY - this.camera.y) * panK;
      this.camera.x = clamp(this.camera.x, 0, width);
      this.camera.targetX = clamp(this.camera.targetX, 0, width);
    }
    const ox = this.camera.x;
    const oy = this.camera.y;
    this.camera.y = clamp(this.camera.y, 0, height);
    this.camera.targetY = clampLatY(this.camera.targetY, height);
    this.resyncZoomPivot(ox, oy);
    this.confineCameraToIsolation();
    if (this.leavingIsolation && this.camera.scale <= this.zoneLeaveScale() + 0.03) {
      this.leaveInstance();
    }
  }

  private maybeGenerate(): void {
    if (!this.renderer) return;
    const world = this.world.world();
    if (!world) return;
    const atPlayer = this.prefs.adventureMode() || this.camera.followPlayer;
    const fx = atPlayer ? this.player.x : this.camera.targetX;
    const fy = atPlayer ? this.player.y : this.camera.targetY;
    if (!this.leavingIsolation && this.camera.targetScale >= DETAIL_START) {
      // Dive uses the locked uncharted focus when set, else the live camera/walker tile.
      const dive = this.pendingDiscover ?? { x: fx, y: fy };
      const here = nodeContaining(world.nodes, dive.x, dive.y);
      if (here) {
        // Don't steal into a neighbor place after minting / diving elsewhere.
        if (!this.isolatePlaceId || this.isolatePlaceId === here.id) {
          this.isolatePlaceId = here.id;
          this.discoverArmed = false;
          this.pendingDiscover = null;
          this.world.markVisited(here);
          this.world.attachEdgePois(here.id);
        }
      } else if (this.canDiscoverPlace()) {
        const node = this.world.ensureZoneAt(dive.x, dive.y, this.camera.targetScale);
        this.discoverArmed = false;
        this.pendingDiscover = null;
        if (node) {
          this.isolatePlaceId = node.id;
          this.world.markVisited(node);
          this.world.attachEdgePois(node.id);
        }
      }
    }
    if (
      this.prefs.adventureMode() &&
      !this.leavingIsolation &&
      (this.isolatePlaceId || this.camera.targetScale >= DETAIL_START)
    ) {
      this.syncIsolationLock(world);
    }
    const iso = this.isolationTiles();
    if (!iso) return;
    // Edge-POI attach can expand the isolation set and invalidate chunk data — always
    // catch up with a full bake when any iso tile is missing a ground bake.
    const missingBake = iso.some((t) => !this.renderer!.hasChunkBake(t.x, t.y));
    if (missingBake) {
      this.fillAndBake(iso);
    } else {
      this.bakeCreated(this.world.ensureTiles(iso, CHUNK_STREAM_PER_FRAME, { x: fx, y: fy }), world);
    }
    const dropped = this.world.dropChunksNotIn(iso);
    for (const key of dropped) {
      const [sx, sy] = key.split(',');
      this.renderer.forgetChunk(Number(sx), Number(sy));
    }
  }

  private fillAndBake(tiles: { x: number; y: number }[]): void {
    const world = this.world.world();
    if (!world || !this.renderer || !tiles.length) return;
    // Bake the whole place up front so isolation never shows empty black tiles.
    const created = this.world.ensureTiles(tiles, tiles.length, { x: this.player.x, y: this.player.y });
    // Also rebake any iso tiles that already had chunk data but lost their ground canvas
    // (e.g. after edge-POI attach invalidated neighbors).
    const chunks = this.world.liveChunks();
    const needBake: ChunkData[] = [...created];
    const seen = new Set(created.map((c) => chunkKey(c.wx, c.wy)));
    for (const t of tiles) {
      const key = chunkKey(t.x, t.y);
      if (seen.has(key)) continue;
      if (this.renderer.hasChunkBake(t.x, t.y)) continue;
      const chunk = chunks.get(key);
      if (!chunk) continue;
      needBake.push(chunk);
      seen.add(key);
    }
    this.bakeCreated(needBake, world);
  }

  private bakeCreated(created: ChunkData[], world: NonNullable<ReturnType<WorldService['world']>>): void {
    if (!this.renderer || !created.length) return;
    const chunks = this.world.liveChunks();
    const createdKeys = new Set(created.map((c) => chunkKey(c.wx, c.wy)));
    for (const chunk of created) {
      this.renderer.bakeChunk(chunk, chunks, world);
    }
    const rebake = new Set<string>();
    for (const chunk of created) {
      for (const [ox, oy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const key = chunkKey(chunk.wx + ox, chunk.wy + oy);
        if (createdKeys.has(key)) continue;
        if (chunks.has(key)) rebake.add(key);
      }
    }
    for (const key of rebake) {
      const neighbor = chunks.get(key);
      if (neighbor) this.renderer.bakeChunk(neighbor, chunks, world);
    }
  }

  private applyZoom(next: number): boolean {
    if (this.isolatePlaceId && next < this.zoneLeaveScale()) {
      this.leavingIsolation = true;
    } else if (this.isolatePlaceId && next >= this.zoneLeaveScale()) {
      this.leavingIsolation = false;
    }
    if (this.world.adventurePrompt()) {
      this.ngZone.run(() => this.world.adventurePrompt.set(false));
    }
    this.setTargetScale(next);
    return true;
  }

  private setTargetScale(next: number): void {
    const clamped = clamp(next, this.minZoom(), this.maxZoom());
    if (clamped + 1e-4 < this.camera.targetScale) this.noteZoomOut();
    else if (clamped > this.camera.targetScale + 1e-4) this.armDiscover();
    this.camera.targetScale = clamped;
  }

  private armDiscover(): void {
    this.discoverArmed = true;
    this.refreshPendingDiscover();
  }

  private refreshPendingDiscover(force = false): void {
    if (!this.discoverArmed || this.isolatePlaceId) {
      this.pendingDiscover = null;
      return;
    }
    const world = this.world.world();
    if (!world) return;
    // Keep an existing uncharted lock through the dive so a neighbor city can't steal it.
    if (
      !force &&
      this.pendingDiscover &&
      !nodeContaining(world.nodes, this.pendingDiscover.x, this.pendingDiscover.y)
    ) {
      return;
    }
    const focus = this.diveFocus();
    if (!nodeContaining(world.nodes, focus.x, focus.y)) {
      this.pendingDiscover = { x: focus.x, y: focus.y };
    } else {
      this.pendingDiscover = null;
    }
  }

  private diveFocus(): { x: number; y: number } {
    if (this.prefs.adventureMode() || this.camera.followPlayer) {
      return { x: this.player.x, y: this.player.y };
    }
    return { x: this.camera.targetX, y: this.camera.targetY };
  }

  private noteZoomOut(): void {
    this.discoverArmed = false;
    this.pendingDiscover = null;
    this.lastZoomOutAt = performance.now();
  }

  private canDiscoverPlace(): boolean {
    if (!this.discoverArmed) return false;
    if (this.camera.targetScale + 0.04 < this.camera.scale) return false;
    return performance.now() >= this.lastZoomOutAt + ZOOM_OUT_DISCOVER_COOLDOWN_MS;
  }

  private adventureCap(): number {
    return ADVENTURE_ASK_SCALE - 0.08;
  }

  private isolationTiles(): { x: number; y: number }[] | null {
    const world = this.world.world();
    if (!world) return null;
    const link = this.prefs.adventureLinkNeighbors() ? 1 : 0;
    if (this.isolatePlaceId) {
      const locked = world.nodes.find((n) => n.id === this.isolatePlaceId);
      if (locked?.tiles?.length) {
        const key = `${locked.id}:${locked.tiles.length}:${world.nodes.length}:${link}`;
        if (this.isoTilesCache?.key === key) return this.isoTilesCache.tiles;
        const tiles = this.adventureTiles(world.nodes, locked);
        this.isoTilesCache = { key, tiles };
        return tiles;
      }
      this.isolatePlaceId = null;
      this.leavingIsolation = false;
      this.isoTilesCache = null;
    }
    if (this.prefs.adventureMode()) {
      const lock = this.world.adventureLock();
      if (this.world.adventurePrompt() && lock?.tiles.length) {
        const key = `lock:${lock.tiles.length}:${link}`;
        if (this.isoTilesCache?.key === key) return this.isoTilesCache.tiles;
        const tiles = fillEnclosedPockets(lock.tiles);
        this.isoTilesCache = { key, tiles };
        return tiles;
      }
    }
    this.isoTilesCache = null;
    return null;
  }

  private adventureTiles(nodes: MapNode[], place: MapNode): { x: number; y: number }[] {
    const raw =
      this.prefs.adventureMode() && this.prefs.adventureLinkNeighbors()
        ? connectedPlaceTiles(nodes, place)
        : [...(place.tiles ?? [])];
    const walls = new Set(touchingPoiTiles(nodes, place).map((t) => `${t.x},${t.y}`));
    return fillEnclosedPockets(raw, ADVENTURE_POCKET_MAX, walls);
  }

  private isolationPlace(): MapNode | null {
    const world = this.world.world();
    if (!world || !this.isolatePlaceId) return null;
    return world.nodes.find((n) => n.id === this.isolatePlaceId) ?? null;
  }

  private confineCameraToIsolation(): void {
    if (this.prefs.adventureMode()) return;
    if (this.camera.scale < DETAIL_START && this.camera.targetScale < DETAIL_START) return;
    if (this.isolatePlaceId) this.world.attachEdgePois(this.isolatePlaceId);
    const tiles = this.isolationTiles();
    if (!tiles?.length) return;
    if (!pointInTiles(tiles, this.camera.targetX, this.camera.targetY)) {
      const edge = closestOnTiles(tiles, this.camera.targetX, this.camera.targetY);
      this.camera.targetX = edge.x;
      this.camera.targetY = edge.y;
    }
    if (!pointInTiles(tiles, this.camera.x, this.camera.y)) {
      const edge = closestOnTiles(tiles, this.camera.x, this.camera.y);
      this.camera.x = edge.x;
      this.camera.y = edge.y;
    }
  }

  private confinePlayerToIsolation(): void {
    if (this.prefs.adventureMode()) return;
    if (this.camera.scale < DETAIL_START) return;
    const tiles = this.isolationTiles();
    if (!tiles?.length) return;
    if (pointInTiles(tiles, this.player.x, this.player.y)) return;
    const edge = closestOnTiles(tiles, this.player.x, this.player.y);
    this.player.x = edge.x;
    this.player.y = edge.y;
  }

  private zoneFitScale(): number {
    const place = this.isolationPlace();
    if (!place?.tiles?.length) return DETAIL_START;
    return fitScaleForBounds(boundsFromTiles(place.tiles), this.viewW, this.viewH);
  }

  private zoneLeaveScale(): number {
    const framed = Math.min(this.zoneFitScale(), DIVE_SCALE);
    return Math.max(this.overworldMinZoom(), leaveScaleForFit(framed));
  }

  private syncIsolationLock(world: NonNullable<ReturnType<WorldService['world']>>): void {
    const place = knownPlaceAt(world.nodes, this.player.x, this.player.y);
    if (!place) return;
    const before = world.nodes.length;
    this.world.attachEdgePois(place.id);
    if (world.nodes.length !== before) this.isoTilesCache = null;
    const tiles = this.adventureTiles(world.nodes, place);
    const lock = this.world.adventureLock();
    const lockMatches =
      !!lock &&
      lock.tiles.length === tiles.length &&
      tiles.every((t) => lock.keys.has(`${t.x},${t.y}`));
    if (this.isolatePlaceId === place.id && lockMatches) return;
    this.isolatePlaceId = place.id;
    this.leavingIsolation = false;
    this.world.claimAdventurePockets(place, tiles);
    this.world.adventureLock.set(regionFromTiles(tiles));
    this.world.markVisited(place);
    this.isoTilesCache = null;
    this.fillAndBake(tiles);
  }

  private noteAdventureEdge(world: ReturnType<WorldService['world']>): void {
    if (!this.prefs.adventureMode() || this.camera.scale < ADVENTURE_ASK_SCALE) return;
    const place = world ? knownPlaceAt(world.nodes, this.player.x, this.player.y) : null;
    if (place) {
      this.edgeReturn = { x: this.player.x, y: this.player.y };
      return;
    }
    if (!this.isolatePlaceId || this.leavingIsolation) return;
    this.applyZoom(Math.min(this.zoneLeaveScale() - 0.04, this.adventureCap()));
  }

  leaveAdventure(): void {
    this.exitAdventure();
  }

  private exitAdventure(): void {
    this.keys.clear();
    this.edgeReturn = null;
    this.world.clearAdventure();
    this.setFollow(false);
  }

  private leaveInstance(): void {
    this.isolatePlaceId = null;
    this.leavingIsolation = false;
    this.isoTilesCache = null;
    this.zoomPivot = null;
    this.discoverArmed = false;
    this.pendingDiscover = null;
    this.lastZoomOutAt = performance.now();
    this.world.clearAdventure();
    this.setFollow(this.usingWalker());
  }

  private usingWalker(): boolean {
    return this.prefs.adventureMode();
  }

  /** Fixed travel rates by view mode — not scaled by camera zoom. */
  private moveSpeedBand(): 'iso' | 'overworld' | 'globe' {
    if (this.showingGlobe()) return 'globe';
    if (this.isolatePlaceId && !this.leavingIsolation) return 'iso';
    return 'overworld';
  }

  private globeAllowed(): boolean {
    return this.prefs.planetView() && !this.prefs.adventureMode();
  }

  private usingGlobe(scale = this.camera.scale): boolean {
    return this.globeAllowed();
  }

  /** 3D planet is on screen. Closer in, the view flattens to the 2D map. */
  private showingGlobe(scale = this.camera.scale): boolean {
    if (!this.globeAllowed()) return false;
    return globeShowsWholePlanet(this.viewW, this.viewH, scale, this.world.world()?.width ?? 192);
  }

  /** Zoom changes distance only — no cursor-lock pan. */
  private dollyZoom(scale?: number): boolean {
    // Keep the dive locked on uncharted land next to a city/town instead of sliding into it.
    if (this.pendingDiscover && !this.isolatePlaceId) return true;
    const scales = scale == null ? [this.camera.scale, this.camera.targetScale] : [scale];
    const width = this.world.world()?.width ?? 192;
    if (scales.some((s) => this.showingGlobe(s))) return true;
    return scales.some((s) => this.viewW / (Math.max(1e-6, s) * TILE) >= width * 0.92);
  }

  private setFollow(on: boolean): void {
    const follow = on && this.usingWalker();
    this.camera.followPlayer = follow;
    this.world.followPlayer.set(follow);
  }

  private syncWalkerMode(): void {
    const on = this.usingWalker();
    if (on === this.walkerOn) return;
    this.walkerOn = on;
    if (on) {
      this.player.x = this.camera.targetX;
      this.player.y = this.camera.targetY;
      this.setFollow(true);
      const lo = this.overworldMinZoom();
      if (this.camera.targetScale < lo) this.setTargetScale(lo);
      if (this.camera.scale < lo) this.camera.scale = lo;
      return;
    }
    this.leaveAdventure();
  }

  private syncPlanetView(): void {
    const on = this.globeAllowed();
    if (on === this.planetOn) return;
    this.planetOn = on;
    if (on) return;
    const lo = this.overworldMinZoom();
    if (this.camera.targetScale < lo) this.setTargetScale(lo);
    if (this.camera.scale < lo) this.camera.scale = lo;
  }

  private overworldMinZoom(): number {
    return minScaleFor(this.world.world()?.width ?? 192);
  }

  private minZoom(): number {
    if (this.isolatePlaceId && !this.leavingIsolation) return this.zoneLeaveScale();
    if (!this.globeAllowed()) return this.overworldMinZoom();
    return globeMinScaleFor(this.world.world()?.width ?? 192);
  }

  private maxZoom(): number {
    return MAX_SCALE;
  }

  private applyStartCamera(
    data: NonNullable<ReturnType<WorldService['world']>>,
    snap: boolean,
  ): void {
    if (!this.prefs.adventureMode()) {
      this.fitCameraScale(data.width, snap);
      return;
    }
    this.setFollow(true);
    const place = knownPlaceAt(data.nodes, this.player.x, this.player.y);
    if (place) {
      this.world.markVisited(place);
      this.isolatePlaceId = place.id;
      this.leavingIsolation = false;
      const tiles = this.adventureTiles(data.nodes, place);
      this.world.claimAdventurePockets(place, tiles);
      this.world.adventureLock.set(regionFromTiles(tiles));
      this.fillAndBake(tiles);
    } else {
      this.confirmEnter(false);
    }
    this.setTargetScale(CLOSE_SCALE);
    if (snap) this.camera.scale = CLOSE_SCALE;
  }

  private fitCameraScale(width: number, snap: boolean): void {
    const start = startScaleFor(width);
    this.setTargetScale(start);
    if (snap) this.camera.scale = start;
  }

  private draw(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    const world = this.world.world();
    if (!ctx || !world || !this.renderer) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const isolate = this.isolationTiles();
    this.syncZoneBake(world);
    this.syncCloudBake(world);
    const globeState = {
      width: world.width,
      height: world.height,
      cameraX: this.camera.x,
      cameraY: this.camera.y,
      scale: this.camera.scale,
      viewW: this.viewW,
      viewH: this.viewH,
      markers: this.globeMarkers(world),
      zoneTex: this.renderer.zoneBake,
      zoneAmt: (this.world.showOutlines() ? 1 : 0.55) * this.prefs.zoneOverlay(),
    };
    if (this.showingGlobe() && this.globe?.ready) {
      this.setGlobeVisible(true);
      ctx.clearRect(0, 0, this.viewW, this.viewH);
      this.globe.draw(globeState);
      return;
    }
    this.setGlobeVisible(false);
    if (this.showingGlobe()) {
      drawCanvasGlobe(ctx, this.renderer.worldBake, globeState);
      return;
    }
    const focus = this.camera.followPlayer ? this.player : { x: this.camera.x, y: this.camera.y };
    const detail = detailAnchor(world, focus.x, focus.y);
    const isolateKeys = isolate ? new Set(isolate.map((t) => chunkKey(t.x, t.y))) : null;
    const live = this.world.liveEntities();
    const markersOn = this.prefs.showWorldMarkers();
    const inIso = (e: (typeof live)[number]) =>
      !!isolateKeys && isolateKeys.has(chunkKey(Math.floor(e.x), Math.floor(e.y)));
    const exploredOrMarked = (e: (typeof live)[number]) =>
      markersOn || this.world.tileExplored(e.x, e.y);
    const entities = isolateKeys
      ? live.filter((e) => inIso(e))
      : live.filter(exploredOrMarked);
    const markerEntities =
      markersOn && isolateKeys ? live.filter((e) => !inIso(e)) : undefined;
    const remotePlayers = this.room.connected()
      ? this.room.peers().map((p) => ({
          id: p.id,
          name: p.name,
          x: p.x,
          y: p.y,
          facing: p.facing,
          frame: p.frame,
          anim: 0,
          sheet: p.sheet,
          char: p.char,
        }))
      : [];
    this.renderer.draw(ctx, world, this.camera, this.player, this.viewW, this.viewH, {
      showOutlines: this.world.showOutlines(),
      showPois: this.world.showPois(),
      visiblePoiIds: this.world.visiblePoiIds(this.prefs.adventureMode()),
      hoveredId: this.world.hoveredNodeId(),
      hoveredPoiId: this.world.hoveredPoiId(),
      hoveredEntityId: this.world.hoveredEntityId(),
      detailNode: detail,
      entities,
      markerEntities,
      chunks: this.world.liveChunks(),
      isolateTiles: isolate,
      showPlayer: this.usingWalker(),
      outlineAmt: this.prefs.zoneOverlay(),
      cloudAmt: this.prefs.fogCover(),
      nametagScale: this.prefs.nametagScale(),
      remotePlayers,
      localPeerId: this.room.connected() ? selfId : null,
      speechBubbles: [
        ...(this.prefs.npcChatter() ? this.world.npcBubbles() : []),
        ...(this.room.connected() ? this.room.bubbles() : []),
      ],
      interior: this.world.interior(),
    });
  }

  private updateHover(sx: number, sy: number): void {
    const world = this.world.world();
    if (!world) return;
    const hover = this.screenToWorld(sx, sy);
    const node = nodeContaining(world.nodes, hover.x, hover.y);
    const visible = this.world.visiblePoiIds(this.prefs.adventureMode());
    const poiPool = world.pois.filter((p) => visible.has(p.id));
    const poi = poiPool.length ? this.hitPoi(poiPool, hover.x, hover.y) : null;
    const entityHit = this.entityHit();
    let entity = nearestEntity(this.world.liveEntities(), hover.x, hover.y, entityHit);
    if (entity && !this.prefs.showWorldMarkers() && !this.world.tileExplored(entity.x, entity.y)) entity = null;
    const entityId = entity?.id ?? null;
    const nodeId = entityId ? null : (node?.id ?? null);
    const poiId =
      entityId || !poi
        ? null
        : !node || Math.hypot(hover.x - poi.x, hover.y - poi.y) <= Math.hypot(hover.x - node.cx, hover.y - node.cy)
          ? poi.id
          : null;
    if (
      nodeId !== this.world.hoveredNodeId() ||
      poiId !== this.world.hoveredPoiId() ||
      entityId !== this.world.hoveredEntityId()
    ) {
      this.ngZone.run(() => {
        this.world.setHovered(nodeId);
        this.world.setHoveredPoi(poiId);
        this.world.setHoveredEntity(entityId);
      });
    }
  }

  private hitPoi(pois: { id: string; x: number; y: number }[], x: number, y: number) {
    const hit = Math.max(2.6, 12 / this.camera.scale);
    let best: { id: string; x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const poi of pois) {
      const d = Math.hypot(x - poi.x, y - poi.y);
      if (d <= hit && d < bestD) {
        best = poi;
        bestD = d;
      }
    }
    return best;
  }

  private entityHit(): number {
    return Math.max(1.05, 16 / (this.camera.scale * TILE));
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    if (this.world.adventurePrompt()) return;
    const nextScale = this.camera.targetScale * factor;
    const dolly = this.dollyZoom(this.camera.scale) || this.dollyZoom(nextScale);
    const zoomed = this.applyZoom(nextScale);
    if (!zoomed) return;
    if (this.camera.followPlayer || dolly) {
      this.zoomPivot = null;
      if (dolly) {
        this.camera.scale += (this.camera.targetScale - this.camera.scale) * ZOOM_CATCH;
      }
      return;
    }
    const cx = this.viewW / 2;
    const cy = this.viewH / 2;
    const ax = cx + (sx - cx) * ZOOM_CURSOR_BIAS;
    const ay = cy + (sy - cy) * ZOOM_CURSOR_BIAS;
    const pivot = this.screenToWorld(ax, ay);
    const dest = this.cameraHolding(pivot.x, pivot.y, ax, ay, this.camera.targetScale);
    const width = this.world.world()?.width ?? 192;
    const height = this.world.world()?.height ?? 192;
    this.camera.targetX = wrapX(dest.x, width);
    this.camera.targetY = clampLatY(dest.y, height);
    this.zoomPivot = { wx: pivot.x, wy: pivot.y, sx: ax, sy: ay };
    this.camera.scale += (this.camera.targetScale - this.camera.scale) * ZOOM_CATCH;
    const live = this.cameraHolding(pivot.x, pivot.y, ax, ay, this.camera.scale);
    this.camera.x = wrapX(live.x, width);
    this.camera.y = clampLatY(live.y, height);
  }

  private wheelFactor(e: WheelEvent): number {
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= this.viewH;
    return Math.exp(-dy * 0.0032);
  }

  private cameraHolding(
    wx: number,
    wy: number,
    sx: number,
    sy: number,
    scale: number,
  ): { x: number; y: number } {
    return {
      x: wx - (sx - this.viewW / 2) / (scale * TILE),
      y: wy - (sy - this.viewH / 2) / (scale * TILE),
    };
  }

  private resyncZoomPivot(ox: number, oy: number): void {
    const p = this.zoomPivot;
    if (!p) return;
    if (this.camera.scale === this.camera.targetScale) {
      this.zoomPivot = null;
      return;
    }
    if (this.camera.x === ox && this.camera.y === oy) return;
    p.wx = this.camera.x + (p.sx - this.viewW / 2) / (this.camera.scale * TILE);
    p.wy = this.camera.y + (p.sy - this.viewH / 2) / (this.camera.scale * TILE);
    const dest = this.cameraHolding(p.wx, p.wy, p.sx, p.sy, this.camera.targetScale);
    this.camera.targetX = dest.x;
    this.camera.targetY = dest.y;
  }

  private screenToWorld(sx: number, sy: number, scale = this.camera.scale): { x: number; y: number } {
    const world = this.world.world();
    const width = world?.width ?? 192;
    const height = world?.height ?? 192;
    if (this.showingGlobe(scale)) {
      const args = {
        width,
        height,
        cameraX: this.camera.x,
        cameraY: this.camera.y,
        scale,
        viewW: this.viewW,
        viewH: this.viewH,
      };
      const hit = this.globe?.ready ? this.globe.unproject(sx, sy, args) : unprojectCanvasGlobe(sx, sy, args);
      if (hit) return { x: wrapX(hit.x, width), y: clamp(hit.y, 0, height) };
    }
    return {
      x: wrapX(this.camera.x + (sx - this.viewW / 2) / (scale * TILE), width),
      y: this.camera.y + (sy - this.viewH / 2) / (scale * TILE),
    };
  }

  private panBy(dx: number, dy: number): void {
    const world = this.world.world();
    const width = world?.width ?? 192;
    const height = world?.height ?? 192;
    if (this.showingGlobe()) {
      const planetPx = Math.max(80, globeFillFor(this.camera.scale, width) * Math.min(this.viewW, this.viewH));
      const next = orbitGlobeLook(this.camera.targetX, this.camera.targetY, width, height, dx, dy, planetPx);
      this.camera.targetX = wrapX(next.x, width);
      this.camera.targetY = clampLatY(next.y, height);
      return;
    }
    const mx = dx / (this.camera.scale * TILE);
    const my = dy / (this.camera.scale * TILE);
    const viewTilesX = this.viewW / (this.camera.scale * TILE);
    const wrapLon = viewTilesX < width * 0.92;
    this.camera.targetX = wrapLon
      ? wrapX(this.camera.targetX - mx, width)
      : clamp(this.camera.targetX - mx, 0, width);
    this.camera.targetY = clampLatY(this.camera.targetY - my, height);
  }

  private globeMarkers(world: NonNullable<ReturnType<WorldService['world']>>): GlobeMarker[] {
    const marks: GlobeMarker[] = [];
    const t = globeMorphT(this.camera.scale, world.width);
    const base = 5.5 + t * 3.5;
    if (this.world.showPois() || this.prefs.adventureMode()) {
      for (const poi of world.pois) {
        if (!this.world.poiRevealed(poi, this.prefs.adventureMode())) continue;
        marks.push({
          x: poi.x,
          y: poi.y,
          color: [0.76, 0.61, 0.83],
          size: base - 0.8,
        });
      }
    }
    for (const ent of this.world.liveEntities()) {
      if (!this.prefs.showWorldMarkers() && !this.world.tileExplored(ent.x, ent.y)) continue;
      const city = ent.kind === 'army';
      const caravan = ent.kind === 'caravan';
      marks.push({
        x: ent.x,
        y: ent.y,
        color: city ? [1, 0.71, 0.71] : caravan ? [0.88, 0.66, 0.42] : [0.49, 0.81, 0.63],
        size: base - (city ? 0.2 : 1.1),
      });
    }
    marks.push({
      x: this.player.x,
      y: this.player.y,
      color: this.room.connected() ? peerMarkerRgb(selfId) : [0.91, 0.76, 0.48],
      size: base + 2.5,
    });
    if (this.room.connected()) {
      for (const peer of this.room.peers()) {
        marks.push({
          x: peer.x,
          y: peer.y,
          color: peerMarkerRgb(peer.id),
          size: base + 2.2,
        });
      }
    }
    return marks;
  }

  private syncZoneBake(world: NonNullable<ReturnType<WorldService['world']>>): void {
    const last = world.nodes[world.nodes.length - 1];
    const key = `${world.seed}:${world.nodes.length}:${last?.id ?? ''}`;
    if (key === this.zoneBakeKey && this.renderer?.zoneBake) return;
    this.zoneBakeKey = key;
    const canvas = this.renderer?.bakeZones(world) ?? null;
    this.globe?.setZones(canvas);
  }

  private syncCloudBake(world: NonNullable<ReturnType<WorldService['world']>>): void {
    if (!this.prefs.fogEnabled || this.prefs.fogCover() < 0.01) {
      if (this.cloudBakeKey !== 'off') {
        this.cloudBakeKey = 'off';
        if (this.renderer) this.renderer.cloudBake = null;
        this.globe?.setClouds(null);
      }
      return;
    }
    const key = `${this.world.fogKey()}:fog`;
    if (key === this.cloudBakeKey && this.renderer?.cloudBake) return;
    this.cloudBakeKey = key;
    this.renderer?.bakeClouds(world, this.world.exploredTileKeys());
  }

  private setGlobeVisible(on: boolean): void {
    const el = this.globeRef?.nativeElement;
    if (!el) return;
    el.style.visibility = on ? 'visible' : 'hidden';
  }

  private fit(): void {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    this.viewW = Math.max(1, rect.width);
    this.viewH = Math.max(1, rect.height);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(this.viewW * dpr);
    canvas.height = Math.floor(this.viewH * dpr);
    this.globe?.resize(this.viewW, this.viewH, dpr);
  }

  private isMoveKey(code: string): boolean {
    return (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    );
  }
}
