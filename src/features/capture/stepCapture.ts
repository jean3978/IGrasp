// A selection on a step card of the Academy: the step is attached to the chat (with the text
// pointed at, or as a whole from "Ask about this step"), so the question about it can be saved
// on the step afterwards. Nothing is sent: the user presses Send.

import { stepTitle } from '../../lib/tutorial';
import { useAiPanel } from '../../stores/aiPanel';
import type { StepAttachment } from '../../stores/aiPanel';
import { useCapture } from '../../stores/capture';
import type { ContentRect } from '../../stores/capture';
import { selectActiveTab, useTabs } from '../../stores/tabs';
import { useTutorialPlayer } from '../../stores/tutorialPlayer';
import { DRAFT_PREFIX, TEXT_DRAFT_PREFIX, toCaptureRect, toContentRect } from './capture';
import type { CaptureRect } from './capture';

/** The Academy showing a step: its scroll container. */
export interface StepTarget {
  tabId: string;
  container: HTMLElement;
  kind: 'academy';
}

/** The Academy tab when it shows a step (its scroll container), else null. */
export function academyTarget(): StepTarget | null {
  const tab = selectActiveTab(useTabs.getState());
  if (tab?.kind !== 'academy') return null;
  const container = document.querySelector<HTMLElement>('.tab-content .academy-tab');
  return container && useTutorialPlayer.getState().chapter !== null
    ? { tabId: tab.id, container, kind: 'academy' }
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
export function textInRect(card: Element, rect: CaptureRect): string {
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
export function attachStep(
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
    kind: kind === 'text' ? 'text' : 'region',
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

/**
 * "Ask about this step": the step on `card` is attached as a whole (nothing pointed at) and the
 * chat opens next to `anchor` (the button). Nothing is sent. False when no step is on screen.
 */
export function askAboutStep(card: Element, anchor: Element): boolean {
  const target = academyTarget();
  if (!target || !target.container.contains(card)) return false;
  useCapture.getState().setTextMode(false);
  return attachStep(
    target,
    card,
    'whole',
    '',
    toCaptureRect(anchor.getBoundingClientRect()),
    [],
    null,
  );
}

export function focusInput() {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLTextAreaElement>('.ai-panel .ai-input');
    if (input && !input.disabled) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}
