// "New tutorial", step 2 of the wizard: what to learn, three ways, one section each: (1) typed in
// your own words; (2) subjects Hoot finds for the role of step 1, deeply tied to that craft (the
// one control here that spends tokens, through its confirmation card); (3) the ready-made cards
// built locally from the project profile (no AI), the ones that fit the role first. A failed
// outline comes back here with the subjects that may work better.

import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { TutorialSubject } from '../../ipc/types';
import { selectAcademyBusy, useAcademy } from '../../stores/academy';
import { InlineCode } from '../quiz/InlineCode';
import { roleFamily } from '../quiz/quizRoles';
import { PickDialog } from './PickDialog';
import { rankTutorialSubjects, suggestedFor } from './tutorialRoles';
import { WizardSteps } from './WizardSteps';

/** "a Level designer", "an Artist": the role as written (acronyms kept). */
const articled = (role: string) => `${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}`;

export function AcademyCreate() {
  const subjects = useAcademy((s) => s.subjects);
  const failure = useAcademy((s) => s.failure);
  const chooseText = useAcademy((s) => s.chooseText);
  const editRole = useAcademy((s) => s.editRole);
  const role = useAcademy((s) => s.setup.role.trim() || 'Developer');
  const typed = useAcademy((s) => (s.setup.subjectId === null ? s.setup.subject : ''));
  const busy = useAcademy(selectAcademyBusy);
  const [text, setText] = useState(typed);
  const ids = { prompt: useId(), forRole: useId(), ready: useId() };
  const cards = subjects?.cards ?? [];

  return (
    <div className="academy-create">
      <div className="academy-wizard-head">
        <Button variant="ghost" onClick={editRole}>
          <ArrowLeft aria-hidden /> Back
        </Button>
        <WizardSteps current="subject" />
      </div>
      <h1 className="quiz-title">New tutorial</h1>
      <p className="quiz-lead">
        Choose what to learn as {articled(role)}, one of three ways. Hoot writes it from this
        project&apos;s own files; every step cites a file you can open.
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

      <Way
        number={1}
        titleId={ids.prompt}
        title="What do you want to learn?"
        lead="In your own words: a question, a feature, a task you have to do."
      >
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
      </Way>

      <WayOr />

      <Way
        number={2}
        titleId={ids.forRole}
        title={`Subjects for ${articled(role)}, found by Hoot`}
        lead={`Hoot reads the project and proposes subjects tied to your work as ${articled(role)}: what you make, touch and decide here. Uses AI, after a confirmation.`}
        ai
      >
        <RoleSuggestions cards={cards} role={role} tooThin={subjects?.tooThin === true} />
      </Way>

      <WayOr />

      <Way
        number={3}
        titleId={ids.ready}
        title="Ready-made subjects"
        lead={`Built from the project's files, without AI, for any reader. The ones that fit ${articled(role)} come first.`}
      >
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
          <SubjectCards cards={cards.filter((c) => c.kind !== 'suggested')} role={role} />
        )}
      </Way>
    </div>
  );
}

/** One of the three ways to choose a subject: a numbered, titled section. */
function Way({
  number,
  titleId,
  title,
  lead,
  ai,
  children,
}: {
  number: number;
  titleId: string;
  title: string;
  lead: string;
  ai?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="academy-way" data-ai={ai ? 'true' : undefined} aria-labelledby={titleId}>
      <header className="academy-way-head">
        <span className="academy-way-number" aria-hidden>
          {number}
        </span>
        <div>
          <div className="academy-way-titlebar">
            <h2 className="academy-way-title" id={titleId}>
              {title}
            </h2>
            {ai && <AiMark />}
          </div>
          <p className="academy-way-lead">{lead}</p>
        </div>
      </header>
      <div className="academy-way-body">{children}</div>
    </section>
  );
}

function WayOr() {
  return (
    <div className="academy-way-or" aria-hidden>
      <span>or</span>
    </div>
  );
}

/** Way 2: the subjects suggested for this role, and the button that asks for (more of) them. */
function RoleSuggestions({
  cards,
  role,
  tooThin,
}: {
  cards: TutorialSubject[];
  role: string;
  tooThin: boolean;
}) {
  const prepareSuggest = useAcademy((s) => s.prepareSuggest);
  const busy = useAcademy(selectAcademyBusy);
  const suggesting = useAcademy((s) => s.generation?.kind === 'suggest');
  const chooseCard = useAcademy((s) => s.chooseCard);
  const mine = useMemo(() => suggestedFor(cards, role), [cards, role]);
  return (
    <>
      {mine.length > 0 ? (
        <ul className="academy-cards">
          {mine.map((c) => (
            <li key={c.id}>
              <SubjectCard
                card={c}
                onChoose={() => {
                  chooseCard(c);
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="quiz-muted">
          {suggesting
            ? 'Hoot is reading the project…'
            : `No subject found for ${articled(role)} yet.`}
        </p>
      )}
      <div>
        <Button onClick={() => void prepareSuggest()} disabled={busy || tooThin}>
          <Sparkles aria-hidden />{' '}
          {suggesting
            ? 'Finding subjects…'
            : mine.length > 0
              ? `Find more subjects for ${articled(role)}`
              : `Find subjects for ${articled(role)}`}
          <AiMark />
        </Button>
      </div>
    </>
  );
}

const MATERIAL_DOTS = { some: 2, rich: 3 } as const;

interface CardGroup {
  name: string;
  cards: TutorialSubject[];
}

/** The cards by family: universal first, then the domains, then the suggestions. */
function byFamily(cards: TutorialSubject[]): CardGroup[] {
  const out: CardGroup[] = [];
  for (const c of cards) {
    const name = c.kind === 'universal' ? 'For any project' : c.family;
    const g = out.find((x) => x.name === name);
    if (g) g.cards.push(c);
    else out.push({ name, cards: [c] });
  }
  return out;
}

/**
 * The cards for the role: those that fit it first ("For a level designer"), the others by
 * family, and those about what the role never touches behind "More subjects".
 */
function SubjectCards({ cards, role }: { cards: TutorialSubject[]; role: string }) {
  const chooseCard = useAcademy((s) => s.chooseCard);
  const [picking, setPicking] = useState<TutorialSubject | null>(null);
  const [showMore, setShowMore] = useState(false);
  const { groups, more } = useMemo(() => {
    const ranked = rankTutorialSubjects(cards, roleFamily(role));
    const first: CardGroup[] =
      ranked.forRole.length > 0 ? [{ name: `For ${articled(role)}`, cards: ranked.forRole }] : [];
    return { groups: [...first, ...byFamily(ranked.rest)], more: byFamily(ranked.more) };
  }, [cards, role]);
  const moreCount = more.reduce((n, g) => n + g.cards.length, 0);
  const onChoose = (c: TutorialSubject) => {
    if (c.picks.length > 0) setPicking(c);
    else chooseCard(c);
  };
  return (
    <>
      {groups.map((g) => (
        <CardFamily key={g.name} group={g} onChoose={onChoose} />
      ))}
      {moreCount > 0 &&
        (showMore ? (
          more.map((g) => <CardFamily key={g.name} group={g} onChoose={onChoose} />)
        ) : (
          <Button
            variant="ghost"
            className="academy-more-subjects"
            onClick={() => {
              setShowMore(true);
            }}
          >
            More subjects ({moreCount})
          </Button>
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

function CardFamily({
  group,
  onChoose,
}: {
  group: CardGroup;
  onChoose: (card: TutorialSubject) => void;
}) {
  return (
    <div className="academy-family">
      <h3 className="academy-family-title">{group.name}</h3>
      <ul className="academy-cards">
        {group.cards.map((c) => (
          <li key={c.id}>
            <SubjectCard
              card={c}
              onChoose={() => {
                onChoose(c);
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubjectCard({ card: c, onChoose }: { card: TutorialSubject; onChoose: () => void }) {
  return (
    <button type="button" className="academy-card" data-kind={c.kind} onClick={onChoose}>
      {c.kind === 'universal' && <span className="academy-card-family">{c.family}</span>}
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
  );
}
