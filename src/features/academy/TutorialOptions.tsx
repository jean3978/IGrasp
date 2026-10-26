// "New tutorial", step 3 of the wizard: familiarity, "I'm new to…" (the project's domains as
// chips), length and model (the role is step 1), then "Plan the outline" (which shows the
// confirmation card: nothing is spent before its own Start).

import { ArrowLeft, Play } from 'lucide-react';
import { useId } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import { selectAcademyBusy, useAcademy } from '../../stores/academy';
import { ModelPicker } from '../ai/ModelPicker';
import { WizardSteps } from './WizardSteps';
import {
  FAMILIARITIES,
  FAMILIARITY_HINT,
  FAMILIARITY_LABEL,
  LENGTHS,
  LENGTH_LABEL,
} from './labels';

export function TutorialOptions() {
  const setup = useAcademy((s) => s.setup);
  const setSetup = useAcademy((s) => s.setSetup);
  const prepareOutline = useAcademy((s) => s.prepareOutline);
  const editSubject = useAcademy((s) => s.editSubject);
  const domains = useAcademy((s) => s.subjects?.domains ?? []);
  const failure = useAcademy((s) => s.failure);
  const busy = useAcademy(selectAcademyBusy);
  const ids = {
    subject: useId(),
    gap: useId(),
    familiarity: useId(),
    length: useId(),
  };

  return (
    <div className="academy-options">
      <div className="academy-wizard-head">
        <Button variant="ghost" onClick={editSubject}>
          <ArrowLeft aria-hidden /> Back
        </Button>
        <WizardSteps current="options" />
      </div>
      <h1 className="quiz-title">Your tutorial</h1>

      {failure && (
        <section className="quiz-panel quiz-failure" role="alert">
          <p>{failure.message}</p>
        </section>
      )}

      <section className="quiz-panel">
        <label className="academy-field-label" htmlFor={ids.subject}>
          What you want to learn
        </label>
        <input
          id={ids.subject}
          className="academy-learn-input"
          value={setup.subject}
          maxLength={300}
          onChange={(e) => {
            setSetup({ subject: e.target.value, subjectId: null, picks: [] });
          }}
        />
      </section>

      <section className="quiz-panel" aria-labelledby={ids.familiarity}>
        <h2 className="quiz-panel-title" id={ids.familiarity}>
          How well do you know this project?
        </h2>
        <div className="academy-radio-cards" role="radiogroup" aria-labelledby={ids.familiarity}>
          {FAMILIARITIES.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={setup.familiarity === f}
              className="academy-radio-card"
              onClick={() => {
                setSetup({ familiarity: f });
              }}
            >
              <span className="academy-radio-title">{FAMILIARITY_LABEL[f]}</span>
              <span className="quiz-muted">{FAMILIARITY_HINT[f]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="quiz-panel">
        <label className="academy-field-label" htmlFor={ids.gap}>
          I&apos;m new to… <span className="quiz-muted">(optional)</span>
        </label>
        <input
          id={ids.gap}
          className="academy-learn-input"
          value={setup.domainGap}
          maxLength={200}
          placeholder="e.g. Unreal materials, web security, Rust async"
          onChange={(e) => {
            setSetup({ domainGap: e.target.value });
          }}
        />
        {domains.length > 0 && (
          <div className="academy-chips" role="group" aria-label="Domains this project uses">
            {domains.map((d) => (
              <button
                key={d}
                type="button"
                className="academy-chip"
                aria-pressed={setup.domainGap === d}
                onClick={() => {
                  setSetup({ domainGap: setup.domainGap === d ? '' : d });
                }}
              >
                {d}
              </button>
            ))}
          </div>
        )}
        <p className="quiz-muted">
          Hoot teaches that domain through this project&apos;s own use of it, a concept at a time,
          never as a separate course.
        </p>
      </section>

      <section className="quiz-panel" aria-labelledby={ids.length}>
        <h2 className="quiz-panel-title" id={ids.length}>
          Length
        </h2>
        <div className="academy-radio-cards" role="radiogroup" aria-labelledby={ids.length}>
          {LENGTHS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={setup.length === l}
              className="academy-radio-card"
              onClick={() => {
                setSetup({ length: l });
              }}
            >
              <span className="academy-radio-title">{LENGTH_LABEL[l].name}</span>
              <span className="quiz-muted">{LENGTH_LABEL[l].detail}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="quiz-panel academy-options-row">
        <div>
          <span className="academy-field-label">Model</span>
          <ModelPicker />
        </div>
      </section>

      <div className="academy-actions">
        <Button
          variant="primary"
          onClick={() => void prepareOutline()}
          disabled={busy || setup.subject.trim() === ''}
        >
          <Play aria-hidden /> Plan the outline <AiMark />
        </Button>
        <span className="quiz-muted">
          First a short outline you can edit; the chapters come after, on your click.
        </span>
      </div>
    </div>
  );
}
