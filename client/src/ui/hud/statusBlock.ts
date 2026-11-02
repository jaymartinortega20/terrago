/**
 * SPEC.md section 7, "Top-left status block": live portrait, Base/Job
 * level + job title, red HP bar, class resource bar in the class color,
 * yellow Base EXP bar, green Job EXP bar - each bar showing exact numbers
 * on hover (a native `title` tooltip is enough for that, no custom
 * tooltip widget needed). Also owns stat-point allocation (M1 acceptance:
 * "stat points can be allocated with all six stat formulas live") - a row
 * of six "STR 1 [+]"-style buttons that only renders while
 * unallocatedStatPoints > 0, sending `stat:allocate` one point at a time
 * (the server is the source of truth: a rejected allocate - e.g. a stale
 * double-click past BALANCE.maxManualStatPoints - just does nothing, the
 * next self:state resync corrects the button row either way).
 */
import { BALANCE, CLASSES, type JobId, type Stats } from '@terago/shared';
import type { NetClient } from '../../net/NetClient.js';
import type { SelfState } from '../../state/GameState.js';
import { drawPortrait } from '../portrait.js';
import { RESOURCE_BAR_COLORS } from './resourceColors.js';

const STAT_NAMES: readonly (keyof Stats)[] = ['STR', 'AGI', 'VIT', 'LUK', 'INT', 'DEX'];

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
  private readonly statsRoot: HTMLDivElement;
  private readonly statButtons: Record<keyof Stats, { value: HTMLSpanElement; btn: HTMLButtonElement }>;
  private lastEquipmentKey = '';

  constructor(parent: HTMLElement, private readonly net: NetClient) {
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
      <div class="terago-status-stats" hidden></div>
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

    this.statsRoot = this.root.querySelector('.terago-status-stats')!;
    this.statButtons = {} as typeof this.statButtons;
    for (const stat of STAT_NAMES) {
      const row = document.createElement('div');
      row.className = 'terago-stat-row';
      row.innerHTML = `<span class="terago-stat-name">${stat}</span><span class="terago-stat-value">0</span><button type="button" class="terago-stat-add">+</button>`;
      this.statsRoot.appendChild(row);
      const btn = row.querySelector<HTMLButtonElement>('.terago-stat-add')!;
      btn.addEventListener('click', () => this.net.send({ t: 'stat:allocate', stat, points: 1 }));
      this.statButtons[stat] = { value: row.querySelector('.terago-stat-value')!, btn };
    }
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

    this.statsRoot.hidden = self.unallocatedStatPoints <= 0;
    for (const stat of STAT_NAMES) {
      const current = self.stats[stat] ?? 0;
      const { value, btn } = this.statButtons[stat];
      value.textContent = String(current);
      btn.disabled = self.unallocatedStatPoints <= 0 || current >= BALANCE.maxManualStatPoints;
    }
    this.statsRoot.title = self.unallocatedStatPoints > 0 ? `${self.unallocatedStatPoints} point(s) to spend` : '';

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
