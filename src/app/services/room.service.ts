import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { joinRoom, selfId, type Room } from '@trystero-p2p/mqtt';
import {
  CHAT_BUBBLE_MS,
  ChatBubble,
  EMPTY_HOST_IDLE_MS,
  EMPTY_ROOM_MS,
  PeerPose,
  ROOM_APP_ID,
  RoomMeta,
  RoomStatus,
  clampChatText,
  isHostUnlocked,
  normalizePin,
  randomPin,
  roomIdForPin,
  unlockHost,
} from '../models/room.models';
import { clampSettings } from '../models/world.models';
import { PreferencesService } from './preferences.service';
import { WorldService } from './world.service';

type RoomHandle = Room & {
  leave: () => Promise<void>;
};

@Injectable({ providedIn: 'root' })
export class RoomService implements OnDestroy {
  private readonly world = inject(WorldService);
  private readonly prefs = inject(PreferencesService);

  readonly status = signal<RoomStatus>('idle');
  readonly pin = signal<string | null>(null);
  readonly isHost = signal(false);
  readonly error = signal<string | null>(null);
  readonly peers = signal<PeerPose[]>([]);
  readonly bubbles = signal<ChatBubble[]>([]);
  readonly rosterNames = computed(() => {
    const names = this.peers().map((p) => p.name);
    const local = this.world.player().name;
    return local ? [local, ...names] : names;
  });
  readonly connected = computed(() => this.status() === 'connected');
  /** Bumped after a room-owned world rebuild so the viewport can reload. */
  readonly worldSyncRev = signal(0);
  /** Guest must pick name + look before playing. */
  readonly needsHero = signal(false);

  private room: RoomHandle | null = null;
  private meta: RoomMeta | null = null;
  private sendMeta: ((data: RoomMeta) => Promise<void>) | null = null;
  private sendPose: ((data: PeerPose) => Promise<void>) | null = null;
  private sendChat: ((data: { id: string; name: string; text: string; t: number }) => Promise<void>) | null = null;
  private sendHostLeft: ((data: { hostId: string }) => Promise<void>) | null = null;
  private bubbleTimer: number | null = null;
  private emptyTimer: number | null = null;
  private aloneSince = 0;
  private sawGuest = false;
  private lastPoseAt = 0;
  private lastPoseKey = '';
  private readonly onPageHide = (): void => {
    void this.leave();
  };

  constructor() {
    window.addEventListener('pagehide', this.onPageHide);
  }

  ngOnDestroy(): void {
    window.removeEventListener('pagehide', this.onPageHide);
    void this.leave();
    if (this.bubbleTimer != null) window.clearInterval(this.bubbleTimer);
    if (this.emptyTimer != null) window.clearInterval(this.emptyTimer);
  }

  async create(hostKey?: string): Promise<void> {
    if (this.status() === 'connecting' || this.status() === 'connected') return;
    if (!isHostUnlocked()) {
      if (!hostKey || !unlockHost(hostKey)) {
        this.error.set('Hosting is locked. Enter the host key to create a room.');
        this.status.set('error');
        return;
      }
    }
    this.error.set(null);
    this.status.set('connecting');
    let pin = randomPin();
    for (let i = 0; i < 6; i++) {
      try {
        await this.openRoom(pin, true);
        return;
      } catch {
        pin = randomPin();
      }
    }
    this.status.set('error');
    this.error.set('Could not create a room. Try again.');
  }

  /** Whether this browser is unlocked to create rooms. */
  canCreate(): boolean {
    return isHostUnlocked();
  }

  tryUnlockHost(hostKey: string): boolean {
    return unlockHost(hostKey);
  }

  finishHero(): void {
    this.needsHero.set(false);
  }

  async join(rawPin: string): Promise<void> {
    if (this.status() === 'connecting' || this.status() === 'connected') return;
    const pin = normalizePin(rawPin);
    if (!pin) {
      this.error.set('Enter a 4-digit PIN.');
      this.status.set('error');
      return;
    }
    this.error.set(null);
    this.status.set('connecting');
    try {
      await this.openRoom(pin, false);
    } catch (err) {
      this.status.set('error');
      this.error.set(err instanceof Error ? err.message : 'Could not join that room.');
    }
  }

  async leave(reason?: string): Promise<void> {
    const wasHost = this.isHost();
    const hostId = this.meta?.hostId;
    if (wasHost && this.sendHostLeft && hostId) {
      try {
        await this.sendHostLeft({ hostId });
      } catch {
        /* ignore */
      }
    }
    await this.teardown();
    if (reason) {
      this.error.set(reason);
      this.status.set('error');
    } else {
      this.error.set(null);
      this.status.set('idle');
    }
  }

  publishPose(pose: Omit<PeerPose, 'id'>): void {
    if (!this.sendPose || this.status() !== 'connected') return;
    const full: PeerPose = { ...pose, id: selfId };
    const key = `${full.x.toFixed(2)},${full.y.toFixed(2)},${full.facing},${full.frame},${full.name},${full.sheet},${full.char}`;
    const now = performance.now();
    const moved = key !== this.lastPoseKey;
    const minGap = moved ? 100 : 500;
    if (now - this.lastPoseAt < minGap && !moved) return;
    this.lastPoseAt = now;
    this.lastPoseKey = key;
    void this.sendPose(full);
  }

  async sendMessage(raw: string): Promise<void> {
    const text = clampChatText(raw);
    if (!text || !this.sendChat || this.status() !== 'connected') return;
    const payload = {
      id: `${selfId}-${Date.now()}`,
      name: this.world.player().name || 'Traveler',
      text,
      t: Date.now(),
    };
    this.pushBubble(selfId, payload.name, payload.text);
    await this.sendChat(payload);
  }

  /** Host-only: push current seed/settings after a room-safe rebuild. */
  republishMeta(): void {
    if (!this.isHost() || !this.sendMeta || !this.meta) return;
    this.meta = {
      ...this.meta,
      seed: this.world.currentSeed,
      settings: clampSettings(this.world.settings()),
    };
    void this.sendMeta(this.meta);
  }

  private async openRoom(pin: string, asHost: boolean): Promise<void> {
    await this.teardown(false);
    const roomId = roomIdForPin(pin);
    const room = joinRoom({ appId: ROOM_APP_ID }, roomId) as RoomHandle;
    this.room = room;
    this.pin.set(pin);
    this.isHost.set(asHost);

    const metaAction = room.makeAction('meta');
    const poseAction = room.makeAction('pose');
    const chatAction = room.makeAction('chat');
    const leftAction = room.makeAction('hostLeft');

    this.sendMeta = (data) => metaAction.send(data as never);
    this.sendPose = (data) => poseAction.send(data as never);
    this.sendChat = (data) => chatAction.send(data as never);
    this.sendHostLeft = (data) => leftAction.send(data as never);

    metaAction.onMessage = (data) => {
      if (this.isHost()) return;
      this.applyGuestMeta(data as unknown as RoomMeta);
    };
    poseAction.onMessage = (data, { peerId }) => {
      if (!data || peerId === selfId) return;
      const raw = data as unknown as PeerPose;
      const pose: PeerPose = {
        id: peerId,
        name: String(raw.name || 'Guest').slice(0, 24),
        sheet: String(raw.sheet || 'townsfolk'),
        char: Number(raw.char) || 0,
        x: Number(raw.x) || 0,
        y: Number(raw.y) || 0,
        facing: (Number(raw.facing) || 0) as PeerPose['facing'],
        frame: Number(raw.frame) || 1,
      };
      this.peers.update((list) => {
        const next = list.filter((p) => p.id !== peerId);
        next.push(pose);
        return next;
      });
    };
    chatAction.onMessage = (data, { peerId }) => {
      const raw = data as unknown as { name?: string; text?: string } | null;
      if (!raw?.text) return;
      this.pushBubble(peerId, String(raw.name || 'Guest'), String(raw.text));
    };
    leftAction.onMessage = (data) => {
      if (this.isHost()) return;
      const raw = data as unknown as { hostId?: string } | null;
      if (raw?.hostId && this.meta?.hostId === raw.hostId) {
        this.error.set('Host left the room.');
        void this.teardown();
      }
    };

    room.onPeerJoin = (peerId) => {
      this.aloneSince = 0;
      this.sawGuest = true;
      if (this.isHost() && this.meta && this.sendMeta) {
        void this.sendMeta(this.meta);
      }
      void peerId;
    };
    room.onPeerLeave = (peerId) => {
      this.peers.update((list) => list.filter((p) => p.id !== peerId));
      this.touchEmptyClock();
      if (!this.isHost() && this.meta?.hostId === peerId) {
        this.error.set('Host left the room.');
        void this.teardown();
      }
    };

    this.ensureBubbleSweeper();
    this.ensureEmptyWatcher();
    this.prefs.setAdventureMode(true);

    if (asHost) {
      const settings = clampSettings(this.world.settings());
      const seed = this.world.currentSeed;
      this.meta = { pin, hostId: selfId, seed, settings };
      this.world.applySettings(settings);
      this.world.rebuildForRoom(seed);
      this.worldSyncRev.update((n) => n + 1);
      this.status.set('connected');
      this.needsHero.set(false);
      this.aloneSince = Date.now();
      this.sawGuest = false;
      await this.sendMeta(this.meta);
    } else {
      await this.waitForMeta(8000);
      if (!this.meta) {
        await this.teardown(false);
        throw new Error('No host found for that PIN.');
      }
      this.status.set('connected');
      this.needsHero.set(true);
      this.aloneSince = 0;
    }
  }

  private waitForMeta(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (this.meta || Date.now() - start >= ms) {
          resolve();
          return;
        }
        window.setTimeout(tick, 120);
      };
      tick();
    });
  }

  private applyGuestMeta(data: RoomMeta): void {
    if (!data?.pin || typeof data.seed !== 'number') return;
    const settings = clampSettings(data.settings ?? {});
    const seed = data.seed >>> 0;
    const same =
      !!this.meta &&
      this.meta.seed === seed &&
      this.meta.settings.worldScale === settings.worldScale &&
      this.meta.settings.mapStyle === settings.mapStyle &&
      this.meta.settings.poiCount === settings.poiCount &&
      this.meta.settings.wanderers === settings.wanderers &&
      this.meta.settings.caravans === settings.caravans &&
      this.meta.settings.armies === settings.armies;
    this.meta = {
      pin: data.pin,
      hostId: data.hostId,
      seed,
      settings,
    };
    this.pin.set(data.pin);
    if (same) return;
    this.world.applySettings(settings);
    this.world.rebuildForRoom(seed);
    this.prefs.setAdventureMode(true);
    this.worldSyncRev.update((n) => n + 1);
  }

  private pushBubble(peerId: string, name: string, text: string): void {
    const clean = clampChatText(text);
    if (!clean) return;
    const bubble: ChatBubble = {
      id: `${peerId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      peerId,
      name: name.slice(0, 24),
      text: clean,
      until: Date.now() + CHAT_BUBBLE_MS,
    };
    this.bubbles.update((list) => [...list.filter((b) => b.peerId !== peerId), bubble].slice(-24));
  }

  private ensureBubbleSweeper(): void {
    if (this.bubbleTimer != null) return;
    this.bubbleTimer = window.setInterval(() => {
      const now = Date.now();
      this.bubbles.update((list) => list.filter((b) => b.until > now));
    }, 400);
  }

  private ensureEmptyWatcher(): void {
    if (this.emptyTimer != null) return;
    this.emptyTimer = window.setInterval(() => this.sweepEmptyRoom(), 4000);
  }

  private touchEmptyClock(): void {
    const peers = this.room ? Object.keys(this.room.getPeers()).length : 0;
    if (peers > 0) this.aloneSince = 0;
    else if (!this.aloneSince) this.aloneSince = Date.now();
  }

  private sweepEmptyRoom(): void {
    if (this.status() !== 'connected' || !this.room) return;
    this.touchEmptyClock();
    if (!this.aloneSince) return;
    const limit = this.sawGuest ? EMPTY_ROOM_MS : EMPTY_HOST_IDLE_MS;
    if (Date.now() - this.aloneSince < limit) return;
    void this.leave('Room closed (empty).');
  }

  private async teardown(resetStatus = true): Promise<void> {
    const room = this.room;
    this.room = null;
    this.meta = null;
    this.sendMeta = null;
    this.sendPose = null;
    this.sendChat = null;
    this.sendHostLeft = null;
    this.peers.set([]);
    this.bubbles.set([]);
    this.pin.set(null);
    this.isHost.set(false);
    this.needsHero.set(false);
    this.aloneSince = 0;
    this.sawGuest = false;
    this.lastPoseKey = '';
    this.world.endRoomSession();
    if (room) {
      try {
        await room.leave();
      } catch {
        /* ignore */
      }
    }
    if (resetStatus) {
      this.status.update((s) => (s === 'error' ? s : 'idle'));
    }
  }
}
