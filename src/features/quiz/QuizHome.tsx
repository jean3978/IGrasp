// The quiz home: the project profile, the subject chips, the options of a new quiz (questions,
// mode, sources, model) and Start (the AI marker: the card that follows leads to the one call),
// the quiz to continue, the last results with Play again (no AI) and the provider's problems.

import { FolderOpen, Play, RotateCcw } from 'lucide-react';
import { useId } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { QuizMode, QuizScopeSetting } from '../../ipc/types';
import { selectUsable, useAiProvider } from '../../stores/aiProvider';
import { selectQuizBusy, targetReady, useQuiz } from '../../stores/quiz';
import { ModelPicker } from '../ai/ModelPicker';
import { StatusLine } from '../ai/StatusLine';
import { Hoot } from '../hoot/Hoot';
import { ProjectProfilePanel } from '../profile/ProjectProfilePanel';
import { Segmented } from '../settings/fields';
import { roundsOf } from './quizEngine';
import { formatWhen } from './quizFormat';
import { SubjectPicker } from './SubjectPicker';

const MODES: { value: QuizMode; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'adaptive', label: 'Adaptive' },
];

const SCOPES: { value: QuizScopeSetting; label: string }[] = [
  { value: 'wholeProject', label: 'Whole project' },
  { value: 'documentationOnly', label: 'Documentation only' },
];

export const MIN_COUNT = 5;
export const MAX_COUNT = 30;

export function QuizHome({ hootLine }: { hootLine: string }) {
  const setup = useQuiz((s) => s.setup);
  const setSetup = useQuiz((s) => s.setSetup);
  const prepare = useQuiz((s) => s.prepare);
  const failure = useQuiz((s) => s.failure);
  const saved = useQuiz((s) => s.saved);
  const history = useQuiz((s) => s.history);
  const continueSaved = useQuiz((s) => s.continueSaved);
  const playAgain = useQuiz((s) => s.playAgain);
  const playFile = useQuiz((s) => s.playFile);
  const quizFiles = useQuiz((s) => s.quizFiles);
  const busy = useQuiz(selectQuizBusy);
  const usable = useAiProvider(selectUsable);
  const ids = { count: useId(), files: useId() };
  const checkingCode = setup.target === 'paths';
  const last = history[0];

  return (
    <div className="quiz-home">
      <section className="quiz-hero">
        <div className="quiz-hero-text">
          <h1 className="quiz-title">Quiz</h1>
          <p className="quiz-lead">
            Questions about how this project is made, written from its own files. Every question
            cites a file you can open.
          </p>
        </div>
        <Hoot state="idle" size={120} line={hootLine} />
      </section>

      {saved && (
        <section className="quiz-panel quiz-continue" aria-label="Quiz in progress">
          <div>
            <h2 className="quiz-panel-title">Continue your quiz</h2>
            <p className="quiz-muted">
              {saved.subjectTitle} · {saved.answers.length} of {saved.questions.length} answered ·
              level {saved.level}
              {saved.mode === 'adaptive' ? ' · adaptive' : ''}
            </p>
          </div>
          <Button variant="primary" onClick={continueSaved}>
            <Play aria-hidden /> Continue
          </Button>
        </section>
      )}

      {failure && (
        <section className="quiz-panel quiz-failure" role="alert">
          <p>{failure.message}</p>
          {failure.suggestedSubjects.length > 0 && (
            <p className="quiz-muted">
              Subjects that may work better: {failure.suggestedSubjects.join(' · ')}
            </p>
          )}
        </section>
      )}

      <section className="quiz-panel quiz-setup" aria-label="New quiz">
        <SubjectPicker />

        <div className="quiz-options">
          <label className="quiz-option" htmlFor={ids.count}>
            <span className="quiz-option-label">Questions</span>
            <input
              id={ids.count}
              className="quiz-count"
              type="number"
              min={MIN_COUNT}
              max={MAX_COUNT}
              value={setup.count}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setSetup({ count: Math.round(n) });
              }}
              onBlur={() => {
                setSetup({ count: Math.min(MAX_COUNT, Math.max(MIN_COUNT, setup.count)) });
              }}
            />
          </label>
          <div className="quiz-option">
            <span className="quiz-option-label">Mode</span>
            <Segmented<QuizMode>
              label="Mode"
              value={setup.mode}
              options={MODES}
              onChange={(mode) => {
                setSetup({ mode });
              }}
            />
          </div>
          <div className="quiz-option">
            <span className="quiz-option-label">Sources</span>
            <Segmented<QuizScopeSetting>
              label="Sources"
              value={setup.scope}
              options={SCOPES}
              disabled={checkingCode}
              onChange={(scope) => {
                setSetup({ scope });
              }}
            />
          </div>
          <div className="quiz-option">
            <span className="quiz-option-label">Model</span>
            <ModelPicker />
          </div>
        </div>
        <p className="quiz-muted quiz-option-help">
          {setup.mode === 'fixed'
            ? 'Fixed: all questions are written now, in one AI call; your level changes their order.'
            : `Adaptive: written in rounds of 5 as you play, at the level you reach. It calls the AI between rounds while you play: about ${String(roundsOf(setup.count))} calls for this quiz, each started by your click on Next round, with a short wait each time.`}{' '}
          {checkingCode
            ? 'Code check: only the files and folders you picked, in detail.'
            : setup.scope === 'wholeProject'
              ? 'Whole project: code, configuration, build, tests and docs.'
              : "Documentation only: what the project's markdown files say."}
        </p>

        <StatusLine part="problem" showSession={false} />
        <div className="quiz-start">
          <Button
            variant="primary"
            className="quiz-start-button"
            disabled={busy || !usable || !targetReady(setup)}
            onClick={() => void prepare()}
          >
            Start <AiMark />
          </Button>
          <span className="quiz-muted">Nothing is sent until you confirm on the next card.</span>
        </div>
      </section>

      {last && (
        <section className="quiz-panel quiz-last" aria-label="Last results">
          <div>
            <h2 className="quiz-panel-title">Last results</h2>
            <p className="quiz-muted">
              {last.subjectTitle} · {last.score} of {last.answered} right ·{' '}
              {formatWhen(last.finishedMs)}
            </p>
          </div>
          <Button
            onClick={() => void playAgain(last.id)}
            title="The same questions again, without the AI"
          >
            <RotateCcw aria-hidden /> Play again
          </Button>
        </section>
      )}

      <section className="quiz-panel quiz-files" aria-labelledby={ids.files}>
        <div className="quiz-files-head">
          <h2 className="quiz-panel-title" id={ids.files}>
            Saved quizzes
          </h2>
          <Button onClick={() => void playFile()} disabled={busy}>
            <FolderOpen aria-hidden /> Open quiz file…
          </Button>
        </div>
        {quizFiles.length === 0 ? (
          <p className="quiz-muted">
            Quizzes saved with “Save quiz…” on the results appear here; anyone can replay them
            without the AI.
          </p>
        ) : (
          <ul className="quiz-files-list">
            {quizFiles.map((f) => (
              <li key={f.relPath}>
                <button
                  type="button"
                  className="quiz-file"
                  disabled={busy}
                  onClick={() => void playFile(f.relPath)}
                  title={`Play ${f.relPath} (no AI call)`}
                >
                  <Play aria-hidden className="quiz-file-icon" />
                  <span className="quiz-file-title">{f.subject ?? f.title ?? f.relPath}</span>
                  <span className="quiz-muted">
                    {f.questions} question{f.questions === 1 ? '' : 's'}
                    {f.generated ? ` · ${formatGenerated(f.generated)}` : ''} · {f.relPath}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ProjectProfilePanel compact />
    </div>
  );
}

/** The `generated` date of a quiz file as a short date (as written when it does not parse). */
function formatGenerated(value: string): string {
  const ms = Date.parse(value);
  return Number.isNaN(ms)
    ? value
    : new Date(ms).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}
