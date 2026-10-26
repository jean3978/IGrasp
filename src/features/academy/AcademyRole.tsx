// "New tutorial", step 1 of the wizard: who reads it. The roles proposed come from the project
// profile (the quiz's `rolesFor`), or the reader types their own. The role ranks the subject
// cards of the next step and reaches the prompt. Local: nothing is spent.

import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useAcademy } from '../../stores/academy';
import { useProjectProfile } from '../../stores/projectProfile';
import { rolesFor } from '../quiz/quizRoles';
import { WizardSteps } from './WizardSteps';

export function AcademyRole() {
  const saved = useAcademy((s) => s.setup.role);
  const chooseRole = useAcademy((s) => s.chooseRole);
  const backHome = useAcademy((s) => s.backHome);
  const profile = useProjectProfile((s) => s.profile);
  const roles = rolesFor(profile);
  const [role, setRole] = useState(saved);
  const proposed = roles.includes(role);
  const [other, setOther] = useState(() => (proposed ? '' : saved));
  const ids = { title: useId(), other: useId() };

  return (
    <div className="academy-create">
      <div className="academy-wizard-head">
        <Button variant="ghost" onClick={backHome}>
          <ArrowLeft aria-hidden /> Academy
        </Button>
        <WizardSteps current="role" />
      </div>
      <h1 className="quiz-title">New tutorial</h1>
      <p className="quiz-lead">
        Hoot writes for your role: what you need to know about this project, at the depth that fits
        your work. The subjects that fit it come first.
      </p>

      <form
        className="quiz-panel academy-role"
        aria-labelledby={ids.title}
        onSubmit={(e) => {
          e.preventDefault();
          chooseRole(role);
        }}
      >
        <h2 className="academy-learn-title" id={ids.title}>
          Who are you on this project?
        </h2>
        <div className="quiz-subjects" role="radiogroup" aria-label="Roles">
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              className={clsx('quiz-subject', { 'quiz-subject-selected': role === r })}
              onClick={() => {
                setRole(r);
              }}
              onDoubleClick={() => {
                chooseRole(r);
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div className={clsx('quiz-other', { 'quiz-other-selected': !proposed && role !== '' })}>
          <label className="quiz-other-label" htmlFor={ids.other}>
            Other role
          </label>
          <input
            id={ids.other}
            className="quiz-custom-subject text-input"
            type="text"
            maxLength={80}
            placeholder="e.g. narrative designer, security reviewer, new hire"
            value={other}
            onChange={(e) => {
              setOther(e.target.value);
              setRole(e.target.value);
            }}
            onFocus={() => {
              if (other.trim() !== '') setRole(other);
            }}
          />
        </div>
        <div className="academy-actions">
          <Button type="submit" variant="primary" disabled={role.trim() === ''}>
            Next <ArrowRight aria-hidden />
          </Button>
        </div>
      </form>
    </div>
  );
}
