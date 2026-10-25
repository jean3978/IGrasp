// The quiz home: Hoot, the quiz to continue, the new-quiz wizard (kind, subject, options and
// Start), the last results with Play again (no AI), the saved quizzes and the project profile.

import { FolderOpen, Play, RotateCcw } from 'lucide-react';
import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { selectQuizBusy, useQuiz } from '../../stores/quiz';
import { Hoot } from '../hoot/Hoot';
import { ProjectProfilePanel } from '../profile/ProjectProfilePanel';
import { formatWhen } from './quizFormat';
import { QuizWizard } from './QuizWizard';

export function QuizHome({ hootLine }: { hootLine: string }) {
  const failure = useQuiz((s) => s.failure);
  const saved = useQuiz((s) => s.saved);
  const history = useQuiz((s) => s.history);
  const continueSaved = useQuiz((s) => s.continueSaved);
  const playAgain = useQuiz((s) => s.playAgain);
  const playFile = useQuiz((s) => s.playFile);
  const quizFiles = useQuiz((s) => s.quizFiles);
  const busy = useQuiz(selectQuizBusy);
  const ids = { files: useId() };
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

      <QuizWizard />

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
