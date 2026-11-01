/**
 * SPEC.md section 8: the on-screen AUTO button (glows while on, also
 * toggled by Caps Lock - Hud.ts owns that key) plus its cog settings
 * panel. AUTO's actual scan/target/attack/potion/cast LOOP is task #82;
 * this only owns the toggle, the three settings, and persisting them
 * (`auto:toggle`/`auto:configure`, echoed back via self:state so a
 * relogin restores the panel correctly - docs/DECISIONS.md).
 */
import type { NetClient } from '../../net/NetClient.js';
import type { SelfState } from '../../state/GameState.js';

type AutoConfig = SelfState['autoConfig'];

function defaultConfig(): AutoConfig {
  return { autoTargetMobs: true, autoUsePotionsHpPct: null, autoUsePotionsResourcePct: null, autoCastLowTierSkills: false };
}

export class AutoPanel {
  private readonly buttonRoot: HTMLDivElement;
  private readonly autoButton: HTMLButtonElement;
  private readonly settingsRoot: HTMLDivElement;
  private readonly targetMobsEl: HTMLInputElement;
  private readonly hpEnabledEl: HTMLInputElement;
  private readonly hpSliderEl: HTMLInputElement;
  private readonly resourceEnabledEl: HTMLInputElement;
  private readonly resourceSliderEl: HTMLInputElement;
  private readonly castEl: HTMLInputElement;
  private config: AutoConfig = defaultConfig();
  private autoOn = false;

  constructor(parent: HTMLElement, private readonly net: NetClient) {
    this.buttonRoot = document.createElement('div');
    this.buttonRoot.className = 'interactive terago-glass terago-hud-auto';
    this.buttonRoot.innerHTML = `
      <button type="button" class="terago-auto-toggle">AUTO</button>
      <button type="button" class="terago-auto-cog" title="AUTO settings">&#9881;</button>
    `;
    parent.appendChild(this.buttonRoot);
    this.autoButton = this.buttonRoot.querySelector('.terago-auto-toggle')!;

    this.settingsRoot = document.createElement('div');
    this.settingsRoot.className = 'interactive terago-glass terago-hud-auto-settings';
    this.settingsRoot.hidden = true;
    this.settingsRoot.innerHTML = `
      <h3>AUTO Settings</h3>
      <label><input type="checkbox" class="terago-auto-target" /> Auto-Target Mobs</label>
      <label>
        <input type="checkbox" class="terago-auto-hp-enabled" /> Auto-Use Potions below HP%
        <input type="range" class="terago-auto-hp-slider" min="10" max="90" value="50" />
      </label>
      <label>
        <input type="checkbox" class="terago-auto-resource-enabled" /> ...below Resource%
        <input type="range" class="terago-auto-resource-slider" min="10" max="90" value="50" />
      </label>
      <label><input type="checkbox" class="terago-auto-cast" /> Auto-Cast Low-Tier Skills</label>
      <button type="button" class="terago-auto-settings-close">Close</button>
    `;
    parent.appendChild(this.settingsRoot);

    this.targetMobsEl = this.settingsRoot.querySelector('.terago-auto-target')!;
    this.hpEnabledEl = this.settingsRoot.querySelector('.terago-auto-hp-enabled')!;
    this.hpSliderEl = this.settingsRoot.querySelector('.terago-auto-hp-slider')!;
    this.resourceEnabledEl = this.settingsRoot.querySelector('.terago-auto-resource-enabled')!;
    this.resourceSliderEl = this.settingsRoot.querySelector('.terago-auto-resource-slider')!;
    this.castEl = this.settingsRoot.querySelector('.terago-auto-cast')!;

    this.autoButton.addEventListener('click', () => this.toggle());
    this.buttonRoot.querySelector('.terago-auto-cog')!.addEventListener('click', () => this.toggleSettings());
    this.settingsRoot.querySelector('.terago-auto-settings-close')!.addEventListener('click', () => this.closeSettings());

    for (const el of [this.targetMobsEl, this.hpEnabledEl, this.hpSliderEl, this.resourceEnabledEl, this.resourceSliderEl, this.castEl]) {
      el.addEventListener('change', () => this.sendConfig());
    }
  }

  toggle(): void {
    this.autoOn = !this.autoOn;
    this.autoButton.classList.toggle('is-on', this.autoOn);
    this.net.send({ t: 'auto:toggle', on: this.autoOn });
  }

  toggleSettings(): void {
    this.settingsRoot.hidden = !this.settingsRoot.hidden;
  }

  closeSettings(): void {
    this.settingsRoot.hidden = true;
  }

  isSettingsOpen(): boolean {
    return !this.settingsRoot.hidden;
  }

  private sendConfig(): void {
    const autoUsePotionsHpPct = this.hpEnabledEl.checked ? Number(this.hpSliderEl.value) : null;
    const autoUsePotionsResourcePct = this.resourceEnabledEl.checked ? Number(this.resourceSliderEl.value) : null;
    this.net.send({
      t: 'auto:configure',
      autoTargetMobs: this.targetMobsEl.checked,
      autoUsePotionsHpPct,
      autoUsePotionsResourcePct,
      autoCastLowTierSkills: this.castEl.checked,
    });
  }

  update(self: SelfState): void {
    this.autoOn = self.autoOn;
    this.autoButton.classList.toggle('is-on', this.autoOn);
    this.config = self.autoConfig;

    this.targetMobsEl.checked = this.config.autoTargetMobs;
    this.hpEnabledEl.checked = this.config.autoUsePotionsHpPct !== null;
    this.hpSliderEl.value = String(this.config.autoUsePotionsHpPct ?? 50);
    this.resourceEnabledEl.checked = this.config.autoUsePotionsResourcePct !== null;
    this.resourceSliderEl.value = String(this.config.autoUsePotionsResourcePct ?? 50);
    this.castEl.checked = this.config.autoCastLowTierSkills;
  }

  destroy(): void {
    this.buttonRoot.remove();
    this.settingsRoot.remove();
  }
}
