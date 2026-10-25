// Hoot's head as a line icon (24 px grid, `currentColor`, like the lucide icons it sits next
// to): the ear tufts, the round glasses and the beak. For the tab, the toolbar and the menus.

export function HootIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'hoot-icon'}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* The head with its tufts. */}
      <path d="M5 4l2.5 3.2A8 8 0 0 1 12 6a8 8 0 0 1 4.5 1.2L19 4v8.5a7 7 0 0 1-14 0z" />
      {/* The glasses. */}
      <circle cx="9" cy="12" r="2.4" />
      <circle cx="15" cy="12" r="2.4" />
      <path d="M11.4 12h1.2" />
      {/* The beak. */}
      <path d="M11 15.5l1 1.5 1-1.5" />
    </svg>
  );
}
