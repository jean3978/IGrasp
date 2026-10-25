import { describe, expect, it } from 'vitest';
import { FIXTURE_FILES } from './fixture';
import { fixtureTutorialSubjects } from './mockFamilies';
import { createMockBackend } from './index';
import type { TutorialSubject } from '../types';

const files = () => new Map(Object.entries(FIXTURE_FILES));

describe('the fixture subject cards', () => {
  it('are phrased about the project, universal first, with anchors on the disk', () => {
    const s = fixtureTutorialSubjects(files());
    expect(s.tooThin).toBe(false);
    expect(s.cards.map((c) => c.id)).toContain('family:big-picture');
    const kinds = s.cards.map((c) => c.kind);
    expect(kinds.lastIndexOf('universal')).toBeLessThan(kinds.indexOf('domain'));
    for (const c of s.cards) {
      expect(c.title).toContain('igrasp-demo');
      for (const a of [...c.anchors, ...c.picks.flatMap((p) => p.anchors)])
        expect(files().has(a)).toBe(true);
    }
    expect(s.domains).toContain('command-line interfaces');
  });

  it('drops cards without material and ends with the suggestions', () => {
    const disk = new Map([['README.md', '# x\n']]);
    expect(fixtureTutorialSubjects(disk).tooThin).toBe(true);
    const suggested: TutorialSubject = {
      id: 'suggested:1',
      kind: 'suggested',
      family: 'Suggested',
      title: 'How igrasp-demo greets loudly',
      blurb: 'The loud option of main()',
      focus: 'the loud option',
      anchors: ['src/main.ts'],
      material: 'some',
      picks: [],
      domain: null,
    };
    const s = fixtureTutorialSubjects(files(), [suggested]);
    expect(s.cards.at(-1)?.id).toBe('suggested:1');
  });

  it('are listed by the mock backend for the open folder only', async () => {
    const backend = createMockBackend();
    await expect(backend.listTutorialSubjects()).rejects.toMatchObject({ code: 'NoRootOpen' });
    await backend.openRoot(backend.controls.state.pickFolderResult ?? '');
    const s = await backend.listTutorialSubjects();
    expect(s.cards.length).toBeGreaterThan(3);
    expect(backend.controls.state.ai.starts).toEqual([]);
  });
});
