/**
 * SPEC.md section 7, "Hotbar (bottom center, keys 1-8)". M1 has no skills
 * yet (`shared/config/skills.ts` doesn't exist - `handleHotbarAssign`'s
 * own comment notes this), so every slot that's ever actually filled in
 * M1 holds a stackable consumable; the `skill` binding type is still
 * rendered (a generic icon) so nothing breaks once M2 adds real skills.
 * Drag-drop source is InventoryPanel, which only makes `stackable` items
 * draggable - this module trusts whatever item id a drop hands it and
 * lets the server be the final authority on ownership either way.
 */
import { ITEMS } from '@terago/shared';
import type { NetClient } from '../../net/NetClient.js';
import type { SelfState } from '../../state/GameState.js';
import { ICON_SIZE_PX, drawGenericItemIcon, drawItemIcon } from '../../assets/generators/ui.js';
import { TERAGO_ITEM_DRAG_MIME } from './dragMime.js';

const SLOT_COUNT = 8;

interface SlotEls {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  qty: HTMLSpanElement;
}

function rarityClass(itemId: string | undefined): string {
  if (!itemId) return '';
  const rarity = ITEMS[itemId]?.rarity;
  return rarity ? `terago-rarity-${rarity}` : '';
}

export class Hotbar {
  private readonly root: HTMLDivElement;
  private readonly slots: SlotEls[] = [];

  constructor(parent: HTMLElement, private readonly net: NetClient) {
    this.root = document.createElement('div');
    this.root.className = 'interactive terago-glass terago-hud-hotbar';
    parent.appendChild(this.root);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const slotNumber = i + 1;
      const slotRoot = document.createElement('div');
      slotRoot.className = 'terago-hotbar-slot';
      slotRoot.innerHTML = `
        <span class="terago-hotbar-key">${slotNumber}</span>
        <canvas class="terago-hotbar-icon" width="${ICON_SIZE_PX}" height="${ICON_SIZE_PX}"></canvas>
        <span class="terago-hotbar-qty"></span>
        <button type="button" class="terago-hotbar-clear" title="Clear slot">&times;</button>
      `;
      this.root.appendChild(slotRoot);

      const canvas = slotRoot.querySelector<HTMLCanvasElement>('.terago-hotbar-icon')!;
      const qty = slotRoot.querySelector<HTMLSpanElement>('.terago-hotbar-qty')!;
      const clearBtn = slotRoot.querySelector<HTMLButtonElement>('.terago-hotbar-clear')!;

      canvas.addEventListener('click', () => this.use(slotNumber));
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clear(slotNumber);
      });

      canvas.draggable = true;
      canvas.addEventListener('dragstart', (e) => {
        const itemId = canvas.dataset.itemId;
        if (!itemId) {
          e.preventDefault();
          return;
        }
        e.dataTransfer?.setData(TERAGO_ITEM_DRAG_MIME, itemId);
        e.dataTransfer!.effectAllowed = 'move';
      });
      // SPEC.md: "Drag a slot off the bar to clear it." A drop that never
      // lands on a valid target reports dropEffect 'none' on dragend.
      canvas.addEventListener('dragend', (e) => {
        if (e.dataTransfer?.dropEffect === 'none') this.clear(slotNumber);
      });

      slotRoot.addEventListener('dragover', (e) => e.preventDefault());
      slotRoot.addEventListener('drop', (e) => {
        e.preventDefault();
        const itemId = e.dataTransfer?.getData(TERAGO_ITEM_DRAG_MIME);
        if (itemId) this.net.send({ t: 'hotbar:assign', slot: slotNumber, binding: { type: 'item', id: itemId } });
      });

      this.slots.push({ root: slotRoot, canvas, qty });
    }
  }

  private use(slot: number): void {
    this.net.send({ t: 'hotbar:use', slot });
  }

  private clear(slot: number): void {
    this.net.send({ t: 'hotbar:assign', slot, binding: null });
  }

  update(self: SelfState): void {
    self.hotbar.forEach((binding, i) => {
      const { root, canvas, qty } = this.slots[i]!;
      const ctx = canvas.getContext('2d')!;

      root.classList.remove('terago-rarity-common', 'terago-rarity-rare', 'terago-rarity-epic', 'terago-rarity-mythic', 'terago-empty', 'terago-depleted');

      if (!binding) {
        ctx.clearRect(0, 0, ICON_SIZE_PX, ICON_SIZE_PX);
        qty.textContent = '';
        canvas.dataset.itemId = '';
        root.classList.add('terago-empty');
        return;
      }

      if (binding.type === 'skill') {
        drawGenericItemIcon(ctx); // no skills exist in M1 - a placeholder until M2
        qty.textContent = '';
        canvas.dataset.itemId = '';
        return;
      }

      drawItemIcon(ctx, binding.id);
      qty.textContent = binding.qty > 1 ? String(binding.qty) : '';
      canvas.dataset.itemId = binding.id;
      const cls = rarityClass(binding.id);
      if (cls) root.classList.add(cls);
      // SPEC.md: "At 0 the slot greys out but keeps its binding, so
      // restocking re-enables it" - still shows the icon, just dimmed.
      if (binding.qty <= 0) root.classList.add('terago-depleted');
    });
  }

  destroy(): void {
    this.root.remove();
  }
}
