import type { MapEntity, WorldData } from '../../models/world.models';
import { settlementLayout } from '../buildings';
import { crowdWater, placeCrowd } from '../crowd-mix';
import { residentCountFor, residentEntityId } from '../entities';
import {
  isDwellingType,
  isSettlementKind,
  residentCensus,
  resolveResidentParams,
  type ResidentOverride,
} from '../residents';
import { tierForKind } from '../settlement-tiers';
import { bootstrapPeople, type BootstrapResult } from './bootstrap';
import type { PlaceSeed, TravellerSeed } from './types';

const BANDIT_ROLES = ['Raider', 'Beast', 'Warband Runner', 'Harbinger'];

/** Census places and traveller parties for one generated world. */
export function bootstrapFromWorld(
  world: WorldData,
  entities: readonly MapEntity[],
  overrides?: Record<string, ResidentOverride>,
): BootstrapResult {
  const places = placesFromWorld(world, overrides);
  for (const place of places) {
    const names: string[] = [];
    for (let i = 0; i < place.named; i++) {
      const entity = entities.find((row) => row.id === residentEntityId(place.id, i));
      if (entity) names.push(entity.name);
    }
    if (names.length) place.namedNames = names;
  }
  return bootstrapPeople({
    worldSeed: world.seed,
    clockHours: 8,
    places,
    travellers: travellersFrom(entities),
  });
}

export function placesFromWorld(world: WorldData, overrides?: Record<string, ResidentOverride>): PlaceSeed[] {
  const defaults = {
    residentsMode: world.settings.residentsMode,
    avgPerHouse: world.settings.avgPerHouse,
    avgPerPlace: world.settings.avgPerPlace,
  };
  const places: PlaceSeed[] = [];
  for (const node of world.nodes) {
    if (!isSettlementKind(node.kind)) continue;
    const tier = tierForKind(node.kind);
    if (!tier) continue;
    const params = resolveResidentParams(defaults, overrides?.[node.id]);
    const layout = settlementLayout(node, world);
    const houses = layout.filter((building) => isDwellingType(building.sprite)).length;
    const listed = layout.map((building) => ({ specialty: building.specialty, kit: building.kit }));
    const crowd = placeCrowd({
      worldSeed: world.seed,
      placeId: node.id,
      tier,
      buildings: listed,
      water: crowdWater(world, node, listed),
    });
    places.push({
      id: node.id,
      name: node.name,
      x: node.cx,
      y: node.cy,
      census: residentCensus({
        seed: world.seed,
        placeId: node.id,
        mode: params.mode,
        avg: params.avg,
        houses: params.mode === 'perHouse' ? houses : 1,
      }),
      named: residentCountFor(node),
      mix: crowd.mix,
      crowdSeed: crowd.seed,
    });
  }
  return places;
}

export function travellersFrom(entities: readonly MapEntity[]): TravellerSeed[] {
  const out: TravellerSeed[] = [];
  for (const entity of entities) {
    if (entity.resident || entity.token) continue;
    if (entity.kind !== 'wanderer' && entity.kind !== 'caravan' && entity.kind !== 'army') continue;
    out.push({
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      x: entity.x,
      y: entity.y,
      destX: entity.destX,
      destY: entity.destY,
      speed: entity.speed,
      bandit: entity.kind === 'wanderer' && BANDIT_ROLES.some((role) => entity.name.endsWith(role)),
    });
  }
  return out;
}
