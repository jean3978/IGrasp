// Region capture, wired to the app: the overlay over the active tab's scroll container, the text
// of the selected lines, then the attachment of the AI chat. Nothing is sent: the
// panel opens with the chip and a pre-filled draft, and the user presses Send.

import { useEffect } from 'react';
import type { AiCapture } from '../../ipc/types';
import { useAiPanel } from '../../stores/aiPanel';
import { useCapture } from '../../stores/capture';
import { useDocuments } from '../../stores/documents';
import { selectActiveTab, useTabs } from '../../stores/tabs';
import { useTextFiles } from '../../stores/textFiles';
import { useWorkspace } from '../../stores/workspace';
import { CaptureOverlay } from './CaptureOverlay';
import { captureCodeRegion, captureMarkdownRegion } from './capture';
import type { CaptureRect } from './capture';

export const DRAFT_PREFIX = 'About this region:';

/** The scroll container and source of the active tab, when it is a document or a code tab. */
function activeTarget(): {
  container: HTMLElement;
  kind: 'document' | 'code';
  path: string;
} | null {
  const tab = selectActiveTab(useTabs.getState());
  if (!tab || tab.relPath === null) return null;
  if (tab.kind === 'document') {
    const container = document.querySelector<HTMLElement>('.tab-content .document-scroll');
    return container ? { container, kind: 'document', path: tab.relPath } : null;
  }
  if (tab.kind === 'code') {
    const container = document.querySelector<HTMLElement>('.tab-content .code-scroll');
    return container ? { container, kind: 'code', path: tab.relPath } : null;
  }
  return null;
}

function capture(rect: CaptureRect): void {
  const target = activeTarget();
  useCapture.getState().stop();
  if (!target) return;
  const { container, kind, path } = target;
  const source =
    kind === 'document'
      ? useDocuments.getState().byPath[path]?.content
      : useTextFiles.getState().byPath[path]?.content;
  if (source === undefined) return;
  const lines =
    kind === 'document'
      ? captureMarkdownRegion(container, rect, source)
      : captureCodeRegion(container, rect, source);
  if (!lines) return;
  const region: AiCapture = {
    sourcePath: path,
    firstLine: lines.firstLine,
    lastLine: lines.lastLine,
    text: lines.text,
  };

  const panel = useAiPanel.getState();
  const attachment = { capture: region, image: null };
  panel.setAttachment(attachment);
  if (panel.draft.trim() === '') panel.setDraft(DRAFT_PREFIX);
  panel.setOpen(true);
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLTextAreaElement>('.ai-panel .ai-input');
    if (input && !input.disabled) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

export function CaptureHost() {
  const active = useCapture((s) => s.active);
  const tabId = useTabs((s) => s.activeId);
  const hasRoot = useWorkspace((s) => s.root !== null);
  // Switching tabs or closing the folder ends the selection.
  useEffect(() => {
    useCapture.getState().stop();
  }, [tabId, hasRoot]);

  const target = active ? activeTarget() : null;
  if (!target) return null;
  return (
    <CaptureOverlay
      container={target.container}
      onCapture={(rect) => {
        capture(rect);
      }}
      onCancel={() => {
        useCapture.getState().stop();
      }}
    />
  );
}
