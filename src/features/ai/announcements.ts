// What the AI live region says when the conversation changes (plan §6.12). Pure: the announcer
// feeds it consecutive store states.

import { selectBusy } from '../../stores/aiConversation';
import type { AiConversationState, PendingPermission } from '../../stores/aiConversation';
import { decisionText } from './timeline';
import type { ChatItem } from './timeline';
import { usageText } from './usageFormat';

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function permissionText(name: string, p: PendingPermission): string {
  if (p.proposedEdit) return `${name} proposes an edit to ${baseName(p.proposedEdit.path)}.`;
  return `${name} asks to use ${p.tool}${p.description ? `: ${p.description}` : ''}.`;
}

function itemText(item: ChatItem): string | null {
  switch (item.kind) {
    case 'decision':
      return `${decisionText(item)}.`;
    case 'notice':
      // Errors are alerts in the transcript, announced there.
      return item.level === 'info' ? item.text : null;
    case 'usage':
      return `Usage: ${usageText(item)}.`;
    default:
      return null;
  }
}

/** What changed between two conversation states, as sentences. */
export function conversationAnnouncements(
  name: string,
  s: AiConversationState,
  prev: AiConversationState,
): string[] {
  const out: string[] = [];
  const busy = selectBusy(s);
  const wasBusy = selectBusy(prev);
  if (busy && !wasBusy) out.push(`${name} is answering…`);
  // Items appended by this change (a reset or a loaded conversation is not news).
  if (s.id === prev.id && s.items !== prev.items && s.items.length > prev.items.length) {
    const known = new Set(prev.items.map((i) => i.id));
    for (const item of s.items) {
      if (known.has(item.id)) continue;
      const text = itemText(item);
      if (text) out.push(text);
    }
  }
  const asked = new Set(prev.permissions.map((p) => p.requestId));
  for (const p of s.permissions) if (!asked.has(p.requestId)) out.push(permissionText(name, p));
  if (s.pendingConfirm && !prev.pendingConfirm) {
    out.push(`${s.pendingConfirm.title}: confirm with Start, or Cancel.`);
  }
  if (!busy && wasBusy && s.id === prev.id) out.push(`${name} finished.`);
  return out;
}
