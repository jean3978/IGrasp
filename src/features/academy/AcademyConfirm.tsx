// The confirmation card of a tutorial operation, always shown: what the AI will do, the
// provider and the model, what it inlines, the size, the number of calls and the cost line.
// Start is the user action; nothing runs before it.

import { useAiProvider, selectProviderName } from '../../stores/aiProvider';
import { useAcademy } from '../../stores/academy';
import { ConfirmCard } from '../ai/ConfirmCard';
import { WizardSteps } from './WizardSteps';

export function AcademyConfirm() {
  const pending = useAcademy((s) => s.pending);
  const confirmStart = useAcademy((s) => s.confirmStart);
  const cancelConfirm = useAcademy((s) => s.cancelConfirm);
  const provider = useAiProvider(selectProviderName);
  const model = useAiProvider((s) => s.model);
  if (!pending) return null;
  const { estimate } = pending;
  return (
    <div className="quiz-confirm academy-confirm">
      {pending.kind === 'outline' && (
        <div className="academy-wizard-head">
          <WizardSteps current="confirm" />
        </div>
      )}
      <ConfirmCard
        title={pending.title}
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
        {pending.kind === 'chapters' && (
          <li>
            {estimate.calls === 1
              ? `1 call: ${pending.chapters[0] ?? 'the chapter'}.`
              : `${String(estimate.calls)} calls in one operation, one chapter at a time: ${pending.chapters.join(' · ')}. You can start reading the first chapter while the next ones are written, and stop at any moment.`}
          </li>
        )}
        {pending.kind === 'outline' && (
          <li>One call: a short outline you can reorder, rename and trim before any chapter.</li>
        )}
        {pending.kind === 'review' && (
          <li>
            One call: the AI rereads the tutorial against the project as it is now and proposes
            replacements for outdated steps. Nothing changes until you accept them.
          </li>
        )}
        {estimate.costHint && <li>{estimate.costHint}</li>}
        <li>
          Read-only: the AI may read, list and search the files of this folder; it cannot change
          anything, run commands or browse the web.
        </li>
        <li>
          The size is a floor: the AI reads other files of the project while it works. Steps whose
          citations do not check out are rewritten, at most twice per call.
        </li>
        {pending.kind !== 'review' && (
          <li>The tutorial stays private, in the app&apos;s data, until you share it.</li>
        )}
      </ul>
    </div>
  );
}
