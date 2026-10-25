// The subject step of the quiz wizard, one input per kind of quiz: the global concepts (with the
// whole project), the features, a subject of your own, or specific code to check (files or
// folders, for detailed questions, e.g. before submitting a change).

import { clsx } from 'clsx';
import { Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { Subject, SubjectGroup } from '../../ipc/types';
import { useProjectProfile } from '../../stores/projectProfile';
import { useQuiz } from '../../stores/quiz';
import { fileName, useTabs } from '../../stores/tabs';
import { useSubjects } from './useSubjects';

function SubjectChip({
  subject,
  selected,
  onSelect,
}: {
  subject: Subject | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const title = subject
    ? `${subject.title}: ${subject.focus}\nStarts from: ${subject.anchors.join(', ')}`
    : 'Questions about the whole project, with no specific subject';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={clsx('quiz-subject', { 'quiz-subject-selected': selected })}
      title={title}
      onClick={onSelect}
    >
      {subject ? subject.title : 'The whole project'}
      {subject?.material === 'rich' && (
        <span className="quiz-subject-badge" aria-label="plenty of material">
          ●●
        </span>
      )}
    </button>
  );
}

/** The chips of the global concepts (and the whole project) or of the features. */
export function SubjectChoices({ group, label }: { group: SubjectGroup; label: string }) {
  const setup = useQuiz((s) => s.setup);
  const setSetup = useQuiz((s) => s.setSetup);
  const shown = useSubjects(group);
  const onSubject = setup.target === 'subject';
  const selected = onSubject ? (shown.find((s) => s.id === setup.subjectId) ?? null) : null;
  return (
    <div className="quiz-subjects" role="radiogroup" aria-label={label}>
      {group === 'global' && (
        <SubjectChip
          subject={null}
          selected={onSubject && setup.subjectId === null}
          onSelect={() => {
            setSetup({ target: 'subject', subjectId: null });
          }}
        />
      )}
      {shown.map((s) => (
        <SubjectChip
          key={s.id}
          subject={s}
          selected={selected?.id === s.id}
          onSelect={() => {
            setSetup({ target: 'subject', subjectId: s.id });
          }}
        />
      ))}
    </div>
  );
}

const CUSTOM_PLACEHOLDERS: Record<SubjectGroup, string> = {
  global: 'e.g. rendering pipeline, threading model, localization',
  feature: 'e.g. fishing, the shop, matchmaking, exporting to PDF',
};

/** "Something else": a concept or a feature that is not in the list, typed. */
export function CustomSubjectField({ group }: { group: SubjectGroup }) {
  const customSubject = useQuiz((s) => s.setup.customSubject);
  const selected = useQuiz((s) => s.setup.target === 'custom');
  const setSetup = useQuiz((s) => s.setSetup);
  const id = useId();
  return (
    <div className={clsx('quiz-other', { 'quiz-other-selected': selected })}>
      <label className="quiz-other-label" htmlFor={id}>
        Something else
      </label>
      <input
        id={id}
        className="quiz-custom-subject text-input"
        type="text"
        maxLength={200}
        placeholder={CUSTOM_PLACEHOLDERS[group]}
        value={customSubject}
        onChange={(e) => {
          const text = e.target.value;
          // Typing selects it; emptying it goes back to the chips.
          setSetup({ customSubject: text, target: text.trim() === '' ? 'subject' : 'custom' });
        }}
        onFocus={() => {
          if (customSubject.trim() !== '') setSetup({ target: 'custom' });
        }}
      />
    </div>
  );
}

/** Suggestions for the path box: the profile's modules and the subjects' anchor files. */
function usePathSuggestions(): string[] {
  const profile = useProjectProfile((s) => s.profile);
  const subjects = useProjectProfile((s) => s.subjects);
  const set = new Set<string>();
  for (const m of profile?.modules ?? []) set.add(m.path);
  for (const s of subjects ?? []) for (const a of s.anchors) set.add(a);
  return [...set].sort();
}

/** The files and folders to check: typed (with suggestions) or added from the open tabs. */
export function CodeToCheck() {
  const paths = useQuiz((s) => s.setup.paths);
  const setSetup = useQuiz((s) => s.setSetup);
  const tabs = useTabs((s) => s.tabs);
  const openFiles = tabs.flatMap((t) => (t.relPath !== null && !t.deleted ? [t.relPath] : []));
  const suggestions = usePathSuggestions();
  const [draft, setDraft] = useState('');
  const listId = useId();

  const addPaths = (raw: string) => {
    const added = raw
      .split(/[\n,]+/)
      .map((p) =>
        p
          .trim()
          .replace(/\\/g, '/')
          .replace(/^\/+|\/+$/g, ''),
      )
      .filter(Boolean);
    if (added.length === 0) return;
    setSetup({ target: 'paths', paths: [...new Set([...paths, ...added])] });
    setDraft('');
  };

  return (
    <div className="quiz-code-check">
      {paths.length > 0 && (
        <ul className="quiz-paths" aria-label="Code to check">
          {paths.map((p) => (
            <li key={p} className="quiz-path">
              <span className="quiz-path-chip">{p}</span>
              <button
                type="button"
                className="quiz-path-remove"
                aria-label={`Remove ${p}`}
                onClick={() => {
                  setSetup({ paths: paths.filter((x) => x !== p) });
                }}
              >
                <X aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="quiz-path-add"
        onSubmit={(e) => {
          e.preventDefault();
          addPaths(draft);
        }}
      >
        <input
          className="text-input"
          type="text"
          list={listId}
          aria-label="A file or folder to check"
          placeholder="src/save or src/save/slots.ts"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
        />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <button type="submit" className="quiz-hint-button" disabled={draft.trim() === ''}>
          <Plus aria-hidden /> Add
        </button>
      </form>
      {openFiles.some((p) => !paths.includes(p)) && (
        <div className="quiz-open-files">
          <span className="quiz-muted">Open files:</span>
          {openFiles
            .filter((p) => !paths.includes(p))
            .slice(0, 6)
            .map((p) => (
              <button
                key={p}
                type="button"
                className="quiz-hint-button"
                title={`Check ${p}`}
                onClick={() => {
                  addPaths(p);
                }}
              >
                <Plus aria-hidden /> {fileName(p)}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
