import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  ADVENTURE_ASK_SCALE,
  CameraState,
  ChunkData,
  DETAIL_START,
  DIVE_SCALE,
  ZOOM_OUT_DISCOVER_COOLDOWN_MS,
  MapNode,
  MAX_SCALE,
  PlayerState,
  SPEED_REF_SCALE,
  SYNC_TURN_TILES,
  TILE,
  WALK_SPEED,
  clamp,
  chunkKey,
  detailAnchor,
  growAdventureRegion,
  connectedPlaceTiles,
  fillEnclosedPockets,
  regionFromTiles,
  knownPlaceAt,
  nodeApproaching,
  nodeContaining,
  closestOnNode,
  boundsFromTiles,
  clampLatY,
  globeActive,
  globeMinScaleFor,
  globeMorphT,
  lerpWrapX,
  pointInNode,
  placeTouchesTile,
  presentedFocus,
  startScaleFor,
  wrapDeltaX,
  wrapX,
} from '../../models/world.models';
import { AssetLibrary } from '../../engine/assets';
import { nearestEntity } from '../../engine/entities';
import { drawCanvasGlobe, GlobeMarker, GlobeRenderer, unprojectCanvasGlobe } from '../../engine/globe';
import { WorldRenderer } from '../../engine/renderer';
import { PreferencesService } from '../../services/preferences.service';
import { WorldService } from '../../services/world.service';

@Component({
  selector: 'app-map-viewport',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    <div class="stage">
      <canvas #globe class="globe" aria-hidden="true"></canvas>
      <canvas #canvas class="map" [class.locked]="world.adventurePrompt()"></canvas>
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
  `,
})
export class MapViewportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('globe', { static: true }) globeRef!: ElementRef<HTMLCanvasElement>;

  loaded = false;

  readonly world = inject(WorldService);
  private readonly prefs = inject(PreferencesService);
  private readonly ngZone = inject(NgZone);
  private readonly assets = new AssetLibrary();
  private renderer: WorldRenderer | null = null;
  private globe: GlobeRenderer | null = null;
  private raf = 0;
  private lastT = 0;
  private hudAcc = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private readonly keys = new Set<string>();
  private dragging = false;
  private dragMoved = false;
  private lastPtr = { x: 0, y: 0 };
  private viewW = 1;
  private viewH = 1;
  private syncAcc = 0;
  private edgeReturn: { x: number; y: number } | null = null;
  private isolatePlaceId: string | null = null;
  private entering = false;
  private discoverArmed = false;
  private lastZoomOutAt = Number.NEGATIVE_INFINITY;
  private readonly player: PlayerState = { x: 80, y: 80 };
  private readonly camera: CameraState = {
    x: 96,
    y: 96,
    scale: 0.26,
    targetX: 96,
    targetY: 96,
    targetScale: 0.26,
    followPlayer: true,
  };
  private resizeObs: ResizeObserver | null = null;
  private unlisten: Array<() => void> = [];

  async ngAfterViewInit(): Promise<void> {
    await this.assets.load();
    this.ngZone.run(() => {
      this.loaded = true;
      this.world.generating.set(true);
    });
    await new Promise((r) => setTimeout(r, 40));
    const data = this.world.world() ?? this.world.init();
    const start = this.world.player();
    this.player.x = start.x;
    this.player.y = start.y;
    this.camera.x = start.x;
    this.camera.y = start.y;
    this.camera.targetX = start.x;
    this.camera.targetY = start.y;
    this.camera.followPlayer = true;
    this.fitCameraScale(data.width, true);
    this.renderer = new WorldRenderer(this.assets);
    this.renderer.bakeWorld(data);
    this.globe = new GlobeRenderer(this.globeRef.nativeElement);
    if (this.globe.ready) this.globe.setTexture(this.renderer.worldBake);
    this.ngZone.run(() => this.world.generating.set(false));

    const canvas = this.canvasRef.nativeElement;
    this.bind(canvas);
    this.fit();
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
    for (const u of this.unlisten) u();
    this.globe?.dispose();
    this.globe = null;
  }

  reloadFromWorld(): void {
    const data = this.world.world();
    const start = this.world.player();
    this.player.x = start.x;
    this.player.y = start.y;
    this.camera.x = start.x;
    this.camera.y = start.y;
    this.camera.targetX = start.x;
    this.camera.targetY = start.y;
    this.camera.followPlayer = true;
    this.world.clearAdventure();
    this.edgeReturn = null;
    this.isolatePlaceId = null;
    this.discoverArmed = false;
    this.lastZoomOutAt = performance.now();
    this.fitCameraScale(data?.width ?? 192, true);
    this.renderer?.clearChunks();
    if (data) this.renderer?.bakeWorld(data);
    if (data && this.globe?.ready) this.globe.setTexture(this.renderer?.worldBake ?? null);
  }

  clearStreamed(): void {
    this.world.forgetChunks();
    this.renderer?.clearChunks();
  }

  recenter(): void {
    this.camera.followPlayer = true;
    this.world.followPlayer.set(true);
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
    const from =
      !snapZoom && this.edgeReturn
        ? knownPlaceAt(data.nodes, this.edgeReturn.x, this.edgeReturn.y)
        : null;
    const hug =
      from && placeTouchesTile(from, wx, wy) ? (from.tiles ?? []) : undefined;
    const expand = !!from && from.origin === 'generated' && !!hug?.length;
    const region = growAdventureRegion(
      wx,
      wy,
      data.width,
      data.height,
      this.world.adventureBlocked(),
      data.seed ^ (wx * 73856093) ^ (wy * 19349663),
      hug,
    );
    const node =
      expand && from
        ? this.world.expandAdventurePlace(from, region.tiles)
        : this.world.registerAdventureInstance(region);
    this.isolatePlaceId = node?.id ?? null;
    this.world.adventurePrompt.set(false);
    const tiles = node ? this.adventureTiles(data.nodes, node) : region.tiles;
    if (node) this.world.claimAdventurePockets(node, tiles);
    this.world.adventureLock.set(regionFromTiles(tiles));
    this.camera.followPlayer = true;
    this.world.followPlayer.set(true);
    if (snapZoom) {
      this.setTargetScale(MAX_SCALE);
      this.camera.scale = MAX_SCALE;
    }
    this.fillAndBake(tiles);
  }

  private autoEnter(): void {
    if (this.entering) return;
    this.entering = true;
    try {
      this.confirmEnter(false);
    } finally {
      this.entering = false;
    }
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

  private bind(canvas: HTMLCanvasElement): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (this.isMoveKey(e.code)) {
        e.preventDefault();
        this.keys.add(e.code);
        this.camera.followPlayer = true;
        this.world.followPlayer.set(true);
      }
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
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.world.adventurePrompt()) return;
      const before = this.screenToWorld(e.offsetX, e.offsetY);
      const factor = Math.exp(-e.deltaY * 0.0032);
      const zoomed = this.applyZoom(this.camera.targetScale * factor);
      if (zoomed && !this.camera.followPlayer) {
        const after = this.screenToWorld(e.offsetX, e.offsetY, this.camera.targetScale);
        const width = this.world.world()?.width ?? 192;
        const height = this.world.world()?.height ?? 192;
        this.camera.targetX = wrapX(this.camera.targetX + wrapDeltaX(after.x, before.x, width), width);
        this.camera.targetY = clampLatY(this.camera.targetY + (before.y - after.y), height);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (this.world.adventurePrompt()) return;
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.dragMoved = false;
      this.lastPtr = { x: e.offsetX, y: e.offsetY };
      canvas.classList.add('dragging');
    };
    const onMove = (e: PointerEvent) => {
      this.updateHover(e.offsetX, e.offsetY);
      if (!this.dragging) return;
      const dx = e.offsetX - this.lastPtr.x;
      const dy = e.offsetY - this.lastPtr.y;
      if (Math.hypot(dx, dy) > 3) this.dragMoved = true;
      this.lastPtr = { x: e.offsetX, y: e.offsetY };
      this.camera.followPlayer = false;
      this.world.followPlayer.set(false);
      this.panBy(dx, dy);
      this.confineCameraToIsolation();
    };
    const onUp = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      canvas.classList.remove('dragging');
      if (!this.dragMoved) this.onClick(e.offsetX, e.offsetY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    this.unlisten.push(
      () => canvas.removeEventListener('wheel', onWheel),
      () => canvas.removeEventListener('pointerdown', onDown),
      () => canvas.removeEventListener('pointermove', onMove),
      () => canvas.removeEventListener('pointerup', onUp),
      () => canvas.removeEventListener('pointercancel', onUp),
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
    );
    this.resizeObs = new ResizeObserver(() => this.fit());
    this.resizeObs.observe(canvas);
  }

  private onClick(sx: number, sy: number): void {
    if (this.prefs.adventureMode()) return;
    const worldPt = this.screenToWorld(sx, sy);
    const data = this.world.world();
    if (!data) return;
    const entity = nearestEntity(this.world.liveEntities(), worldPt.x, worldPt.y, this.entityHit());
    if (entity) {
      this.camera.followPlayer = false;
      this.world.followPlayer.set(false);
      this.camera.targetX = entity.x;
      this.camera.targetY = entity.y;
      this.setTargetScale(Math.max(this.camera.targetScale, 8.4));
      return;
    }
    const node = nodeContaining(data.nodes, worldPt.x, worldPt.y);
    const poi = this.world.showPois() ? this.hitPoi(data.pois, worldPt.x, worldPt.y) : null;
    const target = node
      ? { x: node.cx, y: node.cy }
      : poi
        ? { x: poi.x, y: poi.y }
        : null;
    if (!target) return;
    this.camera.followPlayer = false;
    this.world.followPlayer.set(false);
    this.camera.targetX = target.x;
    this.camera.targetY = target.y;
    if (node) {
      this.isolatePlaceId = node.id;
      this.discoverArmed = false;
    } else {
      this.armDiscover();
    }
    this.setTargetScale(DIVE_SCALE);
  }

  private tick(t: number): void {
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    this.stepPlayer(dt);
    this.stepSim(dt);
    this.stepCamera(dt);
    this.maybeGenerate();
    this.draw();
    this.hudAcc += dt;
    if (this.hudAcc > 0.08) {
      this.hudAcc = 0;
      const px = this.player.x;
      const py = this.player.y;
      const scale = this.camera.scale;
      this.ngZone.run(() => {
        this.world.setPlayer(px, py);
        this.world.setScale(scale);
        this.world.bumpSimHud();
      });
    }
  }

  private stepPlayer(dt: number): void {
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (!mx && !my) return;
    const len = Math.hypot(mx, my) || 1;
    const speed = clamp(WALK_SPEED * (SPEED_REF_SCALE / this.camera.scale), 0.38, 92);
    const ox = this.player.x;
    const oy = this.player.y;
    const world = this.world.world();
    const width = world?.width ?? 192;
    const maxY = (world?.height ?? 192) - 0.5;
    this.player.x = wrapX(this.player.x + (mx / len) * speed * dt, width);
    this.player.y = clamp(this.player.y + (my / len) * speed * dt, 0.5, maxY);
    this.confinePlayerToIsolation();
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
    if (this.adventureNeedsAsk() && !this.world.adventurePrompt()) {
      if (this.camera.scale < ADVENTURE_ASK_SCALE && this.camera.targetScale >= ADVENTURE_ASK_SCALE) {
        this.setTargetScale(this.adventureCap());
      }
    }
    if (!this.adventureNeedsAsk() && this.world.adventurePrompt()) {
      this.ngZone.run(() => this.world.adventurePrompt.set(false));
    }
    const world = this.world.world();
    if (this.camera.followPlayer) {
      const view = world
        ? presentedFocus(this.player, world.nodes, world.pois, this.camera.scale)
        : this.player;
      this.camera.targetX = view.x;
      this.camera.targetY = view.y;
    }
    const k = 1 - Math.exp(-dt * 9);
    const width = world?.width ?? 192;
    const height = world?.height ?? 192;
    this.camera.scale += (this.camera.targetScale - this.camera.scale) * k;
    const isolating = !!this.isolatePlaceId && this.camera.scale >= DETAIL_START;
    const viewTilesX = this.viewW / (this.camera.scale * TILE);
    const wrapLon = !isolating && (globeActive(this.camera.scale, width) || viewTilesX < width * 0.92);
    if (wrapLon) {
      this.camera.x = lerpWrapX(this.camera.x, this.camera.targetX, k, width);
      this.camera.targetX = wrapX(this.camera.targetX, width);
    } else {
      this.camera.x += (this.camera.targetX - this.camera.x) * k;
      this.camera.x = clamp(this.camera.x, 0, width);
      this.camera.targetX = clamp(this.camera.targetX, 0, width);
    }
    this.camera.y += (this.camera.targetY - this.camera.y) * k;
    this.camera.y = clamp(this.camera.y, 0, height);
    this.camera.targetY = clampLatY(this.camera.targetY, height);
    this.confineCameraToIsolation();
  }

  private maybeGenerate(): void {
    if (!this.renderer) return;
    const world = this.world.world();
    if (!world) return;
    if (this.prefs.adventureMode()) {
      const iso = this.isolationTiles();
      if (!iso) return;
      if (this.camera.scale < DETAIL_START && !this.world.adventurePrompt()) return;
      this.syncIsolationLock(world);
      this.bakeCreated(this.world.ensureTiles(iso, 32), world);
      return;
    }
    if (this.canDiscoverPlace() && this.camera.targetScale >= DETAIL_START) {
      const node = this.world.ensureZoneAt(this.camera.targetX, this.camera.targetY, this.camera.targetScale);
      this.discoverArmed = false;
      if (node) this.isolatePlaceId = node.id;
    }
    const iso = this.isolationTiles();
    if (!iso) return;
    this.bakeCreated(this.world.ensureTiles(iso, 32), world);
    const dropped = this.world.dropChunksNotIn(iso);
    for (const key of dropped) {
      const [sx, sy] = key.split(',');
      this.renderer.forgetChunk(Number(sx), Number(sy));
    }
  }

  private fillAndBake(tiles: { x: number; y: number }[]): void {
    const world = this.world.world();
    if (!world || !this.renderer) return;
    for (const t of tiles) this.renderer.forgetChunk(t.x, t.y);
    this.world.rebuildTiles(tiles);
    this.rebakeIsolation(tiles, world);
  }

  private rebakeIsolation(
    tiles: { x: number; y: number }[],
    world: NonNullable<ReturnType<WorldService['world']>>,
  ): void {
    if (!this.renderer) return;
    const chunks = this.world.liveChunks();
    const seen = new Set<string>();
    for (const t of tiles) {
      const key = chunkKey(t.x, t.y);
      if (seen.has(key)) continue;
      seen.add(key);
      const chunk = chunks.get(key);
      if (chunk) this.renderer.bakeChunk(chunk, chunks, world);
    }
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
    const lo = this.minZoom();
    if (this.adventureNeedsAsk()) {
      const cap = this.adventureCap();
      if (this.camera.scale >= ADVENTURE_ASK_SCALE) {
        if (next < ADVENTURE_ASK_SCALE && this.world.adventurePrompt()) {
          this.ngZone.run(() => this.world.adventurePrompt.set(false));
        }
        this.setTargetScale(clamp(next, lo, MAX_SCALE));
        return true;
      }
      if (!this.camera.followPlayer) {
        this.setTargetScale(clamp(Math.min(next, cap), lo, MAX_SCALE));
        return true;
      }
      if (next < ADVENTURE_ASK_SCALE && this.world.adventurePrompt()) {
        this.ngZone.run(() => this.world.adventurePrompt.set(false));
      }
      if (next >= ADVENTURE_ASK_SCALE) {
        this.setTargetScale(clamp(cap, lo, MAX_SCALE));
        if (!this.world.adventurePrompt()) {
          this.ngZone.run(() => this.world.adventurePrompt.set(true));
        }
        return false;
      }
    } else if (this.world.adventurePrompt()) {
      this.ngZone.run(() => this.world.adventurePrompt.set(false));
    }
    this.setTargetScale(clamp(next, lo, MAX_SCALE));
    return true;
  }

  private setTargetScale(next: number): void {
    const clamped = clamp(next, this.minZoom(), MAX_SCALE);
    if (clamped + 1e-4 < this.camera.targetScale) this.noteZoomOut();
    else if (clamped > this.camera.targetScale + 1e-4) this.armDiscover();
    this.camera.targetScale = clamped;
  }

  private armDiscover(): void {
    this.discoverArmed = true;
  }

  private noteZoomOut(): void {
    this.discoverArmed = false;
    this.lastZoomOutAt = performance.now();
  }

  private canDiscoverPlace(): boolean {
    if (!this.discoverArmed) return false;
    if (this.camera.targetScale + 0.04 < this.camera.scale) return false;
    return performance.now() >= this.lastZoomOutAt + ZOOM_OUT_DISCOVER_COOLDOWN_MS;
  }

  private adventureNeedsAsk(): boolean {
    if (!this.prefs.adventureMode()) return false;
    const world = this.world.world();
    if (!world) return true;
    if (knownPlaceAt(world.nodes, this.player.x, this.player.y)) return false;
    return true;
  }

  private adventureCap(): number {
    return ADVENTURE_ASK_SCALE - 0.08;
  }

  private isolationTiles(): { x: number; y: number }[] | null {
    const world = this.world.world();
    if (!world) return null;
    const zoomed = this.camera.scale >= DETAIL_START || this.world.adventurePrompt();
    if (!zoomed) {
      if (this.camera.targetScale < DETAIL_START) this.isolatePlaceId = null;
      return null;
    }
    if (this.isolatePlaceId) {
      const locked = world.nodes.find((n) => n.id === this.isolatePlaceId);
      if (locked?.tiles?.length) return this.adventureTiles(world.nodes, locked);
    }
    const focus = this.camera.followPlayer
      ? this.player
      : { x: this.camera.targetX, y: this.camera.targetY };
    const place =
      knownPlaceAt(world.nodes, focus.x, focus.y) ??
      nodeApproaching(world.nodes, focus.x, focus.y) ??
      knownPlaceAt(world.nodes, this.player.x, this.player.y) ??
      nodeApproaching(world.nodes, this.player.x, this.player.y);
    if (place) {
      this.isolatePlaceId = place.id;
      return this.adventureTiles(world.nodes, place);
    }
    if (this.prefs.adventureMode()) {
      const lock = this.world.adventureLock();
      if (this.world.adventurePrompt() && lock?.tiles.length) return fillEnclosedPockets(lock.tiles);
    }
    return null;
  }

  private adventureTiles(nodes: MapNode[], place: MapNode): { x: number; y: number }[] {
    const raw =
      this.prefs.adventureMode() && this.prefs.adventureLinkNeighbors()
        ? connectedPlaceTiles(nodes, place)
        : [...(place.tiles ?? [])];
    return fillEnclosedPockets(raw);
  }

  private isolationPlace(): MapNode | null {
    const world = this.world.world();
    if (!world || !this.isolatePlaceId) return null;
    return world.nodes.find((n) => n.id === this.isolatePlaceId) ?? null;
  }

  private confineCameraToIsolation(): void {
    if (this.prefs.adventureMode()) return;
    if (this.camera.scale < DETAIL_START && this.camera.targetScale < DETAIL_START) return;
    const place = this.isolationPlace();
    if (!place?.tiles?.length) return;
    const b = boundsFromTiles(place.tiles);
    const pad = 1.2;
    this.camera.targetX = clamp(this.camera.targetX, b.x0 - pad, b.x1 + pad);
    this.camera.targetY = clamp(this.camera.targetY, b.y0 - pad, b.y1 + pad);
    this.camera.x = clamp(this.camera.x, b.x0 - pad, b.x1 + pad);
    this.camera.y = clamp(this.camera.y, b.y0 - pad, b.y1 + pad);
  }

  private confinePlayerToIsolation(): void {
    if (this.prefs.adventureMode()) return;
    if (this.camera.scale < DETAIL_START) return;
    const place = this.isolationPlace();
    if (!place?.tiles?.length) return;
    if (pointInNode(place, this.player.x, this.player.y)) return;
    const edge = closestOnNode(place, this.player.x, this.player.y);
    this.player.x = edge.x;
    this.player.y = edge.y;
  }

  private syncIsolationLock(world: NonNullable<ReturnType<WorldService['world']>>): void {
    const place = knownPlaceAt(world.nodes, this.player.x, this.player.y);
    if (!place) return;
    const tiles = this.adventureTiles(world.nodes, place);
    const lock = this.world.adventureLock();
    const lockMatches =
      !!lock &&
      lock.tiles.length === tiles.length &&
      tiles.every((t) => lock.keys.has(`${t.x},${t.y}`));
    if (this.isolatePlaceId === place.id && lockMatches) return;
    this.isolatePlaceId = place.id;
    this.world.claimAdventurePockets(place, tiles);
    this.world.adventureLock.set(regionFromTiles(tiles));
    this.fillAndBake(tiles);
  }

  private noteAdventureEdge(world: ReturnType<WorldService['world']>): void {
    if (!this.prefs.adventureMode() || this.camera.scale < ADVENTURE_ASK_SCALE) return;
    const place = world ? knownPlaceAt(world.nodes, this.player.x, this.player.y) : null;
    if (place) {
      this.edgeReturn = { x: this.player.x, y: this.player.y };
      return;
    }
    this.ngZone.run(() => this.autoEnter());
  }

  leaveAdventure(): void {
    this.exitAdventure();
  }

  private exitAdventure(): void {
    this.keys.clear();
    this.edgeReturn = null;
    this.isolatePlaceId = null;
    this.world.clearAdventure();
    this.camera.followPlayer = true;
    this.world.followPlayer.set(true);
    this.camera.targetX = this.player.x;
    this.camera.targetY = this.player.y;
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
    this.fitCameraScale(this.world.world()?.width ?? 192, true);
  }

  private minZoom(): number {
    const width = this.world.world()?.width ?? 192;
    return globeMinScaleFor(width);
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
    const usingGlobe = !isolate && globeActive(this.camera.scale, world.width);
    const globeState = {
      width: world.width,
      height: world.height,
      cameraX: this.camera.x,
      cameraY: this.camera.y,
      scale: this.camera.scale,
      viewW: this.viewW,
      viewH: this.viewH,
      markers: this.globeMarkers(world),
    };
    if (usingGlobe && this.globe?.ready) {
      this.setGlobeVisible(true);
      ctx.clearRect(0, 0, this.viewW, this.viewH);
      this.globe.draw(globeState);
      return;
    }
    this.setGlobeVisible(false);
    if (usingGlobe) {
      drawCanvasGlobe(ctx, this.renderer.worldBake, globeState);
      return;
    }
    const focus = this.camera.followPlayer ? this.player : { x: this.camera.x, y: this.camera.y };
    const detail = detailAnchor(world.nodes, world.pois, focus.x, focus.y);
    const view = presentedFocus(this.player, world.nodes, world.pois, this.camera.scale);
    const isolateKeys = isolate ? new Set(isolate.map((t) => chunkKey(t.x, t.y))) : null;
    const entities = isolateKeys
      ? this.world.liveEntities().filter((e) =>
          isolateKeys.has(chunkKey(Math.floor(e.x), Math.floor(e.y))),
        )
      : this.world.liveEntities();
    this.renderer.draw(ctx, world, this.camera, view, this.viewW, this.viewH, {
      showOutlines: this.world.showOutlines(),
      showPois: this.world.showPois(),
      hoveredId: this.world.hoveredNodeId(),
      hoveredPoiId: this.world.hoveredPoiId(),
      hoveredEntityId: this.world.hoveredEntityId(),
      detailNode: detail,
      entities,
      chunks: this.world.liveChunks(),
      isolateTiles: isolate,
    });
  }

  private updateHover(sx: number, sy: number): void {
    const world = this.world.world();
    if (!world) return;
    const hover = this.screenToWorld(sx, sy);
    const node = nodeContaining(world.nodes, hover.x, hover.y);
    const poi = this.world.showPois() ? this.hitPoi(world.pois, hover.x, hover.y) : null;
    const entityHit = this.entityHit();
    const entity = nearestEntity(this.world.liveEntities(), hover.x, hover.y, entityHit);
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

  private screenToWorld(sx: number, sy: number, scale = this.camera.scale): { x: number; y: number } {
    const world = this.world.world();
    const width = world?.width ?? 192;
    const height = world?.height ?? 192;
    const isolated = this.camera.scale >= DETAIL_START && !!this.isolatePlaceId;
    if (!isolated && globeActive(scale, width)) {
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
    const t = globeActive(this.camera.scale, width) ? globeMorphT(this.camera.scale, width) : 0;
    const panX = dx / (this.camera.scale * TILE);
    const panY = dy / (this.camera.scale * TILE);
    let mx = panX;
    let my = panY;
    if (t > 0.04) {
      const planetPx = Math.max(80, 0.64 * Math.min(this.viewW, this.viewH));
      const sphereX = (dx / planetPx) * (width * 0.5);
      const sphereY = (dy / planetPx) * (height * 0.5);
      mx = panX + (sphereX - panX) * t;
      my = panY + (sphereY - panY) * t;
    }
    const viewTilesX = this.viewW / (this.camera.scale * TILE);
    const wrapLon = globeActive(this.camera.scale, width) || viewTilesX < width * 0.92;
    this.camera.targetX = wrapLon
      ? wrapX(this.camera.targetX - mx, width)
      : clamp(this.camera.targetX - mx, 0, width);
    this.camera.targetY = clampLatY(this.camera.targetY - my, height);
  }

  private globeMarkers(world: NonNullable<ReturnType<WorldService['world']>>): GlobeMarker[] {
    const marks: GlobeMarker[] = [];
    const t = globeMorphT(this.camera.scale, world.width);
    const base = 5.5 + t * 3.5;
    if (this.world.showOutlines()) {
      for (const node of world.nodes) {
        const authored = node.origin === 'authored';
        const city = node.kind === 'city' || node.kind === 'town';
        marks.push({
          x: node.cx,
          y: node.cy,
          color: authored ? [0.88, 0.66, 0.42] : [0.49, 0.81, 0.63],
          size: base + (city ? 3 : authored ? 1.5 : 0),
        });
      }
    }
    if (this.world.showPois()) {
      for (const poi of world.pois) {
        marks.push({
          x: poi.x,
          y: poi.y,
          color: [0.76, 0.61, 0.83],
          size: base - 0.8,
        });
      }
    }
    marks.push({
      x: this.player.x,
      y: this.player.y,
      color: [0.91, 0.76, 0.48],
      size: base + 2.5,
    });
    return marks;
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
