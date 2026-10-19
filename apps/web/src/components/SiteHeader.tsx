import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b-4 border-ink bg-night-2/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <Link href="/" className="text-outline text-2xl font-bold tracking-wider text-gold">
          TERRAGO
        </Link>
        <nav className="ml-4 hidden gap-4 text-sm text-parchment/80 md:flex">
          <a href="#about" className="hover:text-gold">About</a>
          <a href="#farming" className="hover:text-gold">Farming</a>
          <a href="#trading" className="hover:text-gold">Trading</a>
          <a href="#world" className="hover:text-gold">World</a>
          <a href="#faq" className="hover:text-gold">FAQ</a>
        </nav>
        <div className="ml-auto flex gap-2">
          <Link href="/login" className="px-btn ghost small">
            Log in
          </Link>
          <Link href="/characters" className="px-btn green small">
            Play
          </Link>
        </div>
      </div>
    </header>
  );
}
