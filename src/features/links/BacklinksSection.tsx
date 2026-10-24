import { CornerDownRight, FileText } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { VirtualRows } from '../../components/VirtualRows';
import type { Backlink } from '../../ipc/types';
import { dirname } from '../../lib/paths';
import { useGraph } from '../../stores/graph';
import { fileName, selectActiveTab, useTabs } from '../../stores/tabs';

type Row =
  { kind: 'file'; path: string; count: number } | { kind: 'link'; link: Backlink; index: number };

const NONE: Backlink[] = [];

function useActiveDocument(): string | null {
  return useTabs((s) => {
    const tab = selectActiveTab(s);
    return tab?.kind === 'document' ? tab.relPath : null;
  });
}

function useBacklinks(): { relPath: string | null; items: Backlink[] | undefined } {
  const relPath = useActiveDocument();
  const items = useGraph((s) => (relPath ? s.backlinks[relPath] : undefined));
  useEffect(() => {
    if (relPath) void useGraph.getState().refreshBacklinks(relPath);
  }, [relPath]);
  return { relPath, items };
}

/** Rows grouped by linking file, in path order. */
function backlinkRows(items: Backlink[]): Row[] {
  const rows: Row[] = [];
  items.forEach((link, index) => {
    const last = rows.findLast((r) => r.kind === 'file');
    if (last?.kind === 'file' && last.path === link.fromPath) last.count += 1;
    else rows.push({ kind: 'file', path: link.fromPath, count: 1 });
    rows.push({ kind: 'link', link, index });
  });
  return rows;
}

/** The number shown in the section header. */
export function BacklinksCount() {
  const relPath = useActiveDocument();
  const count = useGraph((s) => (relPath ? s.backlinks[relPath]?.length : undefined));
  return count === undefined ? null : <>{count}</>;
}

function open(link: Backlink, pin: boolean) {
  useTabs.getState().openDocument(link.fromPath, { pin, scroll: { line: link.line } });
}

/** The documents that link to the active one, live. */
export function BacklinksSection() {
  const { relPath, items } = useBacklinks();
  const graphReady = useGraph((s) => s.status.ready);
  const rows = useMemo(() => backlinkRows(items ?? NONE), [items]);

  if (!relPath) return <div className="panel-empty">Open a document to see its backlinks.</div>;
  if (items === undefined) return <div className="panel-empty">Loading…</div>;
  if (items.length === 0) {
    return (
      <div className="panel-empty">
        {graphReady ? 'No other document links here.' : 'Indexing links…'}
      </div>
    );
  }
  return (
    <VirtualRows
      items={rows}
      getKey={(row) => (row.kind === 'file' ? `f:${row.path}` : `l:${String(row.index)}`)}
      label={`Documents linking to ${fileName(relPath)}`}
      className="backlinks-list"
      role="list"
      rowProps={(row) =>
        row.kind === 'file'
          ? { role: 'listitem', title: row.path }
          : {
              role: 'listitem',
              title: `${row.link.fromPath}, line ${String(row.link.line)}`,
            }
      }
      onActivate={(row, { pin }) => {
        if (row.kind === 'link') open(row.link, pin);
        else useTabs.getState().openDocument(row.path, { pin });
      }}
      renderRow={(row) =>
        row.kind === 'file' ? (
          <>
            <FileText className="list-icon" aria-hidden />
            <span className="list-label">{fileName(row.path)}</span>
            <span className="list-dim">{dirname(row.path)}</span>
            <span className="list-count">{row.count}</span>
          </>
        ) : (
          <span className="backlink-line">
            <CornerDownRight aria-hidden />
            <span className="list-label">{row.link.text || '(link)'}</span>
            {row.link.fragment && <span className="list-dim">#{row.link.fragment}</span>}
            <span className="list-meta">{row.link.line}</span>
          </span>
        )
      }
    />
  );
}
