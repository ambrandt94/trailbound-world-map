/**
 * Entity counts and save/load/tick timings for seed 7741 at world scale 16.
 *   node --import tsx scripts/people-metrics.ts
 */
import 'fake-indexeddb/auto';
import { performance } from 'node:perf_hooks';
import { bootstrapFromWorld } from '../src/app/engine/people/from-world';
import { advanceHours, openWorldDb, packWorld, totalMoney, unpackWorld } from '../src/app/engine/people';
import { spawnEntities, spawnResidents } from '../src/app/engine/entities';
import { generateWorld } from '../src/app/engine/world-gen';
import { DEFAULT_WORLD_SETTINGS } from '../src/app/models/world.models';

async function main(): Promise<void> {
const seed = 7741;
const world = generateWorld(seed, { ...DEFAULT_WORLD_SETTINGS, worldScale: 16 });
const entities = [...spawnEntities(world, seed), ...spawnResidents(world, seed)];
const built = bootstrapFromWorld(world, entities);
const state = built.state;

const residents = [...state.people.values()].filter((person) => person.home.kind === 'town').length;
const stubs = state.stubs.size;
const parties = [...state.parties.values()].filter((party) => party.purpose !== 'relocating').length;
const named = [...state.people.values()].filter((person) => person.mapEntityId).length;

const db = openWorldDb({ name: 'tb-world-entities-metrics' });
const saveStarted = performance.now();
const saveBytes = await db.save(packWorld(state), built.details);
const saveMs = performance.now() - saveStarted;
const loadStarted = performance.now();
const loaded = unpackWorld(await db.load(seed));
const loadMs = performance.now() - loadStarted;

const tickStarted = performance.now();
advanceHours(state, 24, state.places);
const tickMs = performance.now() - tickStarted;
const weekStarted = performance.now();
advanceHours(state, 24 * 7, state.places);
const weekMs = performance.now() - weekStarted;
const livedStarted = performance.now();
const livedBytes = await db.save(packWorld(state));
const livedSaveMs = performance.now() - livedStarted;
const livedLoadStarted = performance.now();
const lived = unpackWorld(await db.load(seed));
const livedLoadMs = performance.now() - livedLoadStarted;

const report = {
  seed,
  worldScale: 16,
  width: world.width,
  settlements: state.places.map((place) => ({ id: place.id, name: place.name, census: place.census, named: place.named })),
  persons: state.people.size,
  residents,
  namedResidents: named,
  travellerStubs: stubs,
  parties,
  campsAfter8Days: state.camps.size,
  minted: state.minted,
  moneyAfter8Days: totalMoney(state),
  clockHours: state.clockHours,
  saveBytes,
  saveMs: Math.round(saveMs * 100) / 100,
  loadMs: Math.round(loadMs * 100) / 100,
  tickMs: Math.round(tickMs * 100) / 100,
  weekMs: Math.round(weekMs * 100) / 100,
  loadedPersons: loaded?.people.size ?? 0,
  loadedClock: loaded?.clockHours ?? null,
  detailBlobs: built.details.length,
  livedSaveBytes: livedBytes,
  livedSaveMs: Math.round(livedSaveMs * 100) / 100,
  livedLoadMs: Math.round(livedLoadMs * 100) / 100,
  livedClock: lived?.clockHours ?? null,
  livedCamps: lived?.camps.size ?? 0,
  gap: totalMoney(state) - state.minted,
};
console.log(JSON.stringify(report, null, 2));
await db.close();
await new Promise<void>((resolve, reject) => {
  const req = indexedDB.deleteDatabase('tb-world-entities-metrics');
  req.onsuccess = () => resolve();
  req.onerror = () => reject(req.error);
});
}

void main();
