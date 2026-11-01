/**
 * SPEC.md section 7, "Top-left status block": live portrait, Base/Job
 * level + job title, red HP bar, class resource bar in the class color,
 * yellow Base EXP bar, green Job EXP bar - each bar showing exact numbers
 * on hover (a native `title` tooltip is enough for that, no custom
 * tooltip widget needed).
 */
import { CLASSES, type JobId } from '@terago/shared';
import type { SelfState } from '../../state/GameState.js';
import { drawPortrait } from '../portrait.js';
import { RESOURCE_BAR_COLORS } from './resourceColors.js';

interface Bar {
  root: HTMLDivElement;
  fill: HTMLDivElement;
}

function createBar(parent: HTMLElement, className: string, fillColor: string): Bar {
  const root = document.createElement('div');
  root.className = `terago-bar ${className}`;
  const fill = document.createElement('div');
  fill.className = 'terago-bar-fill';
  fill.style.background = fillColor;
  root.appendChild(fill);
  parent.appendChild(root);
  return { root, fill };
}

function setBar(bar: Bar, value: number, max: number): void {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  bar.fill.style.width = `${pct}%`;
  bar.root.title = `${value} / ${max}`;
}

export class StatusBlock {
  private readonly root: HTMLDivElement;
  private readonly portraitCanvas: HTMLCanvasElement;
  private readonly nameEl: HTMLDivElement;
  private readonly levelEl: HTMLDivElement;
  private readonly hpBar: Bar;
  private readonly resourceBar: Bar;
  private readonly baseExpBar: Bar;
  private readonly jobExpBar: Bar;
  private lastEquipmentKey = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'interactive terago-glass terago-hud-status';
    this.root.innerHTML = `
      <div class="terago-status-top">
        <canvas class="terago-portrait" width="64" height="64"></canvas>
        <div class="terago-status-text">
          <div class="terago-status-name"></div>
          <div class="terago-status-level"></div>
        </div>
      </div>
      <div class="terago-status-bars"></div>
    `;
    parent.appendChild(this.root);

    this.portraitCanvas = this.root.querySelector('.terago-portrait')!;
    this.nameEl = this.root.querySelector('.terago-status-name')!;
    this.levelEl = this.root.querySelector('.terago-status-level')!;

    const barsHost = this.root.querySelector<HTMLDivElement>('.terago-status-bars')!;
    this.hpBar = createBar(barsHost, 'terago-bar-hp', '#d9434a');
    this.resourceBar = createBar(barsHost, 'terago-bar-resource', RESOURCE_BAR_COLORS.stamina);
    this.baseExpBar = createBar(barsHost, 'terago-bar-exp-base', '#e0c23c');
    this.jobExpBar = createBar(barsHost, 'terago-bar-exp-job', '#4fcf6a');
  }

  update(self: SelfState): void {
    this.nameEl.textContent = self.name;
    const jobName = CLASSES[self.jobId as JobId]?.name ?? self.jobId;
    this.levelEl.textContent = `${jobName} - Base Lv ${self.baseLevel} / Job Lv ${self.jobLevel}`;

    setBar(this.hpBar, self.hp, self.maxHp);
    this.resourceBar.fill.style.background = RESOURCE_BAR_COLORS[self.resourceKind];
    setBar(this.resourceBar, self.resource, self.maxResource);
    setBar(this.baseExpBar, self.baseExp, self.baseExpToNext);
    setBar(this.jobExpBar, self.jobExp, self.jobExpToNext);

    // Only recomposite the portrait when equipment actually changed - it's
    // a handful of canvas draw calls, cheap, but there's no reason to redo
    // it on every HP tick when self:state resends for unrelated reasons.
    const equipmentKey = JSON.stringify(self.equipment);
    if (equipmentKey !== this.lastEquipmentKey) {
      this.lastEquipmentKey = equipmentKey;
      drawPortrait(this.portraitCanvas, self.equipment);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
