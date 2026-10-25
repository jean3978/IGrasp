// Where the reader is in "New tutorial": Subject, Options, Confirm. Only the outline's
// confirmation card spends tokens, on its Start; the steps before it are local.

import { Check } from 'lucide-react';

export type WizardStep = 'subject' | 'options' | 'confirm';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'subject', label: 'Subject' },
  { id: 'options', label: 'Options' },
  { id: 'confirm', label: 'Confirm' },
];

export function WizardSteps({ current }: { current: WizardStep }) {
  const at = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="academy-wizard-steps" aria-label="New tutorial steps">
      {STEPS.map((s, i) => (
        <li
          key={s.id}
          data-state={i < at ? 'done' : i === at ? 'current' : 'next'}
          aria-current={i === at ? 'step' : undefined}
        >
          <span className="academy-wizard-number" aria-hidden>
            {i < at ? <Check /> : i + 1}
          </span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}
