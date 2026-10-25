// Settings → Learning: the quiz defaults (questions, mode, sources), the effects, the folders the
// save dialogs open on, forgetting the folder's quizzes, and the project profile of the open
// folder with a reset of its corrections. Nothing here reaches a model.

import { useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import {
  DEFAULT_LEARNING_SETTINGS,
  MAX_QUIZ_QUESTIONS,
  MIN_QUIZ_QUESTIONS,
  relativeFolder,
} from '../../ipc/defaults';
import type {
  Familiarity,
  LearningSettingsPatch,
  Length,
  QuizMode,
  QuizScopeSetting,
} from '../../ipc/types';
import { useAcademy } from '../../stores/academy';
import { useProjectProfile } from '../../stores/projectProfile';
import { useQuiz } from '../../stores/quiz';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';
import { FAMILIARITIES, FAMILIARITY_LABEL, LENGTHS, LENGTH_LABEL } from '../academy/labels';
import { EMPTY_CORRECTIONS } from '../profile/labels';
import { ProjectProfilePanel } from '../profile/ProjectProfilePanel';
import { Field, Segmented, Toggle } from './fields';
import { save } from './saveSetting';

const saveLearning = (learning: LearningSettingsPatch) => {
  save({ learning });
};

function QuestionCount() {
  const value = useSettings((s) => s.settings.learning.quizQuestions);
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && draft.trim() !== '')
      saveLearning({
        quizQuestions: Math.min(MAX_QUIZ_QUESTIONS, Math.max(MIN_QUIZ_QUESTIONS, n)),
      });
    setDraft(null);
  };
  return (
    <Field
      label="Questions per quiz"
      htmlFor={id}
      description={`From ${String(MIN_QUIZ_QUESTIONS)} to ${String(MAX_QUIZ_QUESTIONS)}. The quiz home starts with this number.`}
    >
      <input
        id={id}
        className="settings-number"
        type="number"
        min={MIN_QUIZ_QUESTIONS}
        max={MAX_QUIZ_QUESTIONS}
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </Field>
  );
}

/** A folder inside the open folder; an invalid value is shown, not saved. */
function FolderField({
  label,
  description,
  value,
  fallback,
  onSave,
}: {
  label: string;
  description: string;
  value: string;
  fallback: string;
  onSave: (folder: string) => void;
}) {
  const id = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && relativeFolder(draft, '') === '';
  const commit = () => {
    if (draft === null || invalid) return;
    const folder = relativeFolder(draft, fallback);
    if (folder !== value) onSave(folder);
    setDraft(null);
  };
  return (
    <Field label={label} htmlFor={id} description={description}>
      <input
        id={id}
        className="settings-text"
        type="text"
        spellCheck={false}
        value={draft ?? value}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
      {invalid && (
        <span id={errorId} className="settings-warning" role="alert">
          A folder inside the open folder: letters, digits, spaces, “-”, “_”, “.” and “/”, no “..”.
        </span>
      )}
    </Field>
  );
}

function ForgetQuizzes() {
  const root = useWorkspace((s) => s.root);
  const forget = useQuiz((s) => s.forgetHistory);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Field
      label="Forget this folder's quizzes"
      description={
        root
          ? `Deletes the quiz history and the quiz in progress kept for ${root.name} in the app data folder. Saved quiz and results files stay.`
          : 'Open a folder to forget its quizzes.'
      }
    >
      {confirming ? (
        <>
          <Button
            variant="primary"
            onClick={() => {
              setConfirming(false);
              void forget().then(() => {
                setDone(true);
              });
            }}
          >
            Forget them
          </Button>
          <Button
            onClick={() => {
              setConfirming(false);
            }}
          >
            Keep them
          </Button>
        </>
      ) : (
        <Button
          disabled={!root}
          onClick={() => {
            setDone(false);
            setConfirming(true);
          }}
        >
          Forget quizzes…
        </Button>
      )}
      {done && (
        <span className="settings-value" role="status">
          Forgotten.
        </span>
      )}
    </Field>
  );
}

function ForgetTutorials() {
  const root = useWorkspace((s) => s.root);
  const forget = useAcademy((s) => s.forgetTutorials);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Field
      label="Forget this folder's tutorials"
      description={
        root
          ? `Deletes the private tutorials of ${root.name}, your progress in every tutorial and the suggested subjects, from the app data folder. Tutorials shared in the folder stay.`
          : 'Open a folder to forget its tutorials.'
      }
    >
      {confirming ? (
        <>
          <Button
            variant="primary"
            onClick={() => {
              setConfirming(false);
              void forget().then((ok) => {
                setDone(ok);
              });
            }}
          >
            Forget them
          </Button>
          <Button
            onClick={() => {
              setConfirming(false);
            }}
          >
            Keep them
          </Button>
        </>
      ) : (
        <Button
          disabled={!root}
          onClick={() => {
            setDone(false);
            setConfirming(true);
          }}
        >
          Forget tutorials…
        </Button>
      )}
      {done && (
        <span className="settings-value" role="status">
          Forgotten.
        </span>
      )}
    </Field>
  );
}

function ResetProfile() {
  const root = useWorkspace((s) => s.root);
  const corrections = useProjectProfile((s) => s.profile?.corrections ?? null);
  const saveCorrections = useProjectProfile((s) => s.saveCorrections);
  const corrected =
    corrections !== null && JSON.stringify(corrections) !== JSON.stringify(EMPTY_CORRECTIONS);
  return (
    <Field
      label="Profile corrections"
      description={
        root
          ? 'Your corrections of the detected profile of this folder. Resetting goes back to what was detected.'
          : 'Open a folder to see its project profile.'
      }
    >
      <Button
        disabled={!corrected}
        onClick={() => {
          void saveCorrections(EMPTY_CORRECTIONS);
        }}
      >
        Reset to detected
      </Button>
    </Field>
  );
}

export function LearningSettingsSection() {
  const learning = useSettings((s) => s.settings.learning);
  const effectsId = useId();
  const root = useWorkspace((s) => s.root);
  return (
    <section aria-labelledby="settings-learning">
      <h2 id="settings-learning">Learning</h2>
      <QuestionCount />
      <Field
        label="Default mode"
        description="Fixed writes every question in one AI call. Adaptive writes rounds of 5 at your level, one call per round."
      >
        <Segmented<QuizMode>
          label="Default mode"
          value={learning.quizMode}
          options={[
            { value: 'fixed', label: 'Fixed' },
            { value: 'adaptive', label: 'Adaptive' },
          ]}
          onChange={(quizMode) => {
            saveLearning({ quizMode });
          }}
        />
      </Field>
      <Field
        label="Default sources"
        description="Whole project: code, configuration, build, tests and docs. Documentation only: the markdown files."
      >
        <Segmented<QuizScopeSetting>
          label="Default sources"
          value={learning.quizScope}
          options={[
            { value: 'wholeProject', label: 'Whole project' },
            { value: 'documentationOnly', label: 'Documentation only' },
          ]}
          onChange={(quizScope) => {
            saveLearning({ quizScope });
          }}
        />
      </Field>
      <Field
        label="Effects"
        htmlFor={effectsId}
        description="Confetti, sparks and Hoot's animations. Always off when the system asks for reduced motion."
      >
        <Toggle
          id={effectsId}
          checked={learning.effects}
          onChange={(effects) => {
            saveLearning({ effects });
          }}
        />
      </Field>
      <FolderField
        label="Results folder"
        description="Where “Save results…” opens, inside the open folder. Created only when you save there."
        value={learning.quizResultsFolder}
        fallback={DEFAULT_LEARNING_SETTINGS.quizResultsFolder}
        onSave={(quizResultsFolder) => {
          saveLearning({ quizResultsFolder });
        }}
      />
      <FolderField
        label="Quizzes folder"
        description="Where “Save quiz…” opens, inside the open folder. Created only when you save there."
        value={learning.quizzesFolder}
        fallback={DEFAULT_LEARNING_SETTINGS.quizzesFolder}
        onSave={(quizzesFolder) => {
          saveLearning({ quizzesFolder });
        }}
      />
      <ForgetQuizzes />
      <div
        className="settings-subsection"
        role="group"
        aria-labelledby="settings-learning-tutorials"
      >
        <h3 id="settings-learning-tutorials">Tutorials</h3>
        <Field
          label="Default familiarity"
          description="Who a new tutorial is written for; each tutorial's options can change it."
        >
          <Segmented<Familiarity>
            label="Default familiarity"
            value={learning.tutorialFamiliarity}
            options={FAMILIARITIES.map((value) => ({ value, label: FAMILIARITY_LABEL[value] }))}
            onChange={(tutorialFamiliarity) => {
              saveLearning({ tutorialFamiliarity });
            }}
          />
        </Field>
        <Field label="Default length" description="How long a new tutorial is.">
          <Segmented<Length>
            label="Default length"
            value={learning.tutorialLength}
            options={LENGTHS.map((value) => ({ value, label: LENGTH_LABEL[value].name }))}
            onChange={(tutorialLength) => {
              saveLearning({ tutorialLength });
            }}
          />
        </Field>
        <FolderField
          label="Tutorials folder"
          description="Where “Share with the project” writes a tutorial (one folder per tutorial), inside the open folder. Created only when you share."
          value={learning.tutorialsFolder}
          fallback={DEFAULT_LEARNING_SETTINGS.tutorialsFolder}
          onSave={(tutorialsFolder) => {
            saveLearning({ tutorialsFolder });
          }}
        />
        <ForgetTutorials />
      </div>
      {root && <ResetProfile />}
      <div className="settings-learning-profile">
        <ProjectProfilePanel />
      </div>
    </section>
  );
}
