/**
 * SPEC.md section 7 controls table: "Esc: Close the top-most window, or
 * open the system menu" - and M1's own acceptance checklist (section 3):
 * "the story intro... is skipped and can be replayed from Settings."
 * This is deliberately the minimum that satisfies both: a single hidden
 * panel with one action. Rebindable keys and volume sliders (section
 * 7/11's fuller description of "Settings") are real future work but
 * aren't named anywhere in section 3's M1 checklist, so they're not
 * built here - see docs/PROGRESS.md.
 */
export class SystemMenu {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, onReplayIntro: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'interactive terago-glass terago-hud-system-menu';
    this.root.hidden = true;
    this.root.innerHTML = `
      <h3>System Menu</h3>
      <button type="button" class="terago-system-replay-intro">Settings: Replay Intro</button>
      <button type="button" class="terago-system-menu-close">Close</button>
    `;
    parent.appendChild(this.root);

    this.root.querySelector('.terago-system-replay-intro')!.addEventListener('click', () => {
      this.close();
      onReplayIntro();
    });
    this.root.querySelector('.terago-system-menu-close')!.addEventListener('click', () => this.close());
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
  }

  destroy(): void {
    this.root.remove();
  }
}
