'use client';

import { getItem } from '@terrago/game-data';
import { affixText, type InventorySlot } from '@terrago/shared';
import { PixelIcon } from '@/components/PixelIcon';

/** Quality borders: Common steel, Rare blue, Epic purple, Mythic glowing gold. */
export const RARITY_COLOR: Record<string, string> = {
  common: '#9aa6b8',
  uncommon: '#4ee08a',
  rare: '#4f9bff',
  epic: '#b46aff',
  legendary: '#ff9a3a',
  mythic: '#ffcb52',
};
const QUALITY_CLASS: Record<string, string> = { common: 'q-common', uncommon: 'q-common', rare: 'q-rare', epic: 'q-epic', legendary: 'q-epic', mythic: 'q-mythic' };

export function ItemSlot({
  slot,
  item,
  selected,
  onClick,
  hotkey,
  size = 44,
}: {
  slot: number;
  item: InventorySlot | undefined;
  selected?: boolean;
  onClick?: () => void;
  hotkey?: string;
  size?: number;
}) {
  const def = item ? getItem(item.itemId) : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`slot-${slot}`}
      title={def ? `${def.name}${item!.enhance ? ` +${item!.enhance}` : ''}${item!.quantity > 1 ? ` ×${item!.quantity}` : ''}${item!.affixes?.length ? `\n${item!.affixes.map(affixText).join('\n')}` : ''}` : 'Empty'}
      className={`relative flex items-center justify-center rounded-xl transition hover:brightness-125 ${def ? QUALITY_CLASS[def.rarity] ?? 'q-common' : ''}`}
      style={{
        width: size,
        height: size,
        background: def ? `radial-gradient(circle at 50% 35%, ${RARITY_COLOR[def.rarity]}44, rgba(8,12,30,.85) 72%)` : 'rgba(8,12,30,.55)',
        border: `2px solid ${def ? RARITY_COLOR[def.rarity] : 'rgba(255,255,255,.12)'}`,
        boxShadow: selected ? '0 0 0 2px #ffcb52, 0 0 14px #ffcb52aa' : def ? undefined : 'inset 0 1px 0 rgba(255,255,255,.08), inset 0 -6px 12px rgba(0,0,0,.35)',
      }}
    >
      {def && <PixelIcon icon={def.icon} size={size - 12} />}
      {item && item.quantity > 1 && <span className="text-outline absolute right-0.5 bottom-0 text-[11px] font-bold text-white">{item.quantity}</span>}
      {item?.affixes?.length ? (
        <span className="text-outline absolute top-0 right-0.5 text-[9px] font-bold" style={{ color: '#7ab8ff' }} aria-hidden>
          {'✦'.repeat(Math.min(3, item.affixes.length))}
        </span>
      ) : null}
      {hotkey && <span className="absolute top-0 left-0.5 text-[9px] text-parchment/60">{hotkey}</span>}
    </button>
  );
}
