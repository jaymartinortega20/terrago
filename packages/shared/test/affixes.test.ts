import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addItem, affixPool, affixText, combatProfile, emptySlots, rollAffixes, setBonuses, setOf, type EquipDef } from '../src';

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const sword = { rarity: 'epic' as const, levelRequirement: 50, category: 'weapon', equip: { slot: 'mainhand' } };
const boots = { rarity: 'legendary' as const, levelRequirement: 70, category: 'armor', equip: { slot: 'boots' } };

test('rarer drops roll more affixes; Elites roll one extra; values grow with level', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(rollAffixes(sword, rand).length, 2);
    assert.equal(rollAffixes(sword, rand, { elite: true }).length, 3);
    const c = rollAffixes({ ...sword, rarity: 'common' }, rand).length;
    assert.ok(c === 0 || c === 1);
  }
  const lo = rollAffixes({ ...sword, levelRequirement: 1, rarity: 'mythic' }, () => 0.5);
  const hi = rollAffixes({ ...sword, levelRequirement: 70, rarity: 'mythic' }, () => 0.5);
  const atk = (xs: { stat: string; value: number }[]) => xs.find((a) => a.stat === 'atk' || a.stat === 'matk' || a.stat === 'str')?.value ?? 0;
  assert.ok(atk(hi) >= atk(lo));
  // Pools fit the slot: lifesteal only on weapons, move speed only on boots.
  assert.ok(affixPool(sword).includes('lifesteal') && !affixPool(sword).includes('move'));
  assert.ok(affixPool(boots).includes('move') && !affixPool(boots).includes('lifesteal'));
  assert.deepEqual(rollAffixes({ ...sword, category: 'material', equip: null }, rand), []);
  assert.equal(affixText({ stat: 'crit', value: 3 }), '+3% Critical');
  assert.equal(affixText({ stat: 'hp', value: 40 }), '+40 Max HP');
});

test('different rolls never stack; identical ones do', () => {
  const a = { itemId: 'iron_sword', quality: 0, durability: 160, bound: false, enhance: 0 };
  let slots = emptySlots(4);
  for (const affixes of [[{ stat: 'atk', value: 3 }], [{ stat: 'atk', value: 4 }], [{ stat: 'atk', value: 3 }]]) {
    const r = addItem(slots, { ...a, affixes }, 1, 99);
    assert.ok(r.ok);
    slots = r.slots;
  }
  assert.deepEqual(slots.filter(Boolean).map((s) => s!.quantity), [2, 1]);
});

test('armour sets: 2 and 4 pieces add bonuses; affixes add to your stats', () => {
  assert.equal(setOf('iron_boots')?.id, 'iron');
  assert.equal(setOf('star_metal_shield')?.id, 'star_metal');
  assert.equal(setOf('iron_sword'), undefined);
  assert.deepEqual(setBonuses(['iron_head']), {});
  const two = setBonuses(['iron_head', 'iron_chest']);
  assert.ok((two.hp ?? 0) > 0 && !two.atk);
  const four = setBonuses(['iron_head', 'iron_chest', 'iron_gloves', 'iron_boots']);
  assert.ok((four.atk ?? 0) > 0 && four.hp === two.hp);

  const defs: Record<string, EquipDef> = {
    iron_sword: { slot: 'mainhand', weapon: 'sword', stats: { atk: 10 }, speedMs: 1000 },
    iron_head: { slot: 'head', stats: { def: 2 } },
    iron_chest: { slot: 'chest', stats: { def: 2 } },
    iron_boots: { slot: 'boots', stats: { def: 1 } },
  };
  const base = { strength: 5, agility: 5, intelligence: 5, vitality: 5, luck: 5 };
  const zero = { strength: 0, agility: 0, intelligence: 0, vitality: 0, luck: 0 };
  const hp = { base: 100, perLevel: 10, mpBase: 50, mpPerLevel: 5 };
  const slot = (itemId: string, i: number, affixes?: { stat: string; value: number }[]) => ({ slot: i, itemId, quantity: 1, quality: 0, durability: 100, bound: false, ...(affixes ? { affixes } : {}) });
  const plain = combatProfile(10, base, zero, hp, [slot('iron_sword', 0)], (id) => defs[id]);
  const rolled = combatProfile(10, base, zero, hp, [slot('iron_sword', 0, [{ stat: 'atk', value: 6 }, { stat: 'lifesteal', value: 3 }, { stat: 'aspd', value: 5 }]), slot('iron_boots', 1, [{ stat: 'move', value: 4 }])], (id) => defs[id]);
  assert.equal(rolled.derived.physicalAttack - plain.derived.physicalAttack, 6);
  assert.equal(rolled.lifesteal, 3);
  assert.equal(rolled.derived.attackSpeed - plain.derived.attackSpeed, 5);
  assert.equal(rolled.derived.movementSpeed, 104);
  const set = combatProfile(10, base, zero, hp, [slot('iron_head', 2), slot('iron_chest', 3)], (id) => defs[id]);
  const one = combatProfile(10, base, zero, hp, [slot('iron_head', 2)], (id) => defs[id]);
  assert.equal(set.maxHp - one.maxHp, two.hp);
});
