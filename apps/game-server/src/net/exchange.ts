import { getItem } from '@terrago/game-data';
import { EXCHANGES, OUTFITS, addItem, countItem, removeItemById, type ExchangeId, type ExchangeView } from '@terrago/shared';
import { GameError, withTransaction } from '../db';
import { loadSlots, lockCharacter, toState, writeSlots } from '../services/inventory';
import { logItemMovement } from '../services/ledger';
import type { Player } from '../world/player';
import { npcService, pushInventory, type GameplayDeps } from './gameplay';

/**
 * Exchanges for activity currencies. Arena and Rift exchanges open from their
 * own windows; the Seal Exchange is at the bounty boards.
 */

function exchangeOf(id: unknown): (typeof EXCHANGES)[ExchangeId] {
  const ex = EXCHANGES[id as ExchangeId];
  if (!ex) throw new GameError('Unknown exchange.');
  return ex;
}

async function owned(deps: GameplayDeps, p: Player, which: ExchangeId): Promise<string[]> {
  const ex = EXCHANGES[which];
  const [skins, styles] = await Promise.all([
    deps.pool.query<{ outfit: number }>(`SELECT outfit FROM character_skins WHERE character_id = $1`, [p.id]),
    deps.pool.query<{ style_id: string }>(`SELECT style_id FROM character_mount_styles WHERE character_id = $1`, [p.id]),
  ]);
  const outfits = new Set(skins.rows.map((r) => r.outfit));
  const st = new Set(styles.rows.map((r) => r.style_id));
  return ex.offers
    .filter((o) => (o.give.kind === 'outfit' && outfits.has(OUTFITS.findIndex((x) => x.name === (o.give as { ref: string }).ref))) || (o.give.kind === 'mount_style' && st.has(o.give.ref)))
    .map((o) => o.id);
}

export const exchange = {
  async get(deps: GameplayDeps, p: Player, req: unknown): Promise<ExchangeView> {
    const r = (req ?? {}) as { which?: unknown; npcId?: unknown };
    const ex = exchangeOf(r.which);
    if (ex.id === 'bounty') npcService(deps.world, p, r.npcId, 'bounty');
    const slots = deps.world.inventoryCache.get(p.id)?.slots ?? [];
    const balance = slots.filter((s) => s.itemId === ex.currency).reduce((n, s) => n + s.quantity, 0);
    return { def: ex, balance, owned: await owned(deps, p, ex.id) };
  },

  async buy(deps: GameplayDeps, p: Player, req: unknown): Promise<ExchangeView & { message: string }> {
    const r = (req ?? {}) as { which?: unknown; offer?: unknown; npcId?: unknown };
    const ex = exchangeOf(r.which);
    if (ex.id === 'bounty') npcService(deps.world, p, r.npcId, 'bounty');
    const offer = ex.offers.find((o) => o.id === r.offer);
    if (!offer) throw new GameError('That is not on offer.');
    const inv = await withTransaction(deps.pool, async (tx) => {
      const { gold } = await lockCharacter(tx, p.id);
      const { capacity, slots } = await loadSlots(tx, p.id);
      if (countItem(slots, ex.currency) < offer.cost) throw new GameError(`You need ${offer.cost} ${ex.currencyName}.`);
      const paid = removeItemById(slots, ex.currency, offer.cost);
      if (!paid.ok) throw new GameError(paid.error);
      let next = paid.slots;
      const changed = new Set(paid.changed);
      const g = offer.give;
      if (g.kind === 'item') {
        const def = getItem(g.itemId)!;
        const res = addItem(next, { itemId: def.id, quality: 0, durability: def.maxDurability, bound: def.bind === 'pickup', enhance: 0 }, g.quantity, def.stackSize);
        if (!res.ok) throw new GameError('Make some room in your bag first.');
        next = res.slots;
        res.changed.forEach((i) => changed.add(i));
        await logItemMovement(tx, { itemId: def.id, quantity: g.quantity, to: p.id, reason: 'npc_purchase', ref: { type: 'exchange', id: offer.id } });
      } else if (g.kind === 'outfit') {
        const idx = OUTFITS.findIndex((o) => o.name === g.ref);
        const ins = await tx.query(`INSERT INTO character_skins (character_id, outfit) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [p.id, idx]);
        if (!ins.rowCount) throw new GameError(`You already own ${offer.label}.`);
      } else {
        const ins = await tx.query(`INSERT INTO character_mount_styles (character_id, style_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [p.id, g.ref]);
        if (!ins.rowCount) throw new GameError(`You already own ${offer.label}.`);
      }
      await logItemMovement(tx, { itemId: ex.currency, quantity: offer.cost, from: p.id, reason: 'npc_sale', ref: { type: 'exchange', id: offer.id } });
      await writeSlots(tx, p.id, next, [...changed]);
      return toState(capacity, gold, next);
    });
    pushInventory(deps.world, p, inv);
    const where = offer.give.kind === 'outfit' ? ' Wear it from the Wardrobe.' : offer.give.kind === 'mount_style' ? ' Put it on in the Stable (Shift+Z).' : '';
    return { ...(await exchange.get(deps, p, { which: ex.id, npcId: r.npcId })), message: `Got ${offer.label}!${where}` };
  },
};
