// The AI features' live region (plan §6.12), always mounted so screen readers hear what happens
// even when the chat is closed: an answer starting and finishing, a permission or an edit waiting,
// automatic decisions and notices, and a selection attached to the chat. Streaming text is not
// announced word by word (the transcript has no live region of its own).

import { useEffect, useRef, useState } from 'react';
import { useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { selectProviderName, useAiProvider } from '../../stores/aiProvider';
import { conversationAnnouncements } from './announcements';
import { captureLabel } from './timeline';

export function AiAnnouncer() {
  const [message, setMessage] = useState('');
  const queue = useRef<string[]>([]);
  // The same sentence twice in a row must be heard twice: alternate a trailing space.
  const flip = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const announce = (texts: string[]) => {
      if (texts.length === 0) return;
      queue.current.push(...texts);
      // Several changes of one tick are read as one message.
      timer ??= setTimeout(() => {
        timer = undefined;
        flip.current = !flip.current;
        setMessage(queue.current.join(' ') + (flip.current ? '' : ' '));
        queue.current = [];
      }, 0);
    };
    const name = () => selectProviderName(useAiProvider.getState());
    const offConversation = useAiConversation.subscribe((s, prev) => {
      announce(conversationAnnouncements(name(), s, prev));
    });
    const offPanel = useAiPanel.subscribe((s, prev) => {
      if (s.attachment && s.attachment !== prev.attachment) {
        announce([
          s.attachment.capture
            ? `${s.attachment.capture.selection === undefined ? 'Region' : 'Selection'} attached: ${captureLabel(s.attachment.capture)}. Nothing is sent until you press Send.`
            : `${s.attachment.step.label} attached. Nothing is sent until you press Send.`,
        ]);
      }
    });
    return () => {
      offConversation();
      offPanel();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  return (
    <div
      className="visually-hidden ai-announcer"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
