import { clsx } from 'clsx';
import { Dialog } from 'radix-ui';
import { FileText, Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { SymbolHit } from '../../ipc/types';
import { useGraph } from '../../stores/graph';
import { useQuickOpen } from '../../stores/quickOpen';
import './quickopen.css';

const LIST_ID = 'quick-open-list';
const optionId = (index: number) => `quick-open-${String(index)}`;

/** Text with the matched code points in bold accent. */
export function Highlighted({ text, matched, offset = 0 }: HighlightProps) {
  if (matched.length === 0) return <>{text}</>;
  const set = new Set(matched.map((m) => m - offset));
  const chars = Array.from(text);
  const parts: ReactNode[] = [];
  let run = '';
  let inMatch = false;
  const flush = (key: number) => {
    if (run === '') return;
    parts.push(inMatch ? <mark key={key}>{run}</mark> : <span key={key}>{run}</span>);
    run = '';
  };
  chars.forEach((ch, i) => {
    const hit = set.has(i);
    if (hit !== inMatch) {
      flush(i);
      inMatch = hit;
    }
    run += ch;
  });
  flush(chars.length);
  return <>{parts}</>;
}

interface HighlightProps {
  text: string;
  matched: number[];
  /** Position of `text` inside the string the indices refer to. */
  offset?: number;
}

function folderOf(rel: string) {
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
}

function HitRow({ hit }: { hit: SymbolHit }) {
  if (hit.kind === 'heading') {
    return (
      <>
        <span className="quick-open-level">H{hit.level ?? 1}</span>
        <span className="quick-open-name">
          <Highlighted text={hit.name} matched={hit.matched} />
        </span>
        <span className="quick-open-path">{hit.relPath}</span>
      </>
    );
  }
  const folder = folderOf(hit.relPath);
  const nameOffset = folder === '' ? 0 : Array.from(folder).length + 1;
  const inName = hit.matchedIn === 'name';
  return (
    <>
      <FileText className="quick-open-icon" aria-hidden />
      <span className="quick-open-name">
        <Highlighted text={hit.name} matched={hit.matched} offset={inName ? 0 : nameOffset} />
      </span>
      <span className="quick-open-path">
        <Highlighted text={folder} matched={inName ? [] : hit.matched} />
      </span>
    </>
  );
}

/** The quick pick of Ctrl+T: files and headings, fuzzy matched. */
export function QuickOpenDialog() {
  const { open, query, files, headings, graphReady, selected } = useQuickOpen();
  const progress = useGraph((s) => s.status);
  const listRef = useRef<HTMLDivElement>(null);
  const hits = [...files, ...headings];

  // Keep the selected row in view.
  useEffect(() => {
    listRef.current?.querySelector(`#${optionId(selected)}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const q = useQuickOpen.getState();
    switch (e.key) {
      case 'ArrowDown':
        q.move(1);
        break;
      case 'ArrowUp':
        q.move(-1);
        break;
      case 'PageDown':
        q.move(10);
        break;
      case 'PageUp':
        q.move(-10);
        break;
      case 'Enter':
        q.confirm({ pin: e.ctrlKey || e.metaKey, keepOpen: e.altKey });
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const row = (hit: SymbolHit, index: number) => (
    <div
      key={`${hit.kind}:${hit.relPath}:${String(hit.line ?? 0)}`}
      id={optionId(index)}
      role="option"
      aria-selected={index === selected}
      className={clsx('quick-open-row', { 'quick-open-row-selected': index === selected })}
      title={hit.kind === 'heading' ? `${hit.relPath}, line ${String(hit.line ?? 1)}` : hit.relPath}
      onMouseMove={() => {
        if (index !== selected) useQuickOpen.getState().select(index);
      }}
      onClick={(e) => {
        useQuickOpen.getState().select(index);
        useQuickOpen.getState().confirm({ pin: e.ctrlKey || e.metaKey });
      }}
    >
      <HitRow hit={hit} />
    </div>
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) useQuickOpen.getState().close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Content className="quick-open" aria-label="Search files and headings">
          <Dialog.Title className="visually-hidden">Search files and headings</Dialog.Title>
          <Dialog.Description className="visually-hidden">
            Type to search file names and headings. Enter opens, Ctrl+Enter keeps the tab open,
            Alt+Enter opens and keeps searching.
          </Dialog.Description>
          <div className="quick-open-input">
            <Search aria-hidden />
            <input
              className="text-input"
              role="combobox"
              aria-expanded={hits.length > 0}
              aria-controls={LIST_ID}
              aria-activedescendant={hits.length > 0 ? optionId(selected) : undefined}
              aria-autocomplete="list"
              placeholder="Search files and headings (# for headings only, / for paths)"
              value={query}
              onChange={(e) => {
                useQuickOpen.getState().setQuery(e.target.value);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="quick-open-list" id={LIST_ID} role="listbox" ref={listRef}>
            {files.length > 0 && (
              <div className="quick-open-group" role="presentation">
                {query.trim() === '' ? 'Recently opened' : 'Files'}
              </div>
            )}
            {files.map((hit, i) => row(hit, i))}
            {headings.length > 0 && (
              <div className="quick-open-group" role="presentation">
                Headings
              </div>
            )}
            {headings.map((hit, i) => row(hit, files.length + i))}
            {hits.length === 0 && (
              <div className="quick-open-empty">
                {query.trim() === '' ? 'Type to search.' : 'No matching files or headings.'}
              </div>
            )}
          </div>
          {!graphReady && (
            <div className="quick-open-footer" role="status">
              Indexing headings…
              {progress.totalDocs > 0 &&
                ` (${progress.parsedDocs.toLocaleString()} / ${progress.totalDocs.toLocaleString()})`}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
