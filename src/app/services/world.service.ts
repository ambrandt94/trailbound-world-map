import { Injectable, computed, signal } from '@angular/core';
import {
  BIOME_LABELS,
  Biome,
  ChunkData,
  DETAIL_START,
  DEFAULT_WORLD_SETTINGS,
  FAST_RATE,
  GAME_HOURS_PER_REAL_SEC,
  GENERATED_ZONE_RADIUS,
  KIND_LABELS,
  LocationInfo,
  MapEntity,
  MapNode,
  PLAY_RATE,
  POI_LABELS,
  PointOfInterest,
  PlayerState,
  SIM_LABELS,
  SYNC_TURN_HOURS,
  SimHud,
  SimMode,
  WorldData,
  WorldSettings,
  chunkKey,
  biomeAt,
  boundsFromTiles,
  clamp,
  clampSettings,
  ensureNodeRegion,
  fillEnclosedPockets,
  formatClock,
  growTileBlob,
  nodeApproaching,
  nodeContaining,
  poiApproaching,
  poiAsNode,
  presentedFocus,
  scaleLabel,
  tileKey,
  AdventureRegion,
  Vec2,
} from '../models/world.models';
import { Rng } from '../engine/noise';
import { generatedName, kindForBiome } from '../engine/names';
import { nearestEntity, spawnEntities, stepEntities } from '../engine/entities';
import { generateChunk, neighborMap } from '../engine/chunk-gen';
import { poiKindToNodeKind } from '../engine/pois';
import { defaultPlayerStart, generateWorld } from '../engine/world-gen';

const SEED_KEY = 'tb-world-map-seed';
const OUTLINES_KEY = 'tb-world-map-outlines';
const POIS_KEY = 'tb-world-map-pois';
const nodesKey = (seed: number) => `tb-world-map-nodes-v6-${seed}`;

const SETTINGS_KEY = 'tb-world-map-setup';
const SIM_KEY = 'tb-world-map-sim';
const DEFAULT_SEED = 7741;
const START_HOUR = 8;

@Injectable({ providedIn: 'root' })
export class WorldService {
  readonly world = signal<WorldData | null>(null);
  readonly player = signal<PlayerState>({ x: 80, y: 80 });
  readonly showOutlines = signal(this.readOutlines());
  readonly showPois = signal(this.readPois());
  readonly hoveredNodeId = signal<string | null>(null);
  readonly hoveredPoiId = signal<string | null>(null);
  readonly hoveredEntityId = signal<string | null>(null);
  readonly followPlayer = signal(true);
  readonly scale = signal(0.26);
  readonly ready = signal(false);
  readonly generating = signal(false);
  readonly settings = signal<WorldSettings>(this.readSettings());
  readonly simMode = signal<SimMode>(this.readSimMode());
  readonly adventureLock = signal<AdventureRegion | null>(null);
  readonly adventurePrompt = signal(false);
  readonly simHours = signal(START_HOUR);
  readonly simTick = signal(0);
  readonly entities = signal<MapEntity[]>([]);
  readonly generatedCount = computed(
    () => this.world()?.nodes.filter((n) => n.origin === 'generated').length ?? 0,
  );
  readonly cityCount = computed(
    () => this.world()?.nodes.filter((n) => n.kind === 'city').length ?? 0,
  );
  readonly poiCount = computed(() => this.world()?.pois.length ?? 0);
  readonly chunkCount = computed(() => {
    this.simTick();
    return this.chunks.size;
  });
  readonly simHud = computed<SimHud>(() => {
    const hours = this.simHours();
    this.simTick();
    const { day, clock } = formatClock(hours);
    const list = this.entities();
    const player = this.player();
    const near = nearestEntity(list, player.x, player.y, 10);
    return {
      mode: this.simMode(),
      hours,
      day,
      clock,
      wanderers: list.filter((e) => e.kind === 'wanderer').length,
      caravans: list.filter((e) => e.kind === 'caravan').length,
      armies: list.filter((e) => e.kind === 'army').length,
      nearbyName: near?.name ?? null,
      nearbyKind: near?.kind ?? null,
      nearbyDist: near ? Math.hypot(near.x - player.x, near.y - player.y) : null,
    };
  });
  readonly simLine = computed(() => {
    const hud = this.simHud();
    return `Day ${hud.day} · ${hud.clock} · ${SIM_LABELS[hud.mode]}`;
  });

  readonly location = computed<LocationInfo>(() => {
    const world = this.world();
    const player = this.player();
    const scale = this.scale();
    if (!world) {
      return {
        x: 0,
        y: 0,
        viewX: 0,
        viewY: 0,
        biome: Biome.Plains,
        biomeLabel: '—',
        inNode: false,
        atGate: false,
        nodeName: null,
        nodeKind: null,
        nodeOrigin: null,
        poiName: null,
        poiKind: null,
        scaleLabel: scaleLabel(scale),
        scale,
        uncharted: true,
      };
    }
    const biome = biomeAt(world, player.x, player.y);
    const inside = nodeContaining(world.nodes, player.x, player.y);
    const near = nodeApproaching(world.nodes, player.x, player.y);
    const poi = poiApproaching(world.pois, player.x, player.y);
    const view = presentedFocus(player, world.nodes, world.pois, scale);
    const atGate = !!near && !inside;
    return {
      x: player.x,
      y: player.y,
      viewX: view.x,
      viewY: view.y,
      biome,
      biomeLabel: BIOME_LABELS[biome],
      inNode: !!inside,
      atGate,
      nodeName: near?.name ?? null,
      nodeKind: near?.kind ?? null,
      nodeOrigin: near?.origin ?? null,
      poiName: poi?.name ?? null,
      poiKind: poi?.kind ?? null,
      scaleLabel: scaleLabel(scale),
      scale,
      uncharted: !near && !poi,
    };
  });

  readonly statusLine = computed(() => {
    const loc = this.location();
    const poiLabel = loc.poiKind ? POI_LABELS[loc.poiKind] : null;
    if (loc.inNode && loc.nodeName) {
      if (poiLabel) return `In ${loc.nodeName} · ${poiLabel}`;
      const origin = loc.nodeOrigin === 'authored' ? 'authored' : 'generated';
      const kind = loc.nodeKind ? KIND_LABELS[loc.nodeKind] : 'zone';
      return `In ${loc.nodeName} · ${origin} ${kind}`;
    }
    if (loc.atGate && loc.nodeName) {
      if (poiLabel) return `At the edge of ${loc.nodeName} · ${poiLabel}`;
      const kind = loc.nodeKind ? KIND_LABELS[loc.nodeKind] : 'zone';
      return `At the edge of ${loc.nodeName} · ${kind}`;
    }
    if (loc.poiName && loc.poiKind) {
      return `Near ${loc.poiName} · ${POI_LABELS[loc.poiKind]}`;
    }
    return 'Uncharted territory';
  });

  private readonly chunks = new Map<string, ChunkData>();
  private seed = DEFAULT_SEED;
  private simRng = new Rng(DEFAULT_SEED);
  private clockHours = START_HOUR;

  get currentSeed(): number {
    return this.seed;
  }

  init(): WorldData {
    const stored = Number(localStorage.getItem(SEED_KEY));
    this.seed = Number.isFinite(stored) && stored !== 0 ? stored : DEFAULT_SEED;
    return this.rebuild(this.seed);
  }

  rebuild(seed: number): WorldData {
    this.seed = seed >>> 0 || DEFAULT_SEED;
    localStorage.setItem(SEED_KEY, String(this.seed));
    const world = generateWorld(this.seed, this.settings());
    const extra = this.readGenerated(this.seed);
    const used = new Set(world.nodes.map((n) => n.id));
    for (const node of extra) {
      if (used.has(node.id)) continue;
      world.nodes.push(ensureNodeRegion(node, world));
      used.add(node.id);
    }
    this.chunks.clear();
    this.world.set(world);
    this.player.set(defaultPlayerStart(world));
    this.followPlayer.set(true);
    this.simHours.set(START_HOUR);
    this.clockHours = START_HOUR;
    this.entities.set(spawnEntities(world, this.seed));
    this.simRng = new Rng(this.seed ^ 0x91a2);
    this.simTick.update((n) => n + 1);
    this.ready.set(true);
    this.clearAdventure();
    return world;
  }

  toggleOutlines(): void {
    this.showOutlines.update((v) => {
      const next = !v;
      localStorage.setItem(OUTLINES_KEY, next ? '1' : '0');
      return next;
    });
  }

  togglePois(): void {
    this.showPois.update((v) => {
      const next = !v;
      localStorage.setItem(POIS_KEY, next ? '1' : '0');
      return next;
    });
  }

  setHovered(id: string | null): void {
    if (this.hoveredNodeId() !== id) this.hoveredNodeId.set(id);
  }

  setHoveredPoi(id: string | null): void {
    if (this.hoveredPoiId() !== id) this.hoveredPoiId.set(id);
  }

  setHoveredEntity(id: string | null): void {
    if (this.hoveredEntityId() !== id) this.hoveredEntityId.set(id);
  }

  setSimMode(mode: SimMode): void {
    this.simMode.set(mode);
    localStorage.setItem(SIM_KEY, mode);
  }

  liveEntities(): MapEntity[] {
    return this.entities();
  }

  stepSimulation(dt: number): void {
    const world = this.world();
    if (!world || dt <= 0) return;
    const list = this.entities();
    stepEntities(world, list, dt, this.simRng);
    this.clockHours += dt * GAME_HOURS_PER_REAL_SEC;
  }

  bumpSimHud(): void {
    this.simHours.set(this.clockHours);
    this.simTick.update((n) => n + 1);
  }

  stepSyncTurn(): void {
    this.stepSimulation(SYNC_TURN_HOURS / GAME_HOURS_PER_REAL_SEC);
  }

  simRate(): number {
    const mode = this.simMode();
    if (mode === 'play') return PLAY_RATE;
    if (mode === 'fast') return FAST_RATE;
    return 0;
  }

  setScale(scale: number): void {
    this.scale.set(scale);
  }

  setPlayer(x: number, y: number): void {
    const world = this.world();
    if (!world) return;
    const nx = clamp(x, 0.5, world.width - 0.5);
    const ny = clamp(y, 0.5, world.height - 0.5);
    this.player.set({ x: nx, y: ny });
  }

  movePlayer(dx: number, dy: number): void {
    const p = this.player();
    this.setPlayer(p.x + dx, p.y + dy);
  }

  chunk(wx: number, wy: number): ChunkData | undefined {
    return this.chunks.get(chunkKey(wx, wy));
  }

  hasChunk(wx: number, wy: number): boolean {
    return this.chunks.has(chunkKey(wx, wy));
  }

  adventureBlocked(): Set<string> {
    const blocked = new Set<string>();
    for (const key of this.chunks.keys()) blocked.add(key);
    const world = this.world();
    if (!world) return blocked;
    for (const node of world.nodes) {
      for (const t of node.tiles ?? []) blocked.add(tileKey(t.x, t.y));
    }
    return blocked;
  }

  registerAdventureInstance(region: AdventureRegion): MapNode | null {
    const world = this.world();
    if (!world || !region.tiles.length) return null;
    const existing = world.nodes.find((n) =>
      n.tiles?.some((t) => region.keys.has(tileKey(t.x, t.y))),
    );
    if (existing) return existing;
    const cx = (region.x0 + region.x1) / 2;
    const cy = (region.y0 + region.y1) / 2;
    const biome = biomeAt(world, cx, cy);
    const used = new Set(world.nodes.map((n) => n.name));
    const rng = new Rng((world.seed ^ (region.tiles.length * 2654435761) ^ (region.x0 << 16) ^ region.y0) >>> 0);
    const kind =
      biome === Biome.Forest || biome === Biome.DarkForest
        ? 'grove'
        : biome === Biome.Water || biome === Biome.Sand || biome === Biome.Marsh
          ? 'shore'
          : biome === Biome.Mountain || biome === Biome.Snow || biome === Biome.Taiga
            ? 'pass'
            : 'meadow';
    const node: MapNode = {
      id: `adv-${region.x0}-${region.y0}-${region.tiles.length}-${world.nodes.length}`,
      name: generatedName(rng, used),
      origin: 'generated',
      kind,
      biome,
      cx,
      cy,
      radius: Math.max(1.6, Math.sqrt(region.tiles.length / Math.PI)),
      seed: rng.int(1, 1_000_000),
      tiles: region.tiles.map((t) => ({ x: t.x, y: t.y })),
      x0: region.x0,
      y0: region.y0,
      x1: region.x1,
      y1: region.y1,
    };
    world.nodes = [...world.nodes, node];
    this.world.set({ ...world, nodes: world.nodes });
    this.persistGenerated(world);
    this.simTick.update((n) => n + 1);
    return node;
  }

  /** Attach enclosed uncharted pockets to this place so isolation generates and keeps them. */
  claimAdventurePockets(place: MapNode, filled: Vec2[]): void {
    const world = this.world();
    if (!world || !filled.length) return;
    const owned = new Set<string>();
    for (const node of world.nodes) {
      for (const t of node.tiles ?? []) owned.add(tileKey(t.x, t.y));
    }
    const extra: Vec2[] = [];
    for (const t of filled) {
      if (t.x < 0 || t.y < 0 || t.x >= world.width || t.y >= world.height) continue;
      const key = tileKey(t.x, t.y);
      if (owned.has(key)) continue;
      owned.add(key);
      extra.push({ x: t.x, y: t.y });
    }
    if (!extra.length) return;
    place.tiles = [...(place.tiles ?? []), ...extra];
    const b = boundsFromTiles(place.tiles);
    place.x0 = b.x0;
    place.y0 = b.y0;
    place.x1 = b.x1;
    place.y1 = b.y1;
    this.world.set({ ...world, nodes: world.nodes });
    this.persistGenerated(world);
    this.simTick.update((n) => n + 1);
  }

  /** Grow an existing generated place by absorbing a new uncharted lobe. */
  expandAdventurePlace(place: MapNode, extra: Vec2[]): MapNode {
    this.claimAdventurePockets(place, extra);
    this.claimAdventurePockets(place, fillEnclosedPockets(place.tiles ?? []));
    const tiles = place.tiles ?? [];
    if (tiles.length) {
      const b = boundsFromTiles(tiles);
      place.cx = (b.x0 + b.x1) / 2;
      place.cy = (b.y0 + b.y1) / 2;
      place.radius = Math.max(1.6, Math.sqrt(tiles.length / Math.PI));
      const world = this.world();
      if (world) {
        this.world.set({ ...world, nodes: world.nodes });
        this.persistGenerated(world);
      }
    }
    return place;
  }

  /** Recreate isolation chunks now that neighbors exist, so edges and overlays match. */
  rebuildTiles(tiles: Vec2[]): ChunkData[] {
    const world = this.world();
    if (!world || !tiles.length) return [];
    const unique: Vec2[] = [];
    const seen = new Set<string>();
    for (const t of tiles) {
      const key = chunkKey(t.x, t.y);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(t);
      this.chunks.delete(key);
    }
    const build = () => {
      for (const t of unique) {
        const chunk = generateChunk(world, t.x, t.y, neighborMap(this.chunks, t.x, t.y));
        this.chunks.set(chunkKey(t.x, t.y), chunk);
      }
    };
    build();
    build();
    this.simTick.update((n) => n + 1);
    return unique.map((t) => this.chunks.get(chunkKey(t.x, t.y))!);
  }

  applySettings(raw: Partial<WorldSettings>): WorldSettings {
    const next = clampSettings(raw);
    this.settings.set(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  liveChunks(): Map<string, ChunkData> {
    return this.chunks;
  }

  forgetChunks(): void {
    this.chunks.clear();
    this.simTick.update((n) => n + 1);
  }

  dropChunksNotIn(tiles: Vec2[]): string[] {
    const keep = new Set(tiles.map((t) => chunkKey(t.x, t.y)));
    const dropped: string[] = [];
    for (const key of [...this.chunks.keys()]) {
      if (keep.has(key)) continue;
      this.chunks.delete(key);
      dropped.push(key);
    }
    if (dropped.length) this.simTick.update((n) => n + 1);
    return dropped;
  }

  clearAdventure(): void {
    this.adventureLock.set(null);
    this.adventurePrompt.set(false);
  }

  ensureChunks(x0: number, y0: number, x1: number, y1: number, maxNew = 16): ChunkData[] {
    const world = this.world();
    if (!world) return [];
    const cx0 = Math.max(0, Math.floor(x0));
    const cy0 = Math.max(0, Math.floor(y0));
    const cx1 = Math.min(world.width - 1, Math.floor(x1));
    const cy1 = Math.min(world.height - 1, Math.floor(y1));
    const midX = (cx0 + cx1) / 2;
    const midY = (cy0 + cy1) / 2;
    const jobs: Vec2[] = [];
    for (let wy = cy0; wy <= cy1; wy++) {
      for (let wx = cx0; wx <= cx1; wx++) {
        if (this.chunks.has(chunkKey(wx, wy))) continue;
        jobs.push({ x: wx, y: wy });
      }
    }
    jobs.sort(
      (a, b) =>
        Math.hypot(a.x + 0.5 - midX, a.y + 0.5 - midY) - Math.hypot(b.x + 0.5 - midX, b.y + 0.5 - midY),
    );
    return this.createChunkJobs(jobs, maxNew);
  }

  ensureTiles(tiles: Vec2[], maxNew = 128): ChunkData[] {
    const jobs = tiles.filter((t) => !this.chunks.has(chunkKey(t.x, t.y)));
    return this.createChunkJobs(jobs, maxNew, false);
  }

  private createChunkJobs(jobs: Vec2[], maxNew: number, discoverPois = false): ChunkData[] {
    const world = this.world();
    if (!world) return [];
    const created: ChunkData[] = [];
    for (const job of jobs.slice(0, maxNew)) {
      if (discoverPois) {
        const poi = poiApproaching(world.pois, job.x + 0.5, job.y + 0.5);
        if (poi && !world.nodes.some((n) => n.id === poi.id)) this.nodeFromPoi(world, poi);
      }
      const chunk = generateChunk(world, job.x, job.y, neighborMap(this.chunks, job.x, job.y));
      this.chunks.set(chunkKey(job.x, job.y), chunk);
      created.push(chunk);
    }
    if (created.length) this.simTick.update((n) => n + 1);
    return created;
  }

  evictDistantChunks(cx: number, cy: number, keep = 28): string[] {
    const dropped: string[] = [];
    for (const [key, chunk] of this.chunks) {
      if (Math.max(Math.abs(chunk.wx - cx), Math.abs(chunk.wy - cy)) <= keep) continue;
      this.chunks.delete(key);
      dropped.push(key);
    }
    return dropped;
  }

  ensureZoneAt(x: number, y: number, scale: number): MapNode | null {
    const world = this.world();
    if (!world || scale < DETAIL_START) {
      return nodeApproaching(world?.nodes ?? [], x, y);
    }
    const near = nodeApproaching(world.nodes, x, y);
    if (near) return near;
    const poi = poiApproaching(world.pois, x, y);
    if (poi) return this.nodeFromPoi(world, poi);
    return this.discoverPlace(world, x, y);
  }

  clearGenerated(): void {
    const world = this.world();
    if (!world) return;
    world.nodes = world.nodes.filter((n) => n.origin === 'authored');
    this.chunks.clear();
    localStorage.removeItem(nodesKey(this.seed));
    this.world.set({ ...world, nodes: [...world.nodes] });
    this.clearAdventure();
    this.simTick.update((n) => n + 1);
  }

  private nodeFromPoi(world: WorldData, poi: PointOfInterest): MapNode {
    const existing = world.nodes.find((n) => n.id === poi.id);
    if (existing) return existing;
    const blocked = new Set<string>();
    for (const n of world.nodes) {
      for (const t of n.tiles ?? []) blocked.add(`${t.x},${t.y}`);
    }
    const kind = poiKindToNodeKind(poi.kind);
    const radius = Math.max(poi.radius, GENERATED_ZONE_RADIUS);
    const blob = growTileBlob(poi.x, poi.y, radius, {
      kind,
      seed: poi.seed,
      biomes: world.biomes,
      width: world.width,
      height: world.height,
      blocked,
      biomeBias: 0.18,
    });
    const node: MapNode = {
      ...poiAsNode(poi),
      kind,
      radius,
      tiles: blob.tiles,
      x0: blob.x0,
      y0: blob.y0,
      x1: blob.x1,
      y1: blob.y1,
    };
    world.nodes = [...world.nodes, node];
    this.world.set({ ...world, nodes: world.nodes });
    this.persistGenerated(world);
    this.simTick.update((n) => n + 1);
    return node;
  }

  /** First dive into uncharted land: mint a persisted settlement-sized place. */
  private discoverPlace(world: WorldData, x: number, y: number): MapNode | null {
    const wx = Math.floor(x);
    const wy = Math.floor(y);
    if (wx < 0 || wy < 0 || wx >= world.width || wy >= world.height) return null;
    const biome = biomeAt(world, x, y);
    if (biome === Biome.Water) return null;
    const covered = nodeContaining(world.nodes, x, y);
    if (covered) return covered;
    const rng = new Rng((world.seed ^ (wx * 73856093) ^ (wy * 19349663) ^ 0x51ed) >>> 0);
    const kind = kindForBiome(biome, rng);
    const radius = GENERATED_ZONE_RADIUS + rng.range(-0.5, 1.3);
    const blocked = new Set<string>();
    for (const n of world.nodes) {
      for (const t of n.tiles ?? []) blocked.add(tileKey(t.x, t.y));
    }
    const blob = growTileBlob(wx + 0.5, wy + 0.5, radius, {
      kind,
      seed: rng.int(1, 1_000_000),
      biomes: world.biomes,
      width: world.width,
      height: world.height,
      blocked,
      biomeBias: 0.18,
    });
    if (!blob.tiles.length) return null;
    const used = new Set(world.nodes.map((n) => n.name));
    const b = boundsFromTiles(blob.tiles);
    const node: MapNode = {
      id: `gen-${wx}-${wy}-${blob.tiles.length}`,
      name: generatedName(rng, used),
      origin: 'generated',
      kind,
      biome,
      cx: (b.x0 + b.x1) / 2,
      cy: (b.y0 + b.y1) / 2,
      radius,
      seed: rng.int(1, 1_000_000),
      tiles: blob.tiles,
      x0: b.x0,
      y0: b.y0,
      x1: b.x1,
      y1: b.y1,
    };
    world.nodes = [...world.nodes, node];
    this.world.set({ ...world, nodes: world.nodes });
    this.persistGenerated(world);
    this.simTick.update((n) => n + 1);
    return node;
  }

  private persistGenerated(world: WorldData): void {
    const generated = world.nodes.filter((n) => n.origin === 'generated');
    localStorage.setItem(nodesKey(this.seed), JSON.stringify(generated));
  }

  private readGenerated(seed: number): MapNode[] {
    try {
      const raw = localStorage.getItem(nodesKey(seed));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as MapNode[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private readOutlines(): boolean {
    const stored = localStorage.getItem(OUTLINES_KEY);
    if (stored === '0') return false;
    return true;
  }

  private readPois(): boolean {
    const stored = localStorage.getItem(POIS_KEY);
    if (stored === '0') return false;
    return true;
  }

  private readSimMode(): SimMode {
    const stored = localStorage.getItem(SIM_KEY);
    if (stored === 'paused' || stored === 'play' || stored === 'fast' || stored === 'sync') return stored;
    return 'play';
  }

  private readSettings(): WorldSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_WORLD_SETTINGS };
      return clampSettings(JSON.parse(raw) as Partial<WorldSettings>);
    } catch {
      return { ...DEFAULT_WORLD_SETTINGS };
    }
  }
}
