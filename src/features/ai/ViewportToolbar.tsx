// The AI tools over the view (top-right corner of every tab, and of the empty area): open the
// chat, the Academy, the quiz, the text mode (highlight text, release, and the chat opens next to it) and the region
// tool (drag a rectangle), the last two in markdown and code tabs. None of them spends tokens;
// Send does.

import { GraduationCap, Sparkles, SquareDashedMousePointer, TextCursor } from 'lucide-react';
import { useAiPanel } from '../../stores/aiPanel';
import { useCanCapture, useCapture } from '../../stores/capture';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { HootIcon } from '../hoot/HootIcon';
import { ActionButton } from '../titlebar/ToolbarActions';
import './viewportToolbar.css';

export function ViewportToolbar() {
  const hasRoot = useWorkspace((s) => s.root !== null);
  const chatOpen = useAiPanel((s) => s.open);
  const textMode = useCapture((s) => s.textMode);
  const regionMode = useCapture((s) => s.active);
  const canCapture = useCanCapture();
  const quizOpen = useTabs((s) => s.activeId === 'tab-quiz');
  const academyOpen = useTabs((s) => s.activeId === 'tab-academy');
  if (!hasRoot) return null;
  return (
    <div className="viewport-toolbar" role="toolbar" aria-label="AI tools">
      <ActionButton id="ai.chat" pressed={chatOpen} className="viewport-tool">
        <Sparkles aria-hidden />
      </ActionButton>
      <ActionButton id="learn.academy" pressed={academyOpen} className="viewport-tool">
        <GraduationCap aria-hidden />
      </ActionButton>
      <ActionButton id="learn.quiz" pressed={quizOpen} className="viewport-tool">
        <HootIcon />
      </ActionButton>
      <span className="viewport-toolbar-separator" aria-hidden />
      <ActionButton
        id="ai.selectText"
        pressed={textMode}
        disabled={!canCapture && !textMode}
        className="viewport-tool"
      >
        <TextCursor aria-hidden />
      </ActionButton>
      <ActionButton
        id="ai.capture"
        pressed={regionMode}
        disabled={!canCapture}
        className="viewport-tool"
      >
        <SquareDashedMousePointer aria-hidden />
      </ActionButton>
    </div>
  );
}
