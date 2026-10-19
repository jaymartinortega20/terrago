import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { afterHarvest, cropGrowth, cropStatus, removeItemById, rollQuality, waterCrop, type CropDef, type CropState, type Slots } from '../src';

const MIN = 60_000;
const carrot: CropDef = {
  id: 'carrot',
  name: 'Carrot',
  seedItem: 'carrot_seed',
  produceItem: 'carrot',
  growthMs: 4 * MIN,
  regrowMs: null,
  harvestsMax: null,
  levelRequired: 1,
  xp: 6,
  yield: [1, 1],
  quality: [0.86, 0.11, 0.025, 0.005, 0],
  seasons: ['spring'],
  art: { leaf: '#000', fruit: '#000', shape: 'root' },
};
const tomato: CropDef = { ...carrot, id: 'tomato', growthMs: 12 * MIN, regrowMs: 5 * MIN, harvestsMax: 4 };

const T0 = 1_000_000_000_000;
const planted = (over: Partial<CropState> = {}): CropState => ({
  cropId: 'carrot',
  growthDone: 0,
  progressAt: T0,
  waterUntil: 0,
  speed: 1,
  fertilizer: null,
  harvests: 0,
  ...over,
});

describe('crop growth from timestamps', () => {
  test('dry soil: no growth, however long you wait', () => {
    assert.equal(cropGrowth(planted(), carrot, T0 + 600 * MIN), 0);
    assert.equal(cropStatus(planted(), carrot, T0 + 600 * MIN).ready, false);
  });

  test('wet soil: grows in real time, ready after growthMs, even while offline', () => {
    const c = waterCrop(planted(), carrot, T0, 60 * MIN);
    assert.equal(cropStatus(c, carrot, T0 + 2 * MIN).ready, false);
    assert.equal(Math.round(cropStatus(c, carrot, T0 + 2 * MIN).progress * 100), 50);
    assert.equal(cropStatus(c, carrot, T0 + 4 * MIN).ready, true);
    assert.equal(cropStatus(c, carrot, T0 + 3 * 24 * 60 * MIN).ready, true);
  });

  test('growth stops when the soil dries, and resumes after watering', () => {
    const tom = { ...planted(), cropId: 'tomato' };
    let c = waterCrop(tom, tomato, T0, 5 * MIN); // wet for 5 minutes
    assert.equal(cropGrowth(c, tomato, T0 + 60 * MIN), 5 * MIN);
    c = waterCrop(c, tomato, T0 + 60 * MIN, 60 * MIN);
    assert.equal(cropGrowth(c, tomato, T0 + 67 * MIN), 12 * MIN);
    assert.equal(cropStatus(c, tomato, T0 + 67 * MIN).ready, true);
  });

  test('fertilizer speed applies to wet time', () => {
    const c = { ...waterCrop(planted(), carrot, T0, 60 * MIN), speed: 1.25 };
    assert.equal(cropGrowth(c, carrot, T0 + 2 * MIN), 2.5 * MIN);
  });

  test('stages go 0..3 and only the last is ready', () => {
    const c = waterCrop(planted(), carrot, T0, 60 * MIN);
    const stages = [0, 1, 2, 3, 3.99, 4].map((m) => cropStatus(c, carrot, T0 + m * MIN).stage);
    assert.deepEqual(stages, [0, 0, 1, 2, 2, 3]);
  });

  test('regrowing crops come back a few times, then are spent', () => {
    let c: CropState | null = { ...planted(), cropId: 'tomato' };
    for (let i = 0; i < 3; i++) {
      c = afterHarvest(c!, tomato, T0);
      assert.ok(c);
      assert.equal(c.growthDone, 7 * MIN);
    }
    assert.equal(afterHarvest(c!, tomato, T0), null);
    assert.equal(afterHarvest(planted(), carrot, T0), null);
  });
});

describe('quality rolls', () => {
  test('higher skill shifts quality upwards', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const avg = (lvl: number) => {
      let sum = 0;
      for (let i = 0; i < 4000; i++) sum += rollQuality(carrot.quality, lvl, 1, 0, rand);
      return sum / 4000;
    };
    assert.ok(avg(30) > avg(1) * 1.5, `${avg(30)} vs ${avg(1)}`);
  });

  test('always returns a valid tier', () => {
    for (const r of [0, 0.5, 0.999999]) {
      const q = rollQuality(carrot.quality, 100, 1, 0.5, () => r);
      assert.ok(q >= 0 && q <= 4);
    }
  });
});

describe('removing items across stacks', () => {
  const slots: Slots = [
    { itemId: 'stone', quantity: 30, quality: 0, durability: null, bound: false },
    null,
    { itemId: 'stone', quantity: 5, quality: 0, durability: null, bound: false },
    { itemId: 'log', quantity: 2, quality: 0, durability: null, bound: false },
  ];
  test('takes from the smallest stacks first, all or nothing', () => {
    const r = removeItemById(slots, 'stone', 10);
    assert.ok(r.ok);
    assert.equal(r.slots[2], null);
    assert.equal(r.slots[0]!.quantity, 25);
    assert.equal(removeItemById(slots, 'stone', 36).ok, false);
    assert.equal(slots[0]!.quantity, 30, 'input not mutated');
  });
});
