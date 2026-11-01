/**
 * A dev-only visual audit page for every procedurally generated asset
 * (client/preview.html) - NOT part of the shipped game (main.ts never
 * imports this). Open with `npm run dev -w client` then visit /preview.html
 * whenever a generator in assets/generators/ changes, to eyeball the
 * result instead of trusting the drawing code blind.
 */
import { listAllAssetEntries } from './assets/manifest.js';
import { drawBody, drawBoots, drawChest, drawHair, drawHead, drawHelmet, drawWeapon, drawWings, type PaperDollFacing } from './assets/generators/paperDoll.js';
import { ANIM_FRAME_COUNTS, computePose, type AnimName } from './assets/generators/pose.js';
import { SPRITE_FRAME_SIZE_PX } from './config.js';

const root = document.getElementById('root')!;

function section(title: string): HTMLDivElement {
  const h = document.createElement('h2');
  h.textContent = title;
  root.appendChild(h);
  const grid = document.createElement('div');
  grid.className = 'grid';
  root.appendChild(grid);
  return grid;
}

function cell(grid: HTMLDivElement, label: string, displaySize: number, big = false): CanvasRenderingContext2D {
  const wrapper = document.createElement('div');
  wrapper.className = big ? 'cell big' : 'cell';
  const canvas = document.createElement('canvas');
  canvas.width = displaySize;
  canvas.height = displaySize;
  canvas.title = label;
  wrapper.appendChild(canvas);
  grid.appendChild(wrapper);
  return canvas.getContext('2d')!;
}

function renderEntryGrid(title: string, keyFilter: (key: string) => boolean, displayScale = 1): void {
  const grid = section(title);
  for (const entry of listAllAssetEntries()) {
    if (!keyFilter(entry.key)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = entry.width;
    canvas.height = entry.height;
    const ctx = canvas.getContext('2d')!;
    entry.draw(ctx);

    const display = document.createElement('canvas');
    display.width = entry.width * displayScale;
    display.height = entry.height * displayScale;
    display.title = entry.key;
    const dctx = display.getContext('2d')!;
    dctx.drawImage(canvas, 0, 0, display.width, display.height);

    const wrapper = document.createElement('div');
    wrapper.className = 'cell';
    wrapper.appendChild(display);
    grid.appendChild(wrapper);
  }
}

renderEntryGrid('Tiles', (k) => k.startsWith('tile_'), 2);
renderEntryGrid('UI icons', (k) => k.startsWith('icon_') || k.startsWith('ui_'), 2);
renderEntryGrid('Intro backgrounds', (k) => k.startsWith('intro_bg_'), 0.2);

// ---- Paper-doll composites: stack every layer for a held pose, per facing ----

const LAYER_DRAW_ORDER: Array<(ctx: CanvasRenderingContext2D, facing: PaperDollFacing, pose: ReturnType<typeof computePose>) => void> = [
  drawBody,
  drawBoots,
  drawChest,
  drawHead,
  drawHair,
  drawHelmet,
  drawWeapon,
];

function drawComposite(facing: PaperDollFacing, anim: AnimName, frame: number, frameCount: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_FRAME_SIZE_PX;
  canvas.height = SPRITE_FRAME_SIZE_PX;
  const ctx = canvas.getContext('2d')!;
  const pose = computePose(anim, frame, frameCount);
  drawWings(ctx, facing, frame / frameCount);
  for (const draw of LAYER_DRAW_ORDER) draw(ctx, facing, pose);
  return ctx;
}

const facingsGrid = section('Composite - idle frame 0, every facing');
for (const facing of ['down', 'left', 'up'] as PaperDollFacing[]) {
  const ctx = drawComposite(facing, 'idle', 0, ANIM_FRAME_COUNTS.idle);
  const target = cell(facingsGrid, facing, SPRITE_FRAME_SIZE_PX * 3, true);
  target.imageSmoothingEnabled = true;
  target.drawImage(ctx.canvas, 0, 0, target.canvas.width, target.canvas.height);
}

for (const anim of ['walk', 'attack', 'hurt', 'death', 'wakeUp', 'cast', 'mounted'] as AnimName[]) {
  const grid = section(`Composite - down facing, ${anim} (${ANIM_FRAME_COUNTS[anim]} frames)`);
  for (let frame = 0; frame < ANIM_FRAME_COUNTS[anim]; frame++) {
    const ctx = drawComposite('down', anim, frame, ANIM_FRAME_COUNTS[anim]);
    const target = cell(grid, `${anim} ${frame}`, SPRITE_FRAME_SIZE_PX * 2, true);
    target.drawImage(ctx.canvas, 0, 0, target.canvas.width, target.canvas.height);
  }
}

const wingsGrid = section('Wings flutter loop - down facing');
for (let frame = 0; frame < 6; frame++) {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_FRAME_SIZE_PX;
  canvas.height = SPRITE_FRAME_SIZE_PX;
  const ctx = canvas.getContext('2d')!;
  drawWings(ctx, 'down', frame / 6);
  const target = cell(wingsGrid, `wings ${frame}`, SPRITE_FRAME_SIZE_PX * 2, true);
  target.drawImage(canvas, 0, 0, target.canvas.width, target.canvas.height);
}

// ---- Monster sprites (task #80: WorldScene needs remote-entity art for
// monsters too, not just the player paper-doll) ----

for (const anim of ['idle', 'walk', 'attack', 'hurt', 'death', 'wakeUp', 'cast'] as AnimName[]) {
  renderEntryGrid(`Monster: Slime - ${anim}`, (k) => k.startsWith(`mon_slime_${anim}_`), 2.5);
}
