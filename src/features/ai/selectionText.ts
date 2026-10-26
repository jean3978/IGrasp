// What the chat says about the selection it is about (the attachment, or the highlighted one
// already sent).

import type { AiCapture } from '../../ipc/types';
import { useAiPanel } from '../../stores/aiPanel';
import { useCapture } from '../../stores/capture';

/** The capture the chat is about: the attachment first, else the highlighted one. */
export function useSelectionCapture(): AiCapture | null {
  const attached = useAiPanel((s) => s.attachment?.capture ?? null);
  const highlighted = useCapture((s) => s.highlight?.capture ?? null);
  const aboutStep = useAiPanel((s) => s.attachment?.step !== undefined);
  if (aboutStep) return null;
  return attached ?? highlighted;
}

/** The first words of the selection, without markdown marks, on one line. */
export function selectionExcerpt(capture: Pick<AiCapture, 'text' | 'selection'>, max = 80): string {
  const raw = capture.selection ?? capture.text;
  const flat = raw
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
