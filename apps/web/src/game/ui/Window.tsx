'use client';

/** A parchment window with a title bar and close button (panels and service windows). */
export function Window({
  title,
  onClose,
  children,
  testId,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testId?: string;
  wide?: boolean;
}) {
  return (
    <section
      className={`px-panel pointer-events-auto max-h-[min(80dvh,calc(100dvh-16px))] overflow-y-auto p-3 ${wide ? 'w-[min(94vw,460px)]' : 'w-[min(92vw,380px)]'}`}
      data-testid={testId}
      role="dialog"
      aria-label={title}
    >
      <header className="mb-2 flex items-center">
        <h2 className="text-lg font-bold text-wood-dark">{title}</h2>
        <button className="px-btn ghost small ml-auto" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      {children}
    </section>
  );
}
