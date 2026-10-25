// Pieces every step uses: the step's markdown (the preview's sanitized pipeline, in the Academy's
// own render cache; nothing in it runs or navigates), the sources line with "Read more →", and the
// notice when a cited source changed or went missing since the tutorial was written.

import { AlertTriangle, BookOpen } from 'lucide-react';
import type { Citation } from '../../../ipc/types';
import { useWorkspace } from '../../../stores/workspace';
import { MarkdownPreview } from '../../preview/MarkdownPreview';
import { useMarkdown } from '../../preview/useMarkdown';
import { citationLabel, openCitation } from './stepUtils';
import type { SourceStatus } from './stepUtils';

export function StepMarkdown({ text, className }: { text: string; className?: string }) {
  const { rendered } = useMarkdown(text, 'academy');
  const rootPath = useWorkspace((s) => s.root?.path ?? '');
  return (
    <div className={className ?? 'academy-markdown'}>
      {rendered ? (
        <MarkdownPreview rendered={rendered} rootPath={rootPath} />
      ) : (
        <p className="academy-plain">{text}</p>
      )}
    </div>
  );
}

/** The sources of a step, the first one as "Read more →". */
export function StepSources({
  sources,
  status,
}: {
  sources: Citation[];
  status?: Record<string, SourceStatus>;
}) {
  if (sources.length === 0) return null;
  const changed = sources.filter((s) => status?.[citationLabel(s)]);
  return (
    <div className="academy-sources">
      {changed.length > 0 && (
        <p className="academy-source-notice" role="note">
          <AlertTriangle aria-hidden />{' '}
          {changed.some((s) => status?.[citationLabel(s)] === 'missing')
            ? 'A source of this step is gone from the project: read it with care.'
            : 'A source of this step changed since the tutorial was written: the lines may differ.'}
        </p>
      )}
      <span className="academy-sources-label">Sources:</span>
      {sources.map((s, i) => (
        <button
          key={`${s.path}-${String(i)}`}
          type="button"
          className="academy-source"
          data-state={status?.[citationLabel(s)]}
          title={s.why ?? undefined}
          onClick={() => {
            openCitation(s);
          }}
        >
          {i === 0 && <BookOpen aria-hidden />}
          {i === 0 ? 'Read more → ' : ''}
          {citationLabel(s)}
        </button>
      ))}
    </div>
  );
}
