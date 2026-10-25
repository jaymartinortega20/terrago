/** Small SVG icons for the ornate HUD buttons (24×24 viewBox). */
const PATHS: Record<string, React.ReactNode> = {
  character: (
    <>
      <circle cx="12" cy="8" r="4" fill="#fbe0cd" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7Z" fill="#5a8ad8" />
    </>
  ),
  inventory: (
    <>
      <path d="M5 9h14l-1 11H6Z" fill="#c08a4a" stroke="#fff" strokeWidth="1.4" />
      <path d="M9 9V7a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="2" fill="none" />
    </>
  ),
  skills: <path d="M13 2 L5 13 h6 l-2 9 L19 10 h-6Z" fill="#ffe14a" stroke="#fff" strokeWidth="1" />,
  quests: (
    <>
      <path d="M6 3h10l2 2v16H6Z" fill="#e8dcb8" />
      <path d="M9 8h6M9 12h6M9 16h4" stroke="#6a4a1a" strokeWidth="1.6" />
    </>
  ),
  map: (
    <>
      <path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2Z" fill="#f2d48a" stroke="#6a4a1a" strokeWidth="1.2" />
      <path d="M14 10l2 2m0-2l-2 2" stroke="#d03a2a" strokeWidth="2" />
    </>
  ),
  journal: (
    <>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z" fill="#a8473a" />
      <path d="M8 4v16" stroke="#ffd34a" strokeWidth="1.6" />
    </>
  ),
  crafting: (
    <>
      <path d="M4 20l9-9" stroke="#c08a4a" strokeWidth="3" strokeLinecap="round" />
      <path d="M12 4l6 6-3 3-6-6Z" fill="#b9bcc4" stroke="#fff" strokeWidth="1" />
    </>
  ),
  market: (
    <>
      <path d="M3 9l2-5h14l2 5Z" fill="#e04848" />
      <path d="M5 9v11h14V9" fill="#f2e6c8" />
      <circle cx="12" cy="15" r="2.5" fill="#ffd34a" />
    </>
  ),
  stable: (
    <path d="M6 3c-2 3-3 6-3 9 0 5 4 9 9 9s9-4 9-9c0-3-1-6-3-9h-3c2 3 2.6 6 2.6 9 0 3.4-2.6 6-5.6 6s-5.6-2.6-5.6-6c0-3 .6-6 2.6-9z" fill="#ffd56a" />
  ),
  pets: (
    <>
      <circle cx="7" cy="9" r="2.2" fill="#fff" />
      <circle cx="12" cy="6.5" r="2.2" fill="#fff" />
      <circle cx="17" cy="9" r="2.2" fill="#fff" />
      <path d="M7.5 17c0-3 2-5 4.5-5s4.5 2 4.5 5c0 2-2 2.5-4.5 2.5S7.5 19 7.5 17Z" fill="#fff" />
    </>
  ),
  arena: (
    <>
      <path d="M5 4l9 9M19 4l-9 9" stroke="#dfe6f0" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8 14l-3 3 2 2 3-3M16 14l3 3-2 2-3-3" fill="#c08a4a" stroke="#c08a4a" strokeWidth="1.6" />
    </>
  ),
  guild: (
    <>
      <path d="M5 3h14v9c0 5-4 8-7 9-3-1-7-4-7-9Z" fill="#3a6ad0" stroke="#fff" strokeWidth="1.2" />
      <path d="M12 7l1.5 3 3 .4-2.2 2 .6 3L12 14l-2.9 1.4.6-3-2.2-2 3-.4Z" fill="#ffd34a" />
    </>
  ),
  friends: (
    <>
      <circle cx="9" cy="8" r="3" fill="#fbe0cd" />
      <circle cx="16" cy="9" r="2.6" fill="#f1c6a5" />
      <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6Z" fill="#5fa04a" />
      <path d="M14 20c0-2.5 1-4.6 3-5 2.5.4 4 2.4 4 5Z" fill="#e8a03a" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.5" fill="none" stroke="#fff" strokeWidth="2.4" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" stroke="#fff" strokeWidth="2.2" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />,
  attack: (
    <>
      <path d="M4 4 L14 14 M14 14 l-2 3 M14 14 l3 -2 M20 4 L10 14 M10 14 l2 3 M10 14 l-3 -2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M3 21 l3-3 M21 21 l-3-3" stroke="#ffd34a" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  auto: <path d="M12 4a8 8 0 0 1 7.4 5M20 4v5h-5M12 20a8 8 0 0 1-7.4-5M4 20v-5h5" stroke="#eaffff" strokeWidth="2.6" fill="none" strokeLinecap="round" />,
  use: (
    <path
      d="M7 11V5a1.5 1.5 0 0 1 3 0v5V3.5a1.5 1.5 0 0 1 3 0V10V4.5a1.5 1.5 0 0 1 3 0V12V7.5a1.5 1.5 0 0 1 3 0V15c0 4-3 6-6 6s-5-1-7-4l-3-4a1.5 1.5 0 0 1 2.5-1.5Z"
      fill="#fff"
    />
  ),
  talk: <path d="M4 5h16v10H10l-5 4v-4H4Z" fill="#fff" />,
  chat: (
    <>
      <path d="M4 5h16v10H10l-5 4v-4H4Z" fill="#fff" />
      <circle cx="8.5" cy="10" r="1.2" fill="#167a88" />
      <circle cx="12" cy="10" r="1.2" fill="#167a88" />
      <circle cx="15.5" cy="10" r="1.2" fill="#167a88" />
    </>
  ),
};

export function HudIcon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {PATHS[name] ?? PATHS.menu}
    </svg>
  );
}
