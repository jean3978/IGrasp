import { describe, expect, it } from 'vitest';
import { createMockBackend } from './index';
import { MOCK_HEAD } from './mockTutorialStore';
import type { Tutorial } from '../types';

const draft = (): Tutorial => ({
  id: '',
  title: 'How igrasp-demo greets',
  intro: 'Follow main() to the greeting.',
  project: 'igrasp-demo',
  subject: 'Greeting',
  familiarity: 'newHere',
  length: 'quick',
  generated: '',
  provider: '',
  model: 'mock-fast',
  chapters: [
    {
      id: 'c1',
      title: 'main()',
      goal: 'Explain main() in src/main.ts.',
      minutes: 3,
      steps: [
        {
          type: 'explain',
          title: 'The entry point',
          body: 'src/main.ts exports main().',
          sources: [{ path: 'src/main.ts', firstLine: 9, lastLine: 12 }],
        },
      ],
      questions: [],
    },
    { id: 'c2', title: 'greet()', goal: 'Explain greet().', minutes: 3, steps: [], questions: [] },
  ],
  sources: [],
});

describe('the mock tutorial store', () => {
  it('saves, lists, reads, tracks progress and deletes like Rust', async () => {
    const backend = createMockBackend();
    await expect(backend.listTutorials()).rejects.toMatchObject({ code: 'NoRootOpen' });
    await backend.openRoot(backend.controls.state.pickFolderResult ?? '');
    const stored = await backend.saveTutorial(draft());
    const t = stored.tutorial;
    expect(t.id).toMatch(/^greeting-\d{8}-[0-9a-f]{4}$/);
    expect(t.provider).toBe('mock');
    expect(t.generationCommit).toBe(MOCK_HEAD);
    expect(t.sources).toHaveLength(1);
    expect(t.sources[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);

    const list = await backend.listTutorials();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      chapters: 2,
      chaptersWritten: 1,
      stepsTotal: 1,
      progress: null,
    });

    await backend.saveTutorialProgress({
      tutorialId: t.id,
      startedMs: 1,
      lastOpenedMs: 2,
      finishedMs: null,
      chapter: 0,
      step: 1,
      completed: { 'c1:0': 'abc' },
      answers: {},
      xp: 5,
      streak: 0,
      bestStreak: 0,
      chaptersDone: [],
      graduated: false,
    });
    expect((await backend.listTutorials())[0]?.progress).toMatchObject({ stepsDone: 1, xp: 5 });
    expect(await backend.getTutorial({ type: 'private', id: t.id })).toEqual(t);

    await backend.deleteTutorial(t.id);
    await expect(backend.getTutorial({ type: 'private', id: t.id })).rejects.toMatchObject({
      code: 'TutorialNotFound',
    });
    expect(await backend.getTutorialProgress(t.id)).toBeNull();
    await expect(backend.deleteTutorial('../x')).rejects.toMatchObject({ code: 'InvalidPath' });
    expect(backend.controls.state.ai.starts).toEqual([]);
  });

  it('keeps the suggestions once each and forgets everything', async () => {
    const backend = createMockBackend();
    await backend.openRoot(backend.controls.state.pickFolderResult ?? '');
    const [s] = (await backend.listTutorialSubjects()).cards;
    if (!s) throw new Error('no card');
    const card = { ...s, id: 'suggested:1', kind: 'suggested' as const, title: 'Loud greetings' };
    expect(await backend.saveSuggestedSubjects([card, card])).toHaveLength(1);
    expect((await backend.listTutorialSubjects()).cards.at(-1)?.id).toBe('suggested:1');
    await backend.saveTutorial(draft());
    await backend.forgetTutorials();
    expect(await backend.listTutorials()).toEqual([]);
    expect((await backend.listTutorialSubjects()).cards.at(-1)?.id).not.toBe('suggested:1');
  });
});
