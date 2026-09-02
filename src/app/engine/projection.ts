import { clamp, wrapX } from '../models/world.models';

export const GLOBE_FOV = (40 * Math.PI) / 180;
export const GLOBE_TEX_MAX = 2048;

export function globeRadius(width: number): number {
  return width / (Math.PI * 2);
}

export function tileToLonLat(
  x: number,
  y: number,
  width: number,
  height: number,
): { lon: number; lat: number } {
  return {
    lon: (wrapX(x, width) / width) * Math.PI * 2,
    lat: Math.PI / 2 - (clamp(y, 0, height) / Math.max(1e-6, height)) * Math.PI,
  };
}

export function lonLatToTile(
  lon: number,
  lat: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const tau = Math.PI * 2;
  let lonN = lon % tau;
  if (lonN < 0) lonN += tau;
  const latC = clamp(lat, -Math.PI / 2 + 1e-4, Math.PI / 2 - 1e-4);
  return {
    x: (lonN / tau) * width,
    y: (0.5 - latC / Math.PI) * height,
  };
}

export function lonLatToSphere(lon: number, lat: number, radius: number): [number, number, number] {
  const cl = Math.cos(lat);
  return [radius * cl * Math.cos(lon), radius * Math.sin(lat), radius * cl * Math.sin(lon)];
}

export function sphereToLonLat(
  x: number,
  y: number,
  z: number,
): { lon: number; lat: number } {
  const r = Math.hypot(x, y, z) || 1;
  return {
    lon: Math.atan2(z, x),
    lat: Math.asin(clamp(y / r, -1, 1)),
  };
}

/** Camera distance that matches the 2D map: one tile is `scale * tilePx` CSS pixels. */
export function globeFlatDistance(viewH: number, scale: number, tilePx: number): number {
  const visible = viewH / Math.max(1e-6, scale * tilePx);
  return visible / (2 * Math.tan(GLOBE_FOV / 2));
}

/** Camera distance that frames the planet at `fill` of the shorter viewport side. */
export function globeOrbitDistance(viewW: number, viewH: number, radius: number, fill = 0.64): number {
  const targetPx = fill * Math.min(viewW, viewH);
  const visibleH = ((2 * radius) * viewH) / Math.max(1, targetPx);
  return visibleH / (2 * Math.tan(GLOBE_FOV / 2));
}
