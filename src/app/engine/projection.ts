import { TILE, clamp, globeFillFor, wrapX } from '../models/world.models';

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

/** Camera axes for a north-up globe: screen-right is east, screen-up is north. */
export function globeLookBasis(lon: number, lat: number): {
  look: [number, number, number];
  east: [number, number, number];
  north: [number, number, number];
} {
  const cl = Math.cos(lat);
  const sl = Math.sin(lat);
  const co = Math.cos(lon);
  const so = Math.sin(lon);
  return {
    look: [cl * co, sl, cl * so],
    east: [-so, 0, co],
    north: [-sl * co, cl, -sl * so],
  };
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

/** Distance from planet center so one world tile matches `scale * TILE` CSS pixels. */
export function globeSurfaceDistance(viewH: number, scale: number, radius: number): number {
  return radius + globeFlatDistance(viewH, scale, TILE);
}

function globeOrbitCap(viewW: number, viewH: number, scale: number, width: number, radius: number): number {
  return Math.max(radius * 1.045, globeOrbitDistance(viewW, viewH, radius, globeFillFor(scale, width)));
}

/** Orbit when the whole planet fits; otherwise sit above the surface at 2D-matching scale. */
export function globeCameraDistance(
  viewW: number,
  viewH: number,
  scale: number,
  width: number,
  radius = globeRadius(width),
): number {
  const surface = globeSurfaceDistance(viewH, scale, radius);
  const orbit = globeOrbitCap(viewW, viewH, scale, width, radius);
  return Math.max(radius * 1.035, Math.min(surface, orbit));
}

/** True while the camera is still framing the whole planet rather than a local patch. */
export function globeShowsWholePlanet(
  viewW: number,
  viewH: number,
  scale: number,
  width: number,
): boolean {
  const radius = globeRadius(width);
  return globeSurfaceDistance(viewH, scale, radius) + 1e-4 >= globeOrbitCap(viewW, viewH, scale, width, radius);
}
