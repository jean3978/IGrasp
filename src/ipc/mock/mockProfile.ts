// The project profile of the fixture, as the Rust `profile` module describes it: a hand-written
// detection (the fixture's evidence is known) with languages counted from the fake disk, and the
// corrections applied the same way as `profile::apply_corrections`.

import type {
  Detected,
  LanguageShare,
  ProfileCorrections,
  ProjectKind,
  ProjectProfile,
} from '../types';

export const EMPTY_CORRECTIONS: ProfileCorrections = {
  addKinds: [],
  removeKinds: [],
  addEngines: [],
  removeEngines: [],
  addFrameworks: [],
  removeFrameworks: [],
  notes: '',
};

/** The evidence of an item the user added (same as Rust). */
export const BY_YOU = '(you)';

const KIND_LABEL: Record<ProjectKind, string> = {
  game: 'game',
  webFrontend: 'web front end',
  webBackend: 'web back end',
  mobile: 'mobile app',
  desktop: 'desktop app',
  library: 'library',
  cli: 'command-line tool',
  service: 'service',
  dataMl: 'data / machine-learning project',
  infrastructure: 'infrastructure project',
  embedded: 'embedded project',
  monorepo: 'monorepo',
  documentation: 'documentation site',
  unknown: 'project',
};

const LANGUAGES: [RegExp, string, boolean][] = [
  [/\.(?:ts|tsx)$/i, 'TypeScript', true],
  [/\.sh$/i, 'Shell', true],
  [/(?:^|\/)makefile$/i, 'Makefile', true],
  [/\.(?:md|markdown)$/i, 'Markdown', false],
];

/** Like `languages::shares`: by bytes, generated folders excluded. */
function shares(files: Map<string, string>): LanguageShare[] {
  const by = new Map<string, LanguageShare>();
  for (const [path, content] of files) {
    if (/(?:^|\/)(?:node_modules|build|dist)\//.test(path)) continue;
    const found = LANGUAGES.find(([re]) => re.test(path));
    if (!found) continue;
    const [, name, programming] = found;
    const l = by.get(name) ?? { name, files: 0, bytes: 0, percent: 0, programming };
    l.files += 1;
    l.bytes += content.length;
    by.set(name, l);
  }
  const total = [...by.values()].reduce((n, l) => n + l.bytes, 0);
  return [...by.values()]
    .map((l) => ({ ...l, percent: total === 0 ? 0 : Math.round((l.bytes * 1000) / total) / 10 }))
    .sort((a, b) => b.bytes - a.bytes || b.files - a.files);
}

const detected = <T>(value: T, confidence: Detected<T>['confidence'], evidence: string[]) => ({
  value,
  confidence,
  evidence,
});

function andList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** Like `summary::summary` (the fixture has no engine nor shell framework). */
export function summaryOf(p: ProjectProfile): string {
  const first = p.kinds[0];
  if (!first) return `${p.name}: a project.`;
  let head =
    first.value === 'game' && p.engines[0] ? `${p.engines[0].value} game` : KIND_LABEL[first.value];
  const langs = p.languages
    .filter((l) => l.programming && l.percent >= 5)
    .slice(0, 3)
    .map((l) => l.name);
  if (langs.length > 0) head += ` in ${andList(langs)}`;
  const others = p.frameworks
    .filter((f) => f.confidence === 'high' && !head.includes(f.value))
    .slice(0, 3)
    .map((f) => f.value);
  if (others.length > 0) head += ` (${others.join(', ')})`;
  const also = p.kinds
    .slice(1)
    .filter((k) => k.confidence === 'high')
    .slice(0, 2)
    .map((k) => KIND_LABEL[k.value]);
  if (also.length > 0) head += `, also a ${andList(also)}`;
  const tests = p.tests.slice(0, 3).map((t) => t.value);
  if (tests.length > 0) head += `, tested with ${andList(tests)}`;
  const article = /^[aeiou]/i.test(head) ? 'an' : 'a';
  return `${p.name}: ${article} ${head}.`;
}

function correct<T>(list: Detected<T>[], add: T[], remove: T[], same: (a: T, b: T) => boolean) {
  let out = list.filter((d) => !remove.some((r) => same(r, d.value)));
  add.forEach((value, i) => {
    out = out.filter((d) => !same(d.value, value));
    out.splice(Math.min(i, out.length), 0, detected(value, 'high', [BY_YOU]));
  });
  return out;
}

/** Like `ProfileCorrections::normalize`. */
export function normalizeCorrections(c: ProfileCorrections): ProfileCorrections {
  const clean = (v: string[]) => {
    const out: string[] = [];
    for (const s of v) {
      const t = s.trim().slice(0, 80);
      if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    }
    return out.slice(0, 20);
  };
  const kinds = (v: ProjectKind[]) => [...new Set(v)].filter((k) => k !== 'unknown').sort();
  return {
    addKinds: kinds(c.addKinds),
    removeKinds: kinds(c.removeKinds),
    addEngines: clean(c.addEngines),
    removeEngines: clean(c.removeEngines),
    addFrameworks: clean(c.addFrameworks),
    removeFrameworks: clean(c.removeFrameworks),
    notes: c.notes.trim().slice(0, 1000),
  };
}

/** Like `profile::apply_corrections`. */
export function applyCorrections(p: ProjectProfile, c: ProfileCorrections): ProjectProfile {
  const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  let kinds = correct(p.kinds, c.addKinds, c.removeKinds, (a, b) => a === b);
  if (kinds.length > 1 || c.addKinds.length > 0) kinds = kinds.filter((k) => k.value !== 'unknown');
  if (kinds.length === 0) kinds = [detected<ProjectKind>('unknown', 'low', [])];
  const next: ProjectProfile = {
    ...p,
    kinds,
    engines: correct(p.engines, c.addEngines, c.removeEngines, ci),
    frameworks: correct(p.frameworks, c.addFrameworks, c.removeFrameworks, ci),
    corrections: structuredClone(c),
  };
  return { ...next, summary: summaryOf(next) };
}

/** The detected profile of the fixture project on the fake disk. */
export function fixtureProfile(files: Map<string, string>, folderName: string): ProjectProfile {
  const has = (path: string) => files.has(path);
  const markdown = [...files.keys()].filter(
    (p) => /\.(?:md|markdown)$/i.test(p) && !/^(?:node_modules|build)\//.test(p),
  );
  const profile: ProjectProfile = {
    name: has('package.json') ? 'igrasp-demo' : folderName,
    kinds: [
      detected<ProjectKind>('cli', 'high', ['package.json']),
      detected<ProjectKind>('library', 'medium', ['package.json']),
    ],
    engines: [],
    frameworks: [],
    languages: shares(files),
    dependencies: ['typescript', 'vitest'],
    build: [
      detected('make', 'high', ['Makefile']),
      detected('npm scripts', 'high', ['package.json']),
    ],
    tests: [detected('Vitest', 'high', ['package.json'])],
    ci: [detected('GitHub Actions', 'high', ['.github/workflows/ci.yml'])],
    modules: [
      { name: 'scripts', path: 'scripts', role: 'tooling', files: 1, bytes: 30 },
      { name: 'src', path: 'src', role: null, files: 1, bytes: 300 },
    ].sort((a, b) => b.bytes - a.bytes),
    docs: {
      readme: has('README.md') ? 'README.md' : null,
      featurePages: markdown.filter((p) => p.startsWith('docs/features/')),
      adrDir: markdown.some((p) => p.startsWith('docs/decisions/')) ? 'docs/decisions' : null,
      adrs: markdown.filter((p) => p.startsWith('docs/decisions/')).length,
      architecture: has('docs/architecture.md') ? 'docs/architecture.md' : null,
      docsDirs: ['docs/guide'],
      markdownFiles: markdown.length,
    },
    repository: true,
    summary: '',
    corrections: structuredClone(EMPTY_CORRECTIONS),
    filesSeen: [...files.keys()].filter(
      (p) => !p.startsWith('node_modules/') && !p.startsWith('build/'),
    ).length,
    truncated: false,
    builtMs: 3,
  };
  return { ...profile, summary: summaryOf(profile) };
}
