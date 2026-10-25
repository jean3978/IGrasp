// One line at the top of the chat that recalls what the chat is about: "Selection · lines 3–7 ·
// Start of the text…". It shows the attached selection, or the one already sent while it is
// still highlighted. ✕ drops it (and its highlight).

import { SquareDashedMousePointer, TextCursor, X } from 'lucide-react';
import type { AiCapture } from '../../ipc/types';
import { useAiPanel } from '../../stores/aiPanel';
import { useCapture } from '../../stores/capture';
import { selectionExcerpt, useSelectionCapture } from './selectionText';

const linesLabel = (c: AiCapture) =>
  c.firstLine === c.lastLine
    ? `line ${String(c.firstLine)}`
    : `lines ${String(c.firstLine)}–${String(c.lastLine)}`;

export function SelectionLine() {
  const capture = useSelectionCapture();
  const step = useAiPanel((s) => s.attachment?.step ?? null);
  const sent = useAiPanel((s) => s.attachment === null);
  const setAttachment = useAiPanel((s) => s.setAttachment);
  const setHighlight = useCapture((s) => s.setHighlight);
  if (step) {
    const excerpt = step.quote ? selectionExcerpt({ text: step.quote }) : '';
    return (
      <div className="ai-selection-line" role="group" aria-label={`About ${step.label}`}>
        {step.kind === 'text' ? (
          <TextCursor aria-hidden />
        ) : (
          <SquareDashedMousePointer aria-hidden />
        )}
        <span className="ai-selection-kind">Step</span>
        <span className="ai-selection-dot" aria-hidden>
          ·
        </span>
        <span className="ai-selection-lines">{step.label}</span>
        {excerpt && (
          <>
            <span className="ai-selection-dot" aria-hidden>
              ·
            </span>
            <span className="ai-selection-excerpt">{excerpt}</span>
          </>
        )}
        <button
          type="button"
          className="ai-selection-remove"
          aria-label="Remove the step"
          title="Leave it out"
          onClick={() => {
            setAttachment(null);
            setHighlight(null);
          }}
        >
          <X aria-hidden />
        </button>
      </div>
    );
  }
  if (!capture) return null;
  const isText = capture.selection !== undefined;
  const excerpt = selectionExcerpt(capture);
  const kind = isText ? 'Selection' : 'Region';
  return (
    <div
      className="ai-selection-line"
      role="group"
      aria-label={`${kind}: ${capture.sourcePath} ${linesLabel(capture)}`}
      title={`${capture.sourcePath}, ${linesLabel(capture)}${sent ? ' (already sent)' : ''}`}
    >
      {isText ? <TextCursor aria-hidden /> : <SquareDashedMousePointer aria-hidden />}
      <span className="ai-selection-kind">{kind}</span>
      <span className="ai-selection-dot" aria-hidden>
        ·
      </span>
      <span className="ai-selection-lines">{linesLabel(capture)}</span>
      {excerpt && (
        <>
          <span className="ai-selection-dot" aria-hidden>
            ·
          </span>
          <span className="ai-selection-excerpt">{excerpt}</span>
        </>
      )}
      <button
        type="button"
        className="ai-selection-remove"
        aria-label={isText ? 'Remove the selection' : 'Remove the selected region'}
        title="Leave it out"
        onClick={() => {
          setAttachment(null);
          setHighlight(null);
        }}
      >
        <X aria-hidden />
      </button>
    </div>
  );
}
