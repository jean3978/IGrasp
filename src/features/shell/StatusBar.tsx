import { BellOff, Eye, FileText, Link2, LoaderCircle, TriangleAlert } from 'lucide-react';
import { BrokenLinksStatus } from '../links/BrokenLinksStatus';
import { THEME_OPTIONS } from '../titlebar/menuActions';
import { useSettings } from '../../stores/settings';
import { useToasts } from '../../stores/toasts';
import { useUi } from '../../stores/ui';
import { useWorkspace } from '../../stores/workspace';

function IndexItem() {
  const root = useWorkspace((s) => s.root);
  const index = useWorkspace((s) => s.index);
  const watch = useWorkspace((s) => s.watch);
  if (!root) return null;
  return (
    <>
      {index.state === 'scanning' && (
        <span className="statusbar-item">
          <LoaderCircle className="spin" aria-hidden />
          Indexing…
        </span>
      )}
      {index.state === 'ready' && (
        <span className="statusbar-item" title={`${String(index.dirs)} folders with markdown`}>
          <FileText aria-hidden />
          {index.markdownFiles.toLocaleString()} markdown files
        </span>
      )}
      {index.state === 'error' && (
        <span className="statusbar-item statusbar-warning">
          <TriangleAlert aria-hidden />
          Indexing failed
        </span>
      )}
      {watch.mode === 'poll' && (
        <span
          className="statusbar-item statusbar-warning"
          title={`Live updates use polling (every 2 s): ${watch.reason ?? ''}. On Linux, raising fs.inotify.max_user_watches restores instant updates.`}
        >
          <Eye aria-hidden />
          Polling for changes
        </span>
      )}
      {watch.mode === 'off' && (
        <span className="statusbar-item statusbar-warning" title={watch.reason ?? ''}>
          <TriangleAlert aria-hidden />
          Live updates off
        </span>
      )}
    </>
  );
}

function MutedItem() {
  const muted = useSettings((s) => s.settings.toastsMuted);
  const count = useToasts((s) => s.mutedCount);
  const reset = useToasts((s) => s.resetMutedCount);
  if (!muted) return null;
  return (
    <button
      type="button"
      className="statusbar-item statusbar-button"
      title="Notifications are muted. Click to reset the counter."
      onClick={reset}
    >
      <BellOff aria-hidden />
      {count > 0 ? `${count.toLocaleString()} changes` : 'Muted'}
    </button>
  );
}

/** The target of the hovered link, like a browser's status line. */
function HoveredLink({ target }: { target: string }) {
  return (
    <span className="statusbar-item statusbar-link" title={target}>
      <Link2 aria-hidden />
      {target}
    </span>
  );
}

export function StatusBar() {
  const theme = useSettings((s) => s.settings.theme);
  const themeLabel = THEME_OPTIONS.find((o) => o.value === theme)?.label ?? theme;
  const hovered = useUi((s) => s.hoveredLink);

  return (
    <footer className="statusbar" aria-label="Status bar">
      <div className="statusbar-start">
        {hovered ? <HoveredLink target={hovered} /> : <IndexItem />}
      </div>
      <div className="statusbar-end">
        <BrokenLinksStatus />
        <MutedItem />
        <span className="statusbar-item">{themeLabel}</span>
      </div>
    </footer>
  );
}
