// The wizard's choices kept with a quiz, shown as small tags (the kind of quiz and the role),
// on the saved quizzes and the last results. The basis of a sorted list of quizzes later.

import type { QuizCategory } from '../../ipc/types';

const CATEGORY_LABELS: Record<QuizCategory, string> = {
  global: 'Global',
  feature: 'Feature',
  code: 'Code check',
};

export function QuizTags({
  category,
  role,
}: {
  category: QuizCategory | null;
  role: string | null;
}) {
  if (!category && !role) return null;
  return (
    <span className="quiz-tags">
      {category && <span className="quiz-tag">{CATEGORY_LABELS[category]}</span>}
      {role && <span className="quiz-tag quiz-tag-role">{role}</span>}
    </span>
  );
}
