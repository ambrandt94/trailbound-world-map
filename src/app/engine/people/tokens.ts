import type { Facing, MapEntity } from '../../models/world.models';
import type { Camp, Party, PeopleState } from './types';

/** Residents stay in the sim data and never draw as map tokens. */
export function isMapToken(entity: { resident?: unknown }): boolean {
  return !entity.resident;
}

/** Upsert camp and relocating-party pins. Leaves resident entities in the list for the sim. */
export function syncMapTokens(state: PeopleState, entities: MapEntity[]): void {
  const wanted = new Map<string, MapEntity>();
  for (const camp of state.camps.values()) wanted.set(camp.id, campToken(camp));
  for (const party of state.parties.values()) {
    if (party.purpose !== 'relocating') continue;
    wanted.set(party.id, relocatingToken(party));
  }
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i]!;
    if (!entity.token) continue;
    const next = wanted.get(entity.id);
    if (!next) {
      entities.splice(i, 1);
      continue;
    }
    entity.x = next.x;
    entity.y = next.y;
    entity.destX = next.destX;
    entity.destY = next.destY;
    entity.name = next.name;
    entity.token = next.token;
    wanted.delete(entity.id);
  }
  for (const token of wanted.values()) entities.push(token);
}

function campToken(camp: Camp): MapEntity {
  const label = camp.kind === 'wagon-circle' ? 'Wagon circle' : 'Camp';
  return baseToken(camp.id, `${label} · ${camp.memberIds.length}`, camp.x, camp.y, camp.kind);
}

function relocatingToken(party: Party): MapEntity {
  return baseToken(party.id, 'Relocating', party.x, party.y, 'relocating', party.destX, party.destY);
}

function baseToken(
  id: string,
  name: string,
  x: number,
  y: number,
  token: NonNullable<MapEntity['token']>,
  destX = x,
  destY = y,
): MapEntity {
  return {
    id,
    name,
    kind: 'wanderer',
    x,
    y,
    facing: 0 as Facing,
    frame: 1,
    anim: 0,
    speed: 0,
    sheet: 'townsfolk',
    char: 0,
    destX,
    destY,
    members: [],
    afloat: false,
    token,
  };
}
