/**
 * P0 kit shells. Names follow kit_manifest / proposal §5.
 * `{style}` is the material suffix. The legacy sprite is what v0.5 readers
 * and the 2D map still draw. Footprints are metres on the 3 m lot grid.
 */
import {
  BuildingPart,
  BuildingTemplate,
  KIT_STRUCTURE_MAX,
  METERS_PER_STOREY,
  registerTemplate,
} from './building-templates';
import type { Biome } from '../models/world.models';

export type KitFamily = 'res' | 'shop' | 'work' | 'civic' | 'cap' | 'farm';

export interface KitBuilding {
  id: string;
  /** Kit name with a `{style}` token. */
  kit: string;
  family: KitFamily;
  /** Legacy `buildings[].type` / Town Tale sprite. */
  legacy: string;
  label: string;
  structW: number;
  structD: number;
  plotW: number;
  plotD: number;
  storeys: number;
  resTier?: 1 | 2 | 3 | 4 | 5;
}

export const KIT_BUILDINGS: readonly KitBuilding[] = [
  { id: 'tent', kit: 'bld_res_tent_3x3', family: 'res', legacy: 'cottage-1', label: 'Tent', structW: 3, structD: 3, plotW: 3, plotD: 3, storeys: 1, resTier: 1 },
  { id: 'hovel', kit: 'bld_res_hovel_{style}_3x6', family: 'res', legacy: 'cottage-1', label: 'Hovel', structW: 3, structD: 6, plotW: 6, plotD: 9, storeys: 1, resTier: 1 },
  { id: 'cottage', kit: 'bld_res_cottage_{style}_6x6', family: 'res', legacy: 'cottage-2', label: 'Cottage', structW: 6, structD: 6, plotW: 6, plotD: 9, storeys: 1, resTier: 2 },
  { id: 'townhouse', kit: 'bld_res_townhouse_{style}_6x6', family: 'res', legacy: 'house-3', label: 'Townhouse', structW: 6, structD: 6, plotW: 6, plotD: 9, storeys: 2, resTier: 3 },
  { id: 'manor', kit: 'bld_res_manor_{style}_9x9', family: 'res', legacy: 'house-8', label: 'Manor', structW: 9, structD: 9, plotW: 9, plotD: 12, storeys: 2, resTier: 4 },
  { id: 'general_store', kit: 'bld_shop_general_store_{style}_6x9', family: 'shop', legacy: 'shop', label: 'General store', structW: 6, structD: 9, plotW: 6, plotD: 12, storeys: 1 },
  { id: 'bakery', kit: 'bld_shop_bakery_{style}_6x6', family: 'shop', legacy: 'shop', label: 'Bakery', structW: 6, structD: 6, plotW: 6, plotD: 9, storeys: 1 },
  { id: 'tavern', kit: 'bld_shop_tavern_{style}_9x9', family: 'shop', legacy: 'tavern', label: 'Tavern', structW: 9, structD: 9, plotW: 9, plotD: 12, storeys: 2 },
  { id: 'bank', kit: 'bld_shop_exchange_{style}_9x9', family: 'shop', legacy: 'shop', label: 'Bank', structW: 9, structD: 9, plotW: 9, plotD: 12, storeys: 2 },
  { id: 'apothecary', kit: 'bld_shop_apothecary_{style}_6x6', family: 'shop', legacy: 'shop', label: 'Apothecary', structW: 6, structD: 6, plotW: 6, plotD: 9, storeys: 1 },
  { id: 'cartographer', kit: 'bld_shop_cartographer_{style}_6x6', family: 'shop', legacy: 'shop', label: 'Cartographer', structW: 6, structD: 6, plotW: 6, plotD: 9, storeys: 1 },
  { id: 'market_stall', kit: 'bld_shop_market_stall_{style}_3x1.5', family: 'shop', legacy: 'shop', label: 'Market stall', structW: 3, structD: 2, plotW: 3, plotD: 3, storeys: 1 },
  { id: 'smithy', kit: 'bld_work_smithy_{style}_6x9', family: 'work', legacy: 'blacksmith', label: 'Smithy', structW: 6, structD: 9, plotW: 6, plotD: 12, storeys: 1 },
  { id: 'carpenter', kit: 'bld_work_carpenter_{style}_6x9', family: 'work', legacy: 'blacksmith', label: 'Carpenter', structW: 6, structD: 9, plotW: 6, plotD: 12, storeys: 1 },
  { id: 'stables', kit: 'bld_work_stables_{style}_6x12', family: 'work', legacy: 'farm', label: 'Stables', structW: 6, structD: 12, plotW: 6, plotD: 15, storeys: 1 },
  { id: 'wagonwright', kit: 'bld_work_wagonwright_{style}_6x9', family: 'work', legacy: 'blacksmith', label: 'Wagonwright', structW: 6, structD: 9, plotW: 6, plotD: 12, storeys: 1 },
  { id: 'barn', kit: 'bld_farm_barn_{style}_9x12', family: 'farm', legacy: 'farm', label: 'Barn', structW: 9, structD: 12, plotW: 9, plotD: 15, storeys: 1 },
  { id: 'healer', kit: 'bld_civic_healer_{style}_6x9', family: 'civic', legacy: 'church', label: 'Healer', structW: 6, structD: 9, plotW: 6, plotD: 12, storeys: 1 },
  { id: 'temple_small', kit: 'bld_civic_temple_{style}_9x9', family: 'civic', legacy: 'church', label: 'Shrine hall', structW: 9, structD: 9, plotW: 9, plotD: 12, storeys: 1 },
  { id: 'temple', kit: 'bld_civic_temple_{style}_9x15', family: 'civic', legacy: 'church', label: 'Temple', structW: 9, structD: 15, plotW: 9, plotD: 15, storeys: 2 },
  { id: 'town_hall', kit: 'bld_civic_town_hall_{style}_12x12', family: 'civic', legacy: 'town-hall', label: 'Town hall', structW: 12, structD: 12, plotW: 12, plotD: 15, storeys: 2 },
  { id: 'guildhall', kit: 'bld_civic_guildhall_{style}_12x15', family: 'civic', legacy: 'town-hall', label: 'Guildhall', structW: 12, structD: 15, plotW: 12, plotD: 15, storeys: 2 },
];

const BY_ID = new Map(KIT_BUILDINGS.map((row) => [row.id, row]));

export function kitBuilding(id: string): KitBuilding | undefined {
  return BY_ID.get(id);
}

/** Site biome → settlement style (§3.2). Volcanic and the other fallbacks swap at the kit suffix. */
export function styleForBiome(biome: Biome): string {
  switch (biome) {
    case 0:
    case 1:
      return 'coastal';
    case 13:
      return 'tropical';
    case 7:
    case 12:
      return 'arid';
    case 8:
      return 'wetland';
    case 9:
    case 10:
    case 11:
      return 'alpine';
    case 14:
      return 'volcanic';
    default:
      return 'temperate';
  }
}

/** Material suffix that exists as a residential placeholder. */
export function styleSuffix(style: string): string {
  switch (style) {
    case 'temperate_stone':
      return 'temperate';
    case 'savanna':
      return 'arid';
    case 'tundra':
    case 'volcanic':
      return 'alpine';
    case 'wetland_tropical':
      return 'tropical';
    default:
      return style;
  }
}

export function resolveKit(pattern: string, style: string): string {
  return pattern.replaceAll('{style}', styleSuffix(style));
}

export function templateIdFor(building: KitBuilding, style: string): string {
  return resolveKit(building.kit, style);
}

function buildShell(spec: KitBuilding): BuildingTemplate {
  const w = spec.plotW;
  const d = spec.plotD;
  if (w > KIT_STRUCTURE_MAX || d > KIT_STRUCTURE_MAX) {
    throw new Error(`${spec.id} plot ${w}×${d} exceeds kit cap ${KIT_STRUCTURE_MAX}`);
  }
  if (spec.structW > w || spec.structD > d) throw new Error(`${spec.id} structure does not fit its lot`);
  const parts: BuildingPart[] = new Array(w * d).fill('yard');
  const sx0 = Math.floor((w - spec.structW) / 2);
  const sy0 = d - spec.structD;
  for (let y = 0; y < spec.structD; y++) {
    for (let x = 0; x < spec.structW; x++) {
      const edge = y === 0 || x === 0 || y === spec.structD - 1 || x === spec.structW - 1;
      parts[(sy0 + y) * w + (sx0 + x)] = edge ? 'wall' : 'floor';
    }
  }
  const doorX = sx0 + Math.max(0, Math.floor((spec.structW - 1) / 2));
  const doorY = sy0 + spec.structD - 1;
  parts[doorY * w + doorX] = 'door';
  const windows: Array<{ x: number; y: number; facing: 'W' | 'E' }> = [];
  if (spec.structW >= 5 && spec.structD >= 5) {
    const wy = sy0 + Math.floor(spec.structD / 2);
    parts[wy * w + sx0] = 'window';
    parts[wy * w + sx0 + spec.structW - 1] = 'window';
    windows.push({ x: sx0, y: wy, facing: 'W' }, { x: sx0 + spec.structW - 1, y: wy, facing: 'E' });
  }
  const ascii = [];
  for (let y = 0; y < d; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const part = parts[y * w + x]!;
      row += part === 'yard' ? '#' : part === 'floor' ? '.' : part === 'wall' ? 'W' : part === 'door' ? 'D' : 'o';
    }
    ascii.push(row);
  }
  return {
    id: spec.kit.replaceAll('{style}', 'style'),
    type: spec.id,
    label: spec.label,
    w,
    d,
    ascii,
    parts,
    storeys: spec.storeys,
    wallHeightM: Math.round(spec.storeys * METERS_PER_STOREY * 10) / 10,
    roof: { style: spec.storeys > 1 ? 'gable' : 'gable', ridge: 'E-W' },
    doors: [{ x: doorX, y: doorY, facing: 'S' }],
    windows,
    doorFacing: 'S',
  };
}

const REGISTERED = new Set<string>();

/** One shell per catalog id and style. The id is the resolved kit name. */
export function ensureKitTemplate(building: KitBuilding, style: string): string {
  const id = templateIdFor(building, style);
  if (REGISTERED.has(id)) return id;
  const shell = buildShell(building);
  shell.id = id;
  registerTemplate(shell);
  REGISTERED.add(id);
  return id;
}
