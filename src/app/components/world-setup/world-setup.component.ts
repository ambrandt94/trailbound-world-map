import { AfterViewInit, Component, ElementRef, HostListener, ViewChild, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  LAND_SKETCH_SIZE,
  MAP_STYLES,
  MAP_STYLE_LABELS,
  MapStyle,
  WORLD_SCALES,
  WorldScale,
  WorldSettings,
  clampSettings,
  worldExtent,
} from '../../models/world.models';
import { copySketch, paintSketchDisk, sameSketch, sketchHasInk, snapshotSketch, tryFillClosedStroke } from '../../engine/land-sketch';
import { WorldService } from '../../services/world.service';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-world-setup',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatChipsModule, MatFormFieldModule, MatInputModule],
  template: `
    <aside class="panel">
      <div class="eyebrow">World setup</div>
      <p class="lede">{{ sizeLine() }}</p>
      <div class="label">Continent scale</div>
      <mat-chip-set>
        @for (s of scales; track s) {
          <mat-chip [highlighted]="draft().worldScale === s" (click)="setScale(s)">{{ s }}×</mat-chip>
        }
      </mat-chip-set>
      <div class="label">Land shape</div>
      <mat-chip-set>
        @for (style of styles; track style) {
          <mat-chip [highlighted]="draft().mapStyle === style" (click)="setStyle(style)">{{ labels[style] }}</mat-chip>
        }
      </mat-chip-set>
      @if (draft().mapStyle === 'custom') {
        <div class="label">Land sketch</div>
        <canvas
          #sketch
          class="sketch"
          [class.erase]="eraseTool()"
          width="160"
          height="160"
          (pointerdown)="onSketchDown($event)"
          (pointermove)="onSketchMove($event)"
          (pointerup)="onSketchUp($event)"
          (pointercancel)="onSketchUp($event)"
          (contextmenu)="$event.preventDefault()"
        ></canvas>
        <div class="sketch-tools">
          <button mat-stroked-button type="button" [class.active]="!eraseTool()" (click)="eraseTool.set(false)">Draw</button>
          <button mat-stroked-button type="button" [class.active]="eraseTool()" (click)="eraseTool.set(true)">Erase</button>
          <button mat-stroked-button type="button" (click)="undo()" [disabled]="!canUndo()">Undo</button>
          <button mat-stroked-button type="button" (click)="redo()" [disabled]="!canRedo()">Redo</button>
          <button mat-stroked-button type="button" (click)="clearSketch()" [disabled]="!hasSketch()">Clear</button>
        </div>
        <p class="sketch-note">Closed shapes fill. Blank stays ocean. Ctrl+Z / Ctrl+Y.</p>
      }
      <div class="fields">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>POIs</mat-label>
          <input matInput type="number" min="0" max="400" [ngModel]="draft().poiCount" (ngModelChange)="patch({ poiCount: $event })" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Travelers</mat-label>
          <input matInput type="number" min="0" max="200" [ngModel]="draft().wanderers" (ngModelChange)="patch({ wanderers: $event })" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Caravans</mat-label>
          <input matInput type="number" min="0" max="40" [ngModel]="draft().caravans" (ngModelChange)="patch({ caravans: $event })" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Hosts</mat-label>
          <input matInput type="number" min="0" max="20" [ngModel]="draft().armies" (ngModelChange)="patch({ armies: $event })" />
        </mat-form-field>
      </div>
      <div class="actions">
        <button
          mat-flat-button
          type="button"
          (click)="submit(false)"
          [disabled]="world.generating() || roomLocked()"
        >
          Rebuild
        </button>
        <button
          mat-stroked-button
          type="button"
          (click)="submit(true)"
          [disabled]="world.generating() || room.connected()"
        >
          New seed
        </button>
      </div>
      @if (room.connected()) {
        <p class="room-lock">
          @if (room.hostControls()) {
            Room shares one seed — rebuild updates everyone.
          } @else {
            Room shares one seed — guests cannot rebuild.
          }
        </p>
      }
    </aside>
  `,
  styles: `
    .panel {
      width: 16.5rem;
      padding: 0.85rem 0.95rem;
      border-radius: 14px;
      background: color-mix(in srgb, var(--tb-panel) 88%, transparent);
      backdrop-filter: blur(10px);
      border: 1px solid color-mix(in srgb, var(--tb-ink) 10%, transparent);
      box-shadow: 0 10px 28px color-mix(in srgb, black 22%, transparent);
    }
    .eyebrow {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tb-accent-strong);
      margin-bottom: 0.35rem;
    }
    .lede {
      margin: 0 0 0.75rem;
      font-size: 0.82rem;
      color: var(--tb-muted);
    }
    .label {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tb-muted);
      margin-bottom: 0.4rem;
    }
    mat-chip-set {
      margin-bottom: 0.75rem;
    }
    .sketch {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      height: auto;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--tb-ink) 12%, transparent);
      background: #152028;
      cursor: crosshair;
      touch-action: none;
      image-rendering: auto;
    }
    .sketch.erase {
      cursor: cell;
    }
    .sketch-tools {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin: 0.4rem 0 0.35rem;
    }
    .sketch-tools button {
      text-transform: none;
      min-width: 0;
      padding: 0 0.55rem;
    }
    .sketch-tools button.active {
      border-color: color-mix(in srgb, var(--tb-accent-strong) 70%, transparent);
      background: color-mix(in srgb, var(--tb-accent) 18%, transparent);
    }
    .sketch-note {
      margin: 0 0 0.75rem;
      font-size: 0.72rem;
      line-height: 1.3;
      color: var(--tb-muted);
    }
    .fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.55rem;
    }
    .actions {
      display: flex;
      gap: 0.45rem;
      margin-top: 0.75rem;
    }
    .actions button {
      text-transform: none;
      flex: 1;
    }
    .room-lock {
      margin: 0.35rem 0 0;
      font-size: 0.72rem;
      color: var(--tb-muted);
      line-height: 1.3;
    }
    :host {
      display: block;
    }
    @media (max-width: 800px) {
      .panel {
        width: 100%;
      }
    }
  `,
})
export class WorldSetupComponent implements AfterViewInit {
  @ViewChild('sketch') sketchRef?: ElementRef<HTMLCanvasElement>;

  readonly world = inject(WorldService);
  readonly room = inject(RoomService);
  readonly scales = WORLD_SCALES;
  readonly styles = MAP_STYLES;
  readonly labels = MAP_STYLE_LABELS;
  readonly draft = signal<WorldSettings>({ ...this.world.settings() });
  readonly rebuilt = output<{ settings: WorldSettings; newSeed: boolean }>();
  readonly hasSketch = signal(!!this.world.settings().landSketch);
  readonly eraseTool = signal(false);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  private readonly grid = copySketch(this.world.settings().landSketch);
  private readonly stroke: Array<{ x: number; y: number }> = [];
  private readonly history: Float32Array[] = [this.grid.slice()];
  private historyIndex = 0;
  private drawing = false;
  private erasing = false;
  private beforeStroke: Float32Array | null = null;

  ngAfterViewInit(): void {
    this.redrawSketch();
  }

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (this.draft().mapStyle !== 'custom') return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (e.code === 'KeyY') {
      e.preventDefault();
      this.redo();
    }
  }

  sizeLine(): string {
    const n = worldExtent(this.draft().worldScale);
    return `${n} × ${n} tiles · ${MAP_STYLE_LABELS[this.draft().mapStyle]}`;
  }

  setScale(scale: WorldScale): void {
    this.patch({ worldScale: scale });
  }

  setStyle(mapStyle: MapStyle): void {
    this.patch({ mapStyle });
    if (mapStyle === 'custom') queueMicrotask(() => this.redrawSketch());
  }

  patch(part: Partial<WorldSettings>): void {
    this.draft.update((d) => clampSettings({ ...d, ...part }));
  }

  submit(newSeed: boolean): void {
    if (this.room.connected() && (newSeed || !this.room.hostControls())) return;
    this.commitSketch();
    this.rebuilt.emit({ settings: this.draft(), newSeed });
  }

  roomLocked(): boolean {
    return this.room.connected() && !this.room.hostControls();
  }

  clearSketch(): void {
    if (!sketchHasInk(this.grid)) return;
    this.grid.fill(0);
    this.pushHistory();
    this.hasSketch.set(false);
    this.patch({ landSketch: null });
    this.redrawSketch();
  }

  undo(): void {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.grid.set(this.history[this.historyIndex]!);
    this.afterHistory();
  }

  redo(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.grid.set(this.history[this.historyIndex]!);
    this.afterHistory();
  }

  onSketchDown(e: PointerEvent): void {
    e.preventDefault();
    const canvas = this.sketchRef?.nativeElement;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    this.drawing = true;
    this.erasing = this.eraseTool() || e.button === 2 || e.buttons === 2;
    this.stroke.length = 0;
    this.beforeStroke = this.grid.slice();
    this.strokeAt(e);
  }

  onSketchMove(e: PointerEvent): void {
    if (!this.drawing) return;
    this.strokeAt(e);
  }

  onSketchUp(_e: PointerEvent): void {
    if (!this.drawing) return;
    this.drawing = false;
    if (!this.erasing) tryFillClosedStroke(this.grid, this.stroke, 3.1);
    if (this.beforeStroke && !sameSketch(this.beforeStroke, this.grid)) this.pushHistory();
    this.beforeStroke = null;
    this.hasSketch.set(sketchHasInk(this.grid));
    this.redrawSketch();
    this.commitSketch();
  }

  private strokeAt(e: PointerEvent): void {
    const canvas = this.sketchRef?.nativeElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const x = ((e.clientX - rect.left) / rect.width) * LAND_SKETCH_SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * LAND_SKETCH_SIZE;
    const last = this.stroke[this.stroke.length - 1];
    if (last) {
      const jump = Math.hypot(x - last.x, y - last.y);
      if (jump < 0.28) return;
      const steps = Math.max(1, Math.ceil(jump / 0.85));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const px = last.x + (x - last.x) * t;
        const py = last.y + (y - last.y) * t;
        this.stroke.push({ x: px, y: py });
        paintSketchDisk(this.grid, px, py, 3.1, this.erasing);
      }
    }
    this.stroke.push({ x, y });
    paintSketchDisk(this.grid, x, y, 3.1, this.erasing);
    this.hasSketch.set(sketchHasInk(this.grid));
    this.redrawSketch();
  }

  private commitSketch(): void {
    this.patch({ landSketch: snapshotSketch(this.grid) });
  }

  private pushHistory(): void {
    this.history.splice(this.historyIndex + 1);
    this.history.push(this.grid.slice());
    if (this.history.length > 36) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.syncHistoryButtons();
  }

  private afterHistory(): void {
    this.hasSketch.set(sketchHasInk(this.grid));
    this.commitSketch();
    this.redrawSketch();
    this.syncHistoryButtons();
  }

  private syncHistoryButtons(): void {
    this.canUndo.set(this.historyIndex > 0);
    this.canRedo.set(this.historyIndex < this.history.length - 1);
  }

  private redrawSketch(): void {
    const canvas = this.sketchRef?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const n = LAND_SKETCH_SIZE;
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = '#152028';
    ctx.fillRect(0, 0, w, h);
    const cellW = w / n;
    const cellH = h / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = this.grid[x + y * n]!;
        if (v < 0.04) continue;
        ctx.fillStyle = `rgba(214, 196, 150, ${0.35 + v * 0.65})`;
        ctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
  }
}
