import { clsx } from 'clsx';
import {
  CaseSensitive,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Ellipsis,
  FileText,
  Regex,
  RefreshCw,
  WholeWord,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { VirtualRows } from '../../components/VirtualRows';
import type { FileMatches, TextMatch } from '../../ipc/types';
import { dirname } from '../../lib/paths';
import { useSearch } from '../../stores/search';
import { fileName } from '../../stores/tabs';
import { ViewHeader } from '../shell/ViewHeader';
import './search.css';

type Row =
  | { kind: 'file'; file: FileMatches; expanded: boolean }
  | { kind: 'match'; file: FileMatches; match: TextMatch; index: number };

const rowKey = (row: Row) =>
  row.kind === 'file' ? `f:${row.file.relPath}` : `m:${row.file.relPath}:${String(row.index)}`;

/** Characters kept before the first match, so it stays visible in a narrow sidebar. */
const CONTEXT_BEFORE = 24;

/**
 * A match line with every match in <mark>: leading whitespace trimmed, and long text before the
 * first match replaced by an ellipsis.
 */
export function MatchText({ match }: { match: TextMatch }) {
  const chars = Array.from(match.text);
  const lead = chars.findIndex((c) => c !== ' ' && c !== '\t');
  const firstMatch = match.ranges[0]?.[0] ?? 0;
  let from = Math.max(0, Math.min(lead < 0 ? 0 : lead, firstMatch));
  const parts: ReactNode[] = [];
  if (firstMatch - from > CONTEXT_BEFORE) {
    from = firstMatch - CONTEXT_BEFORE;
    parts.push('…');
  }
  let at = from;
  match.ranges.forEach(([s, e], i) => {
    if (s < at) return;
    if (s > at) parts.push(chars.slice(at, s).join(''));
    parts.push(<mark key={i}>{chars.slice(s, e).join('')}</mark>);
    at = e;
  });
  parts.push(chars.slice(at).join(''));
  return <span className="search-match-text">{parts}</span>;
}

function statusText(status: string, files: number, matches: number, truncated: boolean) {
  if (status === 'running' && matches === 0) return 'Searching…';
  if (status === 'idle') return '';
  if (matches === 0) return status === 'cancelled' ? 'Cancelled' : 'No results';
  const summary = `${matches.toLocaleString()} ${matches === 1 ? 'result' : 'results'} in ${files.toLocaleString()} ${files === 1 ? 'file' : 'files'}`;
  if (truncated) return `${summary} (stopped at the result limit; refine the search)`;
  if (status === 'cancelled') return `${summary} (cancelled)`;
  if (status === 'running') return `${summary}…`;
  return summary;
}

function Toggle(props: {
  label: string;
  shortcut: string;
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <IconButton
      className="search-toggle"
      label={props.label}
      shortcut={props.shortcut}
      pressed={props.pressed}
      onClick={props.onToggle}
    >
      {props.children}
    </IconButton>
  );
}

/** The Search sidebar view, with VS Code's layout. Search only: no replace. */
export function SearchPanel() {
  const s = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const historyAt = useRef(-1);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const file of s.results) {
      const expanded = !s.collapsed.has(file.relPath);
      out.push({ kind: 'file', file, expanded });
      if (expanded)
        file.matches.forEach((match, index) => out.push({ kind: 'match', file, match, index }));
    }
    return out;
  }, [s.results, s.collapsed]);

  const matchCount = s.results.reduce((n, f) => n + f.matches.length, 0);
  const summary = statusText(s.status, s.results.length, matchCount, s.truncated);
  const selectedKey = s.selected ? `m:${s.selected.path}:${String(s.selected.index)}` : null;
  // The row the user moved to, until F4 or a click selects another match.
  const [manual, setManual] = useState<{ key: string | null; at: string | null } | null>(null);
  const focusedKey = manual && manual.at === selectedKey ? manual.key : selectedKey;
  const allCollapsed = s.results.length > 0 && s.results.every((f) => s.collapsed.has(f.relPath));

  const toggle = (option: 'matchCase' | 'wholeWord' | 'regex') => {
    s.setOption(option, !s[option]);
  };

  // Alt+C / Alt+W / Alt+R anywhere in the panel, like VS Code.
  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const option = ({ c: 'matchCase', w: 'wholeWord', r: 'regex' } as const)[e.key.toLowerCase()];
    if (!option) return;
    e.preventDefault();
    // Not stopped: the menu bar must see the key, or it takes the release of Alt for a lone Alt.
    toggle(option);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      historyAt.current = -1;
      void s.run();
    } else if (e.key === 'Escape') {
      if (s.query !== '') {
        e.preventDefault();
        e.stopPropagation();
        s.setQuery('');
      } else {
        e.currentTarget.blur();
      }
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && s.history.length > 0) {
      e.preventDefault();
      const next =
        e.key === 'ArrowUp'
          ? Math.min(s.history.length - 1, historyAt.current + 1)
          : Math.max(-1, historyAt.current - 1);
      historyAt.current = next;
      s.setQuery(next < 0 ? '' : (s.history[next] ?? ''));
    }
  };

  return (
    <div className="view search-panel" onKeyDown={onPanelKeyDown}>
      <ViewHeader
        title="Search"
        actions={
          <>
            <IconButton
              label="Refresh"
              disabled={s.query === ''}
              onClick={() => {
                void s.run();
              }}
            >
              <RefreshCw aria-hidden />
            </IconButton>
            <IconButton
              label="Clear Search Results"
              disabled={s.status === 'idle'}
              onClick={() => {
                s.setQuery('');
                s.clear();
                inputRef.current?.focus();
              }}
            >
              <X aria-hidden />
            </IconButton>
            <IconButton
              label={allCollapsed ? 'Expand All' : 'Collapse All'}
              disabled={s.results.length === 0}
              onClick={() => {
                s.setAllCollapsed(!allCollapsed);
              }}
            >
              {allCollapsed ? <ChevronsUpDown aria-hidden /> : <ChevronsDownUp aria-hidden />}
            </IconButton>
          </>
        }
      />
      <div className="search-form">
        <div className="search-query">
          <input
            ref={inputRef}
            className="text-input search-input"
            aria-label="Search"
            placeholder="Search"
            aria-invalid={s.error !== null}
            aria-describedby={s.error ? 'search-error' : undefined}
            title="Plain text, or a Rust regular expression with .* (no look-around or back-references). ↑/↓ for history."
            value={s.query}
            onChange={(e) => {
              historyAt.current = -1;
              s.setQuery(e.target.value);
            }}
            onKeyDown={onInputKeyDown}
          />
          <div className="search-toggles">
            <Toggle
              label="Match Case"
              shortcut="Alt+C"
              pressed={s.matchCase}
              onToggle={() => {
                toggle('matchCase');
              }}
            >
              <CaseSensitive aria-hidden />
            </Toggle>
            <Toggle
              label="Match Whole Word"
              shortcut="Alt+W"
              pressed={s.wholeWord}
              onToggle={() => {
                toggle('wholeWord');
              }}
            >
              <WholeWord aria-hidden />
            </Toggle>
            <Toggle
              label="Use Regular Expression"
              shortcut="Alt+R"
              pressed={s.regex}
              onToggle={() => {
                toggle('regex');
              }}
            >
              <Regex aria-hidden />
            </Toggle>
          </div>
        </div>
        {s.error && (
          <div className="search-error" id="search-error" role="alert">
            {s.error}
          </div>
        )}
        <div className="search-details-toggle">
          <IconButton
            label="Toggle Search Details"
            pressed={s.detailsOpen}
            aria-expanded={s.detailsOpen}
            onClick={() => {
              s.setDetailsOpen(!s.detailsOpen);
            }}
          >
            <Ellipsis aria-hidden />
          </IconButton>
        </div>
        {s.detailsOpen && (
          <div className="search-details">
            <label>
              files to include
              <input
                className="text-input"
                placeholder="e.g. docs/**, *.md"
                title="Comma-separated globs. A name without a slash matches at any depth; a folder includes everything inside it."
                value={s.include}
                onChange={(e) => {
                  s.setGlobs({ include: e.target.value });
                }}
              />
            </label>
            <label>
              files to exclude
              <input
                className="text-input"
                placeholder="e.g. drafts, *.tmp.md"
                title="Comma-separated globs, applied after the include patterns."
                value={s.exclude}
                onChange={(e) => {
                  s.setGlobs({ exclude: e.target.value });
                }}
              />
            </label>
          </div>
        )}
      </div>
      <div className="view-status" role="status" aria-live="polite">
        {summary}
      </div>
      <VirtualRows
        items={rows}
        getKey={rowKey}
        label="Search results"
        role="tree"
        className="search-results"
        focusedKey={focusedKey}
        onFocusedKeyChange={(key) => {
          setManual({ key, at: selectedKey });
        }}
        rowClass={(row) =>
          row.kind === 'match' && rowKey(row) === selectedKey ? 'list-row-active' : undefined
        }
        rowProps={(row) =>
          row.kind === 'file'
            ? {
                role: 'treeitem',
                'aria-level': 1,
                'aria-expanded': row.expanded,
                title: row.file.relPath,
              }
            : { role: 'treeitem', 'aria-level': 2, title: `Line ${String(row.match.line)}` }
        }
        onActivate={(row, { pin }) => {
          if (row.kind === 'file') s.toggleFile(row.file.relPath);
          else s.openMatch({ path: row.file.relPath, index: row.index }, { pin });
        }}
        onRowKey={(e, row) => {
          if (e.key === 'Delete') {
            if (row.kind === 'file') s.dismissFile(row.file.relPath);
            else s.dismissMatch({ path: row.file.relPath, index: row.index });
            return true;
          }
          if (row.kind !== 'file') return false;
          if (
            (e.key === 'ArrowRight' && !row.expanded) ||
            (e.key === 'ArrowLeft' && row.expanded)
          ) {
            s.toggleFile(row.file.relPath);
            return true;
          }
          return false;
        }}
        renderRow={(row) =>
          row.kind === 'file' ? (
            <>
              <ChevronRight
                className={clsx('search-chevron', { open: row.expanded })}
                aria-hidden
              />
              <FileText className="list-icon" aria-hidden />
              <span className="list-label">{fileName(row.file.relPath)}</span>
              <span className="list-dim">{dirname(row.file.relPath)}</span>
              {s.changed.has(row.file.relPath) && (
                <span
                  className="change-dot"
                  title="Changed since the search; refresh to update"
                  aria-label="changed since the search"
                />
              )}
              <span className="list-count">{row.file.matches.length}</span>
              <button
                type="button"
                className="list-row-action"
                aria-label="Dismiss"
                title="Dismiss"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  s.dismissFile(row.file.relPath);
                }}
              >
                <X aria-hidden />
              </button>
            </>
          ) : (
            <span className="search-match">
              <MatchText match={row.match} />
              <button
                type="button"
                className="list-row-action"
                aria-label="Dismiss"
                title="Dismiss"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  s.dismissMatch({ path: row.file.relPath, index: row.index });
                }}
              >
                <X aria-hidden />
              </button>
            </span>
          )
        }
      />
    </div>
  );
}
