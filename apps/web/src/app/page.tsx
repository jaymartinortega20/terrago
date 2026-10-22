import Link from 'next/link';
import { HeroScene } from '@/components/HeroScene';
import { PixelIcon } from '@/components/PixelIcon';
import { SiteHeader } from '@/components/SiteHeader';

const FEATURES = [
  {
    id: 'farming',
    title: 'Farming',
    icon: 'carrot',
    status: 'Next: v0.2',
    body: 'Claim a homestead off the Whispering Fields lane. Till, plant, water and harvest — crops keep growing while you are offline. Quality matters: a Gold-quality harvest is worth far more than a common one.',
  },
  {
    id: 'combat',
    title: 'Combat',
    icon: 'hoe',
    status: 'Planned: v0.5',
    body: 'Real-time battles as a Warrior, Ranger, Mage, Priest or Rogue. Monsters five levels above you are dangerous; fifteen above, you will want friends.',
  },
  {
    id: 'trading',
    title: 'Trading',
    icon: 'ore_copper',
    status: 'Planned: v0.4',
    body: 'A player-driven economy. List goods on the marketplace, trade face to face, open a stall. Shops pay pennies — other players pay what things are really worth.',
  },
  {
    id: 'crafting',
    title: 'Crafting',
    icon: 'log',
    status: 'Planned',
    body: 'Wheat becomes flour becomes bread. Iron ore becomes ingots becomes a blade. Specialise as a smith, alchemist or cook and become the person others depend on.',
  },
] as const;

const FAQ = [
  {
    q: 'Is TerraGo free to play?',
    a: 'Yes. TerraGo will never sell power: no best weapons, no levels, no tradable gold for cash. Anything sold later will be cosmetic or convenience only.',
  },
  {
    q: 'Do I need to download anything?',
    a: 'No. TerraGo runs in Chrome, Edge, Firefox and Safari on desktop, and in mobile browsers with on-screen touch controls.',
  },
  {
    q: 'Can I earn real money playing?',
    a: 'No. TerraGo is a game, not an income source. Any rewards are in-game only and have no cash value.',
  },
  {
    q: 'What can I do right now?',
    a: 'TerraGo is in early development (v0.1). You can create a character, explore six maps from Oakhaven to the Infernal Caldera with other players, chat, meet the townsfolk and manage your bag. Farming arrives next.',
  },
  {
    q: 'Is my progress saved?',
    a: 'Yes. Your character, position and inventory are stored on the server. Refresh, log out or switch devices and pick up where you left off.',
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-dvh">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden border-b-4 border-ink">
        <HeroScene className="absolute inset-0 h-full w-full object-cover opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-b from-night/40 via-night/10 to-night/85" />
        <div className="relative mx-auto flex min-h-[78dvh] max-w-5xl flex-col items-center justify-center px-4 py-24 text-center">
          <h1 className="text-outline text-6xl font-bold tracking-wider text-gold sm:text-8xl">TERRAGO</h1>
          <p className="text-outline mt-4 text-2xl font-bold text-parchment sm:text-3xl">Farm. Trade. Fight. Grow.</p>
          <p className="text-outline mt-3 max-w-xl text-base text-parchment/90 sm:text-lg">
            A multiplayer pixel world in your browser. Start with almost nothing — become a famous farmer, a master smith, a monster hunter or a merchant prince.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link href="/characters" className="px-btn green text-lg">
              ▶ PLAY NOW
            </Link>
            <Link href="/register" className="px-btn text-lg">
              CREATE ACCOUNT
            </Link>
          </div>
          <p className="text-outline mt-6 text-sm text-parchment/80">Version 0.1 · Early development · No download needed</p>
        </div>
      </section>

      {/* About */}
      <section id="about" className="mx-auto max-w-5xl px-4 py-16">
        <div className="px-panel p-6 sm:p-8">
          <h2 className="text-3xl font-bold text-wood-dark">About TerraGo</h2>
          <p className="mt-3 text-lg leading-relaxed">
            TerraGo is a living online world where progress is earned. New arrivals are weak and nearly broke. After a few sessions you are capable; after a few weeks,
            established; after months, you might be wealthy, powerful or famous. Professions matter, rare items are genuinely rare, and the economy is built by players.
          </p>
          <p className="mt-3 text-lg font-bold text-leaf-dark">Time + Skill + Knowledge + Cooperation = Progress.</p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto grid max-w-5xl gap-6 px-4 pb-8 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <article key={f.id} id={f.id} className="px-panel p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center border-2 border-ink bg-parchment-2">
                <PixelIcon icon={f.icon} size={32} />
              </span>
              <h3 className="text-2xl font-bold text-wood-dark">{f.title}</h3>
              <span className="ml-auto border-2 border-ink bg-night-3 px-2 py-0.5 text-xs text-parchment">{f.status}</span>
            </div>
            <p className="mt-3 leading-relaxed">{f.body}</p>
          </article>
        ))}
      </section>

      {/* World */}
      <section id="world" className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="text-outline text-3xl font-bold text-gold">The World</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            ['Oakhaven Sanctuary', 'The safe town hub: quest givers, the blacksmith, crafting stations, the market and a pond full of rare catches.', 'Town'],
            ['Whispering Fields', 'Slimes, goblins and wolves, levels 1–40. Gnarlfang guards the Job Trainer at the far end.', 'Lv 1–40'],
            ['Desolate Crags', 'Cracked stone and living rock. Ore veins and the first upgrade gems.', 'Lv 41–70'],
            ['Glacial Depths', 'Frozen caverns with rare ore and high-tier gems, guarded by frost giants.', 'Lv 71–99'],
            ["Dragon's Peak", 'Level 100 drakes, dragon knights and champions.', 'Lv 100'],
            ['The Infernal Caldera', 'Raid lair of Pyraxis, the Infernal Titan.', 'Raid'],
          ].map(([name, text, status]) => (
            <div key={name} className="px-panel-dark p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gold">{name}</h3>
                <span className={`text-xs ${status === 'Town' ? 'text-leaf' : 'text-parchment/60'}`}>{status}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-parchment/85">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Community */}
      <section id="community" className="mx-auto max-w-5xl px-4 py-12">
        <div className="px-panel-dark p-6 sm:p-8">
          <h2 className="text-3xl font-bold text-gold">Community</h2>
          <p className="mt-3 leading-relaxed text-parchment/90">
            Every player you see in Oakhaven is a real person. Say hello at the fountain, form a party, start a guild. Chat has filters, rate limits, and mute, block and
            report tools are on the roadmap — be kind, trade fair, and help newcomers find their feet.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-4 py-12">
        <h2 className="text-outline text-3xl font-bold text-gold">FAQ</h2>
        <div className="mt-6 space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="px-panel group p-4">
              <summary className="cursor-pointer list-none text-lg font-bold text-wood-dark">
                <span className="mr-2 inline-block transition-transform group-open:rotate-90">▶</span>
                {f.q}
              </summary>
              <p className="mt-2 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-20 text-center">
        <Link href="/register" className="px-btn green text-xl">
          Begin your journey
        </Link>
      </section>

      <footer className="border-t-4 border-ink bg-night-2 py-6 text-center text-sm text-parchment/60">
        TerraGo v0.1 · All art and world content are original · Made for the browser
      </footer>
    </main>
  );
}
