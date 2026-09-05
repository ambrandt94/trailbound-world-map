/**
 * Occasional NPC lines about the current world.
 *
 * Pure content + pacing — a session/API layer owns speakers and display.
 * Lines mention real place / POI / biome / person names when those exist.
 */
import {
  BIOME_LABELS,
  Biome,
  KIND_LABELS,
  MapEntity,
  POI_LABELS,
  WorldData,
  biomeAt,
} from '../models/world.models';
import { Rng } from './noise';

export const NPC_BUBBLE_MS = 5200;
const NEAR_TILES = 14;
const FAR_TILES = 26;
const MIN_GAP_MS = 8000;
const GAP_SPREAD_MS = 6000;
const PER_SPEAKER_HOURS = 2.4;

export interface ChatterLine {
  speakerId: string;
  name: string;
  text: string;
}

export interface ChatterState {
  lastById: Map<string, number>;
  nextAt: number;
}

export function createChatterState(): ChatterState {
  return { lastById: new Map(), nextAt: 0 };
}

export function stepNpcChatter(
  state: ChatterState,
  world: WorldData,
  entities: MapEntity[],
  player: { x: number; y: number; name: string },
  nowMs: number,
  clockHours: number,
  rng: Rng,
): ChatterLine | null {
  if (nowMs < state.nextAt) return null;
  const near = entities.filter((e) => e.kind !== 'army' && Math.hypot(e.x - player.x, e.y - player.y) <= NEAR_TILES);
  const speakers =
    near.length > 0
      ? near
      : entities.filter((e) => e.kind !== 'army' && Math.hypot(e.x - player.x, e.y - player.y) <= FAR_TILES);
  if (!speakers.length) {
    state.nextAt = nowMs + 2500;
    return null;
  }
  const ready = speakers.filter((e) => (state.lastById.get(e.id) ?? -99) + PER_SPEAKER_HOURS <= clockHours);
  const pool = ready.length ? ready : speakers;
  const speaker = rng.pick(pool);
  const text = composeChatterLine(world, entities, speaker, player, rng);
  if (!text) {
    state.nextAt = nowMs + 4000;
    return null;
  }
  state.lastById.set(speaker.id, clockHours);
  if (state.lastById.size > 80) {
    const oldest = [...state.lastById.entries()].sort((a, b) => a[1] - b[1]).slice(0, 32);
    for (const [id] of oldest) state.lastById.delete(id);
  }
  state.nextAt = nowMs + MIN_GAP_MS + rng.range(0, GAP_SPREAD_MS);
  return { speakerId: speaker.id, name: speaker.name, text };
}

function composeChatterLine(
  world: WorldData,
  entities: MapEntity[],
  speaker: MapEntity,
  player: { x: number; y: number; name: string },
  rng: Rng,
): string | null {
  const biome = biomeAt(world, speaker.x, speaker.y);
  const biomeName = biome === Biome.Water ? null : BIOME_LABELS[biome];
  const place = nearestPlace(world, speaker.x, speaker.y);
  const poi = nearestPoi(world, speaker.x, speaker.y);
  const other = nearbyOther(entities, speaker, player);
  const kind = place ? KIND_LABELS[place.kind] : null;

  const lines: string[] = [];
  if (poi) {
    const poiKind = POI_LABELS[poi.kind];
    lines.push(`Heard they still keep a light at ${poi.name}.`);
    lines.push(`The ${poiKind} at ${poi.name} isn't as quiet as it looks.`);
    lines.push(`If you pass ${poi.name}, watch the road.`);
  }
  if (place) {
    lines.push(`${place.name} is a long walk from here.`);
    lines.push(`They say ${place.name} still takes in travelers.`);
    if (kind) lines.push(`Road for the ${kind} of ${place.name} runs that way.`);
  }
  if (biomeName) {
    lines.push(`This ${biomeName.toLowerCase()} stretch wears you down.`);
    lines.push(`${biomeName} weather always turns when the wagons show.`);
  }
  if (other && place) lines.push(`Saw ${shortName(other)} heading toward ${place.name}.`);
  if (other && poi) lines.push(`${shortName(other)} was asking after ${poi.name}.`);
  if (other) lines.push(`${shortName(other)} passed through not long ago.`);
  if (player.name && place && rng.chance(0.35)) {
    lines.push(`${player.name}, ${place.name} is the usual stop from here.`);
  }
  if (!lines.length) return null;
  return rng.pick(lines);
}

function nearestPlace(world: WorldData, x: number, y: number): { name: string; kind: WorldData['nodes'][number]['kind'] } | null {
  let best: WorldData['nodes'][number] | null = null;
  let bestD = 28;
  for (const n of world.nodes) {
    const d = Math.hypot(n.cx - x, n.cy - y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best ? { name: best.name, kind: best.kind } : null;
}

function nearestPoi(world: WorldData, x: number, y: number): { name: string; kind: WorldData['pois'][number]['kind'] } | null {
  let best: WorldData['pois'][number] | null = null;
  let bestD = 22;
  for (const p of world.pois) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? { name: best.name, kind: best.kind } : null;
}

function nearbyOther(
  entities: MapEntity[],
  speaker: MapEntity,
  player: { x: number; y: number; name: string },
): string | null {
  let bestName: string | null = null;
  let bestD = 14;
  for (const e of entities) {
    if (e.id === speaker.id) continue;
    const d = Math.hypot(e.x - speaker.x, e.y - speaker.y);
    if (d < bestD) {
      bestD = d;
      bestName = e.name;
    }
  }
  const pd = Math.hypot(player.x - speaker.x, player.y - speaker.y);
  if (player.name && pd < bestD) bestName = player.name;
  return bestName;
}

function shortName(name: string): string {
  const part = name.trim().split(/\s+/)[0];
  return part || name;
}
