import { clsx } from 'clsx';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useId, useRef, useState } from 'react';
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';

export interface RowState {
  focused: boolean;
}

interface VirtualRowsProps<T> {
  items: T[];
  getKey: (item: T) => string;
  /** Header rows can be shown but not focused. Default: every row is focusable. */
  isFocusable?: (item: T) => boolean;
  renderRow: (item: T, state: RowState) => ReactNode;
  /** ARIA attributes of a row (role, aria-level, aria-expanded…). */
  rowProps?: (item: T) => HTMLAttributes<HTMLDivElement>;
  /** Extra class names of a row. */
  rowClass?: (item: T) => string | undefined;
  /** Enter (pin) / Space (preview) on the focused row, click (preview) and double click (pin). */
  onActivate?: (item: T, options: { pin: boolean }) => void;
  /** Extra keys on the focused row (ArrowLeft/Right in trees). Return true when handled. */
  onRowKey?: (e: KeyboardEvent<HTMLDivElement>, item: T, index: number) => boolean;
  /** Controlled focus, e.g. to follow the active document. */
  focusedKey?: string | null;
  onFocusedKeyChange?: (key: string | null) => void;
  rowHeight?: number;
  role?: 'listbox' | 'tree' | 'list';
  label: string;
  className?: string;
  emptyMessage?: ReactNode;
}

/**
 * A virtualized list of rows with keyboard focus through `aria-activedescendant` (the container
 * keeps DOM focus), shared by the sidebar and right-panel views.
 */
export function VirtualRows<T>({
  items,
  getKey,
  isFocusable = () => true,
  renderRow,
  rowProps,
  rowClass,
  onActivate,
  onRowKey,
  focusedKey: controlledKey,
  onFocusedKeyChange,
  rowHeight = 22,
  role = 'listbox',
  label,
  className,
  emptyMessage,
}: VirtualRowsProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const idPrefix = useId();
  const [ownKey, setOwnKey] = useState<string | null>(null);
  const focusedKey = controlledKey === undefined ? ownKey : controlledKey;
  const setFocusedKey = (key: string | null) => {
    setOwnKey(key);
    onFocusedKeyChange?.(key);
  };

  // TanStack Virtual returns functions that change on every render (see FileTree).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    initialRect: { width: 300, height: 800 },
  });

  const focusedIndex = items.findIndex((item) => getKey(item) === focusedKey);
  useEffect(() => {
    if (focusedIndex >= 0) virtualizer.scrollToIndex(focusedIndex, { align: 'auto' });
  }, [focusedIndex, virtualizer]);

  const rowId = (key: string) => `${idPrefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const focusable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isFocusable(item));

  const moveTo = (position: number) => {
    const target = focusable[Math.max(0, Math.min(focusable.length - 1, position))];
    if (target) setFocusedKey(getKey(target.item));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && focusedIndex >= 0) {
        const item = items[focusedIndex];
        if (item) onActivate?.(item, { pin: true });
        e.preventDefault();
      }
      return;
    }
    const position = focusable.findIndex(({ index }) => index === focusedIndex);
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / rowHeight) - 1);
    const item = items[focusedIndex];
    if (item && onRowKey?.(e, item, focusedIndex)) {
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        moveTo(position < 0 ? 0 : position + 1);
        break;
      case 'ArrowUp':
        moveTo(position < 0 ? 0 : position - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(focusable.length - 1);
        break;
      case 'PageDown':
        moveTo(position + page);
        break;
      case 'PageUp':
        moveTo(position - page);
        break;
      case 'Enter':
      case ' ':
        if (!item) return;
        onActivate?.(item, { pin: e.key === 'Enter' });
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  if (items.length === 0 && emptyMessage) {
    return <div className="view-status">{emptyMessage}</div>;
  }

  return (
    <div
      ref={scrollRef}
      className={clsx('view-list', className)}
      role={role}
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={
        focusedKey !== null && focusedIndex >= 0 ? rowId(focusedKey) : undefined
      }
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target === e.currentTarget && focusedIndex < 0) moveTo(0);
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} role="none">
        {virtualizer.getVirtualItems().map((v) => {
          const item = items[v.index];
          if (item === undefined) return null;
          const key = getKey(item);
          const canFocus = isFocusable(item);
          const focused = canFocus && key === focusedKey;
          return (
            <div
              key={key}
              id={canFocus ? rowId(key) : undefined}
              className={clsx('list-row', rowClass?.(item), { 'list-row-focused': focused })}
              style={{ transform: `translateY(${v.start}px)`, height: rowHeight }}
              {...rowProps?.(item)}
              onClick={(e) => {
                if (!canFocus) return;
                setFocusedKey(key);
                onActivate?.(item, { pin: e.detail >= 2 || e.ctrlKey || e.metaKey });
              }}
              onAuxClick={(e) => {
                // Middle click opens pinned (and never opens a new webview window).
                e.preventDefault();
                if (canFocus && e.button === 1) onActivate?.(item, { pin: true });
              }}
            >
              {renderRow(item, { focused })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
