import { Facing, WorldSettings } from './world.models';

export const ROOM_APP_ID = 'trailbound-world-map';
export const ROOM_ID_PREFIX = 'trailbound-wm-';
/** Client-side host gate — only people who know this can Create. Change anytime. */
export const ROOM_HOST_KEY = 'ashfen-gate';
const HOST_UNLOCK_KEY = 'tb-world-map-host-ok';
const HOST_UNLOCK_VALUE = 'v1';
export const CHAT_BUBBLE_MS = 4000;
export const CHAT_MAX_LEN = 80;
export const POSE_MOVE_MS = 100;
export const POSE_IDLE_MS = 500;
/** Close after the last guest leaves. */
export const EMPTY_ROOM_MS = 90_000;
/** Host alone with no guests ever — close eventually so PINs don't linger. */
export const EMPTY_HOST_IDLE_MS = 15 * 60_000;

export interface RoomMeta {
  pin: string;
  hostId: string;
  seed: number;
  settings: WorldSettings;
}

export interface PeerPose {
  id: string;
  name: string;
  sheet: string;
  char: number;
  x: number;
  y: number;
  facing: Facing;
  frame: number;
}

export interface PresenceRow {
  id: string;
  name: string;
  color: string;
  you: boolean;
}

/** Distinct overworld pin colors for room players (hashed from peer id). */
export const PEER_MARKER_COLORS = [
  '#e8c37a',
  '#6ec6e8',
  '#e07a8a',
  '#7ed9a4',
  '#c9a0e0',
  '#f0a06a',
  '#5fc4b8',
  '#d4c05a',
  '#8aabe8',
  '#e8a0c0',
  '#a8d46a',
  '#e09060',
  '#70b8d8',
  '#d888b0',
  '#90c878',
  '#e8b070',
] as const;

export function peerMarkerColor(peerId: string): string {
  let h = 2166136261;
  for (let i = 0; i < peerId.length; i++) h = Math.imul(h ^ peerId.charCodeAt(i), 16777619);
  return PEER_MARKER_COLORS[(h >>> 0) % PEER_MARKER_COLORS.length]!;
}

export function peerMarkerRgb(peerId: string): [number, number, number] {
  const hex = peerMarkerColor(peerId);
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface ChatBubble {
  id: string;
  peerId: string;
  name: string;
  text: string;
  until: number;
}

export type RoomStatus = 'idle' | 'connecting' | 'connected' | 'error';

export function roomIdForPin(pin: string): string {
  return `${ROOM_ID_PREFIX}${pin}`;
}

export function randomPin(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

export function normalizePin(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length === 4 ? digits : null;
}

export function clampChatText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
}

export function isHostUnlocked(): boolean {
  try {
    return localStorage.getItem(HOST_UNLOCK_KEY) === HOST_UNLOCK_VALUE;
  } catch {
    return false;
  }
}

export function unlockHost(rawKey: string): boolean {
  if (rawKey.trim() !== ROOM_HOST_KEY) return false;
  try {
    localStorage.setItem(HOST_UNLOCK_KEY, HOST_UNLOCK_VALUE);
  } catch {
    /* private mode */
  }
  return true;
}

export function lockHost(): void {
  try {
    localStorage.removeItem(HOST_UNLOCK_KEY);
  } catch {
    /* private mode */
  }
}
