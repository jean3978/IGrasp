import { backend } from '../../ipc/client';
import { useIsMaximized } from './useWindowState';

// Glyphs drawn as 10x10 SVG so they stay crisp at any scale factor.
function MinimizeGlyph() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden>
      <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximizeGlyph() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden>
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
    </svg>
  );
}

function RestoreGlyph() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden>
      <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
      <path d="M2.5 2.5v-2h7v7h-2" fill="none" stroke="currentColor" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden>
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function WindowControls() {
  const maximized = useIsMaximized();
  const w = backend.window;

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => void w.minimize()}
      >
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void w.toggleMaximize()}
      >
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button
        type="button"
        className="window-control window-control-close"
        aria-label="Close"
        title="Close"
        onClick={() => void w.close()}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
