// The quiz store with the mock backend: every flow, and that only Start (on the card), Next
// round and Keep going's Start call the AI.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import type { MockQuizScript } from '../ipc/mock/mockQuiz';
import { resetAiStores } from '../test/resetAi';
import { useAiProvider } from './aiProvider';
import { startEventBridge } from './eventBridge';
import { useProjectProfile } from './projectProfile';
import { afterReveal, useQuiz } from './quiz';
import { useSettings } from './settings';
import { useToasts } from './toasts';
import { useWorkspace } from './workspace';

let stop: () => void = () => undefined;
const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('no mock');
  return m;
};
const starts = () => mock().state.ai.starts;
const quiz = () => useQuiz.getState();

function setUp(script: MockQuizScript = 'valid') {
  mock().state.ai.quizScript = script;
  mock().state.ai.stepMs = 1;
}

/** Answers the current question (right or wrong) and goes on. */
function play(right: boolean) {
  const { record, engine } = quiz();
  const q = record?.questions.find((x) => x.id === engine?.current);
  if (!q) throw new Error('no question');
  quiz().answer(right ? q.answer : (q.answer + 1) % q.choices.length);
}

/** Collects the reasons of the retries shown during the next generation. */
function attemptReasons(): () => string[] {
  const seen: string[] = [];
  const off = useQuiz.subscribe((s, prev) => {
    const reason = s.generation?.attempt?.reason;
    if (reason && reason !== prev.generation?.attempt?.reason) seen.push(reason);
  });
  return () => {
    off();
    return seen;
  };
}

async function startQuiz() {
  await quiz().prepare();
  expect(quiz().screen).toBe('confirm');
  await quiz().confirmStart();
  await vi.waitFor(() => {
    expect(quiz().screen).not.toBe('generating');
  });
}

beforeEach(async () => {
  mock().reset();
  resetAiStores();
  useProjectProfile.getState().clear();
  await useSettings.getState().load();
  quiz().leaveFolder();
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await useAiProvider.getState().checkStatus();
  await quiz().openHome(FIXTURE_ROOT);
});

afterEach(async () => {
  stop();
  await useWorkspace.getState().closeRoot();
});

describe('the quiz store', () => {
  it('estimates on Start and calls the AI only on the card', async () => {
    setUp();
    await quiz().prepare();
    expect(quiz().screen).toBe('confirm');
    expect(quiz().estimate?.inlined.length).toBeGreaterThan(0);
    expect(starts()).toEqual([]);
    quiz().cancelConfirm();
    expect(quiz().screen).toBe('home');
    expect(starts()).toEqual([]);
    await startQuiz();
    expect(starts()).toEqual(['quizGeneration']);
    expect(quiz().screen).toBe('question');
    const record = quiz().record;
    expect(record?.questions).toHaveLength(10);
    expect(record?.questions[0]?.id).toMatch(/^r1-q/);
    expect(record?.usage.inputTokens).toBeGreaterThan(0);
    expect(record?.resumeId).not.toBeNull();
    expect(mock().state.ai.lastRequest?.policy).toBe('readOnly');
  });

  it('plays to the results, saving after each answer, and records the history', async () => {
    setUp();
    await startQuiz();
    play(true);
    expect(quiz().engine?.score).toBe(1);
    await vi.waitFor(() => {
      expect(mock().state.quizzes.get(FIXTURE_ROOT)?.current?.answers).toHaveLength(1);
    });
    quiz().next();
    for (let i = 1; i < 10; i++) {
      play(i % 2 === 0);
      quiz().next();
    }
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('results');
    });
    const record = quiz().record;
    expect(record?.finishedMs).not.toBeNull();
    expect(record?.answers).toHaveLength(10);
    await vi.waitFor(() => {
      expect(quiz().history).toHaveLength(1);
    });
    expect(mock().state.quizzes.get(FIXTURE_ROOT)?.current).toBeNull();
    expect(starts()).toEqual(['quizGeneration']);

    // Save results…: dismissed writes nothing and says nothing; then saved, with Open.
    mock().state.saveDialogResult = '';
    await quiz().saveResults();
    expect(mock().state.saved).toHaveLength(0);
    expect(useToasts.getState().toasts).toHaveLength(0);
    mock().state.saveDialogResult = null;
    await quiz().saveResults();
    const [saved] = mock().state.saved;
    expect(saved?.kind).toBe('results');
    expect(saved?.relPath).toMatch(/^quiz-results\/quiz-results-.+-\d{4}-\d\d-\d\d-\d{4}\.md$/);
    expect(saved?.markdown).toContain('questions: 10');
    expect(mock().state.files.get(saved?.relPath ?? '')).toBe(saved?.markdown);
    const toast = useToasts.getState().toasts.at(-1);
    expect(toast?.type === 'message' && toast.openPath).toBe(saved?.relPath);
    expect(starts()).toEqual(['quizGeneration']);
  });

  it('shows the retry, then plays', async () => {
    setUp('retry');
    await quiz().prepare();
    const reasons = attemptReasons();
    await quiz().confirmStart();
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('question');
    });
    expect(reasons()).toEqual([
      '2 rejected: 1 cited an agent file, 1 cited lines that do not check out',
    ]);
    expect(quiz().record?.attempts).toBe(2);
  });

  it('ends on the home with the reasons when nothing checks out', async () => {
    setUp('exhaust');
    await startQuiz();
    expect(quiz().screen).toBe('home');
    expect(quiz().failure?.message).toMatch(/Hoot could not verify/);
    expect(quiz().record).toBeNull();
  });

  it('plays the questions of a thin subject with the note', async () => {
    setUp('thin');
    await startQuiz();
    expect(quiz().record?.questions).toHaveLength(2);
    expect(quiz().record?.materialNote).toMatch(/little material/);
    expect(quiz().record?.suggestedSubjects.length).toBeGreaterThan(0);
  });

  it('cancels a slow generation back to the home', async () => {
    setUp('slow');
    await quiz().prepare();
    await quiz().confirmStart();
    await vi.waitFor(
      () => {
        expect(quiz().generation?.activity.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
    await quiz().cancel();
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('home');
    });
    expect(quiz().record).toBeNull();
    expect(quiz().failure).toBeNull();
  });

  it('writes an adaptive quiz in rounds, each started by Next round', async () => {
    setUp();
    quiz().setSetup({ mode: 'adaptive', count: 10 });
    await startQuiz();
    expect(quiz().record?.questions).toHaveLength(5);
    const resumeId = quiz().record?.resumeId;
    for (let i = 0; i < 5; i++) {
      play(true);
      if (i < 4) quiz().next();
    }
    expect(afterReveal(quiz())).toBe('nextRound');
    quiz().next();
    expect(quiz().screen).toBe('question');
    expect(starts()).toEqual(['quizGeneration']);
    await quiz().nextRound();
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('question');
    });
    expect(starts()).toEqual(['quizGeneration', 'quizGeneration']);
    expect(mock().state.ai.lastRequest?.resumeId).toBe(resumeId);
    expect(mock().state.ai.lastRequest?.prompt).toContain('This is round 2 of 2');
    const record = quiz().record;
    expect(record?.questions).toHaveLength(10);
    expect(record?.rounds).toBe(2);
    expect(new Set(record?.questions.map((q) => q.question)).size).toBe(10);
    // Five right answers raised the level.
    expect(quiz().engine?.level).toBeGreaterThan(2);
    for (let i = 0; i < 5; i++) {
      play(false);
      quiz().next();
    }
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('results');
    });
    expect(afterReveal(quiz())).toBe('results');
  });

  it('ends an adaptive quiz on the results when its next round is cancelled', async () => {
    setUp();
    quiz().setSetup({ mode: 'adaptive', count: 10 });
    await startQuiz();
    for (let i = 0; i < 5; i++) {
      play(true);
      if (i < 4) quiz().next();
    }
    mock().state.ai.quizScript = 'slow';
    await quiz().nextRound();
    await quiz().cancel();
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('results');
    });
    expect(quiz().record?.answers).toHaveLength(5);
  });

  it('keeps going after its own card, and plays again without the AI', async () => {
    setUp();
    quiz().setSetup({ count: 5 });
    await startQuiz();
    for (let i = 0; i < 5; i++) {
      play(true);
      quiz().next();
    }
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('results');
    });
    await quiz().keepGoing();
    expect(quiz().screen).toBe('confirm');
    expect(quiz().pending?.input.exclude).toHaveLength(5);
    expect(starts()).toHaveLength(1);
    await quiz().confirmStart();
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('question');
    });
    expect(starts()).toHaveLength(2);
    expect(quiz().record?.questions).toHaveLength(10);
    for (let i = 0; i < 5; i++) {
      play(false);
      quiz().next();
    }
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('results');
    });
    const finished = quiz().record;
    await quiz().playAgain();
    const replay = quiz().record;
    expect(quiz().screen).toBe('question');
    expect(replay?.origin).toEqual({ type: 'replay', of: finished?.id });
    expect(replay?.answers).toEqual([]);
    expect(replay?.usage.inputTokens).toBe(0);
    expect(replay?.questions).toHaveLength(10);
    expect(starts()).toHaveLength(2);
  });

  it('saves a quiz as a file, lists it, and plays files without the AI', async () => {
    setUp();
    quiz().setSetup({ count: 5 });
    await startQuiz();
    for (let i = 0; i < 5; i++) {
      play(true);
      quiz().next();
    }
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('results');
    });
    await quiz().saveQuiz();
    const [saved] = mock().state.saved;
    expect(saved?.kind).toBe('quiz');
    expect(saved?.relPath).toMatch(/^quizzes\/quiz-.+\.md$/);
    expect(saved?.markdown).toMatch(/sha256: [0-9a-f]{64}/);
    await vi.waitFor(() => {
      expect(quiz().quizFiles.map((f) => f.relPath)).toContain(saved?.relPath);
    });
    expect(quiz().quizFiles.find((f) => f.relPath === saved?.relPath)?.questions).toBe(5);

    // Logged out: a quiz file still plays, and the saved one has fresh sources.
    mock().state.ai.loggedIn = false;
    await quiz().playFile(saved?.relPath);
    expect(quiz().screen).toBe('question');
    expect(quiz().record?.origin).toEqual({ type: 'file', path: saved?.relPath });
    expect(quiz().record?.questions).toHaveLength(5);
    expect(quiz().sourceNotes).toEqual({});

    // The fixture's quiz: its third question cites a line that changed.
    await quiz().playFile('quizzes/quiz-architecture.md');
    expect(quiz().record?.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    expect(quiz().record?.startLevel).toBe(2);
    expect(quiz().sourceNotes).toEqual({ q3: [{ path: 'src/main.ts', state: 'changed' }] });
    expect(starts()).toHaveLength(1);

    // Open quiz file…: dismissed says nothing; a non-quiz file is refused.
    mock().state.openQuizFileResult = null;
    const toasts = useToasts.getState().toasts.length;
    await quiz().playFile();
    expect(useToasts.getState().toasts).toHaveLength(toasts);
    mock().state.openQuizFileResult = 'README.md';
    await quiz().playFile();
    const last = useToasts.getState().toasts.at(-1);
    expect(last?.type === 'message' && last.text).toMatch(/Cannot play that quiz: Not a quiz/);
  });

  it('restores a quiz in progress from app data', async () => {
    setUp();
    await startQuiz();
    play(true);
    quiz().next();
    play(true);
    const level = quiz().engine?.level;
    await vi.waitFor(() => {
      expect(mock().state.quizzes.get(FIXTURE_ROOT)?.current?.answers).toHaveLength(2);
    });
    quiz().leaveFolder();
    await quiz().openHome(FIXTURE_ROOT);
    expect(quiz().saved?.answers).toHaveLength(2);
    quiz().continueSaved();
    expect(quiz().screen).toBe('question');
    expect(quiz().engine?.level).toBe(level);
    expect(quiz().engine?.score).toBe(2);
    expect(quiz().engine?.chosen).toBeNull();
    expect(starts()).toHaveLength(1);
  });

  it('sends the documentation-only scope and shows its rejection', async () => {
    setUp('leak');
    mock().state.ai.stepMs = 40;
    quiz().setSetup({ scope: 'documentationOnly', count: 5 });
    await quiz().prepare();
    expect(quiz().pending?.input.scope).toEqual({ type: 'documentationOnly' });
    const reasons = attemptReasons();
    await quiz().confirmStart();
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('question');
    });
    expect(reasons()).toEqual(['1 rejected: 1 cited code outside the sources']);
  });
});
