/**
 * Hand the isolated place to the Trailbound controller.
 * postMessage only, with an origin allowlist on every send and receive.
 */
import { AreaExport } from './area-export';

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

export interface AreaBridgeSession {
  close(): void;
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
  const json = JSON.stringify(area, null, 2);
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

export function openAreaInController(
  payload: AreaExport,
  opts?: {
    onStatus?: (message: string) => void;
    url?: string;
    /** Defaults to 20s before a still-waiting note. Listening continues until close or ack. */
    waitingNoteMs?: number;
  },
): AreaBridgeSession {
  const status = opts?.onStatus ?? (() => undefined);
  const stored = readStoredUrl();
  const raw = opts?.url ?? resolveControllerUrl(window.location.hostname, stored);
  const target = controllerBridgeUrl(raw);
  if (!target) {
    status('Controller URL is not a valid http(s) address.');
    return { close() {} };
  }
  const allow = controllerAllowlist(raw);
  if (!allow.includes(target.origin)) {
    status('Controller origin is not on the allowlist.');
    return { close() {} };
  }

  const popup = window.open(target.url, 'tb-controller');
  if (!popup) {
    status('Popup blocked. Allow popups for this site, or download the area JSON.');
    return { close() {} };
  }

  status('Waiting for the 3D controller…');
  let settled = false;
  let closed = false;

  const onMessage = (ev: MessageEvent) => {
    if (closed || settled) return;
    if (!allow.includes(ev.origin) || ev.origin !== target.origin) return;
    if (ev.source !== popup) return;
    const data = ev.data as { type?: unknown; hash?: unknown } | null;
    if (!data || typeof data !== 'object') return;
    if (data.type === BRIDGE_READY) {
      popup.postMessage({ type: BRIDGE_AREA, payload }, target.origin);
      status(`Sent ${payload.area.name}. Waiting for acknowledgement…`);
      return;
    }
    if (data.type === BRIDGE_ACK) {
      const hash = typeof data.hash === 'string' ? data.hash : '';
      const ok = hash === payload.meta.hash || hash === payload.meta.hash.slice('sha1:'.length);
      status(
        ok
          ? `Controller accepted ${payload.area.name}.`
          : `Controller replied with a different hash${hash ? ` (${hash})` : ''}.`,
      );
      settled = true;
      cleanup();
    }
  };

  window.addEventListener('message', onMessage);
  const hello = window.setInterval(() => {
    if (popup.closed) {
      if (!settled) status('Controller window closed before it accepted the area.');
      cleanup();
      return;
    }
    popup.postMessage({ type: BRIDGE_HELLO, version: payload.version }, target.origin);
  }, 500);
  popup.postMessage({ type: BRIDGE_HELLO, version: payload.version }, target.origin);

  const waiting = window.setTimeout(() => {
    if (!settled) {
      status('Still waiting for the controller (tb-area-ready). Download the JSON if you need a fixture.');
    }
  }, opts?.waitingNoteMs ?? 20000);

  function cleanup() {
    if (closed) return;
    closed = true;
    window.clearInterval(hello);
    window.clearTimeout(waiting);
    window.removeEventListener('message', onMessage);
  }

  return { close: cleanup };
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
