// A read-only, syntax-highlighted view of a text file of the folder, shared by the quiz's "Look it
// up" and the Academy's code tours and "Spot it" steps: an optional highlighted range (a tour
// stop), an optional window of lines (a snippet), clickable lines with a keyboard cursor, and a
// scroll target. It reads through the text files store (the backend's root guard), never runs
// anything, and keeps the file's own line numbers.

import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTextFiles } from '../stores/textFiles';
import { MAX_HIGHLIGHT_BYTES, MAX_HIGHLIGHT_LINES, splitLines } from '../features/code/codeLines';
import { languageOf } from '../features/code/languages';
import type { ThemedToken } from '../features/preview/pipeline/highlight';
import '../features/code/code.css';
import './codeView.css';

export const CODE_LINE_HEIGHT = 20;

const tokenize = async (code: string, lang: string) =>
  (await import('../features/preview/pipeline/highlight')).tokenizeCode(code, lang);

export interface CodeViewProps {
  /** Root-relative path of the file. */
  path: string;
  /** Lines marked as the subject (1-based, inclusive), e.g. a tour stop. */
  highlight?: { first: number; last: number } | undefined;
  /** Only these lines are shown (a snippet); the numbers stay the file's. */
  window?: { first: number; last: number } | undefined;
  /** Line scrolled into view (with some context above it); defaults to the highlight's start. */
  scrollTo?: number | undefined;
  /** Makes the lines buttons: a click picks a line. */
  onLineClick?: ((line: number) => void) | undefined;
  /** The keyboard cursor of clickable lines. */
  cursorLine?: number | null | undefined;
  /** Lines shown with a verdict: `right` glows, `wrong` shakes. */
  marks?: Record<number, 'right' | 'wrong' | 'picked'> | undefined;
  /** The accessible name of the view. */
  label?: string | undefined;
  className?: string | undefined;
  /** Something to show above the code inside the scrolling frame (rare). */
  children?: ReactNode;
}

/** Lines shown above the scroll target. */
const CONTEXT_LINES = 4;

export function CodeView({
  path,
  highlight,
  window: win,
  scrollTo,
  onLineClick,
  cursorLine,
  marks,
  label,
  className,
}: CodeViewProps) {
  const file = useTextFiles((s) => s.byPath[path]);
  const [tokens, setTokens] = useState<{ content: string; lines: ThemedToken[][] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const content = file?.status === 'ready' ? file.content : '';
  const lines = useMemo(() => splitLines(content), [content]);
  const language = languageOf(path);
  const highlighted = tokens?.content === content ? tokens.lines : null;
  const first = Math.max(1, win?.first ?? 1);
  const last = Math.min(lines.length, win?.last ?? lines.length);
  const target = scrollTo ?? highlight?.first ?? first;

  useEffect(() => {
    const files = useTextFiles.getState();
    if (files.byPath[path]?.status !== 'ready') void files.load(path);
  }, [path]);

  useEffect(() => {
    if (!language || content === '') return;
    if (content.length > MAX_HIGHLIGHT_BYTES || lines.length > MAX_HIGHLIGHT_LINES) return;
    let cancelled = false;
    tokenize(content, language)
      .then((result) => {
        if (!cancelled && result) setTokens({ content, lines: result });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [content, language, lines.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || content === '') return;
    el.scrollTop = Math.max(0, target - first - CONTEXT_LINES) * CODE_LINE_HEIGHT;
  }, [content, target, first]);

  // The keyboard cursor stays in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || cursorLine === null || cursorLine === undefined) return;
    const top = (cursorLine - first) * CODE_LINE_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + CODE_LINE_HEIGHT > el.scrollTop + el.clientHeight)
      el.scrollTop = top + CODE_LINE_HEIGHT - el.clientHeight;
  }, [cursorLine, first]);

  if (!file || file.status === 'loading')
    return <p className="code-view-status">Opening {path}…</p>;
  if (file.status === 'error')
    return (
      <p className="code-view-status" role="alert">
        Cannot open {path}: {file.error}
      </p>
    );
  const shown = lines.slice(first - 1, last);
  return (
    <div
      ref={scrollRef}
      className={clsx('code-view', className)}
      tabIndex={onLineClick ? undefined : 0}
      role="region"
      aria-label={label ?? `${path}, read-only`}
      style={{ '--gutter-chars': String(String(last).length) } as CSSProperties}
    >
      {shown.map((line, k) => {
        const n = first + k;
        const lineTokens = highlighted?.[n - 1];
        const inRange = highlight !== undefined && n >= highlight.first && n <= highlight.last;
        const text = (
          <span className="code-text code-view-text">
            {lineTokens
              ? lineTokens.map((t, j) => (
                  <span key={j} style={t.style as CSSProperties}>
                    {t.content}
                  </span>
                ))
              : line}
            {'\n'}
          </span>
        );
        const cls = clsx('code-view-line', {
          'code-view-range': inRange,
          'code-view-range-start': inRange && n === highlight.first,
          'code-view-range-end': inRange && n === highlight.last,
          'code-view-cursor': cursorLine === n,
        });
        const mark = marks?.[n];
        return onLineClick ? (
          <button
            key={n}
            type="button"
            className={cls}
            data-mark={mark}
            data-line={n}
            tabIndex={-1}
            aria-label={`Line ${String(n)}: ${line.trim() || '(empty)'}`}
            aria-current={cursorLine === n ? 'true' : undefined}
            onClick={() => {
              onLineClick(n);
            }}
          >
            <span className="code-view-ln" aria-hidden>
              {n}
            </span>
            {text}
          </button>
        ) : (
          <div key={n} className={cls} data-mark={mark} data-line={n}>
            <span className="code-view-ln" aria-hidden>
              {n}
            </span>
            {text}
          </div>
        );
      })}
      {file.truncated && last === lines.length && (
        <p className="code-view-status">The rest of this file is too long to show here.</p>
      )}
    </div>
  );
}
