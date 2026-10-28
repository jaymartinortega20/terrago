import { SiteHeader } from '@/components/SiteHeader';
import { WakeServer } from '@/components/PlayLink';
import { Logo } from '@/components/Logo';
import { SkyScene } from '@/components/SkyScene';
import { BossCountdown, PlayCta, RegisterCta } from '@/components/landing/Cta';
import { LiveCounters, LiveTicker, StatsProvider } from '@/components/landing/LiveTicker';
import { Reveal } from '@/components/landing/reveal';
import { Blip, SoundProvider, SoundToggle } from '@/components/landing/sound';

const VERSION = '3.0';

const STORY = [
  'For a thousand generations, the core of Terago hummed in absolute balance, suspended in a sea of clouds. Its lifeblood — Aetherite Crystals — was protected by the floating island temples.',
  'Then came the Fracture. A violent, unknown surge tore through the lower strata, shattering the crystals and pulling the World Bosses from their dormant slumbers. Darkness spilled into the fields, and the world began to bleed.',
  'You awake as a newly arrived Recruit in Oakhaven Sanctuary, the last standing safe haven. Your memory is fractured, but the call in your veins is clear: mend the crystal core, or watch Terago fall into the endless abyss.',
];

const JOBS = [
  { icon: '🛡️', name: 'Vanguard', role: 'Melee', res: 'Momentum', color: '#ff7a5a', skills: ['Impact Rush', 'Iron Bastion', 'Shockwave Slam'], paths: ['Juggernaut', 'Bulwark'] },
  { icon: '🔥', name: 'Elementalist', role: 'Magic', res: 'Mana', color: '#ff9a3a', skills: ['Pyre Shot', 'Frost Nova', 'Static Rift'], paths: ['Chrono-Mage', 'Pyromancer'] },
  { icon: '🏹', name: 'Wayfinder', role: 'Ranged', res: 'Focus', color: '#4ee08a', skills: ['Steady Shot', 'Concussive Trap', 'Nimble Vault'], paths: ['Sharpshooter', 'Skywarden'] },
  { icon: '☀️', name: 'Channeler', role: 'Support', res: 'Mana', color: '#ffd84a', skills: ['Restorative Beacon', 'Purifying Ward', 'Sol Strike'], paths: ['Hierophant', 'Arbiter'] },
  { icon: '🗡️', name: 'Specter', role: 'Stealth', res: 'Stamina', color: '#b48aff', skills: ['Kinetic Edge', 'Razor Flechette', 'Phantom Veil'], paths: ['Void Blade', 'Trickster'] },
];

const MAPS: [string, string, string, string][] = [
  ['Oakhaven Sanctuary', 'Town hub', '#4ec06a', '#2a6a8a'],
  ['Whispering Fields', 'Lv 1–10', '#8ad85a', '#3a8a4a'],
  ['Echoing Canopy', 'Lv 11–25', '#3a9a5a', '#1a4a3a'],
  ['Sunken Catacombs', 'Lv 25–40', '#6a5a9a', '#1a1a3a'],
  ['Desolate Crags', 'Lv 41–55', '#b8946a', '#5a4a3a'],
  ['Scorched Badlands', 'Lv 50–62', '#f08a3a', '#7a2a1a'],
  ['Sunlit Shoreline', 'Lv 55–68', '#5ad8e8', '#e8c890'],
  ['Glacial Depths', 'Lv 62–75', '#bfeaff', '#4a7ab8'],
  ['Skyward Ridge', 'Lv 76–84', '#9ab8ff', '#5a5ab0'],
  ['Shadowfen Swamp', 'Lv 84–92', '#6a8a4a', '#2a3a2a'],
  ["Dragon's Peak", 'Lv 92–100', '#e86a5a', '#4a1a2a'],
  ['The Infernal Caldera', 'World boss', '#ff5a1a', '#2a0a0a'],
];

const FEATURES: [string, string, string][] = [
  ['⚔️', 'Smart AUTO combat', 'Toggle AUTO (Caps Lock) to scan the whole screen for enemies, path to them, drink potions under your chosen HP and weave in your skills.'],
  ['🎽', 'Every piece of gear shows', 'Helmets, chest plates, boots, weapons and wings layer onto your chibi hero the moment you equip them.'],
  ['✨', 'Six stats, real choices', 'STR, AGI, VIT, INT, DEX and LUK up to 100 each. Enough DEX and your spells go instant — FAST CAST!'],
  ['🗿', 'Waystone network', 'Touch a Waystone to unlock its region, then fast-travel across the twelve islands for a little gold.'],
  ['⏱️', 'World boss schedule', 'A live timetable for every world boss, with a server-wide warning five minutes before each one appears.'],
  ['💎', 'Refinery +1 to +10', 'Mine gems, refine your weapon at the Blacksmith and watch its strikes leave brighter glowing trails.'],
  ['🤝', 'Safe trading', 'Two-step trades — Lock Offer, then Accept — checked by the server so nobody gets scammed.'],
  ['🐉', 'Mounts and companions', 'Press R to ride. Skywardens raise a Gale Falcon that levels from 1 to 100 beside them.'],
];

const ROADMAP: { v: string; name: string; text: string; state: 'done' | 'now' | 'next' }[] = [
  { v: '1.0–2.4', name: 'Foundations', text: 'Real-time multiplayer world, combat, gathering, trading, dungeons, world bosses, mounts, pets and the refinery.', state: 'done' },
  { v: '3.0', name: 'The Fracture — new look', text: 'A brand-new HD interface on every screen: frosted-glass menus, quality-glow items and new damage numbers.', state: 'now' },
  { v: '3.1', name: 'HD chibi graphics', text: 'Hand-shaded HD chibi heroes and monsters, with every helmet, chest piece, boot, weapon and wing visible.', state: 'next' },
  { v: '3.2', name: 'Recruit to master', text: 'Five classes and ten mastery paths, job levels, six stats to 100, fast casting, the 8-slot hotbar and AUTO settings.', state: 'next' },
  { v: '3.3', name: 'Mend the core', text: 'The story intro, main quest Acts I–IV, twelve regions linked by waystones, and the world boss board.', state: 'next' },
];

const FAQ = [
  { q: 'Is Terago Online free?', a: 'Yes. Play in your browser for free — no download, no pay-to-win.' },
  { q: 'Which devices can I play on?', a: 'Chrome, Edge, Firefox and Safari on desktop, plus mobile browsers with on-screen touch controls.' },
  { q: 'What happens to my existing character?', a: 'Your hero comes with you. When the new classes arrive, characters are converted automatically — your level and items stay.' },
  { q: 'Is my progress saved?', a: 'Yes. Everything is stored on the server, so you can switch devices and pick up where you left off.' },
];

export default function LandingPage() {
  return (
    <SoundProvider>
      <StatsProvider>
        <main className="min-h-dvh overflow-x-hidden">
          <WakeServer />
          <SiteHeader />

          {/* Hero */}
          <section className="relative -mt-[57px] overflow-hidden">
            <SkyScene className="absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-b from-night/30 via-transparent to-night" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_42%_at_50%_45%,rgba(10,14,29,.6),transparent)]" />
            <div className="relative mx-auto flex min-h-[100dvh] max-w-5xl flex-col items-center justify-center px-4 pt-24 pb-16 text-center">
              <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-bold tracking-widest text-white uppercase backdrop-blur">
                <span className="h-2 w-2 animate-ping rounded-full bg-sky" /> v{VERSION} · The Fracture
              </span>
              <Logo size="xl" />
              <p className="text-outline mt-6 font-display text-2xl font-semibold text-white sm:text-4xl">Mend the crystal core.</p>
              <p className="text-outline mt-3 max-w-2xl text-base text-white/85 sm:text-lg">
                A real-time fantasy MMORPG above a sea of clouds. Rise from a lost Recruit to a legend — five classes, ten mastery paths, twelve floating regions and the World Bosses the Fracture woke.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <PlayCta>▶ Play free now</PlayCta>
                <RegisterCta />
              </div>
              <LiveCounters />
              <a href="#story" className="mt-10 animate-bounce text-2xl text-white/80 motion-reduce:animate-none" aria-label="Read the story">
                ⌄
              </a>
            </div>
          </section>

          <LiveTicker />

          {/* Story */}
          <section id="story" className="relative mx-auto max-w-4xl scroll-mt-20 px-4 py-20">
            <Reveal className="text-center">
              <p className="text-sm font-bold tracking-[0.35em] text-sky uppercase">The story</p>
              <h2 className="mt-2 text-4xl font-bold text-white sm:text-5xl">The Fracture</h2>
            </Reveal>
            <div className="mt-10 space-y-6">
              {STORY.map((t, i) => (
                <Reveal key={i} delay={i * 120}>
                  <p className="px-panel p-6 text-lg leading-relaxed text-white/90 italic sm:p-8 sm:text-xl">
                    <span className="mr-2 font-display text-3xl text-gold not-italic">{['I', 'II', 'III'][i]}.</span>
                    {t}
                  </p>
                </Reveal>
              ))}
            </div>
          </section>

          {/* Classes */}
          <section id="classes" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
            <Reveal className="text-center">
              <p className="text-sm font-bold tracking-[0.35em] text-sky uppercase">Classes</p>
              <h2 className="mt-2 text-4xl font-bold text-white sm:text-5xl">From Recruit to master</h2>
              <p className="mx-auto mt-3 max-w-2xl text-white/75">
                🔰 Everyone starts as a Recruit. At level 10 choose one of five jobs; at level 40 master one of two paths.
              </p>
            </Reveal>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {JOBS.map((j, i) => (
                <Reveal key={j.name} delay={i * 80}>
                  <Blip s="open">
                    <article className="px-panel group h-full p-5 transition duration-300 hover:-translate-y-2" style={{ boxShadow: `0 10px 40px rgba(2,4,16,.55), 0 0 0 1px ${j.color}33` }}>
                      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full text-4xl transition group-hover:scale-110" style={{ background: `radial-gradient(circle at 35% 30%, ${j.color}cc, ${j.color}33 60%, transparent 72%)`, boxShadow: `0 0 30px ${j.color}66` }}>
                        {j.icon}
                      </div>
                      <h3 className="mt-3 text-center text-2xl font-bold text-white">{j.name}</h3>
                      <p className="text-center text-xs font-bold tracking-widest uppercase" style={{ color: j.color }}>
                        {j.role} · {j.res}
                      </p>
                      <ul className="mt-4 space-y-1 text-sm text-white/85">
                        {j.skills.map((s) => (
                          <li key={s} className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rotate-45" style={{ background: j.color }} /> {s}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-4 border-t border-white/10 pt-3 text-xs text-white/60">Lv 40 → {j.paths.join(' or ')}</p>
                    </article>
                  </Blip>
                </Reveal>
              ))}
            </div>
          </section>

          {/* World */}
          <section id="world" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
            <Reveal className="text-center">
              <p className="text-sm font-bold tracking-[0.35em] text-sky uppercase">The world</p>
              <h2 className="mt-2 text-4xl font-bold text-white sm:text-5xl">Twelve islands in the clouds</h2>
            </Reveal>
            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {MAPS.map(([name, lv, a, b], i) => (
                <Reveal key={name} delay={(i % 4) * 60}>
                  <Blip s="portal">
                    <article className="group relative h-36 overflow-hidden rounded-2xl border border-white/15 shadow-xl transition hover:-translate-y-1">
                      <div className="absolute inset-0 transition duration-700 group-hover:scale-110" style={{ background: `radial-gradient(circle at 30% 20%, ${a}, ${b} 75%)` }} />
                      <div className="absolute -right-6 -bottom-8 h-28 w-28 rounded-full opacity-40 blur-xl" style={{ background: a }} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                      <span className="absolute top-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-bold text-white">Map {i + 1}</span>
                      <span className="absolute top-2 right-2 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur">{lv}</span>
                      <h3 className="text-outline absolute bottom-2 left-3 text-lg font-bold text-white">{name}</h3>
                    </article>
                  </Blip>
                </Reveal>
              ))}
            </div>
          </section>

          {/* Boss countdown */}
          <section className="px-4 py-12">
            <Reveal>
              <BossCountdown />
            </Reveal>
          </section>

          {/* Features */}
          <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
            <Reveal className="text-center">
              <p className="text-sm font-bold tracking-[0.35em] text-sky uppercase">Features</p>
              <h2 className="mt-2 text-4xl font-bold text-white sm:text-5xl">Built to be played</h2>
            </Reveal>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(([icon, title, text], i) => (
                <Reveal key={title} delay={(i % 4) * 70}>
                  <article className="px-panel h-full p-5 transition hover:-translate-y-1">
                    <div className="text-3xl">{icon}</div>
                    <h3 className="mt-2 text-lg font-bold text-gold">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-white/80">{text}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </section>

          {/* Roadmap */}
          <section id="roadmap" className="mx-auto max-w-4xl scroll-mt-20 px-4 py-16">
            <Reveal className="text-center">
              <p className="text-sm font-bold tracking-[0.35em] text-sky uppercase">Roadmap</p>
              <h2 className="mt-2 text-4xl font-bold text-white">What&apos;s live and what&apos;s next</h2>
            </Reveal>
            <ol className="relative mt-10 space-y-4 border-l border-white/15 pl-6">
              {ROADMAP.map((r) => (
                <li key={r.v} data-testid={`roadmap-${r.state}`} className="relative">
                  <span
                    className={`absolute top-5 -left-[31px] h-3.5 w-3.5 rounded-full ${r.state === 'done' ? 'bg-leaf' : r.state === 'now' ? 'animate-pulse bg-gold shadow-[0_0_14px_#ffcb52]' : 'bg-white/30'}`}
                  />
                  <div className={`px-panel p-4 ${r.state === 'now' ? 'ring-1 ring-gold/70' : ''}`}>
                    <p className="font-bold text-white">
                      v{r.v} · {r.name}
                      <span className={`ml-2 text-xs ${r.state === 'done' ? 'text-leaf' : r.state === 'now' ? 'text-gold' : 'text-white/50'}`}>
                        {r.state === 'done' ? 'Done' : r.state === 'now' ? 'Live now' : 'Coming next'}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-white/75">{r.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* FAQ */}
          <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16">
            <h2 className="text-center text-4xl font-bold text-white">FAQ</h2>
            <div className="mt-8 space-y-3">
              {FAQ.map((f) => (
                <Blip key={f.q} s="click">
                  <details className="px-panel group p-4">
                    <summary className="cursor-pointer list-none text-lg font-bold text-white">
                      <span className="mr-2 inline-block text-gold transition-transform group-open:rotate-90">›</span>
                      {f.q}
                    </summary>
                    <p className="mt-2 leading-relaxed text-white/80">{f.a}</p>
                  </details>
                </Blip>
              ))}
            </div>
          </section>

          <section className="relative overflow-hidden px-4 py-24 text-center">
            <SkyScene className="absolute inset-0 opacity-60" calm />
            <div className="absolute inset-0 bg-gradient-to-b from-night via-night/40 to-night" />
            <Reveal className="relative">
              <p className="text-outline mb-6 font-display text-4xl font-bold text-white">The crystal is waiting, Recruit.</p>
              <PlayCta big>▶ Play Terago Online</PlayCta>
            </Reveal>
          </section>

          <footer className="border-t border-white/10 bg-night/80 py-8 text-center text-sm text-white/55">
            <Logo size="sm" className="mb-3 opacity-80" />
            <p>Terago Online v{VERSION} · Free to play in your browser</p>
          </footer>
          <SoundToggle />
        </main>
      </StatsProvider>
    </SoundProvider>
  );
}
