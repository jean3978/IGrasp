// The Quiz tab: one screen at a time (home, confirmation, generation, question, results). Opening
// it is free: the profile, the subjects, the history and a quiz to continue are local; the
// provider's status check runs its probes, never a model.

import { useEffect, useState } from 'react';
import { useAiProvider } from '../../stores/aiProvider';
import { useQuiz } from '../../stores/quiz';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';
import { pickLine } from '../hoot/hootLines';
import { GenerationScreen } from './GenerationScreen';
import { QuestionScreen } from './QuestionScreen';
import { QuizConfirm } from './QuizConfirm';
import { QuizHome } from './QuizHome';
import { ResultsScreen } from './ResultsScreen';
import './quiz.css';

export function QuizTab() {
  const root = useWorkspace((s) => s.root?.path ?? null);
  const screen = useQuiz((s) => s.screen);
  const openHome = useQuiz((s) => s.openHome);
  const saveResults = useQuiz((s) => s.saveResults);
  const checkStatus = useAiProvider((s) => s.checkStatus);
  const motion = useSettings((s) => s.settings.learning.effects);
  const [homeLine] = useState(() => pickLine('home'));

  useEffect(() => {
    if (root) void openHome(root);
  }, [root, openHome]);
  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  return (
    <div
      className="document-scroll quiz-tab"
      aria-label="Quiz"
      data-motion={motion ? undefined : 'off'}
    >
      <div className="quiz-page" data-screen={screen}>
        {screen === 'home' && <QuizHome hootLine={homeLine} />}
        {screen === 'confirm' && <QuizConfirm />}
        {screen === 'generating' && <GenerationScreen motion={motion} />}
        {screen === 'question' && <QuestionScreen motion={motion} />}
        {screen === 'results' && (
          <ResultsScreen motion={motion} onSaveResults={() => void saveResults()} />
        )}
      </div>
    </div>
  );
}
