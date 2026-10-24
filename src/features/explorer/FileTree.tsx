import { clsx } from 'clsx';
import { ChevronRight, FileText, LoaderCircle } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { flattenTree, useTree } from '../../stores/tree';
import type { TreeRow } from '../../stores/tree';
import { rowId, treeKeyCommand } from './treeKeyboard';

const ROW_HEIGHT = 22;
const TYPEAHEAD_RESET_MS = 600;

interface FileTreeProps {
  /** Path of the document shown in the active tab, highlighted in the tree. */
  activePath: string | null;
  onOpen: (path: string, options: { pin: boolean }) => void;
}

export function FileTree({ activePath, onOpen }: FileTreeProps) {
  const listings = useTree((s) => s.listings);
  const expanded = useTree((s) => s.expanded);
  const loading = useTree((s) => s.loading);
  const focused = useTree((s) => s.focused);
  const setFocused = useTree((s) => s.setFocused);
  const toggle = useTree((s) => s.toggle);
  const expand = useTree((s) => s.expand);
  const collapse = useTree((s) => s.collapse);

  const rows = useMemo(
    () => flattenTree(listings, expanded, loading),
    [listings, expanded, loading],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: '', at: 0 });

  // TanStack Virtual returns functions that change on every render, which the React Compiler
  // cannot memoize; it skips this component, which is fine since rows are cheap to render.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    // Render a screenful of rows before the first measurement (and in layout-less tests).
    initialRect: { width: 300, height: 800 },
  });

  const focusedIndex = rows.findIndex((r) => r.path === focused && r.kind !== 'loading');
  useEffect(() => {
    if (focusedIndex >= 0) virtualizer.scrollToIndex(focusedIndex, { align: 'auto' });
  }, [focusedIndex, virtualizer]);

  const activate = (row: TreeRow, pin: boolean) => {
    setFocused(row.path);
    if (row.kind === 'dir') toggle(row.path);
    else if (row.kind === 'file') onOpen(row.path, { pin });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let text = '';
    if (e.key.length === 1 && e.key !== ' ' && e.key !== '*') {
      const now = Date.now();
      const t = typeahead.current;
      t.text = now - t.at > TYPEAHEAD_RESET_MS ? e.key : t.text + e.key;
      // Repeating the same letter cycles through matches instead of growing the prefix.
      if (t.text.length > 1 && t.text === e.key.repeat(t.text.length)) t.text = e.key;
      t.at = now;
      text = t.text;
    }
    const cmd = treeKeyCommand(e.key, rows, focused, text);
    if (cmd.type === 'none') return;
    e.preventDefault();
    switch (cmd.type) {
      case 'focus':
        setFocused(cmd.path);
        break;
      case 'expand':
        expand(cmd.path);
        break;
      case 'collapse':
        collapse(cmd.path);
        break;
      case 'expandMany':
        for (const p of cmd.paths) expand(p);
        break;
      case 'open':
        onOpen(cmd.path, { pin: cmd.pin });
        break;
    }
  };

  return (
    <div
      ref={scrollRef}
      className="file-tree"
      role="tree"
      aria-label="Markdown files"
      tabIndex={0}
      aria-activedescendant={focusedIndex >= 0 ? rowId(focused ?? '') : undefined}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (focused === null && rows[0]) setFocused(rows[0].path);
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} role="none">
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={`${row.kind}:${row.path}`}
              id={row.kind === 'loading' ? undefined : rowId(row.path)}
              role="treeitem"
              aria-level={row.level}
              aria-setsize={row.setSize}
              aria-posinset={row.posInSet}
              aria-expanded={row.kind === 'dir' ? row.expanded : undefined}
              aria-selected={row.kind === 'file' ? row.path === activePath : undefined}
              aria-busy={row.kind === 'loading' || undefined}
              className={clsx('tree-row', `tree-row-${row.kind}`, {
                'tree-row-focused': row.path === focused && row.kind !== 'loading',
                'tree-row-active': row.kind === 'file' && row.path === activePath,
                'tree-row-hidden': row.hidden,
              })}
              title={row.hidden ? `${row.path} (hidden or ignored)` : row.path}
              style={{
                transform: `translateY(${item.start}px)`,
                paddingLeft: 8 + (row.level - 1) * 12,
              }}
              onClick={(e) => {
                if (row.kind === 'loading') return;
                // Folders toggle on the first click only; for files, the second click of a
                // double click pins the preview tab opened by the first one.
                if (row.kind === 'dir' && e.detail > 1) return;
                activate(row, e.detail >= 2);
              }}
            >
              <span className="tree-twisty" aria-hidden>
                {row.kind === 'dir' && <ChevronRight className={clsx({ open: row.expanded })} />}
                {row.kind === 'loading' && <LoaderCircle className="spin" />}
              </span>
              {row.kind === 'file' && <FileText className="tree-icon" aria-hidden />}
              <span className="tree-label">{row.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
