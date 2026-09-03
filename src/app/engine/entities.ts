import {
  Biome,
  EntityKind,
  Facing,
  MapEntity,
  MapNode,
  WorldData,
  biomeAt,
  clamp,
  facingFromDelta,
  facingVec,
  lerpWrapX,
  traversableAt,
  walkableAt,
  waterAt,
  wrapDeltaX,
  wrapX,
} from '../models/world.models';
import { Rng } from './noise';

const WANDER_NAMES = [
  'Wren',
  'Bram',
  'Pip',
  'Oats',
  'Lark',
  'Nettle',
  'Rowan',
  'Ash',
  'Moss',
  'Briar',
  'Sedge',
  'Otter',
  'Hare',
  'Fox',
  'Dusk',
  'Thorn',
];

const ARMY_NAMES = ['Thorn Host', 'Pike Company', 'Crow Banner', 'Ashfen Levy', 'Watch Riders'];

/** People sheets from Time Fantasy NPC + dwarf/elf packs (plus a few animals). */
const PEOPLE_SHEETS = [
  'townsfolk',
  'farmer',
  'household',
  'elder',
  'bard',
  'blacksmith',
  'children',
  'dwarf1',
  'dwarf2',
  'elf1',
  'elf2',
  'animals1',
  'animals2',
] as const;

const ARMY_SHEETS = ['knights', 'knights2', 'dwarf1', 'dwarf2', 'executioner', 'animals5'] as const;

const ARMY_COLS = 5;
/** Far-zoom marker / trail size. Close zoom draws the full roster. */
const ARMY_FAR_VISIBLE = 5;

export function spawnEntities(world: WorldData, seed: number): MapEntity[] {
  const rng = new Rng(seed ^ 0x51ed);
  const cities = world.nodes.filter((n) => n.kind === 'city' || n.kind === 'town');
  const landMarks = [...world.nodes, ...world.pois.map((p) => ({ cx: p.x, cy: p.y, radius: p.radius }))];
  const entities: MapEntity[] = [];
  const wanderN = world.settings?.wanderers ?? 16;
  const caravanN = world.settings?.caravans ?? 4;
  const armyN = world.settings?.armies ?? 2;

  for (let i = 0; i < wanderN; i++) {
    const spot = findLand(world, rng, landMarks);
    if (!spot) continue;
    const dest = wanderDest(world, rng, cities);
    const look = pickPerson(rng);
    entities.push({
      id: `wanderer-${i}`,
      name: `${rng.pick(WANDER_NAMES)} ${rng.pick(['Walker', 'Scout', 'Peddler', 'Messenger', 'Pilgrim'])}`,
      kind: 'wanderer',
      x: spot.x,
      y: spot.y,
      facing: rng.int(0, 3) as Facing,
      frame: 1,
      anim: rng.range(0, 4),
      speed: rng.range(1.35, 1.9),
      sheet: look.sheet,
      char: look.char,
      destX: dest.x,
      destY: dest.y,
      members: [],
      afloat: false,
    });
  }

  if (cities.length) {
    for (let i = 0; i < caravanN; i++) {
      const from = cities[i % cities.length]!;
      const to = cities[(i + 1) % cities.length] ?? from;
      const start = edgeOf(from, rng);
      const packed = 4 + (i % 4);
      const escort = pickPerson(rng);
      const members = [
        {
          x: start.x,
          y: start.y + 0.4,
          sheet: 'horse1',
          char: 4 + ((i + 1) % 4),
          facing: 0 as Facing,
          frame: 1,
        },
        {
          x: start.x,
          y: start.y + 0.8,
          sheet: escort.sheet,
          char: escort.char,
          facing: 0 as Facing,
          frame: 1,
        },
      ];
      entities.push({
        id: `caravan-${i}`,
        name: `${from.name}–${to.name} caravan`,
        kind: 'caravan',
        x: start.x,
        y: start.y,
        facing: 0,
        frame: 1,
        anim: 0,
        speed: rng.range(0.95, 1.25),
        sheet: 'horse1',
        char: packed,
        destX: to.cx,
        destY: to.cy,
        members,
        afloat: false,
      });
    }
  }

  for (let i = 0; i < armyN; i++) {
    const spot = findLand(world, rng, landMarks) ?? { x: world.width * 0.4, y: world.height * 0.4 };
    const dest = armyDest(world, rng);
    const lead = pickSoldier(rng);
    const roster = rng.int(28, 44);
    const members = Array.from({ length: roster - 1 }, (_, n) => {
      const look = pickSoldier(rng);
      const slot = armySlot(n);
      return {
        x: spot.x + slot.dx,
        y: spot.y + slot.dy,
        sheet: look.sheet,
        char: look.char,
        facing: 0 as Facing,
        frame: 1,
      };
    });
    entities.push({
      id: `army-${i}`,
      name: ARMY_NAMES[i % ARMY_NAMES.length]!,
      kind: 'army',
      x: spot.x,
      y: spot.y,
      facing: 0,
      frame: 1,
      anim: 0,
      speed: rng.range(0.72, 1.05),
      sheet: lead.sheet,
      char: lead.char,
      destX: dest.x,
      destY: dest.y,
      members,
      afloat: false,
    });
  }

  return entities;
}

/** How many army followers to draw at this zoom (lead is separate). */
export function armyVisibleFollowers(scale: number, roster: number): number {
  if (roster <= 0) return 0;
  if (scale < 3.2) return Math.min(ARMY_FAR_VISIBLE, roster);
  if (scale < 7) return Math.min(12, roster);
  if (scale < 14) return Math.min(22, roster);
  if (scale < 28) return Math.min(32, roster);
  return roster;
}

export function stepEntities(world: WorldData, entities: MapEntity[], dt: number, rng: Rng): void {
  if (dt <= 0) return;
  for (const e of entities) {
    const dist = Math.hypot(wrapDeltaX(e.x, e.destX, world.width), e.destY - e.y);
    if (dist < 1.15) retarget(world, e, rng);
    const step = e.speed * dt * (e.afloat ? 1.15 : 1);
    const moved = moveToward(world, e, step);
    const wasAfloat = e.afloat;
    e.afloat = waterAt(world, e.x, e.y);
    if (moved > 0.002) {
      e.anim += moved * (e.afloat ? 5.5 : 8.5);
      e.frame = [0, 1, 2, 1][Math.floor(e.anim) % 4]!;
      if (e.afloat) {
        for (const m of e.members) {
          m.x = e.x;
          m.y = e.y;
          m.facing = e.facing;
          m.frame = e.frame;
        }
      } else {
        if (wasAfloat) {
          for (const m of e.members) {
            m.x = e.x;
            m.y = e.y;
          }
        }
        trailMembers(e, dt, world.width);
      }
    } else {
      e.frame = 1;
      retarget(world, e, rng);
    }
  }
}

function pickPerson(rng: Rng): { sheet: string; char: number } {
  const sheet = rng.pick([...PEOPLE_SHEETS]);
  return { sheet, char: rng.int(0, 7) };
}

function pickSoldier(rng: Rng): { sheet: string; char: number } {
  const sheet = rng.pick([...ARMY_SHEETS]);
  if (sheet === 'animals5') return { sheet, char: rng.pick([4, 5, 6, 7]) };
  return { sheet, char: rng.int(0, 7) };
}

function armySlot(index: number): { dx: number; dy: number } {
  const row = Math.floor(index / ARMY_COLS);
  const col = index % ARMY_COLS;
  return {
    dx: (col - (ARMY_COLS - 1) / 2) * 0.3,
    dy: (row + 1) * 0.34,
  };
}

function retarget(world: WorldData, e: MapEntity, rng: Rng): void {
  const cities = world.nodes.filter((n) => n.kind === 'city' || n.kind === 'town');
  if (e.kind === 'caravan' && cities.length) {
    const next = rng.pick(cities);
    e.destX = next.cx + rng.range(-1.2, 1.2);
    e.destY = next.cy + rng.range(-1.2, 1.2);
    const other = cities.find((c) => Math.hypot(c.cx - e.x, c.cy - e.y) > 4) ?? next;
    e.name = `${nearestCityName(cities, e.x, e.y)}–${other.name} caravan`;
    return;
  }
  if (e.kind === 'army') {
    const dest = armyDest(world, rng);
    e.destX = dest.x;
    e.destY = dest.y;
    return;
  }
  const dest = wanderDest(world, rng, cities);
  e.destX = dest.x;
  e.destY = dest.y;
}

function moveToward(world: WorldData, e: MapEntity, dist: number): number {
  if (dist <= 0) return 0;
  const dx = wrapDeltaX(e.x, e.destX, world.width);
  const dy = e.destY - e.y;
  const remain = Math.hypot(dx, dy);
  if (remain < 0.02) return 0;

  let bestX = e.x;
  let bestY = e.y;
  let bestScore = -Infinity;
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7],
  ];
  const look = Math.min(1.15, Math.max(0.45, dist));
  for (const [ox, oy] of dirs) {
    const nx = wrapX(e.x + ox * look, world.width);
    const ny = clamp(e.y + oy * look, 0.6, world.height - 0.6);
    if (!traversableAt(world, nx, ny)) continue;
    let score = -Math.hypot(wrapDeltaX(nx, e.destX, world.width), e.destY - ny);
    const ix = Math.floor(nx);
    const iy = Math.floor(ny);
    if (ix >= 0 && iy >= 0 && ix < world.width && iy < world.height && world.paths[ix + iy * world.width]) {
      score += e.kind === 'wanderer' ? 0.28 : 0.55;
    }
    const biome = biomeAt(world, nx, ny);
    if (e.kind === 'caravan' && (biome === Biome.Mountain || biome === Biome.Marsh)) score -= 0.35;
    if (e.kind === 'army' && biome === Biome.DarkForest) score += 0.12;
    if (score > bestScore) {
      bestScore = score;
      bestX = nx;
      bestY = ny;
    }
  }
  const mx = wrapDeltaX(e.x, bestX, world.width);
  const my = bestY - e.y;
  const md = Math.hypot(mx, my);
  if (md < 0.0001) return 0;
  const use = Math.min(dist, remain, md);
  const ux = (mx / md) * use;
  const uy = (my / md) * use;
  const nx = wrapX(e.x + ux, world.width);
  const ny = clamp(e.y + uy, 0.6, world.height - 0.6);
  if (!traversableAt(world, nx, ny)) return 0;
  e.facing = facingFromDelta(ux, uy);
  e.x = nx;
  e.y = ny;
  return use;
}

function trailMembers(e: MapEntity, dt: number, width: number): void {
  if (!e.members.length) return;
  const f = facingVec(e.facing);
  const k = 1 - Math.exp(-dt * (e.kind === 'army' ? 5.5 : 7));
  for (let i = 0; i < e.members.length; i++) {
    const m = e.members[i]!;
    let along: number;
    let side: number;
    if (e.kind === 'army') {
      const slot = armySlot(i);
      along = -slot.dy;
      side = slot.dx;
    } else {
      along = -(i + 1) * 0.55;
      side = 0;
    }
    const tx = wrapX(e.x + f.x * along + -f.y * side, width);
    const ty = e.y + f.y * along + f.x * side;
    m.x = lerpWrapX(m.x, tx, k, width);
    m.y += (ty - m.y) * k;
    m.facing = e.facing;
    m.frame = e.frame;
  }
}

function wanderDest(world: WorldData, rng: Rng, cities: MapNode[]): { x: number; y: number } {
  if (cities.length && rng.chance(0.45)) {
    const c = rng.pick(cities);
    return { x: c.cx + rng.range(-2, 2), y: c.cy + rng.range(-2, 2) };
  }
  if (world.pois.length && rng.chance(0.3)) {
    const p = rng.pick(world.pois);
    return { x: p.x, y: p.y };
  }
  return findLand(world, rng, []) ?? { x: world.width / 2, y: world.height / 2 };
}

function armyDest(world: WorldData, rng: Rng): { x: number; y: number } {
  const camps = world.pois.filter((p) => p.kind === 'military-camp' || p.kind === 'battlefield' || p.kind === 'ruins');
  if (camps.length && rng.chance(0.7)) {
    const p = rng.pick(camps);
    return { x: p.x, y: p.y };
  }
  const nodes = world.nodes.filter((n) => n.kind === 'camp' || n.kind === 'pass');
  if (nodes.length && rng.chance(0.5)) {
    const n = rng.pick(nodes);
    return { x: n.cx, y: n.cy };
  }
  return findLand(world, rng, []) ?? { x: world.width / 2, y: world.height / 2 };
}

function findLand(
  world: WorldData,
  rng: Rng,
  avoid: Array<{ cx: number; cy: number; radius: number }>,
): { x: number; y: number } | null {
  const pad = Math.max(8, Math.min(world.width, world.height) * 0.04);
  for (let i = 0; i < 200; i++) {
    const x = rng.range(pad, world.width - pad);
    const y = rng.range(pad, world.height - pad);
    if (!walkableAt(world, x, y)) continue;
    const b = biomeAt(world, x, y);
    if (b === Biome.Mountain || b === Biome.Snow) continue;
    const blocked = avoid.some((n) => Math.hypot(n.cx - x, n.cy - y) < n.radius * 0.6);
    if (blocked) continue;
    return { x, y };
  }
  return null;
}

function edgeOf(node: MapNode, rng: Rng): { x: number; y: number } {
  const tiles = node.tiles;
  if (!tiles?.length) {
    const b = { x0: node.x0, y0: node.y0, x1: node.x1, y1: node.y1 };
    const t = rng.next();
    const w = Math.max(0.001, b.x1 - b.x0);
    const h = Math.max(0.001, b.y1 - b.y0);
    const perim = 2 * (w + h);
    const d = t * perim;
    if (d < w) return { x: b.x0 + d, y: b.y0 };
    if (d < w + h) return { x: b.x1, y: b.y0 + (d - w) };
    if (d < w + h + w) return { x: b.x1 - (d - w - h), y: b.y1 };
    return { x: b.x0, y: b.y1 - (d - w - h - w) };
  }
  const set = new Set(tiles.map((p) => `${p.x},${p.y}`));
  const rim = tiles.filter(
    (p) =>
      !set.has(`${p.x},${p.y - 1}`) ||
      !set.has(`${p.x + 1},${p.y}`) ||
      !set.has(`${p.x},${p.y + 1}`) ||
      !set.has(`${p.x - 1},${p.y}`),
  );
  const pick = rim.length ? rng.pick(rim) : rng.pick(tiles);
  return { x: pick.x + 0.5, y: pick.y + 0.5 };
}

function nearestCityName(cities: MapNode[], x: number, y: number): string {
  let best = cities[0]!;
  let bestD = Infinity;
  for (const c of cities) {
    const d = Math.hypot(c.cx - x, c.cy - y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best.name;
}

export function nearestEntity(entities: MapEntity[], x: number, y: number, maxDist: number): MapEntity | null {
  let best: MapEntity | null = null;
  let bestD = maxDist;
  for (const e of entities) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function kindColor(kind: EntityKind): string {
  switch (kind) {
    case 'army':
      return '#e89090';
    case 'caravan':
      return '#e0a86a';
    default:
      return '#7dcea0';
  }
}

export function boatChar(kind: EntityKind): number {
  switch (kind) {
    case 'army':
      return 2;
    case 'caravan':
      return 1;
    default:
      return 0;
  }
}
