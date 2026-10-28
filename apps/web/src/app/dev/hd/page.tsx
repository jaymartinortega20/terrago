'use client';

import { notFound } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** Dev-only preview of baked HD sprite sheets. */
export default function HdPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('baking…');
  useEffect(() => {
    let dead = false;
    (async () => {
      const { bakeHero } = await import('@/game/hd/heroes');
      const mode = new URLSearchParams(location.search).get('m') ?? 'heroes';
      if (mode === 'scenery') {
        const { bakeProp, bakeBuilding, bakeNode } = await import('@/game/hd/scenery');
        const { PROP_TYPES } = await import('@terrago/shared');
        const { getMap } = await import('@terrago/game-data');
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;background:#5a9a46;padding:8px';
        box.current?.append(wrap);
        const add = (label: string, a: { canvas: HTMLCanvasElement; w: number; h: number }) => {
          const d = document.createElement('div');
          d.style.cssText = 'font:10px sans-serif;color:#fff;text-align:center';
          a.canvas.style.cssText = `width:${a.w}px;height:${a.h}px;display:block`;
          d.append(a.canvas, label);
          wrap.append(d);
        };
        const map = getMap('greenhaven')!;
        for (const o of map.objects) if (o.kind === 'building') add(o.id, await bakeBuilding(o));
        for (const t of Object.keys(PROP_TYPES)) add(t, await bakeProp(t as never, 0));
        for (const [k, c] of [['rock', '#c87a3a'], ['crystal', '#7fe0d8'], ['tree', '#4f9a3c'], ['herb', '#e86aa0'], ['bush', '#d0302a'], ['mushroom', '#5fd4e6']] as const) add(k, await bakeNode(k, c, false, 3));
        setStatus('done');
        return;
      }
      if (mode === 'mon') {
        const { bakeCreature } = await import('@/game/hd/creatures');
        const { MONSTERS } = await import('@terrago/game-data');
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;background:#5a9a46;padding:8px';
        box.current?.append(wrap);
        for (const m of MONSTERS.slice(0, 40)) {
          const sh = await bakeCreature('monster', m.id, (m as { art?: { shape?: string } }).art?.shape ?? 'slime', '#7ac74f', 1);
          const c = document.createElement('canvas');
          c.width = sh.fw;
          c.height = sh.fh;
          c.getContext('2d')!.drawImage(sh.canvas, 0, 0, sh.fw, sh.fh, 0, 0, sh.fw, sh.fh);
          c.style.cssText = `width:${sh.w}px;height:${sh.h}px;display:block`;
          const d = document.createElement('div');
          d.style.cssText = 'font:10px sans-serif;color:#fff;text-align:center';
          d.append(c, m.id);
          wrap.append(d);
        }
        setStatus('done');
        return;
      }
      const looks = [
        { base: 'knight', appearance: { bodyType: 'a', skinTone: 1, hairStyle: 0, hairColor: 2, eyeColor: 0, outfit: 1 }, weapon: { type: 'sword', tier: 3, glow: 0 }, shield: 3, helm: 3, chest: 3 },
        { base: 'mage', appearance: { bodyType: 'b', skinTone: 0, hairStyle: 2, hairColor: 4, eyeColor: 1, outfit: 3 }, weapon: { type: 'staff', tier: 4, glow: 2 }, wings: { style: 'fairy', color: '#9ad8ff' } },
        { base: 'ranger', appearance: { bodyType: 'a', skinTone: 2, hairStyle: 1, hairColor: 1, eyeColor: 2, outfit: 2 }, weapon: { type: 'bow', tier: 2, glow: 0 }, wings: { style: 'angel', color: '#ffffff' } },
        { base: 'rogue_hooded', appearance: { bodyType: 'b', skinTone: 3, hairStyle: 3, hairColor: 0, eyeColor: 0, outfit: 4 }, weapon: { type: 'dagger', tier: 5, glow: 3 } },
      ] as const;
      for (const l of looks) {
        const t0 = performance.now();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sh = await bakeHero(l as any);
        if (dead) return;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin:8px 0;padding:8px;background:linear-gradient(#5aa04a,#4a8a3c);overflow:auto';
        sh.canvas.style.cssText = `width:${sh.canvas.width / 2}px;height:${sh.canvas.height / 2}px`;
        sh.canvas.dataset.testid = 'sheet';
        const big = document.createElement('canvas');
        big.width = sh.fw * 4;
        big.height = sh.fh;
        const g = big.getContext('2d')!;
        for (let i = 0; i < 4; i++) g.drawImage(sh.canvas, [0, 4, 12, 17][i]! * sh.fw, 0, sh.fw, sh.fh, i * sh.fw, 0, sh.fw, sh.fh);
        big.style.cssText = `width:${big.width}px;height:${big.height}px;display:block`;
        wrap.append(`${l.base} ${Math.round(performance.now() - t0)}ms`, big, sh.canvas);
        box.current?.append(wrap);
      }
      setStatus('done');
    })().catch((e) => setStatus(String(e)));
    return () => {
      dead = true;
    };
  }, []);
  return (
    <main className="min-h-dvh bg-night p-4 text-white">
      <p data-testid="status">{status}</p>
      <div ref={box} />
    </main>
  );
}
