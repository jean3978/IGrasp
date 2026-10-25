// "New tutorial", step 1 of the wizard: what to learn, typed or picked among the subject cards
// built locally from the project profile (no AI). "Suggest more subjects" is the one control here
// that spends tokens, through its confirmation card. A failed outline comes back here with the
// subjects that may work better.

import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { TutorialSubject } from '../../ipc/types';
import { selectAcademyBusy, useAcademy } from '../../stores/academy';
import { InlineCode } from '../quiz/InlineCode';
import { PickDialog } from './PickDialog';
import { WizardSteps } from './WizardSteps';

export function AcademyCreate() {
  const subjects = useAcademy((s) => s.subjects);
  const failure = useAcademy((s) => s.failure);
  const chooseText = useAcademy((s) => s.chooseText);
  const backHome = useAcademy((s) => s.backHome);
  const typed = useAcademy((s) => (s.setup.subjectId === null ? s.setup.subject : ''));
  const busy = useAcademy(selectAcademyBusy);
  const [text, setText] = useState(typed);
  const ids = { prompt: useId(), cards: useId() };

  return (
    <div className="academy-create">
      <div className="academy-wizard-head">
        <Button variant="ghost" onClick={backHome}>
          <ArrowLeft aria-hidden /> Academy
        </Button>
        <WizardSteps current="subject" />
      </div>
      <h1 className="quiz-title">New tutorial</h1>
      <p className="quiz-lead">
        Choose what to learn. Hoot writes it from this project&apos;s own files; every step cites a
        file you can open.
      </p>

      {failure && (
        <section className="quiz-panel quiz-failure" role="alert">
          <p>{failure.message}</p>
          {failure.suggestedSubjects.length > 0 && (
            <div className="academy-chips" aria-label="Subjects that may work better">
              {failure.suggestedSubjects.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="academy-chip"
                  onClick={() => {
                    chooseText(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="quiz-panel academy-learn" aria-labelledby={ids.prompt}>
        <h2 className="academy-learn-title" id={ids.prompt}>
          What do you want to learn?
        </h2>
        <form
          className="academy-learn-form"
          onSubmit={(e) => {
            e.preventDefault();
            chooseText(text);
          }}
        >
          <input
            className="academy-learn-input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            placeholder="How does a file change reach the screen? I want to add a new command…"
            aria-labelledby={ids.prompt}
            maxLength={300}
            // The first thing to do on this step.
            autoFocus
          />
          <Button type="submit" variant="primary" disabled={text.trim() === '' || busy}>
            Next <ArrowRight aria-hidden />
          </Button>
        </form>
      </section>

      <section className="academy-cards-section" aria-labelledby={ids.cards}>
        <div className="academy-section-head">
          <h2 className="quiz-panel-title" id={ids.cards}>
            Or pick a subject of this project
          </h2>
          <SuggestMore />
        </div>
        {subjects === null ? (
          <p className="quiz-muted" role="status">
            Looking at the project…
          </p>
        ) : subjects.tooThin ? (
          <p className="quiz-muted">
            This folder has too little text for a tutorial: Hoot needs code, configuration or
            documentation to build on.
          </p>
        ) : (
          <SubjectCards cards={subjects.cards} />
        )}
      </section>
    </div>
  );
}

function SuggestMore() {
  const prepareSuggest = useAcademy((s) => s.prepareSuggest);
  const busy = useAcademy(selectAcademyBusy);
  const suggesting = useAcademy((s) => s.generation?.kind === 'suggest');
  return (
    <Button
      onClick={() => void prepareSuggest()}
      disabled={busy}
      title="Ask the AI for more subjects about this project (shows a confirmation first)"
    >
      <Sparkles aria-hidden /> {suggesting ? 'Suggesting…' : 'Suggest more subjects'}
      <AiMark />
    </Button>
  );
}

const MATERIAL_DOTS = { some: 2, rich: 3 } as const;

/** The cards grouped by family: universal first, then the domains, then the suggestions. */
function SubjectCards({ cards }: { cards: TutorialSubject[] }) {
  const chooseCard = useAcademy((s) => s.chooseCard);
  const [picking, setPicking] = useState<TutorialSubject | null>(null);
  const groups = useMemo(() => {
    const out: { name: string; cards: TutorialSubject[] }[] = [];
    const add = (name: string, c: TutorialSubject) => {
      const g = out.find((x) => x.name === name);
      if (g) g.cards.push(c);
      else out.push({ name, cards: [c] });
    };
    for (const c of cards) add(c.kind === 'universal' ? 'For any project' : c.family, c);
    return out;
  }, [cards]);
  return (
    <>
      {groups.map((g) => (
        <div key={g.name} className="academy-family">
          <h3 className="academy-family-title">{g.name}</h3>
          <ul className="academy-cards">
            {g.cards.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="academy-card"
                  data-kind={c.kind}
                  onClick={() => {
                    if (c.picks.length > 0) setPicking(c);
                    else chooseCard(c);
                  }}
                >
                  {c.kind === 'universal' && (
                    <span className="academy-card-family">{c.family}</span>
                  )}
                  <span className="academy-card-title">{c.title}</span>
                  <span className="academy-card-blurb">
                    <InlineCode text={c.blurb} />
                  </span>
                  <span
                    className="academy-card-material"
                    aria-label={`${c.material === 'rich' ? 'Rich' : 'Some'} material`}
                  >
                    {Array.from({ length: 3 }, (_, i) => (
                      <span
                        key={i}
                        className="academy-dot"
                        data-on={i < MATERIAL_DOTS[c.material] ? 'true' : undefined}
                      />
                    ))}
                    {c.picks.length > 0 && <span className="academy-card-pick">Choose…</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <PickDialog
        card={picking}
        onClose={() => {
          setPicking(null);
        }}
        onPick={(card, pick) => {
          setPicking(null);
          chooseCard(card, pick);
        }}
      />
    </>
  );
}
