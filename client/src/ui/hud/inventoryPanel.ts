/**
 * SPEC.md M1 acceptance: "Inventory and equipment work. Equipping a
 * weapon, helmet, chest piece, boots or wings changes the character
 * sprite immediately." Toggled with the I key (Hud.ts owns that
 * binding). Equip slots show what's currently worn and unequip on click;
 * the bag grid shows `self:state.inventory` and equips on click (for
 * gear) or drags onto the hotbar (for stackable consumables, per SPEC.md
 * section 7's hotbar rules) or onto an equip slot (for gear).
 */
import { ITEMS, type EquipmentSlot } from '@terago/shared';
import type { NetClient } from '../../net/NetClient.js';
import type { SelfState } from '../../state/GameState.js';
import { ICON_SIZE_PX, drawItemIcon } from '../../assets/generators/ui.js';
import { TERAGO_ITEM_DRAG_MIME, TERAGO_ITEM_INSTANCE_DRAG_MIME } from './dragMime.js';

const EQUIP_SLOTS: readonly EquipmentSlot[] = ['weapon', 'helmet', 'chest', 'boots', 'wings'];

function rarityClass(itemId: string | undefined): string {
  if (!itemId) return '';
  const rarity = ITEMS[itemId]?.rarity;
  return rarity ? `terago-rarity-${rarity}` : '';
}

export class InventoryPanel {
  private readonly root: HTMLDivElement;
  private readonly equipSlots: Record<EquipmentSlot, HTMLCanvasElement>;
  private readonly bagEl: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly net: NetClient) {
    this.root = document.createElement('div');
    this.root.className = 'interactive terago-glass terago-hud-inventory';
    this.root.hidden = true;
    this.root.innerHTML = `
      <h3>Inventory</h3>
      <div class="terago-inventory-equip">
        ${EQUIP_SLOTS.map((slot) => `
          <div class="terago-equip-slot" data-slot="${slot}" title="${slot}">
            <canvas width="${ICON_SIZE_PX}" height="${ICON_SIZE_PX}"></canvas>
          </div>`).join('')}
      </div>
      <div class="terago-inventory-bag"></div>
      <button type="button" class="terago-inventory-close">Close</button>
    `;
    parent.appendChild(this.root);

    this.root.querySelector('.terago-inventory-close')!.addEventListener('click', () => this.close());
    this.bagEl = this.root.querySelector('.terago-inventory-bag')!;

    this.equipSlots = {} as Record<EquipmentSlot, HTMLCanvasElement>;
    for (const slot of EQUIP_SLOTS) {
      const slotEl = this.root.querySelector<HTMLDivElement>(`.terago-equip-slot[data-slot="${slot}"]`)!;
      this.equipSlots[slot] = slotEl.querySelector('canvas')!;
      slotEl.addEventListener('click', () => this.net.send({ t: 'unequip:slot', slot }));
      slotEl.addEventListener('dragover', (e) => e.preventDefault());
      slotEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const instanceId = e.dataTransfer?.getData(TERAGO_ITEM_INSTANCE_DRAG_MIME);
        if (instanceId) this.net.send({ t: 'equip:item', itemInstanceId: instanceId });
      });
    }
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

  update(self: SelfState): void {
    for (const slot of EQUIP_SLOTS) {
      const canvas = this.equipSlots[slot];
      const ctx = canvas.getContext('2d')!;
      const itemId = self.equipment[slot];
      ctx.clearRect(0, 0, ICON_SIZE_PX, ICON_SIZE_PX);
      canvas.parentElement!.className = `terago-equip-slot ${rarityClass(itemId ?? undefined)}`;
      if (itemId) drawItemIcon(ctx, itemId);
    }

    this.bagEl.innerHTML = '';
    for (const entry of self.inventory) {
      const def = ITEMS[entry.itemId];
      const slotEl = document.createElement('div');
      slotEl.className = `terago-bag-slot ${rarityClass(entry.itemId)}`;
      slotEl.title = def?.name ?? entry.itemId;
      slotEl.innerHTML = `
        <canvas width="${ICON_SIZE_PX}" height="${ICON_SIZE_PX}"></canvas>
        <span class="terago-bag-qty">${entry.qty > 1 ? entry.qty : ''}</span>
      `;
      const canvas = slotEl.querySelector<HTMLCanvasElement>('canvas')!;
      drawItemIcon(canvas.getContext('2d')!, entry.itemId);

      const isEquippable = def && EQUIP_SLOTS.includes(def.slot as EquipmentSlot);
      if (isEquippable) {
        slotEl.addEventListener('click', () => this.net.send({ t: 'equip:item', itemInstanceId: entry.id }));
      }

      // Only stackable consumables are legal hotbar bindings (SPEC.md
      // section 7); gear is draggable only onto an equip slot.
      slotEl.draggable = true;
      slotEl.addEventListener('dragstart', (e) => {
        if (def?.stackable) e.dataTransfer?.setData(TERAGO_ITEM_DRAG_MIME, entry.itemId);
        if (isEquippable) e.dataTransfer?.setData(TERAGO_ITEM_INSTANCE_DRAG_MIME, entry.id);
        e.dataTransfer!.effectAllowed = 'copyMove';
      });

      this.bagEl.appendChild(slotEl);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
