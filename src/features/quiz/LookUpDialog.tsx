// "Look it up": the files a question cites, opened before answering, in a glowing window with Hoot
// perched on its top edge, eyes following the pointer. Nobody knows a project by heart; reading
// the file is part of learning it. The cited lines are scrolled into view but not marked, so the
// answer is still yours to find. Using it is recorded with the answer, like the hint.

import { clsx } from 'clsx';
import { Dialog } from 'radix-ui';
import { BookOpen, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { CodeView } from '../../components/CodeView';
import { Button } from '../../components/ui/Button';
import type { QuizQuestion, QuizSource } from '../../ipc/types';
import { Hoot } from '../hoot/Hoot';
import { InlineCode } from './InlineCode';
import { lookUpSources } from './quizSources';

/** The cited file, scrolled near the cited lines but not marked: the answer is yours to find. */
function SourceText({ source }: { source: QuizSource }) {
  return (
    <CodeView
      path={source.path}
      scrollTo={source.firstLine ?? undefined}
      className="quiz-look-code"
      label={`${source.path}, read-only`}
    />
  );
}

export function LookUpDialog({
  question,
  open,
  onOpenChange,
  motion,
  onClosed,
}: {
  question: QuizQuestion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  motion: boolean;
  /** Where the focus goes back when the window closes. */
  onClosed?: () => void;
}) {
  const sources = lookUpSources(question);
  const [active, setActive] = useState(0);
  const descId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const source = sources[Math.min(active, sources.length - 1)];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          ref={contentRef}
          className="quiz-look"
          aria-describedby={descId}
          // The window itself takes the focus (not the close button): arrows and PageDown
          // then reach the file once it is focused with Tab.
          tabIndex={-1}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            contentRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            if (!onClosed) return;
            e.preventDefault();
            onClosed();
          }}
        >
          <div className="quiz-look-hoot">
            <Hoot
              state="idle"
              size={104}
              followPointer
              motion={motion}
              label="Hoot, reading along with you"
            />
          </div>
          <header className="quiz-look-header">
            <Dialog.Title className="quiz-look-title">
              <BookOpen aria-hidden /> Look it up
            </Dialog.Title>
            <Dialog.Close className="dialog-close" aria-label="Close">
              <X aria-hidden />
            </Dialog.Close>
          </header>
          <p className="quiz-look-question" id={descId}>
            <InlineCode text={question.question} />
          </p>
          {sources.length > 1 && (
            <div className="quiz-look-files" role="group" aria-label="Files">
              {sources.map((s, i) => (
                <button
                  key={s.path}
                  type="button"
                  className={clsx('quiz-look-file', { 'quiz-look-file-active': i === active })}
                  aria-pressed={i === active}
                  onClick={() => {
                    setActive(i);
                  }}
                >
                  {s.path}
                </button>
              ))}
            </div>
          )}
          {sources.length === 1 && source && <p className="quiz-look-path">{source.path}</p>}
          {source && <SourceText key={source.path} source={source} />}
          <footer className="quiz-look-footer">
            <Dialog.Close asChild>
              <Button variant="primary">Back to the question</Button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
