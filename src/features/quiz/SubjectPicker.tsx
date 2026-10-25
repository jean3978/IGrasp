// "What should Hoot ask about?": the proposed subjects grouped as global concepts and features,
// a subject of your own, or specific code to check (files or folders, for detailed questions,
// e.g. before submitting a change). One of the three is the quiz's target.

import { clsx } from 'clsx';
import { FileCode, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { Subject } from '../../ipc/types';
import { useProjectProfile } from '../../stores/projectProfile';
import { useQuiz } from '../../stores/quiz';
import { fileName, useTabs } from '../../stores/tabs';

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
    : 'Questions about the whole project';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={clsx('quiz-subject', { 'quiz-subject-selected': selected })}
      title={title}
      onClick={onSelect}
    >
      {subject ? subject.title : 'No specific subject'}
      {subject?.material === 'rich' && (
        <span className="quiz-subject-badge" aria-label="plenty of material">
          ●●
        </span>
      )}
    </button>
  );
}

function SubjectRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="quiz-subject-row">
      <span className="quiz-subject-group">{label}</span>
      <div className="quiz-subjects">{children}</div>
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

export function SubjectPicker() {
  const setup = useQuiz((s) => s.setup);
  const setSetup = useQuiz((s) => s.setSetup);
  const subjects = useProjectProfile((s) => s.subjects);
  const tabs = useTabs((s) => s.tabs);
  const openFiles = tabs.flatMap((t) => (t.relPath !== null && !t.deleted ? [t.relPath] : []));
  const suggestions = usePathSuggestions();
  const [draft, setDraft] = useState('');
  const ids = { title: useId(), custom: useId(), paths: useId(), list: useId(), code: useId() };

  const shown = (subjects ?? []).filter((s) => setup.scope === 'wholeProject' || s.hasDocs);
  const global = shown.filter((s) => s.group === 'global');
  const features = shown.filter((s) => s.group === 'feature');
  const onSubject = setup.target === 'subject';
  const selected = onSubject ? (shown.find((s) => s.id === setup.subjectId) ?? null) : null;

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
    setSetup({ target: 'paths', paths: [...new Set([...setup.paths, ...added])] });
    setDraft('');
  };
  const removePath = (p: string) => {
    const paths = setup.paths.filter((x) => x !== p);
    setSetup({ paths, ...(paths.length === 0 ? { target: 'subject' as const } : {}) });
  };

  return (
    <>
      <h2 className="quiz-panel-title" id={ids.title}>
        What should Hoot ask about?
      </h2>
      <div className="quiz-subject-groups" role="radiogroup" aria-labelledby={ids.title}>
        <SubjectRow label="Global">
          <SubjectChip
            subject={null}
            selected={onSubject && selected === null}
            onSelect={() => {
              setSetup({ target: 'subject', subjectId: null });
            }}
          />
          {global.map((s) => (
            <SubjectChip
              key={s.id}
              subject={s}
              selected={selected?.id === s.id}
              onSelect={() => {
                setSetup({ target: 'subject', subjectId: s.id });
              }}
            />
          ))}
        </SubjectRow>
        {features.length > 0 && (
          <SubjectRow label="Features">
            {features.map((s) => (
              <SubjectChip
                key={s.id}
                subject={s}
                selected={selected?.id === s.id}
                onSelect={() => {
                  setSetup({ target: 'subject', subjectId: s.id });
                }}
              />
            ))}
          </SubjectRow>
        )}
      </div>
      {subjects !== null && subjects.length === 0 && (
        <p className="quiz-muted">This project is small: Hoot will ask about it as a whole.</p>
      )}

      <div
        className={clsx('quiz-target', {
          'quiz-target-selected': setup.target === 'custom',
        })}
      >
        <label className="quiz-subject-group" htmlFor={ids.custom}>
          Your own
        </label>
        <input
          id={ids.custom}
          className="quiz-custom-subject text-input"
          type="text"
          maxLength={200}
          placeholder="Any subject, e.g. how the save system works"
          value={setup.customSubject}
          onChange={(e) => {
            const customSubject = e.target.value;
            setSetup({
              customSubject,
              target: customSubject.trim() === '' ? 'subject' : 'custom',
            });
          }}
          onFocus={() => {
            if (setup.customSubject.trim() !== '') setSetup({ target: 'custom' });
          }}
        />
      </div>

      <section
        className={clsx('quiz-target quiz-code-check', {
          'quiz-target-selected': setup.target === 'paths',
        })}
        aria-labelledby={ids.code}
      >
        <div className="quiz-code-check-head">
          <h3 className="quiz-subject-group" id={ids.code}>
            <FileCode aria-hidden /> Check specific code
          </h3>
          <span className="quiz-muted">
            Detailed, line-level questions on the files or folders you pick, to make sure you
            understand the code, e.g. before submitting it.
          </span>
        </div>
        {setup.paths.length > 0 && (
          <ul className="quiz-paths" aria-label="Code to check">
            {setup.paths.map((p) => (
              <li key={p} className="quiz-path">
                <button
                  type="button"
                  className="quiz-path-chip"
                  title={`${p}: click to check this code`}
                  onClick={() => {
                    setSetup({ target: 'paths' });
                  }}
                >
                  {p}
                </button>
                <button
                  type="button"
                  className="quiz-path-remove"
                  aria-label={`Remove ${p}`}
                  onClick={() => {
                    removePath(p);
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
            id={ids.paths}
            className="text-input"
            type="text"
            list={ids.list}
            aria-label="A file or folder to check"
            placeholder="src/save or src/save/slots.ts"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />
          <datalist id={ids.list}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button type="submit" className="quiz-hint-button" disabled={draft.trim() === ''}>
            <Plus aria-hidden /> Add
          </button>
        </form>
        {openFiles.length > 0 && (
          <div className="quiz-open-files">
            <span className="quiz-muted">Open files:</span>
            {openFiles
              .filter((p) => !setup.paths.includes(p))
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
      </section>
    </>
  );
}
