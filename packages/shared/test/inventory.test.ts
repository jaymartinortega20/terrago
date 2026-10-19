import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addItem, countItem, emptySlots, fromInventorySlots, moveItem, removeFromSlot, toInventorySlots, type Slots } from '../src/inventory';

const bread = { itemId: 'bread', quality: 0, durability: null, bound: false };
const hoe = { itemId: 'worn_hoe', quality: 0, durability: 100, bound: false };
const lookup = (id: string) => ({ stackSize: id === 'bread' ? 50 : 1 });

function unwrap<T>(r: { ok: true } & T | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('addItem', () => {
  test('stacks into existing stacks before using empty slots', () => {
    let slots: Slots = emptySlots(5);
    slots = unwrap(addItem(slots, bread, 30, 50)).slots;
    const r = unwrap(addItem(slots, bread, 30, 50));
    assert.equal(r.slots[0]?.quantity, 50);
    assert.equal(r.slots[1]?.quantity, 10);
    assert.deepEqual(r.changed, [0, 1]);
    assert.equal(countItem(r.slots, 'bread'), 60);
  });

  test('different quality does not stack', () => {
    let slots = unwrap(addItem(emptySlots(3), bread, 5, 50)).slots;
    slots = unwrap(addItem(slots, { ...bread, quality: 2 }, 5, 50)).slots;
    assert.equal(slots[0]?.quality, 0);
    assert.equal(slots[1]?.quality, 2);
  });

  test('items with durability never stack', () => {
    let slots = unwrap(addItem(emptySlots(3), hoe, 1, 1)).slots;
    slots = unwrap(addItem(slots, hoe, 1, 1)).slots;
    assert.equal(slots[0]?.quantity, 1);
    assert.equal(slots[1]?.quantity, 1);
  });

  test('all-or-nothing refuses when full and leaves the input untouched', () => {
    const slots = unwrap(addItem(emptySlots(2), bread, 100, 50)).slots;
    const before = JSON.stringify(slots);
    const r = addItem(slots, bread, 1, 50);
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(slots), before);
  });

  test('rejects nonsense quantities', () => {
    assert.equal(addItem(emptySlots(2), bread, 0, 50).ok, false);
    assert.equal(addItem(emptySlots(2), bread, -5, 50).ok, false);
    assert.equal(addItem(emptySlots(2), bread, 1.5, 50).ok, false);
  });
});

describe('removeFromSlot', () => {
  test('removes and clears empty stacks', () => {
    const slots = unwrap(addItem(emptySlots(2), bread, 3, 50)).slots;
    const r1 = unwrap(removeFromSlot(slots, 0, 2));
    assert.equal(r1.slots[0]?.quantity, 1);
    const r2 = unwrap(removeFromSlot(r1.slots, 0, 1));
    assert.equal(r2.slots[0], null);
  });

  test('refuses to remove more than present', () => {
    const slots = unwrap(addItem(emptySlots(2), bread, 3, 50)).slots;
    assert.equal(removeFromSlot(slots, 0, 4).ok, false);
    assert.equal(removeFromSlot(slots, 1, 1).ok, false);
    assert.equal(removeFromSlot(slots, 9, 1).ok, false);
  });
});

describe('moveItem', () => {
  test('moves into empty slot', () => {
    const slots = unwrap(addItem(emptySlots(4), bread, 3, 50)).slots;
    const r = unwrap(moveItem(slots, 0, 3, lookup));
    assert.equal(r.slots[0], null);
    assert.equal(r.slots[3]?.quantity, 3);
  });

  test('merges matching stacks up to the stack size', () => {
    let slots: Slots = emptySlots(3);
    slots[0] = { ...bread, quantity: 40 };
    slots[1] = { ...bread, quantity: 30 };
    const r = unwrap(moveItem(slots, 1, 0, lookup));
    assert.equal(r.slots[0]?.quantity, 50);
    assert.equal(r.slots[1]?.quantity, 20);
  });

  test('swaps different items', () => {
    const slots: Slots = [{ ...bread, quantity: 2 }, { ...hoe, quantity: 1 }];
    const r = unwrap(moveItem(slots, 0, 1, lookup));
    assert.equal(r.slots[0]?.itemId, 'worn_hoe');
    assert.equal(r.slots[1]?.itemId, 'bread');
  });

  test('total item count is conserved by moves (no duplication)', () => {
    let slots: Slots = emptySlots(6);
    slots = unwrap(addItem(slots, bread, 77, 50)).slots;
    slots = unwrap(addItem(slots, hoe, 1, 1)).slots;
    for (let i = 0; i < 200; i++) {
      const r = moveItem(slots, (i * 7) % 6, (i * 5 + 1) % 6, lookup);
      if (r.ok) slots = r.slots;
    }
    assert.equal(countItem(slots, 'bread'), 77);
    assert.equal(countItem(slots, 'worn_hoe'), 1);
  });

  test('round-trips through the wire format', () => {
    const slots = unwrap(addItem(emptySlots(4), bread, 3, 50)).slots;
    assert.deepEqual(fromInventorySlots(toInventorySlots(slots), 4), slots);
  });
});
