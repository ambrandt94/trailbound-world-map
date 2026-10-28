/**
 * Hand the isolated place to the Trailbound controller.
 * postMessage only, with an origin allowlist on every send and receive.
 * A live session stays open after the ack: heartbeats, sequence numbers, and one lock.
 */
import { AreaExport } from './area-export';
import {
  ClockState,
  ControllerMsg,
  HEARTBEAT_MS,
  LIVE_MAJORS,
  LIVE_SESSION_KEY,
  NpcEvent,
  NpcReportMsg,
  NpcState,
  PlayerMsg,
  SIM_HZ,
  STALE_MS,
  StoredLiveSession,
  TIMEOUT_MS,
  PARKED_MS,
  ExitMsg,
  noteRate,
  validateLive,
} from './live-link';

export const CONTROLLER_URL_STORAGE_KEY = 'tb-controller-url';
export const PROD_CONTROLLER_URL = 'https://trailbound-controller.ambrandt94.workers.dev/';
export const DEV_CONTROLLER_URL = 'http://localhost:8787/';

/** Origins that may receive an area payload or send ready / ack. */
export const DEFAULT_CONTROLLER_ORIGINS = [
  'https://trailbound-controller.ambrandt94.workers.dev',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
] as const;

export const BRIDGE_READY = 'tb-area-ready';
export const BRIDGE_AREA = 'tb-area';
export const BRIDGE_ACK = 'tb-area-ack';
export const BRIDGE_HELLO = 'tb-area-hello';

export interface LiveHost {
  now(): number;
  clock(): ClockState;
  placeName(): string;
  nearbyCount(): number;
  gridSpan(): { maxX: number; maxZ: number };
  entryPlayer(): { x: number; z: number; yaw: number } | null;
  buildFrame(key: boolean): { ents: NpcState[]; events: NpcEvent[] };
  onOpen(sid: string): void;
  onClose(): void;
  liveStep(now: number): void;
  mirrorPlayer(msg: PlayerMsg, now: number): void;
  mirrorHeld(npcs: { id: string; pos: { x: number; z: number } }[]): void;
  onExit(msg: ExitMsg): void;
  onNpc(msg: NpcReportMsg): void;
  onInteract(msg: { id: string; seq: number }): void;
  onEnterBuilding(buildingId: string): void;
  onLeaveBuilding(buildingId: string, pos: { x: number; z: number }): void;
  onRelease(): void;
  onResumeHolds(): void;
  onDriving(driving: boolean): void;
  pullChatter(): { bubbleId: string; speakerId: string; name: string; text: string; ms: number; replyTo?: number }[];
  rebuild(stored: StoredLiveSession): AreaExport | null;
  restoreClock(hours: number): void;
}

export interface AreaBridgeSession {
  close(): void;
  readonly live: boolean;
  readonly rejects: number;
  send(body: object): void;
}

export interface OpenAreaOptions {
  onStatus?: (message: string) => void;
  url?: string;
  /** Defaults to 20s before a still-waiting note. Listening continues until close or ack. */
  waitingNoteMs?: number;
  /** Stay on the channel after ack when the controller echoes `live: 1`. */
  live?: boolean;
  host?: LiveHost;
}

export function resolveControllerUrl(hostname: string, stored: string | null | undefined): string {
  const override = stored?.trim();
  if (override) return override;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return DEV_CONTROLLER_URL;
  return PROD_CONTROLLER_URL;
}

/** Default allowlist, plus the origin of an explicitly configured URL. */
export function controllerAllowlist(url: string): string[] {
  const list: string[] = [...DEFAULT_CONTROLLER_ORIGINS];
  const origin = originOf(url);
  if (origin && !list.includes(origin)) list.push(origin);
  return list;
}

export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function controllerBridgeUrl(raw: string): { url: string; origin: string } | null {
  const origin = originOf(raw);
  if (!origin) return null;
  const parsed = new URL(raw);
  parsed.searchParams.set('bridge', '1');
  return { url: parsed.toString(), origin };
}

export function downloadAreaExport(area: AreaExport, doc: Document = document): void {
  const exported: AreaExport = { ...area };
  delete exported.session;
  const json = JSON.stringify(exported, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = `area-${safeFile(area.area.id)}.json`;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function readLiveSession(): StoredLiveSession | null {
  try {
    const raw = sessionStorage.getItem(LIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLiveSession;
    if (!parsed || typeof parsed.sid !== 'string' || typeof parsed.areaHash !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function openAreaInController(payload: AreaExport, opts?: OpenAreaOptions): AreaBridgeSession {
  const status = opts?.onStatus ?? (() => undefined);
  const stored = readStoredUrl();
  const raw = opts?.url ?? resolveControllerUrl(window.location.hostname, stored);
  const target = controllerBridgeUrl(raw);
  if (!target) {
    status('Controller URL is not a valid http(s) address.');
    return inert();
  }
  const allow = controllerAllowlist(raw);
  if (!allow.includes(target.origin)) {
    status('Controller origin is not on the allowlist.');
    return inert();
  }
  const popup = window.open(target.url, 'tb-controller');
  if (!popup) {
    status('Popup blocked. Allow popups for this site, or download the area JSON.');
    return inert();
  }
  try {
    popup.focus();
  } catch {
    /* cross-origin focus can throw */
  }
  status(opts?.live ? 'Waiting for the 3D controller…' : 'Waiting for the 3D controller…');
  return attachBridge(popup, target.origin, allow, payload, opts, false);
}

/**
 * After a reload, the controller still posts `tb-area-ready {resume}` at the opener.
 * Accept it only when the sid, hash, and allowlisted origin match sessionStorage.
 */
export function installLiveResume(opts: {
  host: LiveHost;
  onStatus?: (message: string) => void;
  onSession?: (session: AreaBridgeSession) => void;
}): () => void {
  resumeOpts = opts;
  if (!idleListening) {
    window.addEventListener('message', onIdleMessage);
    idleListening = true;
  }
  return () => {
    if (resumeOpts === opts) resumeOpts = null;
  };
}

let locked: { shutdown(kind: Shutdown): void } | null = null;
let idleListening = false;
let resumeOpts: {
  host: LiveHost;
  onStatus?: (message: string) => void;
  onSession?: (session: AreaBridgeSession) => void;
} | null = null;

type Shutdown = 'destroy' | 'exit' | 'popup' | 'replace' | 'fail';

function onIdleMessage(ev: MessageEvent): void {
  if (locked || !resumeOpts) return;
  const data = ev.data as { type?: unknown; live?: unknown; resume?: { sid?: unknown; hash?: unknown } } | null;
  if (!data || data.type !== BRIDGE_READY || !data.resume) return;
  const stored = readLiveSession();
  if (!stored) {
    replyClose(ev, 'unknown-session', 'missing');
    return;
  }
  if (!controllerAllowlist(stored.controllerOrigin).includes(ev.origin) || ev.origin !== stored.controllerOrigin) return;
  if (data.resume.sid !== stored.sid || data.resume.hash !== stored.areaHash) {
    replyClose(ev, 'unknown-session', stored.sid);
    return;
  }
  const source = ev.source;
  if (!source || typeof (source as Window).postMessage !== 'function') return;
  resumeOpts.host.restoreClock(stored.clockHours);
  const area = resumeOpts.host.rebuild(stored);
  if (!area || area.meta.hash !== stored.areaHash) {
    replyClose(ev, 'unknown-session', stored.sid);
    return;
  }
  const popup = source as Window;
  const status = resumeOpts.onStatus ?? (() => undefined);
  status(`Resuming ${area.area.name}…`);
  const session = attachBridge(popup, ev.origin, controllerAllowlist(ev.origin), area, {
    live: true,
    host: resumeOpts.host,
    onStatus: status,
  }, true);
  resumeOpts.onSession?.(session);
}

function replyClose(ev: MessageEvent, reason: 'unknown-session' | 'version', sid: string): void {
  const source = ev.source as Window | null;
  if (!source || typeof source.postMessage !== 'function') return;
  try {
    source.postMessage({ type: 'tb-close', tb: 1, sid, seq: 1, reason }, ev.origin);
  } catch {
    /* opener gone */
  }
}

function attachBridge(
  popup: Window,
  origin: string,
  allow: string[],
  payload: AreaExport,
  opts: OpenAreaOptions | undefined,
  primed: boolean,
): AreaBridgeSession {
  locked?.shutdown('replace');
  const status = opts?.onStatus ?? (() => undefined);
  const host = opts?.host;
  const wantLive = !!opts?.live && !!host && payload.session?.live === 1 && !!payload.session.sid;
  let mode: 'wait' | 'live' | 'done' = 'wait';
  let sid = payload.session?.sid ?? '';
  let outSeq = 0;
  let inSeq = 0;
  let rejects = 0;
  let lastPlayerAt = 0;
  let lastSentAt = 0;
  let openedAt = Date.now();
  let simTicks = 0;
  let parkedAt = 0;
  let fallback = false;
  let stale = false;
  let versionSent = false;
  let lastStatus = '';
  let lastPlayer: { x: number; z: number; yaw: number } | null = null;
  const rates = new Map<string, number[]>();
  const name = payload.area.name;

  const note = (message: string) => {
    if (message === lastStatus) return;
    lastStatus = message;
    status(message);
  };

  const sendRaw = (data: object) => {
    if (popup.closed) return;
    try {
      popup.postMessage(data, origin);
    } catch {
      /* window gone */
    }
  };

  const sendLive = (body: object) => {
    if (mode !== 'live' || !sid) return;
    outSeq += 1;
    sendRaw({ ...body, tb: LIVE_MAJORS[0], sid, seq: outSeq });
    lastSentAt = Date.now();
  };

  const writeStore = () => {
    if (mode !== 'live' || !host) return;
    const record: StoredLiveSession = {
      sid,
      placeId: payload.area.id,
      areaHash: payload.meta.hash,
      controllerOrigin: origin,
      clockHours: host.clock().hours,
    };
    try {
      sessionStorage.setItem(LIVE_SESSION_KEY, JSON.stringify(record));
    } catch {
      /* private mode */
    }
  };

  const clearStore = () => {
    try {
      const cur = readLiveSession();
      if (cur && cur.sid === sid) sessionStorage.removeItem(LIVE_SESSION_KEY);
    } catch {
      /* ignore */
    }
  };

  const liveStatus = () => {
    if (!host) return;
    if (fallback) note(`3D link stale · local sim · ${name}`);
    else if (stale) note(`3D link stale`);
    else note(`Live in 3D · ${name} · ${host.nearbyCount()} nearby`);
  };

  const sendSim = (forceKey: boolean) => {
    if (!host || mode !== 'live') return;
    simTicks += 1;
    const key = forceKey || simTicks % 8 === 0;
    const frame = host.buildFrame(key);
    sendLive({
      type: 'tb-sim',
      clock: host.clock(),
      key,
      ents: frame.ents,
      events: frame.events,
    });
    for (const line of host.pullChatter()) {
      sendLive({ type: 'tb-chatter', ...line });
    }
    writeStore();
    liveStatus();
  };

  const openBody = (resume: boolean) => {
    const entry = lastPlayer ?? host?.entryPlayer() ?? undefined;
    return {
      type: 'tb-session-open',
      areaHash: payload.meta.hash,
      placeId: payload.area.id,
      resume,
      clock: host?.clock() ?? { hours: 8, rate: 0, mode: 'paused' as const },
      rates: { simHz: SIM_HZ, heartbeatMs: HEARTBEAT_MS, staleMs: STALE_MS, timeoutMs: TIMEOUT_MS },
      player: entry,
    };
  };

  let hello = 0;
  let waiting = 0;
  let pulse = 0;

  const stopTimers = () => {
    window.clearInterval(hello);
    window.clearInterval(pulse);
    window.clearTimeout(waiting);
  };

  const shutdown = (kind: Shutdown) => {
    if (mode === 'done') return;
    const wasLive = mode === 'live';
    if (wasLive && (kind === 'exit' || kind === 'replace')) {
      sendLive({ type: 'tb-close', reason: kind === 'exit' ? 'exit' : 'area-changed' });
    }
    mode = 'done';
    stopTimers();
    window.removeEventListener('message', onMessage);
    if (kind === 'exit' || kind === 'popup' || kind === 'replace' || kind === 'fail') clearStore();
    if (wasLive) host?.onClose();
    if (locked === api) locked = null;
    if (resumeOpts && !idleListening) {
      window.addEventListener('message', onIdleMessage);
      idleListening = true;
    }
  };

  const onMessage = (ev: MessageEvent) => {
    if (mode === 'done') return;
    if (!allow.includes(ev.origin) || ev.origin !== origin) return;
    if (ev.source !== popup) return;
    const data = ev.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return;
    if (data['type'] === BRIDGE_READY) {
      const resume = data['resume'] as { sid?: unknown; hash?: unknown } | undefined;
      if (mode === 'live' && resume && resume.sid === sid && resume.hash === payload.meta.hash) {
        sendRaw({ type: BRIDGE_AREA, payload });
        sendLive(openBody(true));
        note(`Live in 3D · ${name} · resumed`);
        return;
      }
      if (mode === 'wait') {
        sendRaw({ type: BRIDGE_AREA, payload });
        note(`Sent ${name}. Waiting for acknowledgement…`);
      }
      return;
    }
    if (data['type'] === BRIDGE_ACK && mode === 'wait') {
      const hash = typeof data['hash'] === 'string' ? data['hash'] : '';
      const ok = hash === payload.meta.hash || hash === payload.meta.hash.slice('sha1:'.length);
      const liveAck = wantLive && data['live'] === 1;
      if (!liveAck) {
        note(
          ok
            ? `Controller accepted ${name}.`
            : `Controller replied with a different hash${hash ? ` (${hash})` : ''}.`,
        );
        shutdown('fail');
        return;
      }
      mode = 'live';
      sid = payload.session?.sid ?? sid;
      window.clearInterval(hello);
      window.clearTimeout(waiting);
      host?.onOpen(sid);
      writeStore();
      sendLive(openBody(primed));
      sendSim(true);
      pulse = window.setInterval(tickLive, 250);
      liveStatus();
      return;
    }
    if (mode !== 'live' || !host) return;
    if (typeof data['type'] === 'string' && data['tb'] !== undefined && data['tb'] !== 1) {
      if (!versionSent) {
        versionSent = true;
        sendLive({ type: 'tb-close', reason: 'version' });
      }
      return;
    }
    const type = typeof data['type'] === 'string' ? data['type'] : '';
    const bucket = rates.get(type) ?? [];
    rates.set(type, bucket);
    if (type && !noteRate(bucket, Date.now())) {
      rejects += 1;
      return;
    }
    const span = host.gridSpan();
    const parsed = validateLive(data, {
      origin: ev.origin,
      allow,
      pinnedOrigin: origin,
      sid,
      lastSeq: inSeq,
      maxX: span.maxX,
      maxZ: span.maxZ,
    });
    if (!parsed.ok) {
      if (parsed.reason !== 'unknown') rejects += 1;
      return;
    }
    inSeq = parsed.msg.seq;
    dispatch(parsed.msg);
  };

  const dispatch = (msg: ControllerMsg) => {
    if (!host) return;
    if (msg.type === 'tb-player') {
      lastPlayerAt = Date.now();
      lastPlayer = { x: msg.pos.x, z: msg.pos.z, yaw: msg.yaw };
      if (msg.parked) {
        if (!parkedAt) parkedAt = Date.now();
        host.onDriving(false);
      } else {
        const wasParkedLong = parkedAt > 0 && Date.now() - parkedAt > PARKED_MS;
        parkedAt = 0;
        if (fallback || wasParkedLong) {
          fallback = false;
          host.onResumeHolds();
        }
        host.onDriving(true);
        host.mirrorPlayer(msg, host.now());
      }
      if (msg.npcs?.length) host.mirrorHeld(msg.npcs);
      if (stale || fallback) {
        stale = false;
      }
      sendSim(false);
      return;
    }
    if (msg.type === 'tb-exit') {
      host.onExit(msg);
      note(`Back on the map · ${name}`);
      shutdown('exit');
      return;
    }
    if (msg.type === 'tb-npc-event') {
      host.onNpc(msg);
      sendSim(false);
      return;
    }
    if (msg.type === 'tb-npc-interact') {
      host.onInteract({ id: msg.id, seq: msg.seq });
      sendSim(false);
      return;
    }
    if (msg.type === 'tb-enter-building') {
      host.onEnterBuilding(msg.buildingId);
      return;
    }
    if (msg.type === 'tb-leave-building') {
      host.onLeaveBuilding(msg.buildingId, msg.pos);
      return;
    }
    if (msg.type === 'tb-close') {
      note(msg.reason === 'exit' ? `Back on the map · ${name}` : `3D link closed (${msg.reason}).`);
      shutdown(msg.reason === 'exit' ? 'exit' : 'popup');
    }
  };

  const tickLive = () => {
    if (mode !== 'live' || !host) return;
    if (popup.closed) {
      note('Controller window closed.');
      shutdown('popup');
      return;
    }
    const now = Date.now();
    const since = lastPlayerAt > 0 ? now - lastPlayerAt : now - openedAt;
    if (!fallback && lastPlayerAt > 0 && since > TIMEOUT_MS) {
      fallback = true;
      stale = true;
      host.onRelease();
    } else if (!stale && lastPlayerAt > 0 && since > STALE_MS) {
      stale = true;
    }
    if (parkedAt && !fallback && now - parkedAt > PARKED_MS) {
      fallback = true;
      host.onRelease();
    }
    if (now - lastSentAt >= HEARTBEAT_MS || now - lastSentAt >= 250) sendSim(false);
    else liveStatus();
  };

  const helloBody = wantLive
    ? { type: BRIDGE_HELLO, version: payload.version, live: [...LIVE_MAJORS] }
    : { type: BRIDGE_HELLO, version: payload.version };

  window.addEventListener('message', onMessage);
  if (idleListening) {
    window.removeEventListener('message', onIdleMessage);
    idleListening = false;
  }
  hello = window.setInterval(() => {
    if (mode !== 'wait') return;
    if (popup.closed) {
      if (mode === 'wait') note('Controller window closed before it accepted the area.');
      shutdown('popup');
      return;
    }
    sendRaw(helloBody);
  }, 500);
  sendRaw(helloBody);
  if (primed) {
    sendRaw({ type: BRIDGE_AREA, payload });
    note(`Sent ${name}. Waiting for acknowledgement…`);
  }
  waiting = window.setTimeout(() => {
    if (mode === 'wait') note('Still waiting for the controller (tb-area-ready). Download the JSON if you need a fixture.');
  }, opts?.waitingNoteMs ?? 20000);
  openedAt = Date.now();

  const api = {
    shutdown,
    close() {
      shutdown('destroy');
    },
    get live() {
      return mode === 'live';
    },
    get rejects() {
      return rejects;
    },
    send(body: object) {
      sendLive(body);
    },
  };
  locked = api;
  return api;
}

function inert(): AreaBridgeSession {
  return {
    close() {},
    live: false,
    rejects: 0,
    send() {},
  };
}

function readStoredUrl(): string | null {
  try {
    return localStorage.getItem(CONTROLLER_URL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeFile(id: string): string {
  return id.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'area';
}
