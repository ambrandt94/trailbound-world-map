import { Injectable, computed, inject, signal } from '@angular/core';
import {
  BIOME_LABELS,
  Biome,
  ChunkData,
  DETAIL_START,
  DEFAULT_WORLD_SETTINGS,
  FAST_RATE,
  FASTEST_RATE,
  GAME_HOURS_PER_REAL_SEC,
  KIND_LABELS,
  LocationInfo,
  MapEntity,
  MapNode,
  MIN_ZONE_TILES,
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
  capGeneratedZoneTiles,
  MAX_GENERATED_ZONE_TILES,
  capZoneRadius,
  chunkKey,
  biomeAt,
  boundsFromTiles,
  clamp,
  clampSettings,
  ensureNodeRegion,
  formatClock,
  growTileBlob,
  nodeContaining,
  nodeTouching,
  poiApproaching,
  poiOnTile,
  poiAsNode,
  poiFootprintTiles,
  poiFootprintTouchesPlace,
  poiCovering,
  settlePoiSites,
  poiKindToNodeKind,
  presentedFocus,
  scaleLabel,
  sealPlaceTiles,
  clipBlobAwayFromPlaces,
  placeGrowthSeed,
  separateNestedPlaces,
  tileKey,
  wrapX,
  zoneRadiusFor,
  AdventureRegion,
  Vec2,
} from '../models/world.models';
import { Rng } from '../engine/noise';
import { generatedName, kindForBiome } from '../engine/names';
import { nearestEntity, spawnEntities, stepEntities } from '../engine/entities';
import { clampHeroName, defaultPlayerState, findHeroLook, LOCAL_PLAYER_ID } from '../engine/hero';
import { generateChunk, neighborMap } from '../engine/chunk-gen';
import { defaultPlayerStart, generateWorld } from '../engine/world-gen';
import { migrateWorldMapPrefs, PreferencesService } from './preferences.service';

const SEED_KEY = 'tb-world-map-seed';
const OUTLINES_KEY = 'tb-world-map-outlines';
const POIS_KEY = 'tb-world-map-pois';
const nodesKey = (seed: number) => `tb-world-map-nodes-v7-${seed}`;
const visitedKey = (seed: number) => `tb-world-map-visited-v1-${seed}`;

const SETTINGS_KEY = 'tb-world-map-setup';
const SIM_KEY = 'tb-world-map-sim';
const DEFAULT_SEED = 7741;
const START_HOUR = 8;

@Injectable({ providedIn: 'root' })
export class WorldService {
  private readonly prefs = inject(PreferencesService);
  readonly world = signal<WorldData | null>(null);
  readonly player = signal<PlayerState>(this.heroFromPrefs({ x: 80, y: 80 }));
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
  /** Bumps when fog-of-war holes change (visited places). */
  readonly fogRev = signal(0);
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
    const touching = nodeTouching(world.nodes, player.x, player.y);
    const poi = poiApproaching(world.pois, player.x, player.y);
    const poiHere = poiOnTile(world.pois, player.x, player.y);
    const view = presentedFocus(player, world.nodes, world.pois, scale);
    const atGate = !!touching && !inside;
    return {
      x: player.x,
      y: player.y,
      viewX: view.x,
      viewY: view.y,
      biome,
      biomeLabel: BIOME_LABELS[biome],
      inNode: !!inside,
      atGate,
      nodeName: (inside ?? touching)?.name ?? null,
      nodeKind: (inside ?? touching)?.kind ?? null,
      nodeOrigin: (inside ?? touching)?.origin ?? null,
      poiName: poi?.name ?? null,
      poiKind: poi?.kind ?? null,
      scaleLabel: scaleLabel(scale, world.width),
      scale,
      uncharted: !inside && !poiHere,
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
    if (settlePoiSites(world.nodes, world) || separateNestedPlaces(world.nodes)) this.persistGenerated(world);
    this.chunks.clear();
    this.world.set(world);
    this.player.set(this.heroFromPrefs(defaultPlayerStart(world)));
    this.followPlayer.set(true);
    this.simHours.set(START_HOUR);
    this.clockHours = START_HOUR;
    this.entities.set(spawnEntities(world, this.seed));
    this.simRng = new Rng(this.seed ^ 0x91a2);
    this.simTick.update((n) => n + 1);
    this.ready.set(true);
    this.clearAdventure();
    this.visitedIds = this.readVisited(this.seed);
    this.exploredCache = null;
    this.fogRev.update((n) => n + 1);
    return world;
  }

  /** Clip nested donuts and 1-tile spikes on an already-loaded world (HMR / old saves). */
  repairPlaceShapes(): void {
    const world = this.world();
    if (!world) return;
    if (!settlePoiSites(world.nodes, world) && !separateNestedPlaces(world.nodes)) return;
    this.world.set({ ...world, nodes: world.nodes });
    this.persistGenerated(world);
    this.simTick.update((n) => n + 1);
  }

  toggleOutlines(): void {
    this.setOutlines(!this.showOutlines());
  }

  setOutlines(on: boolean): void {
    this.showOutlines.set(on);
    localStorage.setItem(OUTLINES_KEY, on ? '1' : '0');
  }

  togglePois(): void {
    this.setPois(!this.showPois());
  }

  setPois(on: boolean): void {
    this.showPois.set(on);
    localStorage.setItem(POIS_KEY, on ? '1' : '0');
  }

  /** Author view shows every marker. Adventure reveals a POI after its site is entered or a neighboring place exists. */
  poiRevealed(poi: PointOfInterest, adventureMode: boolean): boolean {
    if (this.showPois()) return true;
    if (!adventureMode) return false;
    const world = this.world();
    if (!world) return false;
    const own = world.nodes.find((n) => n.id === poi.id);
    if (own && this.placeExplored(own)) return true;
    for (const node of world.nodes) {
      if (node.id === poi.id) continue;
      if (!this.placeExplored(node)) continue;
      if (poiFootprintTouchesPlace(node, poi, world)) return true;
    }
    return false;
  }

  visiblePoiIds(adventureMode: boolean): Set<string> {
    const world = this.world();
    const ids = new Set<string>();
    if (!world) return ids;
    if (this.showPois()) {
      for (const poi of world.pois) ids.add(poi.id);
      return ids;
    }
    if (!adventureMode) return ids;
    for (const poi of world.pois) {
      if (this.poiRevealed(poi, true)) ids.add(poi.id);
    }
    return ids;
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
    if (mode === 'fastest') return FASTEST_RATE;
    return 0;
  }

  setScale(scale: number): void {
    this.scale.set(scale);
  }

  applyHero(name: string, sheet: string, char: number): void {
    const look = findHeroLook(sheet, char);
    this.prefs.setHero(name, look.sheet, look.char);
    const p = this.player();
    this.player.set({
      ...p,
      id: LOCAL_PLAYER_ID,
      name: clampHeroName(name),
      sheet: look.sheet,
      char: look.char,
      facing: 0,
      frame: 1,
      anim: 0,
    });
  }

  setPlayer(x: number, y: number, pose?: Partial<Pick<PlayerState, 'facing' | 'frame' | 'anim'>>): void {
    const world = this.world();
    if (!world) return;
    const cur = this.player();
    const nx = wrapX(x, world.width);
    const ny = clamp(y, 0.5, world.height - 0.5);
    this.player.set({ ...cur, ...pose, x: nx, y: ny });
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

  private visitedIds = new Set<string>();
  private exploredCache: { rev: number; keys: Set<string> } | null = null;

  fogKey(): string {
    const world = this.world();
    return `${this.seed}:${this.fogRev()}:${world?.nodes.length ?? 0}`;
  }

  placeExplored(node: MapNode): boolean {
    if (node.poiKind) return this.visitedIds.has(node.id);
    if (node.origin === 'generated') return true;
    return this.visitedIds.has(node.id);
  }

  tileExplored(x: number, y: number): boolean {
    const world = this.world();
    if (!world) return false;
    const wx = Math.floor(wrapX(x, world.width));
    const wy = Math.floor(clamp(y, 0, world.height - 0.001));
    return this.exploredTileKeys().has(tileKey(wx, wy));
  }

  exploredTileKeys(): Set<string> {
    const rev = this.fogRev();
    if (this.exploredCache?.rev === rev) return this.exploredCache.keys;
    const keys = new Set<string>();
    const world = this.world();
    if (world) {
      for (const node of world.nodes) {
        if (!this.placeExplored(node)) continue;
        for (const t of node.tiles ?? []) keys.add(tileKey(t.x, t.y));
      }
    }
    this.exploredCache = { rev, keys };
    return keys;
  }

  markVisited(place: MapNode | null | undefined): void {
    if (!place) return;
    if (place.origin !== 'authored' && !place.poiKind) return;
    if (this.visitedIds.has(place.id)) return;
    this.visitedIds.add(place.id);
    this.persistVisited();
    this.bumpFog();
  }

  private bumpFog(): void {
    this.exploredCache = null;
    this.fogRev.update((n) => n + 1);
  }

  adventureBlocked(): Set<string> {
    const blocked = new Set<string>();
    for (const key of this.chunks.keys()) blocked.add(key);
    const world = this.world();
    if (!world) return blocked;
    for (const node of world.nodes) {
      for (const t of node.tiles ?? []) blocked.add(tileKey(t.x, t.y));
    }
    for (const poi of world.pois) {
      for (const t of poiFootprintTiles(poi, world)) blocked.add(tileKey(t.x, t.y));
    }
    return blocked;
  }

  registerAdventureInstance(region: AdventureRegion, kind?: MapNode['kind']): MapNode | null {
    const world = this.world();
    if (!world || !region.tiles.length) return null;
    const existing = world.nodes.find((n) =>
      n.tiles?.some((t) => region.keys.has(tileKey(t.x, t.y))),
    );
    if (existing) return existing;
    if (region.tiles.length < MIN_ZONE_TILES) {
      const seed = region.tiles[0];
      const neighbor = seed ? nodeTouching(world.nodes, seed.x + 0.5, seed.y + 0.5) : null;
      if (neighbor) return this.expandAdventurePlace(neighbor, region.tiles);
    }
    const cx = (region.x0 + region.x1) / 2;
    const cy = (region.y0 + region.y1) / 2;
    const biome = biomeAt(world, cx, cy);
    const used = new Set(world.nodes.map((n) => n.name));
    const rng = new Rng((world.seed ^ (region.tiles.length * 2654435761) ^ (region.x0 << 16) ^ region.y0) >>> 0);
    const resolved =
      kind ??
      (biome === Biome.Forest || biome === Biome.DarkForest
        ? 'grove'
        : biome === Biome.Water || biome === Biome.Sand || biome === Biome.Marsh
          ? 'shore'
          : biome === Biome.Mountain || biome === Biome.Snow || biome === Biome.Taiga
            ? 'pass'
            : kindForBiome(biome, rng));
    const node: MapNode = {
      id: `adv-${region.x0}-${region.y0}-${region.tiles.length}-${world.nodes.length}`,
      name: generatedName(rng, used),
      origin: 'generated',
      kind: resolved,
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
    const world = this.world();
    if (world) {
      const blocked = new Set<string>();
      for (const n of world.nodes) {
        if (n.id === place.id) continue;
        for (const t of n.tiles ?? []) blocked.add(tileKey(t.x, t.y));
      }
      this.claimAdventurePockets(
        place,
        sealPlaceTiles(place.tiles ?? [], blocked, world.width, world.height, world.biomes),
      );
    }
    const tiles = place.tiles ?? [];
    if (world && tiles.length) {
      const blocked = new Set<string>();
      for (const n of world.nodes) {
        if (n.id === place.id) continue;
        for (const t of n.tiles ?? []) blocked.add(tileKey(t.x, t.y));
      }
      const seed = placeGrowthSeed(place);
      const avoid = world.nodes
        .filter((n) => n.id !== place.id)
        .map((n) => {
          const s = placeGrowthSeed(n);
          return { cx: s.x, cy: s.y };
        });
      const clipped = clipBlobAwayFromPlaces(tiles, seed.x, seed.y, avoid, blocked);
      if (clipped !== tiles) place.tiles = clipped;
      const b = boundsFromTiles(place.tiles ?? clipped);
      place.cx = (b.x0 + b.x1) / 2;
      place.cy = (b.y0 + b.y1) / 2;
      place.x0 = b.x0;
      place.y0 = b.y0;
      place.x1 = b.x1;
      place.y1 = b.y1;
      place.radius = Math.max(1.6, Math.sqrt((place.tiles?.length ?? 0) / Math.PI));
      this.world.set({ ...world, nodes: world.nodes });
      this.persistGenerated(world);
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

  ensureTiles(tiles: Vec2[], maxNew = 128, near?: Vec2): ChunkData[] {
    const jobs = tiles.filter((t) => !this.chunks.has(chunkKey(t.x, t.y)));
    if (near && jobs.length > maxNew) {
      jobs.sort(
        (a, b) =>
          (a.x + 0.5 - near.x) ** 2 +
          (a.y + 0.5 - near.y) ** 2 -
          ((b.x + 0.5 - near.x) ** 2 + (b.y + 0.5 - near.y) ** 2),
      );
    }
    return this.createChunkJobs(jobs, maxNew, false);
  }

  private createChunkJobs(jobs: Vec2[], maxNew: number, discoverPois = false): ChunkData[] {
    const world = this.world();
    if (!world) return [];
    const created: ChunkData[] = [];
    for (const job of jobs.slice(0, maxNew)) {
      if (discoverPois) {
        const poi = poiOnTile(world.pois, job.x + 0.5, job.y + 0.5);
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
    if (!world) return null;
    if (scale < DETAIL_START) return nodeContaining(world.nodes, x, y);
    const poi = poiCovering(world.pois, x, y, world);
    if (poi) return this.nodeFromPoi(world, poi);
    const here = nodeContaining(world.nodes, x, y);
    if (here) return here;
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
    this.bumpFog();
    this.simTick.update((n) => n + 1);
  }

  /** Mint compact, POI-centered sites for markers that sit on this place's edge. */
  attachEdgePois(placeId: string): void {
    const world = this.world();
    if (!world) return;
    const place = world.nodes.find((n) => n.id === placeId);
    if (!place?.tiles?.length) return;
    let added = false;
    for (const poi of world.pois) {
      if (world.nodes.some((n) => n.id === poi.id)) continue;
      if (!poiFootprintTouchesPlace(place, poi, world)) continue;
      this.nodeFromPoi(world, poi);
      added = true;
    }
    if (added) settlePoiSites(world.nodes, world);
  }

  private nodeFromPoi(world: WorldData, poi: PointOfInterest): MapNode {
    const existing = world.nodes.find((n) => n.id === poi.id);
    if (existing) return existing;
    const blocked = new Set<string>();
    for (const n of world.nodes) {
      if (n.origin !== 'authored') continue;
      for (const t of n.tiles ?? []) blocked.add(tileKey(t.x, t.y));
    }
    const node = poiAsNode(poi, {
      kind: poiKindToNodeKind(poi.kind),
      biomes: world.biomes,
      width: world.width,
      height: world.height,
      blocked,
    });
    world.nodes = [...world.nodes, node];
    settlePoiSites(world.nodes, world);
    const placed = world.nodes.find((n) => n.id === poi.id) ?? node;
    for (const t of placed.tiles ?? []) {
      this.chunks.delete(chunkKey(t.x, t.y));
      this.chunks.delete(chunkKey(t.x - 1, t.y));
      this.chunks.delete(chunkKey(t.x + 1, t.y));
      this.chunks.delete(chunkKey(t.x, t.y - 1));
      this.chunks.delete(chunkKey(t.x, t.y + 1));
    }
    this.world.set({ ...world, nodes: world.nodes });
    this.persistGenerated(world);
    this.simTick.update((n) => n + 1);
    return placed;
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
    const radius = capZoneRadius(
      zoneRadiusFor(kind, rng.next(), rng.range(0.94, 1.08)),
      world.width,
      world.height,
    );
    const blocked = new Set<string>();
    for (const n of world.nodes) {
      for (const t of n.tiles ?? []) blocked.add(tileKey(t.x, t.y));
    }
    for (const poi of world.pois) {
      for (const t of poiFootprintTiles(poi, world)) blocked.add(tileKey(t.x, t.y));
    }
    const blob = growTileBlob(wx + 0.5, wy + 0.5, radius, {
      kind,
      seed: rng.int(1, 1_000_000),
      biomes: world.biomes,
      width: world.width,
      height: world.height,
      blocked,
      biomeBias: 0.18,
      maxTiles: MAX_GENERATED_ZONE_TILES,
      avoid: world.nodes.map((n) => ({ cx: n.cx, cy: n.cy })),
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
    this.bumpFog();
  }

  private persistVisited(): void {
    localStorage.setItem(visitedKey(this.seed), JSON.stringify([...this.visitedIds]));
  }

  private readVisited(seed: number): Set<string> {
    try {
      const raw = localStorage.getItem(visitedKey(seed));
      if (!raw) return new Set();
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((id): id is string => typeof id === 'string'));
    } catch {
      return new Set();
    }
  }

  private readGenerated(seed: number): MapNode[] {
    try {
      const raw = localStorage.getItem(nodesKey(seed));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as MapNode[];
      if (!Array.isArray(parsed)) return [];
      return parsed.map((node) => {
        const tiles = node.tiles ?? [];
        if (tiles.length <= MAX_GENERATED_ZONE_TILES) return node;
        const trimmed = capGeneratedZoneTiles(tiles, node.cx, node.cy);
        const b = boundsFromTiles(trimmed);
        return { ...node, tiles: trimmed, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
      });
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
    if (stored === 'paused' || stored === 'play' || stored === 'fast' || stored === 'fastest' || stored === 'sync') return stored;
    return 'play';
  }

  private heroFromPrefs(pos: { x: number; y: number }): PlayerState {
    const look = findHeroLook(this.prefs.heroSheet(), this.prefs.heroChar());
    return {
      ...defaultPlayerState(pos),
      name: clampHeroName(this.prefs.heroName()),
      sheet: look.sheet,
      char: look.char,
    };
  }

  private readSettings(): WorldSettings {
    migrateWorldMapPrefs();
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_WORLD_SETTINGS };
      return clampSettings(JSON.parse(raw) as Partial<WorldSettings>);
    } catch {
      return { ...DEFAULT_WORLD_SETTINGS };
    }
  }
}
