// "Look it up": the files a question cites, opened before answering, in a glowing window with Hoot
// perched on its top edge, eyes following the pointer. Nobody knows a project by heart; reading
// the file is part of learning it. The cited lines are scrolled into view but not marked, so the
// answer is still yours to find. Using it is recorded with the answer, like the hint.

import { clsx } from 'clsx';
import { Dialog } from 'radix-ui';
import { BookOpen, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button } from '../../components/ui/Button';
import type { QuizQuestion, QuizSource } from '../../ipc/types';
import { useTextFiles } from '../../stores/textFiles';
import { splitLines, MAX_HIGHLIGHT_BYTES, MAX_HIGHLIGHT_LINES } from '../code/codeLines';
import { languageOf } from '../code/languages';
import type { ThemedToken } from '../preview/pipeline/highlight';
import { Hoot } from '../hoot/Hoot';
import '../code/code.css';
import { InlineCode } from './InlineCode';
import { lookUpSources } from './quizSources';

const LINE_HEIGHT = 20;
/** Lines shown above the cited ones when the file opens. */
const CONTEXT_LINES = 6;

const tokenize = async (code: string, lang: string) =>
  (await import('../preview/pipeline/highlight')).tokenizeCode(code, lang);

function SourceText({ source }: { source: QuizSource }) {
  const { path } = source;
  const file = useTextFiles((s) => s.byPath[path]);
  const [tokens, setTokens] = useState<{ content: string; lines: ThemedToken[][] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const content = file?.status === 'ready' ? file.content : '';
  const lines = useMemo(() => splitLines(content), [content]);
  const language = languageOf(path);
  const highlighted = tokens?.content === content ? tokens.lines : null;

  useEffect(() => {
    const files = useTextFiles.getState();
    if (files.byPath[path]?.status !== 'ready') void files.load(path);
  }, [path]);

  useEffect(() => {
    if (!language || content === '') return;
    if (content.length > MAX_HIGHLIGHT_BYTES || lines.length > MAX_HIGHLIGHT_LINES) return;
    let cancelled = false;
    tokenize(content, language)
      .then((result) => {
        if (!cancelled && result) setTokens({ content, lines: result });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [content, language, lines.length]);

  // Near the cited lines, with some context above them.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || content === '') return;
    el.scrollTop = Math.max(0, (source.firstLine ?? 1) - 1 - CONTEXT_LINES) * LINE_HEIGHT;
  }, [content, source.firstLine]);

  if (!file || file.status === 'loading') return <p className="quiz-look-status">Opening…</p>;
  if (file.status === 'error')
    return (
      <p className="quiz-look-status" role="alert">
        Cannot open {path}: {file.error}
      </p>
    );
  return (
    <div
      ref={scrollRef}
      className="quiz-look-code"
      tabIndex={0}
      role="region"
      aria-label={`${path}, read-only`}
      style={{ '--gutter-chars': String(String(lines.length).length) } as CSSProperties}
    >
      {lines.map((line, i) => {
        const lineTokens = highlighted?.[i];
        return (
          <div key={i} className="quiz-look-line">
            <span className="quiz-look-ln" aria-hidden>
              {i + 1}
            </span>
            <span className="code-text quiz-look-text">
              {lineTokens
                ? lineTokens.map((t, k) => (
                    <span key={k} style={t.style as CSSProperties}>
                      {t.content}
                    </span>
                  ))
                : line}
              {'\n'}
            </span>
          </div>
        );
      })}
      {file.truncated && (
        <p className="quiz-look-status">The rest of this file is too long to show here.</p>
      )}
    </div>
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
