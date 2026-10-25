import { describe, expect, it } from 'vitest';
import slugs from '../test/fixtures/tutorial/slugs.json';
import {
  canonicalJson,
  citationLines,
  hashLines,
  mergeSourceHashes,
  newTutorialId,
  normalizeTutorial,
  slug,
  stepCitations,
  stepHash,
  tutorialCitations,
} from './tutorial';
import { sha256Hex } from './sha256';
import type { Step, Tutorial } from '../ipc/types';

const tour: Step = {
  type: 'codeTour',
  title: 'From event to batch',
  stops: [
    { path: 'src/main.ts', firstLine: 1, lastLine: 2, annotation: 'The import.' },
    { path: 'src/main.ts', firstLine: 9, lastLine: 12, annotation: 'main()' },
  ],
};
const spot: Step = {
  type: 'spotIt',
  title: 'Find it',
  prompt: 'Click the line that greets.',
  path: 'src/main.ts',
  firstLine: 9,
  lastLine: 12,
  answerLine: 10,
  explanation: 'greet(name) on line 10.',
};

const tutorial = (steps: Step[]): Tutorial => ({
  id: 't',
  title: '  The   demo ',
  intro: ' Intro \r\n',
  project: 'demo',
  subject: 'Demo',
  familiarity: 'newHere',
  length: 'quick',
  generated: '2026-10-25T10:00:00Z',
  provider: 'mock',
  model: 'm',
  chapters: [{ id: 'c1', title: 'One', goal: 'g', minutes: 3, steps }],
  sources: [],
});

describe('tutorial helpers', () => {
  it('slug like Rust (shared fixture)', () => {
    for (const c of slugs) expect(slug(c.text), c.text).toBe(c.slug);
  });

  it('list the citations of every step type, once', () => {
    expect(stepCitations(tour).map(citationLines)).toEqual(['1-2', '9-12']);
    expect(stepCitations(spot)).toEqual([{ path: 'src/main.ts', firstLine: 9, lastLine: 12 }]);
    expect(tutorialCitations(tutorial([tour, spot])).map(citationLines)).toEqual(['1-2', '9-12']);
  });

  it('hash lines like the quiz files and keep a recorded hash', () => {
    expect(hashLines(['a\r', 'b'])).toBe(sha256Hex('a\nb'));
    const t = tutorial([tour]);
    const disk = 'l1\nl2\nl3\n';
    const sources = mergeSourceHashes(t, () => disk);
    expect(sources[0]).toEqual({
      path: 'src/main.ts',
      lines: '1-2',
      sha256: hashLines(['l1', 'l2']),
    });
    expect(sources[1]).toEqual({ path: 'src/main.ts', lines: '9-12' }); // beyond the file: no hash
    const again = mergeSourceHashes({ ...t, sources }, () => 'changed\n'.repeat(20));
    expect(again[0]).toEqual(sources[0]);
  });

  it('normalize like Rust and give a stable step hash without line numbers', () => {
    const n = normalizeTutorial(
      tutorial([{ ...tour, selfCheck: { projectSpecific: true, reason: 'r' } }]),
    );
    expect(n.title).toBe('The demo');
    expect(n.intro).toBe('Intro');
    expect(n.chapters[0]?.steps[0]).not.toHaveProperty('selfCheck');
    const moved: Step = {
      ...tour,
      stops: tour.stops.map((s) => ({
        ...s,
        firstLine: s.firstLine + 5,
        lastLine: s.lastLine + 5,
      })),
    };
    expect(stepHash(moved)).toBe(stepHash(tour));
    expect(stepHash({ ...tour, title: 'Other' })).not.toBe(stepHash(tour));
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
  });

  it('make ids from the subject and the date', () => {
    expect(newTutorialId('How the watcher works', '2026-10-25T10:00:00Z')).toMatch(
      /^how-the-watcher-works-20261025-[0-9a-f]{4}$/,
    );
    expect(newTutorialId('!!!', '2026-10-25')).toMatch(/^tutorial-20261025-/);
    expect(newTutorialId('x'.repeat(90), '2026').split('-')[0]).toHaveLength(40);
  });
});
