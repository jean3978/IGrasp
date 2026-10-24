import { clsx } from 'clsx';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, ExternalLink, FileWarning, FolderOpen, Hash, WrapText } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { backend } from '../../ipc/client';
import { toAbsolute } from '../../lib/paths';
import { useTabs } from '../../stores/tabs';
import { useTextFiles } from '../../stores/textFiles';
import { useToasts } from '../../stores/toasts';
import { useWorkspace } from '../../stores/workspace';
import type { ThemedToken } from '../preview/pipeline/highlight';
import {
  MAX_HIGHLIGHT_BYTES,
  MAX_HIGHLIGHT_LINES,
  formatSize,
  parseLineFragment,
  splitLines,
} from './codeLines';
import type { LineRange } from './codeLines';
import { languageOf } from './languages';
import './code.css';

const LINE_HEIGHT = 20;

const tokenize = async (code: string, lang: string) =>
  (await import('../preview/pipeline/highlight')).tokenizeCode(code, lang);

function report(err: unknown) {
  useToasts.getState().notify('error', err instanceof Error ? err.message : String(err));
}

function Header({ relPath, wrap, onWrap, onGoToLine }: HeaderProps) {
  const file = useTextFiles((s) => s.byPath[relPath]);
  const rootPath = useWorkspace((s) => s.root?.path ?? '');
  const language = languageOf(relPath);
  return (
    <div className="code-header">
      <span className="code-path" title={relPath}>
        {relPath}
      </span>
      {file?.status === 'ready' && <span className="code-meta">{formatSize(file.size)}</span>}
      {language && <span className="code-meta">{language}</span>}
      <span className="code-badge">Read-only</span>
      <div className="code-actions" role="toolbar" aria-label="File actions">
        <IconButton label="Go to Line" shortcut="Ctrl+G" onClick={onGoToLine}>
          <Hash aria-hidden />
        </IconButton>
        <IconButton label="Wrap Lines" pressed={wrap} onClick={onWrap}>
          <WrapText aria-hidden />
        </IconButton>
        <IconButton
          label="Copy Path"
          onClick={() => {
            navigator.clipboard.writeText(toAbsolute(rootPath, relPath)).catch(report);
          }}
        >
          <Copy aria-hidden />
        </IconButton>
        <IconButton
          label="Reveal in File Manager"
          onClick={() => {
            backend.revealInFileManager(relPath).catch(report);
          }}
        >
          <FolderOpen aria-hidden />
        </IconButton>
        <IconButton
          label="Open in Default Editor"
          onClick={() => {
            backend.openWithDefaultApp(relPath).catch(report);
          }}
        >
          <ExternalLink aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

interface HeaderProps {
  relPath: string;
  wrap: boolean;
  onWrap: () => void;
  onGoToLine: () => void;
}

function ErrorCard({ relPath, tabId }: { relPath: string; tabId: string }) {
  const file = useTextFiles((s) => s.byPath[relPath]);
  if (file?.status !== 'error') return null;
  const title =
    file.errorCode === 'NotText'
      ? 'Binary file'
      : file.errorCode === 'TooLarge'
        ? `File too large${file.size ? ` (${formatSize(file.size)})` : ''}`
        : file.errorCode === 'NotFound'
          ? 'File not found'
          : 'This file cannot be shown';
  const detail =
    file.errorCode === 'NotText'
      ? 'This file is not text, so IGrasp does not show it.'
      : file.errorCode === 'TooLarge'
        ? 'Files above 5 MB are not shown. Open it from the file manager instead.'
        : file.error;
  return (
    <div className="code-card" role="alert">
      <FileWarning aria-hidden />
      <h2>{title}</h2>
      <p>{detail}</p>
      <div className="code-card-actions">
        {file.errorCode !== 'NotFound' && (
          <Button
            onClick={() => {
              backend.revealInFileManager(relPath).catch(report);
            }}
          >
            Reveal in File Manager
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            useTabs.getState().close(tabId);
          }}
        >
          Close
        </Button>
      </div>
    </div>
  );
}

interface CodeTabProps {
  tabId: string;
  relPath: string;
}

/** Read-only, syntax-highlighted viewer of a non-markdown file, with line numbers. */
export function CodeTab({ tabId, relPath }: CodeTabProps) {
  const file = useTextFiles((s) => s.byPath[relPath]);
  // A new scroll request arrives when the tab is opened again from a link or a search result.
  const pending = useTabs((s) => s.tabs.find((t) => t.id === tabId)?.pending);
  const [wrap, setWrap] = useState(false);
  const [goTo, setGoTo] = useState<string | null>(null);
  const [selection, setSelection] = useState<LineRange | null>(null);
  const [anchorLine, setAnchorLine] = useState<number | null>(null);
  const [tokens, setTokens] = useState<{ content: string; lines: ThemedToken[][] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  const content = file?.status === 'ready' ? file.content : '';
  const lines = useMemo(() => splitLines(content), [content]);
  const language = languageOf(relPath);
  const tooBig = content.length > MAX_HIGHLIGHT_BYTES || lines.length > MAX_HIGHLIGHT_LINES;
  const highlighted = tokens?.content === content ? tokens.lines : null;

  // Load on first show; afterwards, check for changes on disk whenever the tab is shown again or
  // the window regains focus (non-markdown files are not watched).
  useEffect(() => {
    const files = useTextFiles.getState();
    if (files.byPath[relPath]) void files.checkStale(relPath);
    else void files.load(relPath);
    const onFocus = () => void useTextFiles.getState().checkStale(relPath);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [relPath]);

  useEffect(() => {
    if (!language || tooBig || content === '') return;
    let cancelled = false;
    tokenize(content, language)
      .then((result) => {
        if (!cancelled && result) setTokens({ content, lines: result });
      })
      .catch((err: unknown) => {
        console.warn(`Cannot highlight ${relPath}`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [content, language, tooBig, relPath]);

  // eslint-disable-next-line react-hooks/incompatible-library -- see FileTree
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20,
    initialRect: { width: 800, height: 800 },
  });

  // Wrapping changes row heights: measure them again.
  useEffect(() => {
    virtualizer.measure();
  }, [wrap, virtualizer]);

  const revealLines = (range: LineRange) => {
    const start = Math.min(range.start, lines.length);
    const end = Math.min(range.end, lines.length);
    setSelection({ start, end });
    virtualizer.scrollToIndex(start - 1, { align: 'center' });
  };

  // Scroll to a requested line range (#L10-L20 links, search results), else restore the position.
  useLayoutEffect(() => {
    if (file?.status !== 'ready' || lines.length === 0) return;
    const target = useTabs.getState().takePending(tabId);
    if (target?.line) {
      restored.current = true;
      revealLines({ start: target.line, end: target.endLine ?? target.line });
      return;
    }
    if (restored.current) return;
    restored.current = true;
    const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
    if (tab && tab.scrollTop > 0 && scrollRef.current) scrollRef.current.scrollTop = tab.scrollTop;
    // revealLines only depends on state setters and the virtualizer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.status, lines.length, tabId, pending]);

  const onLineNumberClick = (e: MouseEvent, line: number) => {
    if (e.shiftKey && anchorLine !== null) {
      setSelection({ start: Math.min(anchorLine, line), end: Math.max(anchorLine, line) });
    } else {
      setAnchorLine(line);
      setSelection({ start: line, end: line });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      setGoTo('');
    }
  };

  const submitGoTo = () => {
    const range = parseLineFragment(`L${(goTo ?? '').trim().replace(/^L/i, '')}`);
    setGoTo(null);
    if (range) revealLines(range);
    scrollRef.current?.focus();
  };

  return (
    <div className="code-tab" onKeyDown={onKeyDown}>
      <Header
        relPath={relPath}
        wrap={wrap}
        onWrap={() => {
          setWrap(!wrap);
        }}
        onGoToLine={() => {
          setGoTo('');
        }}
      />
      {goTo !== null && (
        <form
          className="code-goto"
          onSubmit={(e) => {
            e.preventDefault();
            submitGoTo();
          }}
        >
          <label>
            Go to line
            <input
              ref={(el) => {
                // The box only exists while the user asked for it: focus it right away.
                el?.focus();
              }}
              className="text-input"
              value={goTo}
              placeholder={`1 – ${String(lines.length)}, or 10-20`}
              onChange={(e) => {
                setGoTo(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setGoTo(null);
                  scrollRef.current?.focus();
                }
              }}
            />
          </label>
        </form>
      )}
      {file?.stale && (
        <div className="document-notice code-banner" role="status">
          <span>This file changed on disk.</span>
          <Button
            variant="secondary"
            onClick={() => {
              void useTextFiles.getState().reload(relPath);
            }}
          >
            Reload
          </Button>
        </div>
      )}
      {file?.status === 'ready' && file.truncated && (
        <div className="document-notice" role="status">
          Showing the first 1 MB of {formatSize(file.size)}. Open the file in an editor to see the
          rest.
        </div>
      )}
      {file?.status === 'ready' && tooBig && language && (
        <div className="document-notice" role="status">
          Syntax highlighting is off for files above 300 KB or 5,000 lines.
        </div>
      )}
      <ErrorCard relPath={relPath} tabId={tabId} />
      {file?.status === 'ready' && (
        <div
          ref={scrollRef}
          className={clsx('code-scroll', { 'code-wrap': wrap })}
          tabIndex={0}
          role="region"
          aria-label={`${relPath} (read-only)`}
          style={{ '--gutter-chars': String(String(lines.length).length) } as CSSProperties}
          onScroll={(e) => {
            if (restored.current) {
              useTabs.getState().setScroll(tabId, Math.round(e.currentTarget.scrollTop));
            }
          }}
        >
          <div className="code-lines" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const n = v.index + 1;
              const selected = selection !== null && n >= selection.start && n <= selection.end;
              const lineTokens = highlighted?.[v.index];
              return (
                <div
                  key={v.key}
                  ref={virtualizer.measureElement}
                  data-index={v.index}
                  className="code-line"
                  data-selected={selected || undefined}
                  style={{ transform: `translateY(${String(v.start)}px)` }}
                >
                  <span
                    className="code-ln"
                    aria-hidden
                    onClick={(e) => {
                      onLineNumberClick(e, n);
                    }}
                  >
                    {n}
                  </span>
                  <span className="code-text">
                    {lineTokens
                      ? lineTokens.map((t, i) => (
                          <span key={i} style={t.style as CSSProperties}>
                            {t.content}
                          </span>
                        ))
                      : (lines[v.index] ?? '')}
                    {'\n'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
