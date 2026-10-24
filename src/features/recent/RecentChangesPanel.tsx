import { CheckCheck, FileText, FolderSearch, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { VirtualRows } from '../../components/VirtualRows';
import { dirname } from '../../lib/paths';
import {
  groupRows,
  isChangedInSession,
  relativeTime,
  useRecentFiles,
} from '../../stores/recentFiles';
import type { RecentRow } from '../../stores/recentFiles';
import { selectActiveTab, useTabs } from '../../stores/tabs';
import { useTree } from '../../stores/tree';
import { useWorkspace } from '../../stores/workspace';
import { ViewHeader } from '../shell/ViewHeader';

const rowKey = (row: RecentRow) => (row.kind === 'header' ? `h:${row.group}` : row.file.relPath);

/** Re-renders every minute so relative times stay right while the view is shown. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(t);
    };
  }, []);
  return now;
}

function revealInExplorer(relPath: string) {
  useTree.getState().reveal(relPath);
  useWorkspace.getState().setSidebarView('explorer');
}

export function RecentChangesPanel() {
  const { files, total, status, error, sessionStartMs, changed } = useRecentFiles();
  const indexState = useWorkspace((s) => s.index.state);
  const generation = useWorkspace((s) => s.index.generation);
  const activePath = useTabs((s) => selectActiveTab(s)?.relPath ?? null);
  const now = useMinuteClock();
  const rows = useMemo(() => groupRows(files, now), [files, now]);

  // Load when shown and again for every new index (rescan, toggles).
  useEffect(() => {
    if (indexState === 'ready') void useRecentFiles.getState().load();
  }, [indexState, generation]);

  const changedCount = files.filter((f) =>
    isChangedInSession(f, { sessionStartMs, changed }),
  ).length;

  return (
    <div className="view">
      <ViewHeader
        title="Recent Changes"
        actions={
          <>
            <IconButton
              label="Clear change markers"
              disabled={changedCount === 0}
              onClick={() => {
                useRecentFiles.getState().clearMarkers();
              }}
            >
              <CheckCheck aria-hidden />
            </IconButton>
            <IconButton
              label="Refresh"
              onClick={() => {
                void useRecentFiles.getState().load();
              }}
            >
              <RefreshCw aria-hidden />
            </IconButton>
          </>
        }
      />
      {status === 'loading' && files.length === 0 && <div className="view-status">Loading…</div>}
      {status === 'error' && indexState === 'ready' && (
        <div className="view-status view-status-error">{error}</div>
      )}
      {status === 'ready' && files.length > 0 && (
        <div className="view-status" role="status">
          {files.length < total
            ? `${files.length.toLocaleString()} of ${total.toLocaleString()} files`
            : `${total.toLocaleString()} files`}
          {changedCount > 0 && ` · ${changedCount.toLocaleString()} changed since opened`}
        </div>
      )}
      <VirtualRows
        items={rows}
        getKey={rowKey}
        isFocusable={(row) => row.kind === 'file'}
        label="Recently modified files"
        className="recent-list"
        emptyMessage={status === 'ready' ? 'No markdown files.' : undefined}
        rowClass={(row) => {
          if (row.kind === 'header') return 'list-group-header';
          const classes = [];
          if (row.file.relPath === activePath) classes.push('list-row-active');
          if (isChangedInSession(row.file, { sessionStartMs, changed }))
            classes.push('list-row-changed');
          return classes.join(' ');
        }}
        rowProps={(row) =>
          row.kind === 'header'
            ? { role: 'presentation', 'aria-hidden': true }
            : {
                role: 'option',
                'aria-selected': row.file.relPath === activePath,
                title: `${row.file.relPath}\nModified ${new Date(row.file.modifiedMs).toLocaleString()}`,
              }
        }
        onActivate={(row, { pin }) => {
          if (row.kind === 'file') useTabs.getState().openDocument(row.file.relPath, { pin });
        }}
        renderRow={(row) => {
          if (row.kind === 'header') {
            return (
              <>
                <span>{row.group}</span>
                <span className="list-meta">{row.count}</span>
              </>
            );
          }
          const marked = isChangedInSession(row.file, { sessionStartMs, changed });
          return (
            <>
              <FileText className="list-icon" aria-hidden />
              <span className="list-label">{row.file.name}</span>
              <span className="list-dim">{dirname(row.file.relPath)}</span>
              {marked && <span className="change-dot" aria-label="changed since opened" />}
              <span className="list-meta">{relativeTime(row.file.modifiedMs, now)}</span>
              <button
                type="button"
                className="list-row-action"
                aria-label="Reveal in Explorer"
                title="Reveal in Explorer"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  revealInExplorer(row.file.relPath);
                }}
              >
                <FolderSearch aria-hidden />
              </button>
            </>
          );
        }}
      />
      {status === 'ready' && files.length < total && (
        <div className="view-footer">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              void useRecentFiles.getState().loadMore();
            }}
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
}
