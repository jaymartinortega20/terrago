import Link from 'next/link';
import { Logo } from './Logo';
import { PlayLink } from './PlayLink';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-night/55 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
        <Link href="/" aria-label="Terago Online home">
          <Logo size="sm" />
        </Link>
        <nav className="ml-6 hidden gap-6 text-sm font-semibold text-parchment/75 md:flex">
          {[
            ['#story', 'Story'],
            ['#classes', 'Classes'],
            ['#world', 'World'],
            ['#features', 'Features'],
            ['#roadmap', 'Roadmap'],
            ['#faq', 'FAQ'],
          ].map(([h, t]) => (
            <a key={h} href={h} className="transition hover:text-gold">
              {t}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex gap-2">
          <Link href="/login" className="px-btn ghost small">
            Log in
          </Link>
          <PlayLink className="px-btn green small">Play free</PlayLink>
        </div>
      </div>
    </header>
  );
}
