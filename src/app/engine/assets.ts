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
