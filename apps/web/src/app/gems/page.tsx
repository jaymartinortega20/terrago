'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { request } from '@/lib/api';

type Order = { status: 'pending' | 'paid' | 'failed' | 'refunded'; gems: number; balance: number };

/** Where players land after the PayMongo checkout. Gems arrive by webhook, so this just waits for them. */
function GemsReturn() {
  const params = useSearchParams();
  const id = params.get('order') ?? '';
  const cancelled = params.get('status') === 'cancelled';
  const fake = params.get('fake') === '1';
  const [order, setOrder] = useState<Order | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!id || cancelled || order?.status === 'paid') return;
    const t = setTimeout(
      () =>
        request<Order>(`/api/gems/order?id=${encodeURIComponent(id)}`)
          .then((o) => {
            setOrder(o);
            setTries((n) => n + 1);
          })
          .catch((e: Error) => setErr(e.message)),
      tries ? 2500 : 0,
    );
    return () => clearTimeout(t);
  }, [id, cancelled, order?.status, tries]);

  const fakePay = async () => {
    await request('/api/gems/fake-pay', { method: 'POST', body: JSON.stringify({ orderId: id }) }).catch((e: Error) => setErr(e.message));
    setTries((n) => n + 1);
  };

  let title = 'Checking your payment…';
  let text = 'This usually takes a few seconds. You can close this tab — your Gems will appear in the game as soon as the payment clears.';
  if (cancelled) {
    title = 'Payment cancelled';
    text = 'No money was taken. You can try again from the Gem Shop any time.';
  } else if (order?.status === 'paid') {
    title = `💎 ${order.gems.toLocaleString()} Gems added!`;
    text = `Your balance is now ${order.balance.toLocaleString()} Gems. Thank you for supporting TerraGo! Close this tab and go back to the game.`;
  } else if (order?.status === 'failed') {
    title = 'Payment failed';
    text = 'Nothing was charged. Please try again from the Gem Shop.';
  } else if (tries > 24) {
    text = 'Still waiting for the payment to clear. If you paid, your Gems will arrive automatically — no need to pay again. Contact support with your order number if they do not arrive within an hour.';
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#141a2c] p-4">
      <section className="px-panel w-[min(94vw,440px)] p-5 text-center" data-testid="gems-return">
        <h1 className="text-xl font-bold text-wood-dark">{title}</h1>
        <p className="mt-2 text-sm leading-snug">{text}</p>
        {err && <p className="mt-2 text-sm text-[#b8402f]">{err}</p>}
        {fake && order?.status === 'pending' && (
          <button className="px-btn green mt-3" onClick={() => void fakePay()} data-testid="fake-pay">
            Pretend to pay (development)
          </button>
        )}
        {id && <p className="mt-3 text-[11px] text-wood-dark/60">Order {id}</p>}
        <Link href="/characters" className="px-btn mt-3 inline-block">
          Back to TerraGo
        </Link>
      </section>
    </main>
  );
}

export default function GemsPage() {
  return (
    <Suspense>
      <GemsReturn />
    </Suspense>
  );
}
