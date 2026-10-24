import { ChevronRight, ListCollapse, LocateFixed } from 'lucide-react';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { VirtualRows } from '../../components/VirtualRows';
import { useOutline } from '../../stores/outline';
import { selectActiveTab, useTabs } from '../../stores/tabs';
import { flash } from '../preview/reveal';
import { activeIndex, visibleOutline } from './outline';
import type { OutlineItem } from './outline';
import './outline.css';

const EMPTY: OutlineItem[] = [];
const NO_IDS: string[] = [];

/** The scrolling element of the active document tab. */
const documentScroll = () => document.querySelector<HTMLElement>('.tab-content .document-scroll');

function jumpTo(id: string, focusDocument: boolean) {
  const container = documentScroll();
  const target = container?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  if (!container || !target) return;
  target.scrollIntoView({ block: 'start' });
  flash(target);
  if (focusDocument) container.focus();
}

/**
 * Follows the document's scroll position: the heading whose section contains the top of the
 * viewport. Offsets are cached and measured again when the document resizes (images, diagrams).
 */
function useCurrentHeading(relPath: string | null, items: OutlineItem[], enabled: boolean) {
  const [current, setCurrent] = useState<string | null>(null);
  const active = enabled && relPath !== null && items.length > 0;
  useEffect(() => {
    if (!active) return;
    let container: HTMLElement | null = null;
    let offsets: number[] = [];
    let ids: string[] = [];
    let stale = true;
    let frame = 0;
    const measure = () => {
      if (!container) return;
      const top = container.getBoundingClientRect().top - container.scrollTop;
      ids = [];
      offsets = [];
      for (const item of items) {
        const el = container.querySelector<HTMLElement>(`[id="${CSS.escape(item.id)}"]`);
        if (!el) continue;
        ids.push(item.id);
        offsets.push(el.getBoundingClientRect().top - top);
      }
      stale = false;
    };
    const update = () => {
      frame = 0;
      if (!container) return;
      if (stale) measure();
      setCurrent(ids[activeIndex(offsets, container.scrollTop)] ?? ids[0] ?? null);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(() => {
      stale = true;
      onScroll();
    });
    // The tab content mounts with (or just after) the outline: attach on the next frame.
    const attach = requestAnimationFrame(() => {
      container = documentScroll();
      if (!container) return;
      container.addEventListener('scroll', onScroll, { passive: true });
      const body = container.querySelector('.markdown-body');
      if (body) resize.observe(body);
      update();
    });
    return () => {
      cancelAnimationFrame(attach);
      cancelAnimationFrame(frame);
      container?.removeEventListener('scroll', onScroll);
      resize.disconnect();
    };
  }, [active, items]);
  return active ? current : null;
}

export function OutlineActions() {
  const follow = useOutline((s) => s.follow);
  const relPath = useTabs((s) => {
    const tab = selectActiveTab(s);
    return tab?.kind === 'document' ? tab.relPath : null;
  });
  const items = useOutline((s) => (relPath ? s.byPath[relPath] : undefined) ?? EMPTY);
  return (
    <>
      <IconButton
        label="Follow Scroll"
        pressed={follow}
        onClick={() => {
          useOutline.getState().setFollow(!follow);
        }}
      >
        <LocateFixed aria-hidden />
      </IconButton>
      <IconButton
        label="Collapse All"
        disabled={!relPath}
        onClick={() => {
          if (!relPath) return;
          for (const item of items) {
            if (item.hasChildren) useOutline.getState().setCollapsed(relPath, item.id, true);
          }
        }}
      >
        <ListCollapse aria-hidden />
      </IconButton>
    </>
  );
}

/** Collapsible table of contents of the active document, in the right panel. */
export function OutlinePanel() {
  const relPath = useTabs((s) => {
    const tab = selectActiveTab(s);
    return tab?.kind === 'document' ? tab.relPath : null;
  });
  const items = useOutline((s) => (relPath ? s.byPath[relPath] : undefined) ?? EMPTY);
  const collapsedIds = useOutline((s) => (relPath ? s.collapsed[relPath] : undefined) ?? NO_IDS);
  const filter = useOutline((s) => s.filter);
  const follow = useOutline((s) => s.follow);
  const current = useCurrentHeading(relPath, items, follow);
  // The row the user moved to, until following the scroll moves the outline along again.
  const [manual, setManual] = useState<{ key: string | null; at: string | null } | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const collapsed = useMemo(() => new Set(collapsedIds), [collapsedIds]);
  const rows = useMemo(() => visibleOutline(items, collapsed, filter), [items, collapsed, filter]);

  const focused = manual && (manual.at === current || current === null) ? manual.key : current;
  const setFocused = (key: string | null) => {
    setManual({ key, at: current });
  };

  if (!relPath) return <div className="panel-empty">Open a document to see its outline.</div>;

  const toggle = (item: OutlineItem) => {
    useOutline.getState().toggle(relPath, item.id);
  };

  return (
    <div className="outline">
      <input
        ref={filterRef}
        className="text-input outline-filter"
        type="search"
        placeholder="Filter headings"
        aria-label="Filter headings"
        value={filter}
        onChange={(e) => {
          useOutline.getState().setFilter(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && filter !== '') {
            e.stopPropagation();
            useOutline.getState().setFilter('');
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            filterRef.current?.parentElement?.querySelector<HTMLElement>('.outline-list')?.focus();
          }
        }}
      />
      <VirtualRows
        items={rows}
        getKey={(item) => item.id}
        label="Outline"
        role="tree"
        className="outline-list"
        emptyMessage={items.length === 0 ? 'No headings.' : 'No matching headings.'}
        focusedKey={focused}
        onFocusedKeyChange={setFocused}
        rowClass={(item) => (item.id === current ? 'list-row-active' : undefined)}
        rowProps={(item) => ({
          role: 'treeitem',
          'aria-level': item.depth + 1,
          'aria-expanded': item.hasChildren && filter === '' ? !collapsed.has(item.id) : undefined,
          'aria-selected': item.id === current,
          title: `${item.text} (H${String(item.level)})`,
        })}
        onActivate={(item, { pin }) => {
          // Click or Space: jump and stay in the outline; Enter: jump and read.
          jumpTo(item.id, pin);
        }}
        onRowKey={(e, item) => {
          if (e.key === 'ArrowRight' && item.hasChildren) {
            if (collapsed.has(item.id)) toggle(item);
            else setFocused(rows.find((r) => r.parent === item.id)?.id ?? item.id);
            return true;
          }
          if (e.key === 'ArrowLeft') {
            if (item.hasChildren && !collapsed.has(item.id) && filter === '') toggle(item);
            else if (item.parent) setFocused(item.parent);
            return true;
          }
          return false;
        }}
        renderRow={(item) => (
          <span className="outline-row" style={{ paddingLeft: item.depth * 12 }}>
            <span
              className="outline-twisty"
              aria-hidden
              onClick={(e) => {
                if (!item.hasChildren) return;
                e.stopPropagation();
                toggle(item);
              }}
            >
              {item.hasChildren && filter === '' && (
                <ChevronRight className={clsx({ open: !collapsed.has(item.id) })} />
              )}
            </span>
            <span className="list-label">{item.text}</span>
          </span>
        )}
      />
    </div>
  );
}
