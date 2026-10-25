// Selections for the AI chat, wired to the app. Two ways to point at part of the active tab:
// - the region overlay: drag a rectangle; the text of the blocks it covers is attached;
// - the text mode: highlight text like in an editor; releasing the mouse attaches it.
// In the Academy, the selection is on a step card: the step is attached (with the text pointed
// at), so the question about it can be saved on the step afterwards.
// Either way the chat opens next to the selection with a pre-filled draft, and the selection
// stays highlighted while the chat is open. Nothing is sent: the user presses Send (or a quick
// action).

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AiCapture } from '../../ipc/types';
import { useAiPanel } from '../../stores/aiPanel';
import type { StepAttachment } from '../../stores/aiPanel';
import { useTutorialPlayer } from '../../stores/tutorialPlayer';
import { stepTitle } from '../../lib/tutorial';
import { useCapture } from '../../stores/capture';
import type { ContentRect, SelectionHighlight } from '../../stores/capture';
import { useDocuments } from '../../stores/documents';
import { selectActiveTab, useTabs } from '../../stores/tabs';
import { useTextFiles } from '../../stores/textFiles';
import { useWorkspace } from '../../stores/workspace';
import { CaptureOverlay } from './CaptureOverlay';
import {
  boundingRect,
  captureCodeRegion,
  captureMarkdownRegion,
  elementsInRect,
  narrowToSelection,
  rangeOver,
  textRects,
  toCaptureRect,
  toContentRect,
} from './capture';
import type { CaptureRect } from './capture';
import './capture.css';

export const DRAFT_PREFIX = 'About this region:';
export const TEXT_DRAFT_PREFIX = 'About this selection:';

interface FileTarget {
  tabId: string;
  container: HTMLElement;
  kind: 'document' | 'code';
  path: string;
}

/** The Academy showing a step: its scroll container. */
interface StepTarget {
  tabId: string;
  container: HTMLElement;
  kind: 'academy';
}

type Target = FileTarget | StepTarget;

/** The scroll container (and source) of the active tab: a document, a code file, a step. */
function activeTarget(): Target | null {
  const tab = selectActiveTab(useTabs.getState());
  if (!tab) return null;
  if (tab.kind === 'academy') {
    const container = document.querySelector<HTMLElement>('.tab-content .academy-tab');
    return container && useTutorialPlayer.getState().chapter !== null
      ? { tabId: tab.id, container, kind: 'academy' }
      : null;
  }
  if (tab.relPath === null) return null;
  const selector =
    tab.kind === 'document'
      ? '.tab-content .document-scroll'
      : tab.kind === 'code'
        ? '.tab-content .code-scroll'
        : null;
  if (!selector) return null;
  const container = document.querySelector<HTMLElement>(selector);
  return container && (tab.kind === 'document' || tab.kind === 'code')
    ? { tabId: tab.id, container, kind: tab.kind, path: tab.relPath }
    : null;
}

/** The step a card shows (`data-chapter` and `data-step` on `article.academy-step`). */
function stepOf(card: Element): StepAttachment | null {
  const { reference, tutorial } = useTutorialPlayer.getState();
  const chapter = Number(card.getAttribute('data-chapter'));
  const step = Number(card.getAttribute('data-step'));
  const s = tutorial?.chapters[chapter]?.steps[step];
  if (!reference || !s) return null;
  return {
    tutorial: reference,
    chapter,
    step,
    label: `Chapter ${String(chapter + 1)}, step ${String(step + 1)}: ${stepTitle(s)}`,
    quote: null,
    kind: 'text',
  };
}

/** The text of `card` inside `rect` (client coordinates), in reading order. */
function textInRect(card: Element, rect: CaptureRect): string {
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? '').trim();
    if (text === '') continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const hit = Array.from(range.getClientRects()).some(
      (b) =>
        b.width > 0 &&
        rect.x < b.right &&
        rect.x + rect.width > b.left &&
        rect.y < b.bottom &&
        rect.y + rect.height > b.top,
    );
    if (hit) parts.push(text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Attaches a step of a tutorial to the chat (what the user pointed at) and opens the chat. */
function attachStep(
  target: StepTarget,
  card: Element,
  kind: StepAttachment['kind'],
  quote: string,
  anchor: CaptureRect,
  paint: readonly CaptureRect[],
  region: CaptureRect | null,
): boolean {
  const step = stepOf(card);
  if (!step) return false;
  const toContent = (r: CaptureRect): ContentRect => toContentRect(target.container, r);
  useCapture.getState().setHighlight({
    tabId: target.tabId,
    kind,
    capture: null,
    rects: paint.map(toContent),
    region: region ? toContent(region) : null,
  });
  const panel = useAiPanel.getState();
  panel.setAttachment({ step: { ...step, kind, quote: quote === '' ? null : quote } });
  const prefixes = [DRAFT_PREFIX, TEXT_DRAFT_PREFIX];
  if (panel.draft.trim() === '' || prefixes.includes(panel.draft.trim())) panel.setDraft('');
  panel.openNear(anchor);
  focusInput();
  return true;
}

function focusInput() {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLTextAreaElement>('.ai-panel .ai-input');
    if (input && !input.disabled) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

function sourceOf(target: FileTarget): string | undefined {
  return target.kind === 'document'
    ? useDocuments.getState().byPath[target.path]?.content
    : useTextFiles.getState().byPath[target.path]?.content;
}

/** The rendered text from the start of the block at `line` to the start of `range`. */
function textBefore(container: HTMLElement, line: number, range: Range): string {
  const block = container.querySelector(`[data-line="${String(line)}"]`);
  if (!block) return '';
  const before = document.createRange();
  before.setStart(block, 0);
  try {
    before.setEnd(range.startContainer, range.startOffset);
  } catch {
    return '';
  }
  return before.toString();
}

/**
 * Attaches a selection to the chat and opens the chat next to it. `boxes` are the client boxes
 * that pick the lines; `paint` the line boxes kept highlighted.
 */
function attach(
  target: FileTarget,
  kind: SelectionHighlight['kind'],
  boxes: readonly CaptureRect[],
  paint: readonly CaptureRect[],
  options: { selection?: string; range?: Range; region?: CaptureRect },
): boolean {
  const source = sourceOf(target);
  const anchor = boundingRect(options.region ? [options.region] : boxes);
  if (source === undefined || !anchor) return false;
  const { container } = target;
  const blocks =
    target.kind === 'document'
      ? captureMarkdownRegion(container, boxes, source)
      : captureCodeRegion(container, boxes, source);
  if (!blocks) return false;
  // Highlighted text in a document: only the source lines that hold it, not its whole block.
  const lines =
    target.kind === 'document' && options.selection
      ? narrowToSelection(
          source,
          blocks,
          options.selection,
          options.range ? textBefore(container, blocks.firstLine, options.range) : '',
        )
      : blocks;
  const capture: AiCapture = {
    sourcePath: target.path,
    firstLine: lines.firstLine,
    lastLine: lines.lastLine,
    text: lines.text,
    ...(options.selection ? { selection: options.selection } : {}),
  };
  const toContent = (r: CaptureRect): ContentRect => toContentRect(container, r);
  useCapture.getState().setHighlight({
    tabId: target.tabId,
    kind,
    capture,
    rects: paint.map(toContent),
    region: options.region ? toContent(options.region) : null,
  });

  const panel = useAiPanel.getState();
  panel.setAttachment({ capture });
  const prefixes = [DRAFT_PREFIX, TEXT_DRAFT_PREFIX];
  if (panel.draft.trim() === '' || prefixes.includes(panel.draft.trim())) {
    panel.setDraft(kind === 'text' ? TEXT_DRAFT_PREFIX : DRAFT_PREFIX);
  }
  panel.openNear(anchor);
  focusInput();
  return true;
}

function captureRegion(rect: CaptureRect): void {
  const target = activeTarget();
  useCapture.getState().stop();
  if (!target) return;
  if (target.kind === 'academy') {
    const card = target.container.querySelector('article.academy-step');
    const box = card?.getBoundingClientRect();
    if (!card || !box || box.bottom < rect.y || box.top > rect.y + rect.height) return;
    attachStep(target, card, 'region', textInRect(card, rect), rect, [], rect);
    return;
  }
  const range = rangeOver(elementsInRect(target.container, rect));
  attach(target, 'region', [rect], range ? textRects(range) : [], { region: rect });
}

/** The text mode: a mouse release over a non-empty selection inside the tab attaches it. */
function captureTextSelection(target: Target): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!target.container.contains(range.commonAncestorContainer)) return;
  const text = selection.toString().trim();
  if (text === '') return;
  if (target.kind === 'academy') {
    const start =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const card = start?.closest('article.academy-step');
    if (!card) return;
    const paint = textRects(range);
    const anchor = boundingRect(paint) ?? toCaptureRect(card.getBoundingClientRect());
    if (attachStep(target, card, 'text', text, anchor, paint, null)) selection.removeAllRanges();
    return;
  }
  const boxes = textRects(range);
  // No line boxes (no layout): the elements where the selection starts and ends pick the lines.
  const pick = boxes.length > 0 ? boxes : endpointBoxes(range);
  if (attach(target, 'text', pick, boxes, { selection: text, range })) {
    selection.removeAllRanges();
  }
}

function endpointBoxes(range: Range): CaptureRect[] {
  const element = (n: Node) => (n instanceof Element ? n : n.parentElement);
  return [element(range.startContainer), element(range.endContainer)]
    .filter((el) => el !== null)
    .map((el) => toCaptureRect(el.getBoundingClientRect()));
}

/**
 * Listens for the end of a text selection in the active tab while the text mode is on (the tab's
 * view may mount later, so the target is looked up on each press). A selection started in the
 * tab counts wherever the mouse is released (over the chat, the sidebar…). Escape outside the
 * chat leaves the mode.
 */
function useTextMode(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    document.body.setAttribute('data-ai-select', 'text');
    let pressed: Target | null = null;
    const onDown = (e: MouseEvent) => {
      const target = e.button === 0 ? activeTarget() : null;
      pressed =
        target && e.target instanceof Node && target.container.contains(e.target) ? target : null;
    };
    const onUp = (e: MouseEvent) => {
      const target = pressed;
      pressed = null;
      if (e.button !== 0 || !target) return;
      // The selection is final once the event is handled.
      setTimeout(() => {
        captureTextSelection(target);
      }, 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('.ai-panel')) return;
      useCapture.getState().setTextMode(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.removeAttribute('data-ai-select');
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
    };
  }, [on]);
}

const boxStyle = (r: ContentRect) => ({
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
});

/** The selection, painted inside the scroll container so it scrolls with the document. */
function HighlightLayer({
  highlight,
  container,
}: {
  highlight: SelectionHighlight;
  container: HTMLElement;
}) {
  return createPortal(
    <div className="ai-highlight-layer" aria-hidden data-kind={highlight.kind}>
      {highlight.region && (
        <div className="ai-highlight-region" style={boxStyle(highlight.region)} />
      )}
      {highlight.rects.map((r, i) => (
        <div key={i} className="ai-highlight" style={boxStyle(r)} />
      ))}
    </div>,
    container,
  );
}

export function CaptureHost() {
  const active = useCapture((s) => s.active);
  const textMode = useCapture((s) => s.textMode);
  const highlight = useCapture((s) => s.highlight);
  const tabId = useTabs((s) => s.activeId);
  const hasRoot = useWorkspace((s) => s.root !== null);
  const panelOpen = useAiPanel((s) => s.open);
  // The source of the highlighted file: an edit (or any change on disk) moves its lines.
  const highlightedSource = useDocuments((s) =>
    highlight?.capture ? s.byPath[highlight.capture.sourcePath]?.content : undefined,
  );
  const highlightedCode = useTextFiles((s) =>
    highlight?.capture ? s.byPath[highlight.capture.sourcePath]?.content : undefined,
  );

  // Switching tabs or closing the folder ends the selection modes and the highlight.
  useEffect(() => {
    const capture = useCapture.getState();
    capture.stop();
    capture.setHighlight(null);
    capture.setTextMode(false);
  }, [tabId, hasRoot]);

  // Closing the chat removes the highlight.
  useEffect(() => {
    if (!panelOpen) useCapture.getState().setHighlight(null);
  }, [panelOpen]);

  // The highlighted file changed (an accepted edit, a change on disk): the painted boxes and the
  // attached lines no longer match it.
  const seen = useRef<{ path: string; content: string | undefined } | null>(null);
  useEffect(() => {
    const before = seen.current;
    const path = highlight?.capture?.sourcePath ?? null;
    const content = highlightedSource ?? highlightedCode;
    seen.current = path === null ? null : { path, content };
    if (!highlight || before?.path !== path || before.content === content) return;
    useCapture.getState().setHighlight(null);
    const panel = useAiPanel.getState();
    if (panel.attachment?.capture === highlight.capture) panel.setAttachment(null);
  }, [highlight, highlightedSource, highlightedCode]);

  useTextMode(textMode && !active);
  const target = activeTarget();

  const shown =
    highlight && panelOpen && target && highlight.tabId === target.tabId ? highlight : null;

  return (
    <>
      {shown && target && <HighlightLayer highlight={shown} container={target.container} />}
      {active && target && (
        <CaptureOverlay
          container={target.container}
          onCapture={captureRegion}
          onCancel={() => {
            useCapture.getState().stop();
          }}
        />
      )}
    </>
  );
}
