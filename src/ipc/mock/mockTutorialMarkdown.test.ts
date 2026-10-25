// The mock's tutorial writer on the format fixtures `cargo test` checks against Rust's
// `markdown::write`: every case folder holds the input and the exact files Rust writes.

import { describe, expect, it } from 'vitest';
import type { Tutorial } from '../types';
import { normalizeTutorial } from '../../lib/tutorial';
import { chapterFileName, writeTutorialMarkdown } from './mockTutorialMarkdown';

interface Input {
  folder: string;
  tutorial: Tutorial;
}

const inputs = import.meta.glob<Input>('../../test/fixtures/tutorial/format/*/input.json', {
  import: 'default',
  eager: true,
});
const markdown = import.meta.glob<string>('../../test/fixtures/tutorial/format/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** What Rust's `#[serde(default)]` fills in when it reads the input (a recap's `sources`). */
function withDefaults(t: Tutorial): Tutorial {
  return {
    ...t,
    chapters: t.chapters.map((c) => ({
      ...c,
      steps: c.steps.map((s) =>
        s.type === 'recap'
          ? { ...s, sources: (s.sources as typeof s.sources | undefined) ?? [] }
          : s,
      ),
    })),
  };
}

const caseOf = (path: string) => path.split('/').slice(-2)[0] ?? '';
const nameOf = (path: string) => path.split('/').pop() ?? '';

const cases = Object.entries(inputs).map(([path, input]) => {
  const name = caseOf(path);
  const files = new Map(
    Object.entries(markdown)
      .filter(([p]) => caseOf(p) === name)
      .map(([p, text]) => [nameOf(p), text.replace(/\r\n/g, '\n')]),
  );
  return { name, input, files };
});

describe('writeTutorialMarkdown', () => {
  it('has the fixtures', () => {
    expect(cases.map((c) => c.name).sort()).toEqual(
      expect.arrayContaining(['every-step', 'sample']),
    );
  });

  it.each(cases)('writes what Rust writes for $name', ({ input, files }) => {
    const out = writeTutorialMarkdown(
      normalizeTutorial(withDefaults(input.tutorial)),
      input.folder,
    );
    expect(out[0]?.name).toBe('README.md');
    expect(out.map((f) => f.name).sort()).toEqual([...files.keys()].sort());
    for (const f of out) expect(f.text, f.name).toBe(files.get(f.name));
  });

  it('names chapter files like Rust', () => {
    expect(chapterFileName(2, 'Build, Run & Ship!')).toBe('03-build-run-ship.md');
    expect(chapterFileName(0, '!!!')).toBe('01-chapter.md');
  });
});
