// The proposed subjects of a group, as the quiz wizard shows them.

import type { Subject, SubjectGroup } from '../../ipc/types';
import { useProjectProfile } from '../../stores/projectProfile';
import { useQuiz } from '../../stores/quiz';

/** The subjects of `group`; a documentation-only quiz keeps those with docs. */
export function useSubjects(group: SubjectGroup): Subject[] {
  const subjects = useProjectProfile((s) => s.subjects);
  const scope = useQuiz((s) => s.setup.scope);
  return (subjects ?? []).filter(
    (s) => s.group === group && (scope === 'wholeProject' || s.hasDocs),
  );
}
