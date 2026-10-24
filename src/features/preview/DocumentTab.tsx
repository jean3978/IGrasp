import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useDocuments } from '../../stores/documents';
import { useGraph } from '../../stores/graph';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { MarkdownPreview } from './MarkdownPreview';
import { MAX_RENDERED_CHARS, useMarkdown } from './useMarkdown';
import { clearMatchHighlight, revealPending } from './reveal';
import './document.css';

interface DocumentTabProps {
  tabId: string;
  relPath: string;
}

function LargeFile({ content }: { content: string }) {
  return (
    <>
      <div className="document-notice" role="status">
        This file is large ({(content.length / 1_000_000).toFixed(1)} MB), so it is shown as plain
        text.
      </div>
      <pre className="document-raw">{content}</pre>
    </>
  );
}

interface RenderedProps {
  content: string;
  relPath: string;
  getScrollContainer: () => HTMLElement | null;
}

function Rendered({ content, relPath, getScrollContainer }: RenderedProps) {
  const { rendered, error } = useMarkdown(content);
  const rootPath = useWorkspace((s) => s.root?.path ?? '');
  if (error) {
    return (
      <div className="document-message" role="alert">
        This file could not be rendered: {error}
      </div>
    );
  }
  return rendered ? (
    <MarkdownPreview
      rendered={rendered}
      relPath={relPath}
      rootPath={rootPath}
      getScrollContainer={getScrollContainer}
    />
  ) : null;
}

export function DocumentTab({ tabId, relPath }: DocumentTabProps) {
  const doc = useDocuments((s) => s.byPath[relPath]);
  const deleted = useTabs((s) => s.tabs.find((t) => t.id === tabId)?.deleted ?? false);
  const pending = useTabs((s) => s.tabs.find((t) => t.id === tabId)?.pending);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const getScrollContainer = useCallback(() => scrollRef.current, []);

  // Restored tabs are loaded lazily, when they are first shown.
  useEffect(() => {
    void useDocuments.getState().load(relPath);
  }, [relPath]);

  // Link statuses for the flags; the graph store refreshes them on graph://changed.
  useEffect(() => {
    void useGraph.getState().refreshDoc(relPath);
  }, [relPath, doc?.revision]);

  // A heading or line to reveal (link with #fragment, search result, quick open, broken link):
  // wait for the asynchronous render, then scroll and flash. It wins over the saved position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pending || doc?.status !== 'ready') return;
    restored.current = true;
    let frame = 0;
    let handle = 0;
    const attempt = () => {
      frame += 1;
      if (revealPending(el, pending) || frame > 120) {
        useTabs.getState().takePending(tabId);
        return;
      }
      handle = requestAnimationFrame(attempt);
    };
    attempt();
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [pending, doc?.status, doc?.revision, tabId]);

  // Search highlights go away with the next click or key in the document.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('pointerdown', clearMatchHighlight);
    el.addEventListener('keydown', clearMatchHighlight);
    return () => {
      el.removeEventListener('pointerdown', clearMatchHighlight);
      el.removeEventListener('keydown', clearMatchHighlight);
      clearMatchHighlight();
    };
  }, []);

  // Restore the tab's scroll position once its content has been laid out.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || restored.current || doc?.status !== 'ready') return;
    const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
    if (tab?.pending) return;
    if (!tab || tab.scrollTop === 0) {
      restored.current = true;
      return;
    }
    // The preview renders asynchronously: retry until the content is tall enough (max ~1 s).
    let frames = 0;
    const apply = () => {
      el.scrollTop = tab.scrollTop;
      frames += 1;
      if (Math.abs(el.scrollTop - tab.scrollTop) > 1 && frames < 60) {
        requestAnimationFrame(apply);
      } else {
        restored.current = true;
      }
    };
    apply();
  }, [doc?.status, tabId]);

  return (
    <div
      ref={scrollRef}
      className="document-scroll"
      tabIndex={0}
      aria-label={relPath}
      onScroll={(e) => {
        if (restored.current) {
          useTabs.getState().setScroll(tabId, Math.round(e.currentTarget.scrollTop));
        }
      }}
    >
      {deleted && (
        <div className="deleted-banner" role="status">
          <span>This file was deleted on disk. The last version is still shown.</span>
          <button
            type="button"
            className="button"
            onClick={() => {
              useTabs.getState().close(tabId);
            }}
          >
            Close
          </button>
        </div>
      )}
      {doc?.status === 'error' && (
        <div className="document-message" role="alert">
          {doc.error}
        </div>
      )}
      {doc?.status === 'ready' &&
        (doc.content.length > MAX_RENDERED_CHARS ? (
          <LargeFile content={doc.content} />
        ) : (
          <Rendered
            content={doc.content}
            relPath={relPath}
            getScrollContainer={getScrollContainer}
          />
        ))}
    </div>
  );
}
