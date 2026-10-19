'use client';

import { useEffect, useState } from 'react';
import { itemIcon } from '@/game/art/world';

const cache = new Map<string, string>();

/** Renders a generated pixel item icon as an <img>. */
export function PixelIcon({ icon, size = 32, className = '' }: { icon: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(() => cache.get(icon) ?? null);
  useEffect(() => {
    if (cache.has(icon)) return setSrc(cache.get(icon)!);
    const url = itemIcon(icon, 2).toDataURL();
    cache.set(icon, url);
    setSrc(url);
  }, [icon]);
  if (!src) return <span style={{ width: size, height: size }} className={`inline-block ${className}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt="" className={`pixel inline-block ${className}`} draggable={false} />;
}
