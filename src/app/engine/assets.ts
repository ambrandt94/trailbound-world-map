export const TILESET_URLS = {
  grasslands: 'assets/tilesets/grasslands.png',
  floors: 'assets/tilesets/floors.png',
} as const;

export const SPRITE_URLS: Record<string, string> = {
  'summer-1': 'assets/sprites/trees/summer-1.png',
  'summer-3': 'assets/sprites/trees/summer-3.png',
  'summer-8': 'assets/sprites/trees/summer-8.png',
  'summer-10': 'assets/sprites/trees/summer-10.png',
  'summer-11': 'assets/sprites/trees/summer-11.png',
  'forest-1': 'assets/sprites/trees/forest-1.png',
  'forest-2': 'assets/sprites/trees/forest-2.png',
  'forest-6': 'assets/sprites/trees/forest-6.png',
  'forest-8': 'assets/sprites/trees/forest-8.png',
  'autumn-1': 'assets/sprites/trees/autumn-1.png',
  'autumn-8': 'assets/sprites/trees/autumn-8.png',
  'autumn-11': 'assets/sprites/trees/autumn-11.png',
  'winter-2': 'assets/sprites/trees/winter-2.png',
  'winter-6': 'assets/sprites/trees/winter-6.png',
  'winter-11': 'assets/sprites/trees/winter-11.png',
  'rock-1': 'assets/sprites/props/rock-1.png',
  'rock-3': 'assets/sprites/props/rock-3.png',
  'rock-4': 'assets/sprites/props/rock-4.png',
  'rock-snow': 'assets/sprites/props/rock-snow.png',
  'flower-1': 'assets/sprites/props/flower-1.png',
  'flower-7': 'assets/sprites/props/flower-7.png',
  'flower-autumn': 'assets/sprites/props/flower-autumn.png',
  'plant-1': 'assets/sprites/props/plant-1.png',
  'mushroom-1': 'assets/sprites/props/mushroom-1.png',
  'mushroom-dark': 'assets/sprites/props/mushroom-dark.png',
  reed: 'assets/sprites/props/reed.png',
  lantern: 'assets/sprites/props/lantern.png',
  bench: 'assets/sprites/props/bench.png',
  chest: 'assets/sprites/props/chest.png',
  fence: 'assets/sprites/props/fence.png',
  well: 'assets/sprites/props/well.png',
  market: 'assets/sprites/props/market.png',
  bridge: 'assets/sprites/props/bridge.png',
  'house-1': 'assets/sprites/buildings/house-1.png',
  'house-2': 'assets/sprites/buildings/house-2.png',
  'house-3': 'assets/sprites/buildings/house-3.png',
  'house-5': 'assets/sprites/buildings/house-5.png',
  'house-7': 'assets/sprites/buildings/house-7.png',
  'house-8': 'assets/sprites/buildings/house-8.png',
  inn: 'assets/sprites/buildings/inn.png',
  'inn-2': 'assets/sprites/buildings/inn-2.png',
  tavern: 'assets/sprites/buildings/tavern.png',
  shop: 'assets/sprites/buildings/shop.png',
  blacksmith: 'assets/sprites/buildings/blacksmith.png',
  church: 'assets/sprites/buildings/church.png',
  'town-hall': 'assets/sprites/buildings/town-hall.png',
  farm: 'assets/sprites/buildings/farm.png',
};

export const CHAR_SHEET_URLS: Record<string, string> = {
  animals1: 'assets/characters/animals1.png',
  animals2: 'assets/characters/animals2.png',
  animals5: 'assets/characters/animals5.png',
  horse1: 'assets/characters/horse1.png',
  dwarf1: 'assets/characters/dwarf1.png',
  dwarf2: 'assets/characters/dwarf2.png',
  elf1: 'assets/characters/elf1.png',
  elf2: 'assets/characters/elf2.png',
  townsfolk: 'assets/characters/townsfolk.png',
  farmer: 'assets/characters/farmer.png',
  household: 'assets/characters/household.png',
  elder: 'assets/characters/elder.png',
  bard: 'assets/characters/bard.png',
  blacksmith: 'assets/characters/blacksmith.png',
  children: 'assets/characters/children.png',
  knights: 'assets/characters/knights.png',
  knights2: 'assets/characters/knights2.png',
  executioner: 'assets/characters/executioner.png',
};

export interface CharSheet {
  id: string;
  canvas: HTMLCanvasElement;
  frameW: number;
  frameH: number;
  charsX: number;
  charsY: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

export class AssetLibrary {
  grasslands!: HTMLImageElement;
  floors!: HTMLImageElement;
  sprites = new Map<string, HTMLImageElement>();
  sheets = new Map<string, CharSheet>();
  player!: HTMLCanvasElement;

  async load(): Promise<void> {
    const [grasslands, floors] = await Promise.all([
      loadImage(TILESET_URLS.grasslands),
      loadImage(TILESET_URLS.floors),
    ]);
    this.grasslands = grasslands;
    this.floors = floors;
    const entries = await Promise.all(
      Object.entries(SPRITE_URLS).map(async ([key, url]) => {
        const img = await loadImage(url);
        return [key, img] as const;
      }),
    );
    for (const [key, img] of entries) {
      this.sprites.set(key, img);
    }
    const sheets = await Promise.all(
      Object.entries(CHAR_SHEET_URLS).map(async ([id, url]) => {
        const img = await loadImage(url);
        return [id, makeSheet(id, img)] as const;
      }),
    );
    for (const [id, sheet] of sheets) {
      this.sheets.set(id, sheet);
    }
    this.sheets.set('boat', makeBoatSheet());
    this.player = makePlayerSprite();
  }

  sprite(name: string): HTMLImageElement | undefined {
    return this.sprites.get(name);
  }

  sheet(id: string): CharSheet | undefined {
    return this.sheets.get(id);
  }
}

function makeSheet(id: string, img: HTMLImageElement): CharSheet {
  const canvas = punchBlack(img);
  return {
    id,
    canvas,
    frameW: img.width / 12,
    frameH: img.height / 8,
    charsX: 4,
    charsY: 2,
  };
}

function punchBlack(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i]! < 10 && px[i + 1]! < 10 && px[i + 2]! < 10) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

export function drawCharFrame(
  ctx: CanvasRenderingContext2D,
  sheet: CharSheet,
  charIndex: number,
  facing: number,
  frame: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const col = (charIndex % sheet.charsX) * 3 + (frame % 3);
  const row = Math.floor(charIndex / sheet.charsX) * 4 + (facing % 4);
  const sx = col * sheet.frameW;
  const sy = row * sheet.frameH;
  ctx.drawImage(sheet.canvas, sx, sy, sheet.frameW, sheet.frameH, dx, dy, dw, dh);
}

function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function makePlayerSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 20;
  const ctx = c.getContext('2d')!;
  const cloak = '#7a3e1d';
  const cloakD = '#4a2412';
  const skin = '#e2b089';
  const hair = '#2c1b12';
  const pack = '#6b5344';
  for (let y = 8; y <= 18; y++) {
    for (let x = 4; x <= 11; x++) {
      px(ctx, x, y, y > 16 ? cloakD : cloak);
    }
  }
  for (let y = 3; y <= 8; y++) {
    for (let x = 5; x <= 10; x++) px(ctx, x, y, skin);
  }
  for (let y = 2; y <= 5; y++) {
    for (let x = 5; x <= 10; x++) px(ctx, x, y, hair);
  }
  px(ctx, 6, 6, '#1a120c');
  px(ctx, 9, 6, '#1a120c');
  for (let y = 10; y <= 14; y++) {
    px(ctx, 3, y, pack);
    px(ctx, 12, y, pack);
  }
  ctx.fillStyle = '#d4a574';
  ctx.fillRect(7, 18, 2, 2);
  ctx.fillRect(9, 18, 2, 2);
  ctx.strokeStyle = '#1a120c';
  ctx.strokeRect(4.5, 2.5, 7, 16);
  return c;
}

const BOAT_HULL = '#7a4a28';
const BOAT_HULL_D = '#4e2c14';
const BOAT_HULL_L = '#c48a4a';
const BOAT_MAST = '#2a1810';
const BOAT_TRIM = '#e8d5b0';
const BOAT_FOAM = '#d7e6ee';

function makeBoatSheet(): CharSheet {
  const frameW = 24;
  const frameH = 16;
  const charsX = 3;
  const canvas = document.createElement('canvas');
  canvas.width = frameW * 3 * charsX;
  canvas.height = frameH * 4;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const sails = ['#7dcea0', '#e0a86a', '#ffb4b4'];
  for (let char = 0; char < charsX; char++) {
    for (let facing = 0; facing < 4; facing++) {
      for (let frame = 0; frame < 3; frame++) {
        const ox = (char * 3 + frame) * frameW;
        const oy = facing * frameH;
        drawBoatFrame(ctx, ox, oy, facing, frame, sails[char]!);
      }
    }
  }
  return { id: 'boat', canvas, frameW, frameH, charsX, charsY: 1 };
}

function drawBoatFrame(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  facing: number,
  frame: number,
  sail: string,
): void {
  const bob = frame === 1 ? 1 : 0;
  const foam = frame === 2;
  const outline = '#1a120c';
  const put = (x: number, y: number, c: string) => px(ctx, ox + x, oy + y, c);
  const bar = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(ox + x, oy + y, w, h);
  };
  if (facing === 2 || facing === 1) {
    const mirror = facing === 1;
    const X = (x: number) => (mirror ? 23 - x : x);
    const putM = (x: number, y: number, c: string) => put(X(x), y, c);
    const barM = (x: number, y: number, w: number, h: number, c: string) => {
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) putM(x + i, y + j, c);
      }
    };
    barM(3, 8 + bob, 18, 5, outline);
    barM(20, 9 + bob, 3, 3, outline);
    barM(4, 9 + bob, 16, 1, BOAT_TRIM);
    barM(4, 10 + bob, 16, 2, BOAT_HULL);
    barM(4, 12 + bob, 16, 1, BOAT_HULL_D);
    barM(3, 10 + bob, 1, 2, BOAT_HULL_D);
    barM(20, 10 + bob, 2, 2, BOAT_HULL);
    putM(22, 10 + bob, BOAT_HULL_L);
    putM(22, 11 + bob, BOAT_HULL_L);
    barM(11, 1 + bob, 1, 9, BOAT_MAST);
    const billow = frame === 1 ? 1 : 0;
    for (let row = 0; row < 7; row++) {
      const w = 6 + Math.min(row, 4) + billow;
      barM(11 - w, 2 + bob + row, w, 1, sail);
      putM(11 - w, 2 + bob + row, outline);
    }
    if (foam) {
      putM(1, 12 + bob, BOAT_FOAM);
      putM(2, 13 + bob, BOAT_FOAM);
      putM(0, 11 + bob, BOAT_FOAM);
    }
    return;
  }
  if (facing === 0) {
    bar(5, 8 + bob, 14, 7, outline);
    bar(8, 7 + bob, 8, 2, BOAT_HULL_D);
    bar(6, 9 + bob, 12, 4, BOAT_HULL);
    bar(7, 13 + bob, 10, 1, BOAT_HULL_L);
    bar(9, 14 + bob, 6, 1, BOAT_HULL_L);
    bar(11, 1 + bob, 1, 8, BOAT_MAST);
    bar(12, 2 + bob, 1, 7, sail);
    bar(13, 3 + bob, 4 + (frame === 1 ? 1 : 0), 5, sail);
    bar(6, 9 + bob, 12, 1, BOAT_TRIM);
    if (foam) {
      put(8, 15, BOAT_FOAM);
      put(15, 15, BOAT_FOAM);
      put(11, 15, BOAT_FOAM);
    }
    return;
  }
  bar(5, 2 + bob, 14, 11, outline);
  bar(9, 2 + bob, 6, 1, BOAT_HULL_L);
  bar(7, 3 + bob, 10, 2, BOAT_HULL);
  bar(6, 5 + bob, 12, 5, BOAT_HULL);
  bar(7, 10 + bob, 10, 2, BOAT_HULL_D);
  bar(11, 3 + bob, 1, 7, BOAT_MAST);
  bar(8, 4 + bob, 3, 5, sail);
  bar(4 + (frame === 1 ? -1 : 0), 5 + bob, 7, 4, sail);
  bar(6, 5 + bob, 12, 1, BOAT_TRIM);
  if (foam) {
    put(8, 12, BOAT_FOAM);
    put(15, 12, BOAT_FOAM);
  }
}
