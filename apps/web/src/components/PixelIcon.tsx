'use client';

import { useEffect, useState } from 'react';
import { itemIconHd } from '@/game/art/world';

const cache = new Map<string, string>();

/** Renders an item / skill icon (HD, smooth) as an <img>. */
export function PixelIcon({ icon, size = 32, className = '' }: { icon: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(() => cache.get(icon) ?? null);
  useEffect(() => {
    if (cache.has(icon)) return setSrc(cache.get(icon)!);
    const url = itemIconHd(icon, 96).toDataURL();
    cache.set(icon, url);
    setSrc(url);
  }, [icon]);
  if (!src) return <span style={{ width: size, height: size }} className={`inline-block ${className}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt="" className={`inline-block ${className}`} draggable={false} />;
}
