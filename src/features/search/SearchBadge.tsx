import { LoaderCircle } from 'lucide-react';
import { useSearch } from '../../stores/search';

/** Spinner on the Search icon of the activity bar while a search runs. */
export function SearchBadge() {
  const running = useSearch((s) => s.status === 'running');
  if (!running) return null;
  return (
    <span className="activity-badge" aria-label="Searching">
      <LoaderCircle className="spin" aria-hidden />
    </span>
  );
}
