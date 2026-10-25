// The confirmation card of a quiz generation, always shown (the chat's threshold does not apply):
// the provider, the model, the documents inlined (agent files marked "context only"), the size
// as a floor, the adaptive caveat. Start is the user action; nothing runs before it.

import { useAiProvider, selectProviderName } from '../../stores/aiProvider';
import { useQuiz } from '../../stores/quiz';
import { ConfirmCard } from '../ai/ConfirmCard';
import { roundsOf } from './quizEngine';

export function QuizConfirm() {
  const pending = useQuiz((s) => s.pending);
  const estimate = useQuiz((s) => s.estimate);
  const record = useQuiz((s) => s.record);
  const confirmStart = useQuiz((s) => s.confirmStart);
  const cancelConfirm = useQuiz((s) => s.cancelConfirm);
  const provider = useAiProvider(selectProviderName);
  const model = useAiProvider((s) => s.model);
  if (!pending || !estimate) return null;
  const { input } = pending;
  const adaptive = input.mode === 'adaptive';
  const rounds = adaptive ? roundsOf(pending.count) : 1;
  const title =
    pending.kind === 'keepGoing'
      ? adaptive
        ? `Generate round ${String((record?.rounds ?? 0) + 1)} of ${String(rounds)}`
        : `Generate ${String(input.count)} more questions`
      : adaptive
        ? `Generate round 1 of ${String(rounds)}`
        : 'Generate a quiz';
  return (
    <div className="quiz-confirm">
      <ConfirmCard
        title={title}
        provider={provider}
        model={model}
        documents={estimate.inlined.map((d) => ({
          path: d.contextOnly ? `${d.path} (context only)` : d.path,
          bytes: d.bytes,
        }))}
        images={0}
        estimate={estimate}
        onStart={() => void confirmStart()}
        onCancel={cancelConfirm}
      />
      <ul className="quiz-confirm-notes">
        <li>
          Read-only: the AI may read, list and search the files of this folder; it cannot change
          anything, run commands or browse the web.
        </li>
        <li>
          {input.scope.type === 'documentationOnly'
            ? 'Sources: the documentation only.'
            : 'Sources: the whole project (code, configuration, build, tests and docs).'}
        </li>
        <li>
          The size is a floor: the AI reads other files of the project while it works. Questions
          that do not check out are rewritten, at most twice, within this one call.
        </li>
        {adaptive && (
          <li className="quiz-confirm-caveat">
            Adaptive mode calls the AI between rounds while you play: about {rounds} calls for this
            quiz, each started by your click on Next round, with a short wait each time.
          </li>
        )}
      </ul>
    </div>
  );
}
