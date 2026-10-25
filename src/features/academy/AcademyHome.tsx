// The Academy home: Hoot, the tutorial to continue, "What do you want to learn?", the subject
// cards built locally from the project profile (no AI), "I'm new to…", "Suggest more subjects"
// (the one control here that spends tokens, through its confirmation card), the library and the
// project profile. Opening it spends nothing.

import {
  ArrowRight,
  BookOpen,
  Download,
  ListChecks,
  Play,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { TutorialSubject, TutorialSummary } from '../../ipc/types';
import { selectAcademyBusy, useAcademy } from '../../stores/academy';
import { useTutorialWrite } from '../../stores/tutorialWrite';
import { Hoot } from '../hoot/Hoot';
import { ProjectProfilePanel } from '../profile/ProjectProfilePanel';
import { InlineCode } from '../quiz/InlineCode';
import { formatWhen } from '../quiz/quizFormat';
import { PickDialog } from './PickDialog';
import { badgeShort } from './freshnessView';
import { FAMILIARITY_LABEL, LENGTH_LABEL } from './labels';

export function AcademyHome({ hootLine }: { hootLine: string }) {
  const subjects = useAcademy((s) => s.subjects);
  const failure = useAcademy((s) => s.failure);
  const library = useAcademy((s) => s.library);
  const chooseText = useAcademy((s) => s.chooseText);
  const busy = useAcademy(selectAcademyBusy);
  const [text, setText] = useState('');
  const ids = { prompt: useId(), cards: useId(), library: useId() };
  const resume = useMemo(
    () =>
      library
        .filter((t) => t.progress && !t.progress.graduated && t.chaptersWritten > 0)
        .sort((a, b) => (b.progress?.lastOpenedMs ?? 0) - (a.progress?.lastOpenedMs ?? 0))[0],
    [library],
  );

  return (
    <div className="academy-home">
      <section className="quiz-hero">
        <div className="quiz-hero-text">
          <h1 className="quiz-title">Hoot&apos;s Academy</h1>
          <p className="quiz-lead">
            Tutorials about this project, written from its own files: every step cites a file you
            can open, and you take them at your pace.
          </p>
        </div>
        <Hoot state="idle" size={120} line={hootLine} />
      </section>

      {resume && <ContinueCard summary={resume} />}

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
          />
          <Button type="submit" variant="primary" disabled={text.trim() === '' || busy}>
            Next <ArrowRight aria-hidden />
          </Button>
        </form>
        <NewToDomain domains={subjects?.domains ?? []} />
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

      <Library tutorials={library} labelledBy={ids.library} />

      <ProjectProfilePanel compact />
    </div>
  );
}

function ContinueCard({ summary }: { summary: TutorialSummary }) {
  const openTutorial = useAcademy((s) => s.openTutorial);
  const p = summary.progress;
  return (
    <section className="quiz-panel quiz-continue" aria-label="Tutorial in progress">
      <div>
        <h2 className="quiz-panel-title">Continue where you left off</h2>
        <p className="quiz-muted">
          {summary.title} · chapter {(p?.chapter ?? 0) + 1} of {summary.chapters} ·{' '}
          {p?.stepsDone ?? 0} of {summary.stepsTotal} steps · {p?.xp ?? 0} XP
        </p>
      </div>
      <Button
        variant="primary"
        onClick={() => {
          openTutorial(summary.reference);
        }}
      >
        <Play aria-hidden /> Resume
      </Button>
    </section>
  );
}

/** "I'm new to…": the domains of the project as chips, or typed. */
function NewToDomain({ domains }: { domains: string[] }) {
  const gap = useAcademy((s) => s.setup.domainGap);
  const setSetup = useAcademy((s) => s.setSetup);
  const id = useId();
  return (
    <div className="academy-newto">
      <label className="academy-newto-label" htmlFor={id}>
        I&apos;m new to…
      </label>
      <input
        id={id}
        className="academy-newto-input"
        value={gap}
        onChange={(e) => {
          setSetup({ domainGap: e.target.value });
        }}
        placeholder="a domain this project uses (optional)"
        maxLength={200}
      />
      {domains.length > 0 && (
        <div className="academy-chips" role="group" aria-label="Domains this project uses">
          {domains.map((d) => (
            <button
              key={d}
              type="button"
              className="academy-chip"
              aria-pressed={gap === d}
              onClick={() => {
                setSetup({ domainGap: gap === d ? '' : d });
              }}
            >
              {d}
            </button>
          ))}
        </div>
      )}
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

function Library({ tutorials, labelledBy }: { tutorials: TutorialSummary[]; labelledBy: string }) {
  const openTutorial = useAcademy((s) => s.openTutorial);
  const reviewOutline = useAcademy((s) => s.reviewOutline);
  const deleteTutorial = useAcademy((s) => s.deleteTutorial);
  const prepareWrite = useTutorialWrite((s) => s.prepare);
  const busy = useAcademy(selectAcademyBusy);
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <section className="quiz-panel academy-library" aria-labelledby={labelledBy}>
      <h2 className="quiz-panel-title" id={labelledBy}>
        Your tutorials
      </h2>
      {tutorials.length === 0 ? (
        <p className="quiz-muted">
          Tutorials you write appear here. They stay private (in the app&apos;s data, never in the
          project) until you share one.
        </p>
      ) : (
        <ul className="academy-library-list">
          {tutorials.map((t) => {
            const written = t.chaptersWritten;
            const p = t.progress;
            const key = t.reference.type === 'private' ? t.reference.id : t.reference.relPath;
            return (
              <li key={key} className="academy-row">
                <button
                  type="button"
                  className="academy-row-main"
                  onClick={() => {
                    if (written === 0 && t.reference.type === 'private')
                      void reviewOutline(t.reference.id);
                    else openTutorial(t.reference);
                  }}
                  disabled={busy && written === 0}
                >
                  <BookOpen aria-hidden className="academy-row-icon" />
                  <span className="academy-row-title">
                    {t.title}
                    {p?.graduated && (
                      <span className="academy-tag academy-tag-done">graduated</span>
                    )}
                    <span className="academy-tag">
                      {t.reference.type === 'shared'
                        ? `shared · ${t.reference.relPath}`
                        : 'private'}
                    </span>
                    {t.sharedAs && <span className="academy-tag">shared as {t.sharedAs}</span>}
                    {t.freshness && t.freshness.badge !== 'upToDate' && (
                      <span className="academy-tag academy-tag-warn">
                        {badgeShort(t.freshness)}
                      </span>
                    )}
                    {p && p.updated > 0 && (
                      <span className="academy-tag academy-tag-warn">
                        {p.updated} updated since you read {p.updated === 1 ? 'it' : 'them'}
                      </span>
                    )}
                    {t.verified && (
                      <span className="academy-tag academy-tag-done">
                        verified {t.verified.date.slice(0, 10)}
                      </span>
                    )}
                  </span>
                  <span className="quiz-muted">
                    {FAMILIARITY_LABEL[t.familiarity]} · {LENGTH_LABEL[t.length].name} ·{' '}
                    {written === t.chapters
                      ? `${String(t.chapters)} chapters`
                      : written === 0
                        ? `outline only (${String(t.chapters)} chapters)`
                        : `${String(written)} of ${String(t.chapters)} chapters written`}
                    {p
                      ? ` · ${String(p.stepsDone)} of ${String(t.stepsTotal)} steps · ${String(p.xp)} XP`
                      : ''}
                    {` · ${formatWhen(t.updatedMs)}`}
                  </span>
                </button>
                {written === 0 && t.reference.type === 'private' && (
                  <Button
                    variant="ghost"
                    onClick={() => void reviewOutline(key)}
                    title="Review the outline"
                  >
                    <ListChecks aria-hidden /> Outline
                  </Button>
                )}
                {t.reference.type === 'private' && written > 0 && (
                  <>
                    <Button
                      variant="ghost"
                      aria-label={`${t.sharedAs ? 'Update the shared copy of' : 'Share'} ${t.title}`}
                      title={
                        t.sharedAs
                          ? `Write this version again in ${t.sharedAs}`
                          : 'Share with the project: write it as markdown files in the folder'
                      }
                      onClick={() => void prepareWrite({ type: 'share', id: key }, t.title)}
                    >
                      <Share2 aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Save ${t.title} as…`}
                      title="Save a copy as markdown files in a folder you choose"
                      onClick={() => void prepareWrite({ type: 'export', id: key }, t.title)}
                    >
                      <Download aria-hidden />
                    </Button>
                  </>
                )}
                {t.reference.type === 'private' &&
                  (confirming === key ? (
                    <span
                      className="academy-row-confirm"
                      role="group"
                      aria-label="Delete this tutorial?"
                    >
                      <Button
                        variant="primary"
                        onClick={() => {
                          setConfirming(null);
                          void deleteTutorial(key);
                        }}
                      >
                        Delete
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setConfirming(null);
                        }}
                      >
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      aria-label={`Delete ${t.title}`}
                      title="Delete this private tutorial and your progress in it"
                      disabled={busy}
                      onClick={() => {
                        setConfirming(key);
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
