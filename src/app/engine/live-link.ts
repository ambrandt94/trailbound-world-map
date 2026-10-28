/**
 * Live link between the world map and the 3D controller.
 * Engine-only: protocol types, validation, zone metres, intents, sim frames.
 * The bridge in `area-bridge.ts` owns the popup, origins, and sequence numbers.
 */
import {
  AreaBuilding,
  AreaExport,
  AreaNpc,
  AreaNpcSnapshot,
  Cardinal,
  GROUND,
  decodeB64U8,
} from './area-export';
import { residentAnchor } from './entities';
import { hash2 } from './noise';
import {
  Facing,
  MapEntity,
  PLAY_RATE,
  ZONE_SCALE,
  wrapDeltaX,
  wrapX,
} from '../models/world.models';

export const LIVE_MAJOR = 1 as const;
export const LIVE_MAJORS = [1] as const;
export const SIM_HZ = 4;
export const HEARTBEAT_MS = 1000;
export const STALE_MS = 3000;
export const TIMEOUT_MS = 10000;
export const PARKED_MS = 60000;
export const MAX_LEADS = 16;
export const MAX_ARMY_SHOW = 15;
export const WATCH_TILES = 8;
export const LIVE_SESSION_KEY = 'tb-live-session';

export type Pace = 'walk';

export type Intent =
  | { kind: 'walk_to'; to: { x: number; z: number }; ref?: string; pace: Pace }
  | { kind: 'visit'; buildingId: string; door: { x: number; z: number }; dwellH: number; pace: Pace }
  | { kind: 'inside'; buildingId: string; untilH: number }
  | {
      kind: 'pass_through';
      from: Cardinal;
      to: Cardinal;
      exit: { x: number; z: number };
      viaRoad: boolean;
      pace: Pace;
    }
  | { kind: 'leave'; side: Cardinal; exit: { x: number; z: number }; pace: Pace }
  | { kind: 'halt'; at: { x: number; z: number }; reason: 'trade' | 'camp'; untilH: number }
  | { kind: 'idle'; at: { x: number; z: number }; untilH: number; task?: string }
  | { kind: 'talk'; with: 'player'; untilH: number };

export interface ClockState {
  hours: number;
  rate: number;
  mode: 'play' | 'fast' | 'fastest' | 'paused' | 'sync' | 'zone';
}

export interface Pt {
  x: number;
  z: number;
}

export interface NpcState {
  id: string;
  iv: number;
  kind: 'wanderer' | 'caravan' | 'army';
  phase: 'near' | 'in' | 'inside';
  pos?: Pt;
  yaw?: number;
  speed: number;
  intent: Intent;
  name?: string;
  look?: { sheet: string; char: number };
  members?: { n: number; show: number; looks: { sheet: string; char: number }[] };
}

export type NpcEvent =
  | { e: 'enter'; id: string; at: Pt; side: Cardinal | null }
  | { e: 'gone'; id: string };

export interface PlayerMsg {
  type: 'tb-player';
  tb: 1;
  sid: string;
  seq: number;
  pos: Pt;
  yaw: number;
  moving: boolean;
  sprint: boolean;
  inside: string | null;
  parked?: boolean;
  npcs?: { id: string; pos: Pt }[];
}

export interface NpcReportMsg {
  type: 'tb-npc-event';
  tb: 1;
  sid: string;
  seq: number;
  id: string;
  iv: number;
  e: 'arrived' | 'entered' | 'exited' | 'left' | 'stuck';
  at: Pt;
  buildingId?: string;
  side?: Cardinal;
}

export interface ExitMsg {
  type: 'tb-exit';
  tb: 1;
  sid: string;
  seq: number;
  side: Cardinal;
  pos: Pt;
  yaw: number;
}

export interface EnterBuildingMsg {
  type: 'tb-enter-building';
  tb: 1;
  sid: string;
  seq: number;
  buildingId: string;
}

export interface LeaveBuildingMsg {
  type: 'tb-leave-building';
  tb: 1;
  sid: string;
  seq: number;
  buildingId: string;
  pos: Pt;
}

export interface NpcInteractMsg {
  type: 'tb-npc-interact';
  tb: 1;
  sid: string;
  seq: number;
  id: string;
  verb: 'talk';
}

export interface CloseMsg {
  type: 'tb-close';
  tb: 1;
  sid: string;
  seq: number;
  reason: 'user' | 'exit' | 'area-changed' | 'map-left-zone' | 'unknown-session' | 'version';
}

export type ControllerMsg = PlayerMsg | NpcReportMsg | ExitMsg | EnterBuildingMsg | LeaveBuildingMsg | NpcInteractMsg | CloseMsg;

export interface StoredLiveSession {
  sid: string;
  placeId: string;
  areaHash: string;
  controllerOrigin: string;
  clockHours: number;
}

export interface ZoneFrame {
  zoneScale: number;
  metersPerTile: number;
  originX: number;
  originY: number;
  worldWidth: number;
  worldBounds: { x0: number; y0: number; x1: number; y1: number };
}

export interface ValidateCtx {
  origin: string;
  allow: readonly string[];
  pinnedOrigin: string;
  sid: string;
  lastSeq: number;
  /** Zone metres upper bound: grid width × metres + 64. */
  maxX: number;
  maxZ: number;
}

export type ValidateResult = { ok: true; msg: ControllerMsg } | { ok: false; reason: string };

const LIVE_TYPES = new Set([
  'tb-session-open',
  'tb-sim',
  'tb-chatter',
  'tb-player',
  'tb-npc-event',
  'tb-exit',
  'tb-enter-building',
  'tb-leave-building',
  'tb-npc-interact',
  'tb-close',
]);

const ID_RE = /^[a-z0-9-]{1,40}$/;
const CARDINALS = new Set(['N', 'E', 'S', 'W']);

export function liveDraw(sid: string, id: string, n: number): number {
  let h = 2166136261;
  const text = `${sid}\0${id}\0${n}`;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return hash2(h >>> 0, n + 1, 0x6c697665);
}

/** Real metres per second at the Play-rate tile speed. 0.125 × 8 m = 1, so the tile speed is already m/s. */
export function npcSpeedMps(tileSpeed: number): number {
  const mps = tileSpeed * PLAY_RATE * ZONE_SCALE;
  return Math.round(mps * 10) / 10;
}

export function simSubsteps(elapsedSec: number, live: boolean): number[] {
  const cap = live ? 2 : 0.05;
  let remain = Math.min(cap, Math.max(0, elapsedSec));
  const steps: number[] = [];
  while (remain > 1e-8) {
    const step = Math.min(0.05, remain);
    steps.push(step);
    remain -= step;
  }
  return steps;
}

export function noteRate(bucket: number[], now: number, limit = 20): boolean {
  const keep = now - 1000;
  while (bucket.length && bucket[0]! < keep) bucket.shift();
  if (bucket.length >= limit) return false;
  bucket.push(now);
  return true;
}

export function frameOf(area: AreaExport, worldWidth: number): ZoneFrame {
  return {
    zoneScale: area.units.zoneScale,
    metersPerTile: area.units.metersPerTile,
    originX: area.area.innerOrigin.x,
    originY: area.area.innerOrigin.y,
    worldWidth,
    worldBounds: area.area.worldBounds,
  };
}

export function zoneCenterX(frame: ZoneFrame): number {
  return (frame.worldBounds.x0 + frame.worldBounds.x1 + 1) / 2;
}

export function zoneFromWorld(wx: number, wy: number, frame: ZoneFrame): Pt {
  const cx = zoneCenterX(frame);
  const unwrapped = cx + wrapDeltaX(cx, wx, frame.worldWidth);
  const ix = unwrapped * frame.zoneScale;
  const iy = wy * frame.zoneScale;
  return {
    x: (ix - frame.originX) * frame.metersPerTile,
    z: (iy - frame.originY) * frame.metersPerTile,
  };
}

export function worldFromZone(mx: number, mz: number, frame: ZoneFrame): { x: number; y: number } {
  const ix = frame.originX + mx / frame.metersPerTile;
  const iy = frame.originY + mz / frame.metersPerTile;
  return {
    x: wrapX(ix / frame.zoneScale, frame.worldWidth),
    y: iy / frame.zoneScale,
  };
}

export function quantizePt(p: Pt): Pt {
  return { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 };
}

const FACING_YAW: Record<Facing, number> = {
  0: 0,
  1: -Math.PI / 2,
  2: Math.PI / 2,
  3: Math.PI,
};

export function facingToYaw(facing: Facing): number {
  return FACING_YAW[facing];
}

export function yawToFacing(yaw: number): Facing {
  if (!Number.isFinite(yaw)) return 0;
  const y = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  const deg = (y * 180) / Math.PI;
  if (deg >= -45 && deg < 45) return 0;
  if (deg >= 45 && deg < 135) return 2;
  if (deg >= -135 && deg < -45) return 1;
  return 3;
}

export function doorApproachPoint(area: AreaExport, building: AreaBuilding): Pt {
  const meters = area.units.metersPerTile;
  const origin = area.area.innerOrigin;
  const outward = outwardMetre(building.door);
  return {
    x: (building.doorCell.x + 0.5 - origin.x) * meters + outward.x,
    z: (building.doorCell.y + 0.5 - origin.y) * meters + outward.z,
  };
}

export function structureContains(area: AreaExport, building: AreaBuilding, p: Pt): boolean {
  const meters = area.units.metersPerTile;
  const origin = area.area.innerOrigin;
  const x0 = (building.structureX - origin.x) * meters;
  const z0 = (building.structureY - origin.y) * meters;
  const x1 = x0 + building.structureW * meters;
  const z1 = z0 + building.structureD * meters;
  const eps = 1e-6;
  return p.x > x0 + eps && p.x < x1 - eps && p.z > z0 + eps && p.z < z1 - eps;
}

export function inPlaceTiles(x: number, y: number, tiles: Set<string>, width: number): boolean {
  const tx = wrapX(Math.floor(x), width);
  const ty = Math.floor(y);
  return tiles.has(`${tx},${ty}`);
}

export function inWatchBox(x: number, y: number, area: AreaExport, width: number, grow = WATCH_TILES): boolean {
  const bounds = area.area.worldBounds;
  const cx = (bounds.x0 + bounds.x1 + 1) / 2;
  const ux = cx + wrapDeltaX(cx, x, width);
  return ux >= bounds.x0 - grow && ux < bounds.x1 + 1 + grow && y >= bounds.y0 - grow && y < bounds.y1 + 1 + grow;
}

export function nudgeOutward(
  x: number,
  y: number,
  side: Cardinal,
  width: number,
  tiles = 0.5,
): { x: number; y: number } {
  const step = sideStep(side);
  return { x: wrapX(x + step.x * tiles, width), y: y + step.y * tiles };
}

export function placeWalkerFromExit(
  pos: Pt,
  side: Cardinal,
  yaw: number,
  frame: ZoneFrame,
  tiles: Set<string>,
): { x: number; y: number; facing: Facing } {
  const world = worldFromZone(pos.x, pos.z, frame);
  let x = world.x;
  let y = world.y;
  const first = nudgeOutward(x, y, side, frame.worldWidth, 0.5);
  x = first.x;
  y = first.y;
  for (let i = 0; i < 4 && inPlaceTiles(x, y, tiles, frame.worldWidth); i++) {
    const step = nudgeOutward(x, y, side, frame.worldWidth, 0.5);
    x = step.x;
    y = step.y;
  }
  return { x, y, facing: yawToFacing(yaw) };
}

export function validateLive(msg: unknown, ctx: ValidateCtx): ValidateResult {
  try {
    if (!msg || typeof msg !== 'object') return { ok: false, reason: 'shape' };
    const raw = msg as Record<string, unknown>;
    const type = raw['type'];
    if (typeof type !== 'string' || !LIVE_TYPES.has(type)) return { ok: false, reason: 'unknown' };
    if (raw['tb'] !== 1) return { ok: false, reason: 'version' };
    if (!ctx.allow.includes(ctx.origin) || ctx.origin !== ctx.pinnedOrigin) return { ok: false, reason: 'origin' };
    if (raw['sid'] !== ctx.sid) return { ok: false, reason: 'sid' };
    const seq = raw['seq'];
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= ctx.lastSeq || seq > 1e15) {
      return { ok: false, reason: 'seq' };
    }
    let size = 0;
    try {
      size = JSON.stringify(msg).length;
    } catch {
      return { ok: false, reason: 'size' };
    }
    if (size > 65536) return { ok: false, reason: 'size' };
    if (!checkBody(type, raw, ctx)) return { ok: false, reason: 'field' };
    return { ok: true, msg: msg as ControllerMsg };
  } catch {
    return { ok: false, reason: 'throw' };
  }
}

export interface LiveTrack {
  iv: number;
  intent: Intent;
  phase: 'near' | 'in' | 'inside' | 'out';
  visitsDone: number;
  visitBudget: number;
  enteredSide: Cardinal | null;
  yield: boolean;
  introduced: boolean;
  lastKey: string;
}

export interface LiveDirector {
  sid: string;
  area: AreaExport;
  worldWidth: number;
  tiles: Set<string>;
  tracks: Map<string, LiveTrack>;
  replicated: Set<string>;
  fallback: boolean;
  tick: number;
  pending: NpcEvent[];
}

export function createDirector(area: AreaExport, sid: string, worldWidth: number): LiveDirector {
  return {
    sid,
    area,
    worldWidth,
    tiles: new Set(area.area.worldTiles.map(([x, y]) => `${x},${y}`)),
    tracks: new Map(),
    replicated: new Set(),
    fallback: false,
    tick: 0,
    pending: [],
  };
}

export function syncDirector(
  dir: LiveDirector,
  entities: MapEntity[],
  hours: number,
  hold = true,
): void {
  if (dir.fallback) {
    for (const entity of entities) if (entity.heldBy === dir.sid) entity.heldBy = undefined;
    return;
  }
  for (const entity of entities) {
    if (!isLead(entity)) continue;
    const watch = inWatchBox(entity.x, entity.y, dir.area, dir.worldWidth);
    const inside = inPlaceTiles(entity.x, entity.y, dir.tiles, dir.worldWidth);
    let track = dir.tracks.get(entity.id);
    if (!watch && entity.heldBy !== dir.sid) {
      if (track && track.phase !== 'out') {
        if (dir.replicated.has(entity.id)) dir.pending.push({ e: 'gone', id: entity.id });
        track.phase = 'out';
        track.yield = false;
        dir.replicated.delete(entity.id);
      }
      continue;
    }
    if (!track) {
      track = blankTrack(dir, entity, hours);
      dir.tracks.set(entity.id, track);
    }
    refreshUntil(dir, entity, track, hours);
    if (!track.introduced) {
      track.enteredSide = sideOf(entity, dir);
      track.intent = initialIntent(dir, entity, track, hours);
      track.iv = 1;
      track.introduced = true;
      track.phase = inside ? 'in' : 'near';
      if (inside && hold && !track.yield) {
        entity.heldBy = dir.sid;
        const at = quantizePt(zoneFromWorld(entity.x, entity.y, frameOf(dir.area, dir.worldWidth)));
        dir.pending.push({ e: 'enter', id: entity.id, at, side: track.enteredSide });
      }
      continue;
    }
    if (inside && !track.yield && track.phase !== 'inside') {
      if (hold && entity.heldBy !== dir.sid) {
        entity.heldBy = dir.sid;
        track.phase = 'in';
        track.enteredSide = track.enteredSide ?? sideOf(entity, dir);
        track.intent = initialIntent(dir, entity, track, hours);
        track.iv += 1;
        const at = quantizePt(zoneFromWorld(entity.x, entity.y, frameOf(dir.area, dir.worldWidth)));
        dir.pending.push({ e: 'enter', id: entity.id, at, side: track.enteredSide });
      } else if (!hold) {
        track.phase = 'in';
      }
    } else if (!inside && track.yield) {
      track.yield = false;
      track.phase = 'near';
      if (entity.heldBy === dir.sid) entity.heldBy = undefined;
    } else if (!inside && track.phase !== 'inside') {
      track.phase = 'near';
      if (entity.heldBy === dir.sid) entity.heldBy = undefined;
    }
  }
}

export function applyNpcReport(dir: LiveDirector, entities: MapEntity[], report: NpcReportMsg, hours: number): void {
  const entity = entities.find((item) => item.id === report.id);
  const track = dir.tracks.get(report.id);
  if (!entity || !track) return;
  if (report.iv < track.iv) return;
  const frame = frameOf(dir.area, dir.worldWidth);
  if (report.e === 'left') {
    const world = worldFromZone(report.at.x, report.at.z, frame);
    const side = report.side ?? track.enteredSide ?? 'E';
    let pos = nudgeOutward(world.x, world.y, side, dir.worldWidth, 0.5);
    for (let i = 0; i < 3 && inPlaceTiles(pos.x, pos.y, dir.tiles, dir.worldWidth); i++) {
      pos = nudgeOutward(pos.x, pos.y, side, dir.worldWidth, 0.5);
    }
    entity.x = pos.x;
    entity.y = pos.y;
    entity.facing = yawToFacing(0);
    entity.heldBy = undefined;
    track.yield = true;
    track.phase = 'near';
    return;
  }
  if (report.e === 'entered') {
    track.phase = 'inside';
    track.visitsDone += 1;
    const dwell = track.intent.kind === 'visit' ? track.intent.dwellH : 0.5;
    const buildingId = report.buildingId ?? (track.intent.kind === 'visit' ? track.intent.buildingId : 'b0');
    track.intent = { kind: 'inside', buildingId, untilH: hours + dwell };
    track.iv += 1;
    return;
  }
  if (report.e === 'exited') {
    const world = worldFromZone(report.at.x, report.at.z, frame);
    entity.x = world.x;
    entity.y = world.y;
    track.phase = 'in';
    entity.heldBy = dir.sid;
    chooseAfterVisit(dir, entity, track, hours);
    return;
  }
  if (report.e === 'arrived') {
    if (track.intent.kind === 'walk_to' && entity.kind === 'caravan') {
      track.intent = {
        kind: 'halt',
        at: track.intent.to,
        reason: 'trade',
        untilH: hours + 1 + liveDraw(dir.sid, entity.id, 5),
      };
      track.iv += 1;
      return;
    }
    chooseAfterVisit(dir, entity, track, hours);
    return;
  }
  if (report.e === 'stuck') {
    track.intent = { kind: 'idle', at: quantizePt(report.at), untilH: hours + 0.25, task: 'look' };
    track.iv += 1;
  }
}

export function setTalkIntent(dir: LiveDirector, entity: MapEntity, hours: number, bubbleMs: number, rateHours: number): void {
  const track = dir.tracks.get(entity.id);
  if (!track) return;
  track.intent = { kind: 'talk', with: 'player', untilH: hours + (bubbleMs / 1000) * rateHours };
  track.iv += 1;
  track.phase = track.phase === 'out' ? 'near' : track.phase;
}

export function releaseHolds(dir: LiveDirector, entities: MapEntity[]): void {
  dir.fallback = true;
  for (const entity of entities) {
    if (entity.heldBy === dir.sid) entity.heldBy = undefined;
  }
  for (const [id, track] of dir.tracks) {
    if (track.phase === 'in' || track.phase === 'inside') {
      if (dir.replicated.has(id)) dir.pending.push({ e: 'gone', id });
      track.phase = 'near';
      track.yield = true;
    }
  }
  dir.replicated.clear();
}

export function resumeHolds(dir: LiveDirector): void {
  dir.fallback = false;
  dir.replicated.clear();
  for (const track of dir.tracks.values()) {
    track.yield = false;
    track.introduced = false;
    track.phase = 'out';
  }
}

export function buildSimBody(
  dir: LiveDirector,
  entities: MapEntity[],
  player: { x: number; y: number },
  key: boolean,
): { ents: NpcState[]; events: NpcEvent[] } {
  const width = dir.worldWidth;
  const ranked = entities
    .filter((entity) => isLead(entity) && (inWatchBox(entity.x, entity.y, dir.area, width) || entity.heldBy === dir.sid))
    .map((entity) => ({
      entity,
      dist: Math.hypot(wrapDeltaX(player.x, entity.x, width), entity.y - player.y),
    }))
    .sort((a, b) => a.dist - b.dist);
  const keep = new Set(ranked.slice(0, MAX_LEADS).map((row) => row.entity.id));
  for (const id of [...dir.replicated]) {
    if (keep.has(id)) continue;
    dir.pending.push({ e: 'gone', id });
    dir.replicated.delete(id);
    const entity = entities.find((item) => item.id === id);
    const track = dir.tracks.get(id);
    if (entity?.heldBy === dir.sid) {
      entity.heldBy = undefined;
      if (track) track.yield = true;
    }
  }
  const events = dir.pending.splice(0, 32);
  const ents: NpcState[] = [];
  for (const row of ranked.slice(0, MAX_LEADS)) {
    const track = dir.tracks.get(row.entity.id);
    if (!track || track.phase === 'out') continue;
    const first = !dir.replicated.has(row.entity.id);
    dir.replicated.add(row.entity.id);
    const state = toNpcState(dir, row.entity, track, first || key);
    const stamp = JSON.stringify({
      iv: state.iv,
      phase: state.phase,
      pos: state.pos,
      yaw: state.yaw,
      intent: state.intent,
    });
    if (key || first || stamp !== track.lastKey) {
      ents.push(state);
      track.lastKey = stamp;
    }
  }
  dir.tick += 1;
  return { ents, events };
}

export function snapshotNpcs(
  area: AreaExport,
  entities: MapEntity[],
  player: { x: number; y: number },
  hours: number,
  sid: string,
  worldWidth: number,
): AreaNpcSnapshot {
  bindResidentBuildings(entities, area);
  const dir = createDirector(area, sid, worldWidth);
  syncDirector(dir, entities, hours, false);
  const body = buildSimBody(dir, entities, player, true);
  const list: AreaNpc[] = [];
  for (const state of body.ents) {
    const entity = entities.find((item) => item.id === state.id);
    if (!entity) continue;
    const pos = quantizePt(zoneFromWorld(entity.x, entity.y, frameOf(area, worldWidth)));
    list.push({
      id: state.id,
      name: entity.name.slice(0, 48),
      kind: state.kind,
      look: { sheet: entity.sheet, char: entity.char },
      phase: state.phase,
      pos,
      yaw: facingToYaw(entity.facing),
      speed: state.speed,
      intent: state.intent,
      iv: state.iv,
      members: state.members,
    });
  }
  return { frame: 'zone-m', asOfHours: Math.round(hours * 1000) / 1000, list };
}

/** Two wanderers and a caravan pinned next to the place, for the v0.4 fixture. */
export function forcedFixtureNpcs(area: AreaExport, worldWidth: number, hours = 8): AreaNpc[] {
  const frame = frameOf(area, worldWidth);
  const bounds = area.area.worldBounds;
  const cx = (bounds.x0 + bounds.x1 + 1) / 2;
  const cy = (bounds.y0 + bounds.y1 + 1) / 2;
  const center = quantizePt(zoneFromWorld(cx, cy, frame));
  const east = quantizePt(zoneFromWorld(bounds.x1 + 2.5, cy, frame));
  const door = area.buildings[0] ? quantizePt(doorApproachPoint(area, area.buildings[0])) : center;
  const plaza = quantizePt(plazaPoint(area));
  const base = {
    phase: 'in' as const,
    yaw: 0,
    iv: 1,
    look: { sheet: 'townsfolk', char: 1 },
  };
  return [
    {
      ...base,
      id: 'wanderer-3',
      name: 'Wren Ranger',
      kind: 'wanderer',
      pos: { x: center.x + 2, z: center.z + 1 },
      speed: 1.4,
      intent: { kind: 'visit', buildingId: area.buildings[0]?.id ?? 'b0', door, dwellH: 0.8, pace: 'walk' },
    },
    {
      ...base,
      id: 'wanderer-4',
      name: 'Bram Baker',
      kind: 'wanderer',
      look: { sheet: 'farmer', char: 2 },
      pos: { x: center.x - 3, z: center.z + 2 },
      speed: 1.3,
      yaw: Math.PI / 2,
      intent: { kind: 'idle', at: center, untilH: hours + 0.25, task: 'look' },
    },
    {
      ...base,
      id: 'caravan-0',
      name: 'Ashfen spice caravan',
      kind: 'caravan',
      look: { sheet: 'horse1', char: 4 },
      phase: 'near',
      pos: east,
      speed: 1.1,
      yaw: -Math.PI / 2,
      intent: { kind: 'walk_to', to: plaza, ref: 'plaza', pace: 'walk' },
      members: {
        n: 2,
        show: 2,
        looks: [
          { sheet: 'horse1', char: 5 },
          { sheet: 'townsfolk', char: 3 },
        ],
      },
    },
  ];
}

export function bindResidentBuildings(entities: MapEntity[], area: AreaExport): void {
  for (const entity of entities) {
    const home = entity.resident;
    if (!home || home.placeId !== area.area.id) continue;
    home.homeBuildingId = nearestBuilding(area, home.homeX, home.homeY, ['cottage', 'house', 'farm'])?.id;
    home.workBuildingId = nearestBuilding(area, home.workX, home.workY, ['shop', 'blacksmith', 'town-hall', 'church'])?.id;
    home.tavernBuildingId = nearestBuilding(area, home.tavernX, home.tavernY, ['tavern', 'inn'])?.id;
  }
}

export interface ScriptLine {
  dir?: string;
  msg: unknown;
  origin?: string;
  t?: number;
}

export interface ReplayResult {
  accepted: number;
  dropped: string[];
  resumed: boolean;
  acked: boolean;
  player: { x: number; y: number; yaw: number } | null;
  exit: { x: number; y: number; side: Cardinal; yaw: number } | null;
  reports: NpcReportMsg[];
}

/** Map-side reducer for a recorded controller transcript. No DOM. */
export function replayControllerScript(
  lines: ScriptLine[],
  opts: {
    sid: string;
    allow: string[];
    origin: string;
    frame: ZoneFrame;
    tiles: Set<string>;
    stored?: { sid: string; hash: string } | null;
  },
): ReplayResult {
  let lastSeq = 0;
  const dropped: string[] = [];
  let resumed = false;
  let acked = false;
  let player: ReplayResult['player'] = null;
  let exit: ReplayResult['exit'] = null;
  const reports: NpcReportMsg[] = [];
  const maxX = 512;
  const maxZ = 512;
  for (const line of lines) {
    if (line.dir && line.dir !== 'c2m') continue;
    const msg = line.msg;
    if (!msg || typeof msg !== 'object') {
      dropped.push('shape');
      continue;
    }
    const type = (msg as { type?: unknown }).type;
    const origin = line.origin ?? opts.origin;
    if (type === 'tb-area-ready') {
      const resume = (msg as { resume?: { sid?: unknown; hash?: unknown } }).resume;
      if (
        resume &&
        opts.stored &&
        resume.sid === opts.stored.sid &&
        resume.hash === opts.stored.hash &&
        opts.allow.includes(origin)
      ) {
        resumed = true;
      }
      continue;
    }
    if (type === 'tb-area-ack') {
      acked = true;
      continue;
    }
    const result = validateLive(msg, {
      origin,
      allow: opts.allow,
      pinnedOrigin: opts.origin,
      sid: opts.sid,
      lastSeq,
      maxX,
      maxZ,
    });
    if (!result.ok) {
      dropped.push(result.reason);
      continue;
    }
    lastSeq = result.msg.seq;
    if (result.msg.type === 'tb-player') {
      const world = worldFromZone(result.msg.pos.x, result.msg.pos.z, opts.frame);
      player = { x: world.x, y: world.y, yaw: result.msg.yaw };
    } else if (result.msg.type === 'tb-exit') {
      const placed = placeWalkerFromExit(result.msg.pos, result.msg.side, result.msg.yaw, opts.frame, opts.tiles);
      exit = { x: placed.x, y: placed.y, side: result.msg.side, yaw: result.msg.yaw };
      player = { x: placed.x, y: placed.y, yaw: result.msg.yaw };
    } else if (result.msg.type === 'tb-npc-event') {
      reports.push(result.msg);
    }
  }
  return { accepted: lastSeq > 0 ? lastSeq : 0, dropped, resumed, acked, player, exit, reports };
}

function checkBody(type: string, raw: Record<string, unknown>, ctx: ValidateCtx): boolean {
  if (type === 'tb-player') {
    if (!isPt(raw['pos'], ctx)) return false;
    if (!isYaw(raw['yaw'])) return false;
    if (typeof raw['moving'] !== 'boolean' || typeof raw['sprint'] !== 'boolean') return false;
    if (!(raw['inside'] === null || typeof raw['inside'] === 'string')) return false;
    if (raw['inside'] !== null && (typeof raw['inside'] !== 'string' || raw['inside'].length > 40)) return false;
    return checkNpcPositions(raw['npcs'], ctx);
  }
  if (type === 'tb-npc-event') {
    if (!isId(raw['id']) || typeof raw['iv'] !== 'number' || !Number.isFinite(raw['iv'])) return false;
    if (raw['e'] !== 'arrived' && raw['e'] !== 'entered' && raw['e'] !== 'exited' && raw['e'] !== 'left' && raw['e'] !== 'stuck') {
      return false;
    }
    if (!isPt(raw['at'], ctx)) return false;
    if (raw['side'] !== undefined && !CARDINALS.has(String(raw['side']))) return false;
    if (raw['buildingId'] !== undefined && (typeof raw['buildingId'] !== 'string' || raw['buildingId'].length > 40)) return false;
    return true;
  }
  if (type === 'tb-exit') {
    if (!CARDINALS.has(String(raw['side']))) return false;
    return isPt(raw['pos'], ctx) && isYaw(raw['yaw']);
  }
  if (type === 'tb-enter-building') return typeof raw['buildingId'] === 'string' && raw['buildingId'].length > 0 && raw['buildingId'].length <= 40;
  if (type === 'tb-leave-building') {
    return typeof raw['buildingId'] === 'string' && raw['buildingId'].length <= 40 && isPt(raw['pos'], ctx);
  }
  if (type === 'tb-npc-interact') return isId(raw['id']) && raw['verb'] === 'talk';
  if (type === 'tb-close') {
    return (
      raw['reason'] === 'user' ||
      raw['reason'] === 'exit' ||
      raw['reason'] === 'area-changed' ||
      raw['reason'] === 'map-left-zone' ||
      raw['reason'] === 'unknown-session' ||
      raw['reason'] === 'version'
    );
  }
  if (type === 'tb-chatter') {
    if (typeof raw['text'] !== 'string' || raw['text'].length > 160) return false;
    if (typeof raw['name'] === 'string' && raw['name'].length > 48) return false;
    if (!isId(raw['speakerId'])) return false;
    return true;
  }
  if (type === 'tb-sim') {
    if (!Array.isArray(raw['ents']) || raw['ents'].length > 32) return false;
    if (!Array.isArray(raw['events']) || raw['events'].length > 32) return false;
    for (const ent of raw['ents']) {
      if (!ent || typeof ent !== 'object') return false;
      const row = ent as Record<string, unknown>;
      if (!isId(row['id'])) return false;
      const members = row['members'] as { looks?: unknown } | undefined;
      if (members && Array.isArray(members.looks) && members.looks.length > 16) return false;
    }
    const clock = raw['clock'] as { hours?: unknown } | undefined;
    if (clock && typeof clock === 'object' && clock.hours !== undefined) {
      if (typeof clock.hours !== 'number' || !Number.isFinite(clock.hours) || clock.hours < 0) return false;
    }
    return true;
  }
  if (type === 'tb-session-open') {
    const clock = raw['clock'] as { hours?: unknown } | undefined;
    if (!clock || typeof clock.hours !== 'number' || !Number.isFinite(clock.hours) || clock.hours < 0) return false;
    return true;
  }
  return true;
}

function checkNpcPositions(value: unknown, ctx: ValidateCtx): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 32) return false;
  for (const row of value) {
    if (!row || typeof row !== 'object') return false;
    const item = row as { id?: unknown; pos?: unknown };
    if (!isId(item.id) || !isPt(item.pos, ctx)) return false;
  }
  return true;
}

function isPt(value: unknown, ctx: ValidateCtx): value is Pt {
  if (!value || typeof value !== 'object') return false;
  const pt = value as Pt;
  return (
    typeof pt.x === 'number' &&
    typeof pt.z === 'number' &&
    Number.isFinite(pt.x) &&
    Number.isFinite(pt.z) &&
    pt.x >= -64 &&
    pt.z >= -64 &&
    pt.x <= ctx.maxX &&
    pt.z <= ctx.maxZ
  );
}

function isYaw(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Math.PI * 2 + 1e-6;
}

function isId(value: unknown): boolean {
  return typeof value === 'string' && ID_RE.test(value);
}

function isLead(entity: MapEntity): boolean {
  return entity.kind === 'wanderer' || entity.kind === 'caravan' || entity.kind === 'army';
}

function blankTrack(dir: LiveDirector, entity: MapEntity, hours: number): LiveTrack {
  const at = quantizePt(zoneFromWorld(entity.x, entity.y, frameOf(dir.area, dir.worldWidth)));
  return {
    iv: 0,
    intent: { kind: 'idle', at, untilH: hours + 0.25 },
    phase: 'out',
    visitsDone: 0,
    visitBudget: 1 + Math.floor(liveDraw(dir.sid, entity.id, 2) * 3),
    enteredSide: null,
    yield: false,
    introduced: false,
    lastKey: '',
  };
}

function refreshUntil(dir: LiveDirector, entity: MapEntity, track: LiveTrack, hours: number): void {
  const until = untilHours(track.intent);
  if (until == null || hours < until) return;
  if (track.intent.kind === 'halt' && entity.kind === 'army') {
    track.intent = passThrough(dir, entity, track);
    track.iv += 1;
    return;
  }
  if (track.intent.kind === 'halt') {
    track.intent = leaveIntent(dir, entity, track);
    track.iv += 1;
    return;
  }
  if (track.intent.kind === 'inside' || track.intent.kind === 'talk' || track.intent.kind === 'idle') {
    track.intent = initialIntent(dir, entity, track, hours);
    track.iv += 1;
  }
}

function chooseAfterVisit(dir: LiveDirector, entity: MapEntity, track: LiveTrack, hours: number): void {
  if (entity.kind === 'army') {
    track.intent = passThrough(dir, entity, track);
  } else if (track.visitsDone >= track.visitBudget || entity.kind === 'caravan') {
    track.intent = leaveIntent(dir, entity, track);
  } else {
    track.intent = visitIntent(dir, entity, track, hours) ?? leaveIntent(dir, entity, track);
  }
  track.iv += 1;
}

function initialIntent(dir: LiveDirector, entity: MapEntity, track: LiveTrack, hours: number): Intent {
  const destInside = inPlaceTiles(entity.destX, entity.destY, dir.tiles, dir.worldWidth);
  if (!destInside) return passThrough(dir, entity, track);
  if (entity.kind === 'caravan') return walkToPlaza(dir, entity);
  if (entity.kind === 'army') return haltCamp(dir, entity, track, hours);
  if (track.visitsDone >= track.visitBudget) return leaveIntent(dir, entity, track);
  return visitIntent(dir, entity, track, hours) ?? idleAt(dir, entity, hours);
}

function visitIntent(dir: LiveDirector, entity: MapEntity, track: LiveTrack, hours: number): Intent | null {
  const building = pickVisitBuilding(dir, entity, track, hours);
  if (!building) return null;
  const dwell = 0.45 + liveDraw(dir.sid, entity.id, 4 + track.visitsDone) * 0.9;
  return {
    kind: 'visit',
    buildingId: building.id,
    door: quantizePt(doorApproachPoint(dir.area, building)),
    dwellH: Math.round(dwell * 100) / 100,
    pace: 'walk',
  };
}

function pickVisitBuilding(dir: LiveDirector, entity: MapEntity, track: LiveTrack, hours: number): AreaBuilding | null {
  const buildings = dir.area.buildings;
  if (!buildings.length) return null;
  if (entity.resident) {
    const phase = residentAnchor(hours);
    const id =
      phase === 'work'
        ? entity.resident.workBuildingId
        : phase === 'tavern'
          ? entity.resident.tavernBuildingId
          : entity.resident.homeBuildingId;
    const bound = id ? buildings.find((building) => building.id === id) : undefined;
    if (bound) return bound;
  }
  const roll = liveDraw(dir.sid, entity.id, 3 + track.visitsDone);
  const inns = buildings.filter((building) => /inn|tavern/.test(building.type));
  const shops = buildings.filter((building) => /shop|blacksmith|market/.test(building.type));
  let pool = buildings;
  if (roll < 0.5 && inns.length) pool = inns;
  else if (roll < 0.8 && shops.length) pool = shops;
  const frame = frameOf(dir.area, dir.worldWidth);
  const dest = zoneFromWorld(entity.destX, entity.destY, frame);
  let best: AreaBuilding | null = null;
  let bestD = 24;
  for (const building of pool) {
    const door = doorApproachPoint(dir.area, building);
    const dist = Math.hypot(door.x - dest.x, door.z - dest.z);
    if (dist < bestD) {
      bestD = dist;
      best = building;
    }
  }
  if (best) return best;
  let fallback: AreaBuilding | null = null;
  let fallbackD = Infinity;
  for (const building of pool) {
    const door = doorApproachPoint(dir.area, building);
    const dist = Math.hypot(door.x - dest.x, door.z - dest.z);
    if (dist < fallbackD) {
      fallbackD = dist;
      fallback = building;
    }
  }
  return fallback;
}

function walkToPlaza(dir: LiveDirector, entity: MapEntity): Intent {
  return { kind: 'walk_to', to: quantizePt(plazaPoint(dir.area)), ref: 'plaza', pace: 'walk' };
}

function haltCamp(dir: LiveDirector, entity: MapEntity, track: LiveTrack, hours: number): Intent {
  const side = track.enteredSide ?? 'S';
  const edge = exitPoint(dir.area, side);
  const inward = inwardMetre(side);
  const at = quantizePt({ x: edge.x + inward.x * 4, z: edge.z + inward.z * 4 });
  return {
    kind: 'halt',
    at,
    reason: 'camp',
    untilH: hours + 0.5 + liveDraw(dir.sid, entity.id, 6) * 1,
  };
}

function passThrough(dir: LiveDirector, entity: MapEntity, track: LiveTrack): Intent {
  const to = sideToward(dir, entity.destX, entity.destY);
  const from = track.enteredSide ?? opposite(to);
  return {
    kind: 'pass_through',
    from,
    to,
    exit: quantizePt(exitPoint(dir.area, to)),
    viaRoad: entity.kind !== 'wanderer',
    pace: 'walk',
  };
}

function leaveIntent(dir: LiveDirector, entity: MapEntity, track: LiveTrack): Intent {
  const side = inPlaceTiles(entity.destX, entity.destY, dir.tiles, dir.worldWidth)
    ? opposite(track.enteredSide ?? 'S')
    : sideToward(dir, entity.destX, entity.destY);
  return { kind: 'leave', side, exit: quantizePt(exitPoint(dir.area, side)), pace: 'walk' };
}

function idleAt(dir: LiveDirector, entity: MapEntity, hours: number): Intent {
  const at = quantizePt(zoneFromWorld(entity.x, entity.y, frameOf(dir.area, dir.worldWidth)));
  return { kind: 'idle', at, untilH: hours + 0.25, task: 'look' };
}

function untilHours(intent: Intent): number | null {
  if (intent.kind === 'inside' || intent.kind === 'halt' || intent.kind === 'idle' || intent.kind === 'talk') return intent.untilH;
  return null;
}

function toNpcState(dir: LiveDirector, entity: MapEntity, track: LiveTrack, withLook: boolean): NpcState {
  const phase = track.phase === 'inside' ? 'inside' : track.phase === 'in' || entity.heldBy === dir.sid ? 'in' : 'near';
  const state: NpcState = {
    id: entity.id,
    iv: track.iv,
    kind: entity.kind,
    phase,
    speed: npcSpeedMps(entity.speed),
    intent: track.intent,
  };
  if (phase === 'near') {
    state.pos = quantizePt(zoneFromWorld(entity.x, entity.y, frameOf(dir.area, dir.worldWidth)));
    state.yaw = Math.round(facingToYaw(entity.facing) * 1000) / 1000;
  }
  if (withLook) {
    state.name = entity.name.slice(0, 48);
    state.look = { sheet: entity.sheet, char: entity.char };
    state.members = memberBlock(entity);
  }
  return state;
}

function memberBlock(entity: MapEntity): NpcState['members'] | undefined {
  if (!entity.members.length) return undefined;
  const show = entity.kind === 'army' ? Math.min(MAX_ARMY_SHOW, entity.members.length) : Math.min(16, entity.members.length);
  return {
    n: entity.members.length,
    show,
    looks: entity.members.slice(0, show).map((member) => ({ sheet: member.sheet, char: member.char })),
  };
}

function plazaPoint(area: AreaExport): Pt {
  const ground = decodeB64U8(area.layers.ground.data);
  const width = area.grid.w;
  const height = area.grid.h;
  const meters = area.units.metersPerTile;
  const plazas: Pt[] = [];
  for (let iy = 0; iy < height; iy++) {
    for (let ix = 0; ix < width; ix++) {
      if (ground[ix + iy * width] !== GROUND.plaza) continue;
      plazas.push({ x: (ix + 0.5) * meters, z: (iy + 0.5) * meters });
    }
  }
  const bounds = area.area.worldBounds;
  const origin = area.area.innerOrigin;
  const cx = ((bounds.x0 + bounds.x1 + 1) / 2) * area.units.zoneScale;
  const cy = ((bounds.y0 + bounds.y1 + 1) / 2) * area.units.zoneScale;
  const center = { x: (cx - origin.x) * meters, z: (cy - origin.y) * meters };
  if (!plazas.length) return center;
  let best = plazas[0]!;
  let bestD = Infinity;
  for (const plaza of plazas) {
    const dist = (plaza.x - center.x) ** 2 + (plaza.z - center.z) ** 2;
    if (dist < bestD) {
      bestD = dist;
      best = plaza;
    }
  }
  return best;
}

function exitPoint(area: AreaExport, side: Cardinal): Pt {
  const entry = area.entries.find((item) => item.kind === 'edge' && item.side === side);
  const origin = area.area.innerOrigin;
  const meters = area.units.metersPerTile;
  if (entry) return { x: (entry.x - origin.x) * meters, z: (entry.y - origin.y) * meters };
  const bounds = area.area.worldBounds;
  const scale = area.units.zoneScale;
  const x0 = (bounds.x0 * scale - origin.x) * meters;
  const x1 = ((bounds.x1 + 1) * scale - origin.x) * meters;
  const z0 = (bounds.y0 * scale - origin.y) * meters;
  const z1 = ((bounds.y1 + 1) * scale - origin.y) * meters;
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  if (side === 'N') return { x: mx, z: z0 };
  if (side === 'S') return { x: mx, z: z1 };
  if (side === 'W') return { x: x0, z: mz };
  return { x: x1, z: mz };
}

function sideToward(dir: LiveDirector, destX: number, destY: number): Cardinal {
  const frame = frameOf(dir.area, dir.worldWidth);
  const bounds = dir.area.area.worldBounds;
  const dest = zoneFromWorld(destX, destY, frame);
  const mid = zoneFromWorld((bounds.x0 + bounds.x1 + 1) / 2, (bounds.y0 + bounds.y1 + 1) / 2, frame);
  const dx = dest.x - mid.x;
  const dz = dest.z - mid.z;
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'E' : 'W';
  return dz >= 0 ? 'S' : 'N';
}

function sideOf(entity: MapEntity, dir: LiveDirector): Cardinal {
  return sideToward(dir, entity.x, entity.y);
}

function nearestBuilding(area: AreaExport, wx: number, wy: number, types?: string[]): AreaBuilding | undefined {
  const frame = frameOf(area, 100000);
  const point = zoneFromWorld(wx, wy, frame);
  let best: AreaBuilding | undefined;
  let bestD = Infinity;
  for (const building of area.buildings) {
    if (types && !types.some((type) => building.type.includes(type))) continue;
    const door = doorApproachPoint(area, building);
    const dist = Math.hypot(door.x - point.x, door.z - point.z);
    if (dist < bestD) {
      bestD = dist;
      best = building;
    }
  }
  return best;
}

function opposite(side: Cardinal): Cardinal {
  if (side === 'N') return 'S';
  if (side === 'S') return 'N';
  if (side === 'E') return 'W';
  return 'E';
}

function sideStep(side: Cardinal): { x: number; y: number } {
  if (side === 'N') return { x: 0, y: -1 };
  if (side === 'S') return { x: 0, y: 1 };
  if (side === 'W') return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

function outwardMetre(side: Cardinal): { x: number; z: number } {
  if (side === 'N') return { x: 0, z: -1 };
  if (side === 'S') return { x: 0, z: 1 };
  if (side === 'W') return { x: -1, z: 0 };
  return { x: 1, z: 0 };
}

function inwardMetre(side: Cardinal): { x: number; z: number } {
  const out = outwardMetre(side);
  return { x: -out.x, z: -out.z };
}
