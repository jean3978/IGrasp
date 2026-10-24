import { clsx } from 'clsx';
import {
  ChevronRight,
  Copy,
  FileQuestion,
  FileText,
  Hash,
  LetterText,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { VirtualRows } from '../../components/VirtualRows';
import type { BrokenDoc, LinkInfo, LinkStatus } from '../../ipc/types';
import { dirname } from '../../lib/paths';
import { useGraph } from '../../stores/graph';
import { fileName, useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { ViewHeader } from '../shell/ViewHeader';
import { linkProblem } from '../preview/links';
import './links.css';

type ProblemKind = Extract<
  LinkStatus['kind'],
  'missingFile' | 'missingAnchor' | 'caseMismatch' | 'outsideRoot'
>;

const KINDS: { kind: ProblemKind; label: string; icon: ReactNode }[] = [
  { kind: 'missingFile', label: 'Missing file', icon: <FileQuestion aria-hidden /> },
  { kind: 'missingAnchor', label: 'Missing heading', icon: <Hash aria-hidden /> },
  { kind: 'caseMismatch', label: 'Wrong case', icon: <LetterText aria-hidden /> },
  { kind: 'outsideRoot', label: 'Outside folder', icon: <LogOut aria-hidden /> },
];

const isProblemKind = (kind: string): kind is ProblemKind => KINDS.some((k) => k.kind === kind);

type Row =
  | { kind: 'doc'; doc: BrokenDoc; count: number; expanded: boolean }
  | { kind: 'link'; doc: BrokenDoc; link: LinkInfo; index: number };

const targetText = (link: LinkInfo) => {
  const t = link.target;
  if ('relPath' in t) {
    const fragment = 'fragment' in t && t.fragment ? `#${t.fragment}` : '';
    return `${t.relPath}${fragment}`;
  }
  if (t.kind === 'anchor') return `#${t.fragment}`;
  return link.href;
};

function open(doc: BrokenDoc, link: LinkInfo | null, pin: boolean) {
  useTabs.getState().openDocument(doc.relPath, {
    pin,
    ...(link ? { scroll: { line: link.line, highlight: link.text ? [link.text] : [] } } : {}),
  });
}

export function BrokenLinksPanel() {
  const report = useGraph((s) => s.broken);
  const status = useGraph((s) => s.status);
  const indexReady = useWorkspace((s) => s.index.state === 'ready');
  const generation = useWorkspace((s) => s.index.generation);
  const [hidden, setHidden] = useState<Set<ProblemKind>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Load when shown and after each new graph (a rescan resets the report).
  useEffect(() => {
    if (indexReady && report === null) void useGraph.getState().loadBroken();
  }, [indexReady, report, generation, status.ready]);

  const counts = useMemo(() => {
    const c: Record<ProblemKind, number> = {
      missingFile: 0,
      missingAnchor: 0,
      caseMismatch: 0,
      outsideRoot: 0,
    };
    for (const doc of report?.docs ?? []) {
      for (const link of doc.links) if (isProblemKind(link.status.kind)) c[link.status.kind] += 1;
    }
    return c;
  }, [report]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const doc of report?.docs ?? []) {
      const links = doc.links.filter(
        (l) => isProblemKind(l.status.kind) && !hidden.has(l.status.kind),
      );
      if (links.length === 0) continue;
      const expanded = !collapsed.has(doc.relPath);
      out.push({ kind: 'doc', doc, count: links.length, expanded });
      if (expanded) {
        links.forEach((link, index) => out.push({ kind: 'link', doc, link, index }));
      }
    }
    return out;
  }, [report, hidden, collapsed]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shown = rows.filter((r) => r.kind === 'link').length;
  const files = report?.docs.length ?? 0;

  const toggleDoc = (relPath: string, expand?: boolean) => {
    setCollapsed((c) => {
      const next = new Set(c);
      const willExpand = expand ?? next.has(relPath);
      if (willExpand) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  return (
    <div className="view">
      <ViewHeader
        title="Broken Links"
        actions={
          <IconButton
            label="Refresh"
            onClick={() => {
              void useGraph.getState().loadBroken();
            }}
          >
            <RefreshCw aria-hidden />
          </IconButton>
        }
      />
      {!status.ready && (
        <div className="view-status" role="status">
          Indexing links…{' '}
          {status.totalDocs > 0 && `${String(status.parsedDocs)} / ${String(status.totalDocs)}`}
        </div>
      )}
      {status.ready && report && (
        <div className="view-status" role="status">
          {total === 0
            ? 'No broken links.'
            : `${total.toLocaleString()} broken ${total === 1 ? 'link' : 'links'} in ${files.toLocaleString()} ${files === 1 ? 'file' : 'files'}`}
        </div>
      )}
      {total > 0 && (
        <div className="filter-chips" role="group" aria-label="Show kinds of problems">
          {KINDS.map(({ kind, label, icon }) => (
            <button
              key={kind}
              type="button"
              className="filter-chip"
              aria-pressed={!hidden.has(kind)}
              disabled={counts[kind] === 0}
              onClick={() => {
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  return next;
                });
              }}
            >
              {icon}
              {label}
              <span className="filter-chip-count">{counts[kind]}</span>
            </button>
          ))}
        </div>
      )}
      {total > 0 && shown === 0 && <div className="view-status">All kinds are hidden.</div>}
      <VirtualRows
        items={rows}
        getKey={(row) =>
          row.kind === 'doc' ? `d:${row.doc.relPath}` : `l:${row.doc.relPath}:${String(row.index)}`
        }
        label="Broken links by document"
        role="tree"
        className="broken-list"
        rowProps={(row) =>
          row.kind === 'doc'
            ? {
                role: 'treeitem',
                'aria-level': 1,
                'aria-expanded': row.expanded,
                title: row.doc.relPath,
              }
            : {
                role: 'treeitem',
                'aria-level': 2,
                title: `${linkProblem({ target: row.link.target, status: row.link.status }) ?? ''}\nLine ${String(row.link.line)}: ${row.link.href}`,
              }
        }
        onActivate={(row, { pin }) => {
          if (row.kind === 'link') open(row.doc, row.link, pin);
          else toggleDoc(row.doc.relPath);
        }}
        onRowKey={(e, row) => {
          if (row.kind !== 'doc') return false;
          if (e.key === 'ArrowRight' && !row.expanded) {
            toggleDoc(row.doc.relPath, true);
            return true;
          }
          if (e.key === 'ArrowLeft' && row.expanded) {
            toggleDoc(row.doc.relPath, false);
            return true;
          }
          return false;
        }}
        renderRow={(row) => {
          if (row.kind === 'doc') {
            return (
              <>
                <ChevronRight
                  className={clsx('broken-chevron', { open: row.expanded })}
                  aria-hidden
                />
                <FileText className="list-icon" aria-hidden />
                <span className="list-label">{fileName(row.doc.relPath)}</span>
                <span className="list-dim">{dirname(row.doc.relPath)}</span>
                <span className="list-count">{row.count}</span>
              </>
            );
          }
          const kind = KINDS.find((k) => k.kind === row.link.status.kind);
          return (
            <span className="broken-link" data-kind={row.link.status.kind}>
              {kind?.icon}
              <span className="list-label">{row.link.text || row.link.href}</span>
              <span className="list-dim">→ {targetText(row.link)}</span>
              <span className="list-meta">{row.link.line}</span>
              <button
                type="button"
                className="list-row-action"
                aria-label="Copy target path"
                title="Copy target path"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  void navigator.clipboard.writeText(targetText(row.link));
                }}
              >
                <Copy aria-hidden />
              </button>
            </span>
          );
        }}
      />
    </div>
  );
}
