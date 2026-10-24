// The AI chat as a floating panel over the window (ADR 0019): moved by its header (mouse or
// Alt+arrows), resized from its edges and corners (Alt+Shift+arrows), kept inside the window,
// remembered per folder. Not modal: the document behind it stays usable.

import { History, Plus, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import type { PanelRect } from '../../ipc/types';
import { selectProviderName, useAiProvider } from '../../stores/aiProvider';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import {
  PANEL_KEY_STEP,
  resizeRect,
  selectPanelRect,
  useAiPanel,
  windowViewport,
} from '../../stores/aiPanel';
import type { ResizeEdge } from '../../stores/aiPanel';
import { activeFilePath } from '../../stores/aiConversation';
import { useTabs } from '../../stores/tabs';
import { Composer } from './Composer';
import { ContextBar } from './ContextBar';
import { HistoryList } from './HistoryList';
import { RulesButton } from './RulesButton';
import { StatusLine } from './StatusLine';
import { Transcript } from './Transcript';
import './ai.css';

const EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** The toolbar button that opens the chat: focus goes back there when the panel closes. */
const opener = () => document.querySelector<HTMLElement>('[data-action="ai.chat"]');

/** Starts a pointer gesture on `e.currentTarget` that reports the move since its start. */
function track(e: ReactPointerEvent<HTMLElement>, onMove: (dx: number, dy: number) => void): void {
  if (e.button !== 0) return;
  e.preventDefault();
  const target = e.currentTarget;
  const startX = e.clientX;
  const startY = e.clientY;
  try {
    target.setPointerCapture(e.pointerId);
  } catch {
    // Not every environment captures pointers (jsdom); moves on the target still arrive.
  }
  const move = (ev: PointerEvent) => {
    onMove(ev.clientX - startX, ev.clientY - startY);
  };
  const end = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

function PanelHeader({ titleId, onClose }: { titleId: string; onClose: () => void }) {
  const providerName = useAiProvider(selectProviderName);
  const newConversation = useAiConversation((s) => s.newConversation);
  const sessionModel = useAiConversation((s) => s.sessionModel);
  const historyOpen = useAiPanel((s) => s.historyOpen);
  const toggleHistory = useAiPanel((s) => s.toggleHistory);
  const setHistoryOpen = useAiPanel((s) => s.setHistoryOpen);
  const setRect = useAiPanel((s) => s.setRect);
  const moveBy = useAiPanel((s) => s.moveBy);
  const resizeBy = useAiPanel((s) => s.resizeBy);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    // Buttons and fields of the header keep their own clicks.
    if ((e.target as HTMLElement).closest('button, input, select, textarea')) return;
    const start = selectPanelRect(useAiPanel.getState());
    track(e, (dx, dy) => {
      setRect({ ...start, x: start.x + dx, y: start.y + dy });
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-PANEL_KEY_STEP, 0],
      ArrowRight: [PANEL_KEY_STEP, 0],
      ArrowUp: [0, -PANEL_KEY_STEP],
      ArrowDown: [0, PANEL_KEY_STEP],
    };
    const delta = step[e.key];
    if (!delta) return;
    // Also keeps Alt+Left/Right from going back and forward in the document history.
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) resizeBy(delta[0], delta[1]);
    else moveBy(delta[0], delta[1]);
  };

  return (
    <header className="ai-header" onPointerDown={onPointerDown}>
      <h2
        id={titleId}
        className="ai-title ai-drag-handle"
        tabIndex={0}
        title="Drag to move · Alt+arrows to move · Alt+Shift+arrows to resize"
        onKeyDown={onKeyDown}
      >
        <Sparkles aria-hidden /> {providerName}
      </h2>
      {sessionModel && (
        <span className="ai-session-model" title="The model this conversation runs with">
          {sessionModel}
        </span>
      )}
      <RulesButton />
      <IconButton
        label="History"
        shortcut="Ctrl+Alt+H"
        pressed={historyOpen}
        onClick={toggleHistory}
      >
        <History aria-hidden />
      </IconButton>
      <IconButton
        label="New conversation"
        shortcut="Ctrl+Alt+N"
        onClick={() => {
          newConversation();
          setHistoryOpen(false);
        }}
      >
        <Plus aria-hidden />
      </IconButton>
      <IconButton label="Close" shortcut="Esc" onClick={onClose}>
        <X aria-hidden />
      </IconButton>
    </header>
  );
}

export function AiPanel() {
  const open = useAiPanel((s) => s.open);
  const rect = useAiPanel((s) => s.rect);
  const setOpen = useAiPanel((s) => s.setOpen);
  const setRect = useAiPanel((s) => s.setRect);
  const clampToWindow = useAiPanel((s) => s.clampToWindow);
  const status = useAiProvider((s) => s.status);
  const checking = useAiProvider((s) => s.checking);
  const checkStatus = useAiProvider((s) => s.checkStatus);
  const cancel = useAiConversation((s) => s.cancel);
  const busy = useAiConversation(selectBusy);
  const historyOpen = useAiPanel((s) => s.historyOpen);
  const setHistoryOpen = useAiPanel((s) => s.setHistoryOpen);
  const refreshContext = useAiPanel((s) => s.refreshContext);
  const hasContext = useAiPanel((s) => s.context !== null);
  // Recomputed when the panel opens and when the active tab changes (never on disk changes).
  const activePath = useTabs(() => activeFilePath());
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [viewport, setViewport] = useState(windowViewport);

  useEffect(() => {
    if (open && !status && !checking) void checkStatus();
  }, [open, status, checking, checkStatus]);

  // Also when the list was cleared (another folder opened with the panel open).
  const listed = useRef<{ open: boolean; path: string | null }>({ open: false, path: null });
  useEffect(() => {
    const before = listed.current;
    listed.current = { open, path: activePath };
    if (!open) return;
    if (!before.open || before.path !== activePath || !hasContext) void refreshContext(activePath);
  }, [open, activePath, hasContext, refreshContext]);

  // Kept inside the window when it changes size (or DPI).
  useEffect(() => {
    const onResize = () => {
      setViewport(windowViewport());
      clampToWindow();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [clampToWindow]);

  // Opening focuses the message box (or the panel when it is disabled).
  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (input && !input.disabled) input.focus();
    else panelRef.current?.focus();
  }, [open]);

  // A card, the history list or the Send / Stop button answered and went away with the focus
  // (removed from the page): the focus goes to the message box rather than to nowhere.
  const lastFocus = useRef<HTMLElement | null>(null);
  const confirming = useAiConversation((s) => s.pendingConfirm !== null);
  const waiting = useAiConversation((s) => s.permissions.length);
  const itemCount = useAiConversation((s) => s.items.length);
  const ruleCount = useAiConversation((s) => s.rules.length);
  useEffect(() => {
    const last = lastFocus.current;
    if (!open || !last || last.isConnected) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    lastFocus.current = null;
    const input = inputRef.current;
    if (input && !input.disabled) input.focus();
    else panelRef.current?.focus();
  }, [open, confirming, waiting, itemCount, ruleCount, historyOpen, busy]);

  // Closed while the focus was inside (Ctrl+Alt+C, Escape): it goes back to the toolbar button.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && document.activeElement === document.body) opener()?.focus();
    wasOpen.current = open;
  }, [open]);

  const close = useCallback(() => {
    const hadFocus = panelRef.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (hadFocus) opener()?.focus();
  }, [setOpen]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // The confirmation card and open menus answer Escape first (they stop it).
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    // The history list closes first.
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    // First press stops a running operation, the next one closes the panel.
    if (busy) void cancel();
    else close();
  };

  if (!open) return null;
  const shown = selectPanelRect({ rect }, viewport);
  const style = {
    left: shown.x,
    top: shown.y,
    width: shown.width,
    height: shown.height,
  };

  const startResize = (edge: ResizeEdge) => (e: ReactPointerEvent<HTMLElement>) => {
    const start: PanelRect = shown;
    track(e, (dx, dy) => {
      setRect(resizeRect(start, edge, dx, dy, windowViewport()));
    });
  };

  return (
    <section
      ref={panelRef}
      className="ai-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={style}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        lastFocus.current = e.target;
      }}
      onBlur={(e) => {
        // Moved elsewhere (the review, the document): nothing to bring back.
        const next = e.relatedTarget;
        if (next instanceof Node && !e.currentTarget.contains(next)) lastFocus.current = null;
      }}
    >
      <PanelHeader titleId={titleId} onClose={close} />
      <StatusLine />
      {historyOpen ? <HistoryList /> : <Transcript />}
      <ContextBar />
      <Composer ref={inputRef} />
      {EDGES.map((edge) => (
        <div
          key={edge}
          className={`ai-resize ai-resize-${edge}`}
          aria-hidden
          onPointerDown={startResize(edge)}
        />
      ))}
    </section>
  );
}
