import { useLayoutEffect, useRef } from 'react';
import { useDocuments } from '../../stores/documents';
import { useTabs } from '../../stores/tabs';
import './document.css';

interface DocumentTabProps {
  tabId: string;
  relPath: string;
}

export function DocumentTab({ tabId, relPath }: DocumentTabProps) {
  const doc = useDocuments((s) => s.byPath[relPath]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  // Restore the tab's scroll position once its content is there.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || restored.current || doc?.status !== 'ready') return;
    restored.current = true;
    const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
    if (tab) el.scrollTop = tab.scrollTop;
  }, [doc?.status, tabId]);

  return (
    <div
      ref={scrollRef}
      className="document-scroll"
      tabIndex={0}
      aria-label={relPath}
      onScroll={(e) => {
        useTabs.getState().setScroll(tabId, Math.round(e.currentTarget.scrollTop));
      }}
    >
      {doc?.status === 'error' && (
        <div className="document-message" role="alert">
          {doc.error}
        </div>
      )}
      {doc?.status === 'ready' && <pre className="document-raw">{doc.content}</pre>}
    </div>
  );
}
