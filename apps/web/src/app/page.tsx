import Link from 'next/link';
import { HeroScene } from '@/components/HeroScene';
import { PixelIcon } from '@/components/PixelIcon';
import { SiteHeader } from '@/components/SiteHeader';
import { PlayLink, WakeServer } from '@/components/PlayLink';

const VERSION = '2.3';

const FEATURES = [
  {
    id: 'combat',
    title: 'Classes & Combat',
    icon: 'weapon:sword:5',
    status: 'Live',
    body: 'Warrior, Mage, Archer or Acolyte, each with its own Rage, Mana or Energy. At level 40 beat Gnarlfang and become a Paladin, Berserker, Sorcerer, Necromancer, Ranger, Beastmaster, High Priest or Inquisitor. Spend stat points your way, combo skills with flashy effects, and raid Pyraxis for mythic loot.',
  },
  {
    id: 'farming',
    title: 'Farming & Gathering',
    icon: 'carrot',
    status: 'Live',
    body: 'Claim a homestead: till, plant, water and harvest — crops grow while you are offline. Raise chickens, sheep and cows, fish the ponds, mine ore and chop wood. Quality matters: a Gold-quality harvest is worth far more.',
  },
  {
    id: 'trading',
    title: 'Trading & Crafting',
    icon: 'ore_copper',
    status: 'Live',
    body: 'A player-driven economy: the marketplace, face-to-face trades, market stalls and bank vaults. Craft gear and food, specialise at level 40, and upgrade your weapons with gems until they glow.',
  },
  {
    id: 'companions',
    title: 'Mounts & Pets',
    icon: 'mount:stag:dfe6ff',
    status: 'Live',
    body: 'Ride horses, wolves, a wyvern or the Celestial Stag, each with speed and terrain perks, and dress them with saddles, barding and trails. Pets fight beside you, level up to 100, earn loyalty, learn new skills and evolve twice into Grown and Mythic forms.',
  },
  {
    id: 'adventure',
    title: 'World Bosses & Arena',
    icon: 'scale:a83a2a',
    status: 'New in 2.3',
    body: 'Every three hours a world boss appears and the whole server fights it. Climb the ranked 1v1 arena each season, find a group in the party finder, take daily bounties and story quests on every map, and chase gear with random bonus stats and set bonuses.',
  },
] as const;

/** What is finished, and what comes next. */
const ROADMAP: { v: string; name: string; text: string; state: 'done' | 'now' | 'next' | 'later' }[] = [
  { v: '0.1', name: 'The world', text: 'Accounts, characters, Oakhaven, multiplayer movement and chat.', state: 'done' },
  { v: '0.2', name: 'Farming', text: 'Homesteads, crops, watering, quality and offline growth.', state: 'done' },
  { v: '0.3', name: 'Gathering & crafting', text: 'Mining, woodcutting, fishing and crafting stations.', state: 'done' },
  { v: '0.4', name: 'Trading', text: 'Player marketplace and face-to-face trades.', state: 'done' },
  { v: '0.5', name: 'Combat', text: 'Real-time fights, skills, equipment and upgrades.', state: 'done' },
  { v: '0.6', name: 'Social', text: 'Parties, friends, guilds, chat channels, mute/block/report.', state: 'done' },
  { v: '0.7–0.9', name: 'Dungeons, seasons, progress', text: 'Dungeons and bosses, day/night and weather, dailies, achievements and leaderboards.', state: 'done' },
  { v: '1.0–1.1', name: 'Launch & endgame', text: 'Music and sound, phone controls, professions, bank, stalls, world events, level 100.', state: 'done' },
  { v: '2.0', name: 'The great revision', text: 'Four classes and eight second jobs, the six-map world, gem upgrades, wings, combat pets and the Pyraxis raid.', state: 'done' },
  { v: '2.1', name: 'Mounts, pets & HUD', text: 'Stable with 3D preview, mount gear, pet levels and loyalty, the ornate HUD and spell effects.', state: 'done' },
  { v: '2.2', name: 'HD-2D graphics', text: 'Pixel art with depth: sun shadows, richer colour, sunbeams and depth haze — tuned to run on low-end PCs, with an Ultra mode for gaming GPUs.', state: 'done' },
  { v: '2.3', name: 'Adventure update', text: '50-slot bags that stack, a faster first hour, minimap and auto-pickup, Elites and new late-map monsters, random gear stats and sets, story chains, bounties and auto-walk, world bosses, party finder, guild quests, food buffs, pet evolution and the ranked arena.', state: 'now' },
  { v: '2.4', name: 'Polish & balance', text: 'Boss and levelling balance from real play, more arena seasons and rewards, glass menus everywhere.', state: 'next' },
  { v: '3.0', name: 'Full 3D', text: 'Low-poly floating islands, 3D chibi characters and visible gear.', state: 'later' },
];

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
    a: 'Almost everything: pick one of four classes and a second job at 40, explore six maps from Oakhaven to the Infernal Caldera, farm, fish, mine, craft, trade, join a guild, ride mounts, raise and evolve pets, fight world bosses, climb the ranked arena, run dungeons and raid Pyraxis. TerraGo is in open alpha (v2.3), so expect balance changes.',
  },
  {
    q: 'Is my progress saved?',
    a: 'Yes. Your character, position and inventory are stored on the server. Refresh, log out or switch devices and pick up where you left off.',
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-dvh">
      <WakeServer />
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
            <PlayLink className="px-btn green text-lg">▶ PLAY NOW</PlayLink>
            <Link href="/register" className="px-btn text-lg">
              CREATE ACCOUNT
            </Link>
          </div>
          <p className="text-outline mt-6 text-sm text-parchment/80">Version {VERSION} · Open alpha · No download needed</p>
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

      {/* Roadmap */}
      <section id="roadmap" className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="text-outline text-3xl font-bold text-gold">Roadmap</h2>
        <p className="mt-2 text-parchment/80">Where TerraGo is now, and what is next.</p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2">
          {ROADMAP.map((r) => (
            <li
              key={r.v}
              className={`px-panel-dark flex gap-3 p-4 ${r.state === 'now' ? 'ring-4 ring-gold' : ''}`}
              data-testid={`roadmap-${r.state}`}
            >
              <span className={`mt-0.5 shrink-0 text-xl ${r.state === 'done' ? 'text-leaf' : r.state === 'now' ? 'text-gold' : 'text-parchment/40'}`} aria-hidden>
                {r.state === 'done' ? '✔' : r.state === 'now' ? '★' : '○'}
              </span>
              <div>
                <p className="font-bold text-parchment">
                  v{r.v} · {r.name}
                  <span className={`ml-2 text-xs ${r.state === 'done' ? 'text-leaf' : r.state === 'now' ? 'text-gold' : 'text-parchment/50'}`}>
                    {r.state === 'done' ? 'Done' : r.state === 'now' ? 'Just released' : r.state === 'next' ? 'Next' : 'Later'}
                  </span>
                </p>
                <p className="mt-1 text-sm text-parchment/80">{r.text}</p>
              </div>
            </li>
          ))}
        </ol>
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
            report tools — be kind, trade fair, and help newcomers find their feet.
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
        <PlayLink className="px-btn green text-xl">Begin your journey</PlayLink>
      </section>

      <footer className="border-t-4 border-ink bg-night-2 py-6 text-center text-sm text-parchment/60">
        TerraGo v{VERSION} · All art and world content are original · Made for the browser
      </footer>
    </main>
  );
}
