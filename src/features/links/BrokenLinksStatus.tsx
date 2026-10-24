import { TriangleAlert } from 'lucide-react';
import { useGraph } from '../../stores/graph';
import { runAction } from '../titlebar/menuActions';

const label = (count: number) =>
  `${count.toLocaleString()} broken ${count === 1 ? 'link' : 'links'}`;

/** Status bar item: the number of broken links, opening the Broken links view. */
export function BrokenLinksStatus() {
  const { ready, brokenCount } = useGraph((s) => s.status);
  if (!ready || brokenCount === 0) return null;
  return (
    <button
      type="button"
      className="statusbar-item statusbar-button statusbar-warning"
      title="Show the broken links (Ctrl+Shift+L)"
      onClick={() => {
        runAction('view.broken');
      }}
    >
      <TriangleAlert aria-hidden />
      {label(brokenCount)}
    </button>
  );
}

/** Badge of the Broken links icon in the activity bar. */
export function BrokenLinksBadge() {
  const { ready, brokenCount } = useGraph((s) => s.status);
  if (!ready || brokenCount === 0) return null;
  return (
    <span className="activity-badge" aria-label={label(brokenCount)}>
      {brokenCount > 99 ? '99+' : brokenCount}
    </span>
  );
}
