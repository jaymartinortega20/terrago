'use client';

import { getItem } from '@terrago/game-data';
import { affixText, type InventorySlot } from '@terrago/shared';
import { PixelIcon } from '@/components/PixelIcon';

export const RARITY_COLOR: Record<string, string> = {
  common: '#9a948a',
  uncommon: '#5fa04a',
  rare: '#4a7fd6',
  epic: '#9b59d0',
  legendary: '#e8a03a',
  mythic: '#e0483a',
};

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
      className="relative flex items-center justify-center bg-night"
      style={{
        width: size,
        height: size,
        border: `3px solid ${def ? RARITY_COLOR[def.rarity] : '#262c45'}`,
        boxShadow: selected ? '0 0 0 3px #e8c24a' : 'inset 0 0 0 2px #0b0d15',
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
