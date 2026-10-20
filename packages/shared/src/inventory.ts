import type { InventorySlot } from './types';

/**
 * Pure inventory rules. The server loads a character's slots inside a database
 * transaction, applies one of these functions, and writes back only the changed
 * slots. Nothing here trusts the client.
 */

export interface SlotItem {
  itemId: string;
  quantity: number;
  quality: number;
  durability: number | null;
  bound: boolean;
  enhance?: number;
}

export type Slots = (SlotItem | null)[];

export interface StackInfo {
  stackSize: number;
}

export type ItemLookup = (itemId: string) => StackInfo | undefined;

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export function emptySlots(capacity: number): Slots {
  return Array.from({ length: capacity }, () => null);
}

export function fromInventorySlots(list: InventorySlot[], capacity: number): Slots {
  const slots = emptySlots(capacity);
  for (const s of list) {
    if (s.slot >= 0 && s.slot < capacity) {
      slots[s.slot] = { itemId: s.itemId, quantity: s.quantity, quality: s.quality, durability: s.durability, bound: s.bound, ...(s.enhance ? { enhance: s.enhance } : {}) };
    }
  }
  return slots;
}

export function toInventorySlots(slots: Slots): InventorySlot[] {
  const out: InventorySlot[] = [];
  slots.forEach((s, slot) => {
    if (s) out.push({ slot, ...s });
  });
  return out;
}

export function canStackTogether(a: SlotItem, b: Omit<SlotItem, 'quantity'>, stackSize: number): boolean {
  return (
    stackSize > 1 &&
    a.itemId === b.itemId &&
    a.quality === b.quality &&
    a.bound === b.bound &&
    a.durability === null &&
    b.durability === null &&
    (a.enhance ?? 0) === 0 &&
    (b.enhance ?? 0) === 0
  );
}

export function countItem(slots: Slots, itemId: string): number {
  return slots.reduce((n, s) => n + (s && s.itemId === itemId ? s.quantity : 0), 0);
}

/**
 * Add items, filling existing stacks first and then empty slots.
 * `allOrNothing` (the default) refuses partial adds so rewards never vanish.
 */
export function addItem(
  slots: Slots,
  item: Omit<SlotItem, 'quantity'>,
  quantity: number,
  stackSize: number,
  allOrNothing = true,
): Result<{ slots: Slots; added: number; changed: number[] }> {
  if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, error: 'Invalid quantity.' };
  if (!Number.isInteger(stackSize) || stackSize < 1) return { ok: false, error: 'Invalid stack size.' };
  const next = slots.map((s) => (s ? { ...s } : null));
  const changed = new Set<number>();
  let remaining = quantity;

  for (let i = 0; i < next.length && remaining > 0; i++) {
    const s = next[i];
    if (s && canStackTogether(s, item, stackSize) && s.quantity < stackSize) {
      const take = Math.min(stackSize - s.quantity, remaining);
      s.quantity += take;
      remaining -= take;
      changed.add(i);
    }
  }
  for (let i = 0; i < next.length && remaining > 0; i++) {
    if (next[i] === null) {
      const take = Math.min(stackSize, remaining);
      next[i] = { ...item, quantity: take };
      remaining -= take;
      changed.add(i);
    }
  }

  if (remaining > 0 && allOrNothing) return { ok: false, error: 'Not enough inventory space.' };
  return { ok: true, slots: next, added: quantity - remaining, changed: [...changed].sort((a, b) => a - b) };
}

/** Remove `quantity` from one slot. */
export function removeFromSlot(slots: Slots, slot: number, quantity: number): Result<{ slots: Slots; removed: SlotItem }> {
  if (!Number.isInteger(slot) || slot < 0 || slot >= slots.length) return { ok: false, error: 'Invalid slot.' };
  if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, error: 'Invalid quantity.' };
  const s = slots[slot];
  if (!s) return { ok: false, error: 'That slot is empty.' };
  if (s.quantity < quantity) return { ok: false, error: 'Not enough items in that slot.' };
  const next = slots.map((x) => (x ? { ...x } : null));
  const target = next[slot]!;
  target.quantity -= quantity;
  if (target.quantity === 0) next[slot] = null;
  return { ok: true, slots: next, removed: { ...s, quantity } };
}

/**
 * Remove `quantity` of an item spread over any number of stacks (smallest
 * stacks first, any quality). All-or-nothing.
 */
export function removeItemById(slots: Slots, itemId: string, quantity: number): Result<{ slots: Slots; changed: number[]; removed: { slot: number; quality: number; quantity: number }[] }> {
  if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, error: 'Invalid quantity.' };
  if (countItem(slots, itemId) < quantity) return { ok: false, error: 'Not enough items.' };
  const next = slots.map((x) => (x ? { ...x } : null));
  const order = next
    .map((s, i) => ({ s, i }))
    .filter((x): x is { s: SlotItem; i: number } => !!x.s && x.s.itemId === itemId)
    .sort((a, b) => a.s.quantity - b.s.quantity || a.s.quality - b.s.quality);
  let left = quantity;
  const changed: number[] = [];
  const removed: { slot: number; quality: number; quantity: number }[] = [];
  for (const { s, i } of order) {
    if (left === 0) break;
    const take = Math.min(left, s.quantity);
    s.quantity -= take;
    left -= take;
    if (s.quantity === 0) next[i] = null;
    changed.push(i);
    removed.push({ slot: i, quality: s.quality, quantity: take });
  }
  return { ok: true, slots: next, changed, removed };
}

/** Move a stack: into an empty slot, merge with a matching stack, or swap. */
export function moveItem(slots: Slots, from: number, to: number, lookup: ItemLookup): Result<{ slots: Slots; changed: number[] }> {
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < slots.length;
  if (!valid(from) || !valid(to)) return { ok: false, error: 'Invalid slot.' };
  if (from === to) return { ok: true, slots, changed: [] };
  const src = slots[from];
  if (!src) return { ok: false, error: 'That slot is empty.' };
  const next = slots.map((x) => (x ? { ...x } : null));
  const dst = next[to];
  const stackSize = lookup(src.itemId)?.stackSize ?? 1;

  if (!dst) {
    next[to] = next[from]!;
    next[from] = null;
  } else if (canStackTogether(dst, src, stackSize) && dst.quantity < stackSize) {
    const take = Math.min(stackSize - dst.quantity, src.quantity);
    dst.quantity += take;
    const left = src.quantity - take;
    next[from] = left > 0 ? { ...src, quantity: left } : null;
  } else {
    next[to] = next[from]!;
    next[from] = dst;
  }
  return { ok: true, slots: next, changed: [from, to] };
}
