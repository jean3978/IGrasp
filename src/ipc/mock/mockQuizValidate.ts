// The quiz validator of the mock backend: a port of `learning/quiz/validate.rs` (and of the
// agent-file and secret tables of `learning/agent_files.rs`), so the browser dev mode and the
// tests see exactly what Rust does. Both run on the shared fixtures of `src/test/fixtures/quiz/`
// and must agree on every accepted and rejected question.

import type { QuestionKind, QuizExclusion, QuizQuestion, QuizSource, SourceScope } from '../types';

export const MAX_RANGE_LINES = 120;
export const WHOLE_FILE_MAX_LINES = 40;
export const HINT_ANSWER_MIN_CHARS = 6;
export const MIN_WORD_CHARS = 4;

/** Same list as Rust's `STOP_WORDS` and `src/test/fixtures/quiz/stopwords.json`. */
export const STOP_WORDS = [
  'about',
  'above',
  'after',
  'again',
  'also',
  'always',
  'another',
  'answer',
  'async',
  'await',
  'based',
  'because',
  'before',
  'being',
  'below',
  'between',
  'both',
  'build',
  'call',
  'called',
  'calls',
  'case',
  'class',
  'code',
  'const',
  'could',
  'data',
  'default',
  'does',
  'done',
  'each',
  'else',
  'enum',
  'error',
  'every',
  'example',
  'export',
  'false',
  'file',
  'files',
  'first',
  'folder',
  'from',
  'function',
  'have',
  'here',
  'into',
  'just',
  'like',
  'line',
  'lines',
  'list',
  'make',
  'makes',
  'many',
  'more',
  'most',
  'must',
  'name',
  'need',
  'never',
  'none',
  'number',
  'object',
  'only',
  'other',
  'over',
  'part',
  'project',
  'public',
  'return',
  'returns',
  'same',
  'self',
  'should',
  'since',
  'some',
  'source',
  'start',
  'static',
  'still',
  'string',
  'struct',
  'such',
  'test',
  'tests',
  'than',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'thing',
  'this',
  'those',
  'through',
  'true',
  'type',
  'types',
  'under',
  'until',
  'used',
  'uses',
  'using',
  'value',
  'values',
  'very',
  'want',
  'what',
  'when',
  'where',
  'which',
  'while',
  'will',
  'with',
  'without',
  'would',
  'your',
];
const STOP = new Set(STOP_WORDS);

const GENERIC_STEMS = new Set([
  'index',
  'main',
  'utils',
  'util',
  'helpers',
  'helper',
  'types',
  'config',
  'readme',
  'setup',
  'common',
  'constants',
  'license',
  'changelog',
  'package',
  'test',
  'tests',
  'spec',
  'style',
  'styles',
  'init',
  'build',
  'default',
  'settings',
]);

export type Rejection =
  | 'choices'
  | 'trueFalse'
  | 'allOfTheAbove'
  | 'answerRange'
  | 'noSource'
  | 'unknownPath'
  | 'agentFile'
  | 'secretFile'
  | 'outOfScope'
  | 'missingRange'
  | 'badRange'
  | 'rangeTooLong'
  | 'beyondEnd'
  | 'binaryRange'
  | 'binaryOnly'
  | 'selfCheck'
  | 'generic'
  | 'hintGivesAnswer'
  | 'duplicate';

const AGENT_NAMES = [
  'claude.md',
  'claude.local.md',
  'agents.md',
  'agent.md',
  'gemini.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  '.roorules',
  'copilot-instructions.md',
  'conventions.md.aider',
];
const AGENT_DIRS = [
  '.claude',
  '.cursor',
  '.codex',
  '.junie',
  '.continue',
  '.windsurf',
  '.clinerules',
  '.roo',
  '.gemini',
  '.aider',
];

/** Like `agent_files::is_agent_file`. */
export function isAgentFile(path: string, extraNames: string[]): boolean {
  const lower = path.toLowerCase();
  const parts = lower.split('/');
  const name = parts[parts.length - 1] ?? lower;
  const inDir = parts.slice(0, -1).some((d) => AGENT_DIRS.includes(d));
  return (
    AGENT_NAMES.includes(name) ||
    extraNames.some((n) => n.toLowerCase() === name) ||
    inDir ||
    name.startsWith('.aider') ||
    name.endsWith('.prompt.md') ||
    name.endsWith('.instructions.md') ||
    (name.endsWith('.mdc') && inDir) ||
    lower.startsWith('.github/instructions/') ||
    lower.startsWith('.github/prompts/') ||
    lower === '.github/copilot-instructions.md'
  );
}

/** Like `agent_files::is_secret`. */
export function isSecret(path: string): boolean {
  const lower = path.toLowerCase();
  const name = lower.split('/').pop() ?? lower;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1) : '';
  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    name.endsWith('.env') ||
    ['pem', 'key', 'p12', 'pfx', 'jks', 'keystore', 'tfstate', 'kdbx', 'ppk', 'asc'].includes(
      ext,
    ) ||
    name.endsWith('.tfstate.backup') ||
    ['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'].some((p) => name.startsWith(p)) ||
    name.includes('.secret') ||
    name.startsWith('secrets.') ||
    name.startsWith('secret.') ||
    name.startsWith('credentials') ||
    ['.netrc', '.npmrc', '.pypirc', '.htpasswd', 'service-account.json'].includes(name)
  );
}

export interface QuizCorpusFile {
  path: string;
  binary: boolean;
  markdown: boolean;
  /** The lines of a text file (empty for a binary). */
  lines: string[];
}

export interface QuizCorpus {
  scope: SourceScope;
  files: Map<string, QuizCorpusFile>;
  agentFiles: QuizCorpusFile[];
  outsideScope: Set<string>;
}

const isMarkdownPath = (path: string) => /\.(?:md|markdown)$/i.test(path);

/** The lines of a text, like Rust's `str::lines` (no last empty line, `\r` dropped). */
export function textLines(content: string): string[] {
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l.replace(/\r$/, ''));
}

/** Like `Corpus::from_entries`: secrets are left out by the caller. */
export function buildQuizCorpus(
  entries: { file: QuizCorpusFile; agent: boolean }[],
  scope: SourceScope,
): QuizCorpus {
  const corpus: QuizCorpus = { scope, files: new Map(), agentFiles: [], outsideScope: new Set() };
  const wanted = scope.type === 'paths' ? new Set(scope.paths) : null;
  for (const { file, agent } of entries) {
    if (agent) {
      if (!file.binary) corpus.agentFiles.push(file);
      continue;
    }
    const inScope =
      scope.type === 'wholeProject'
        ? true
        : scope.type === 'documentationOnly'
          ? file.markdown ||
            (!file.path.includes('/') && file.path.toLowerCase().startsWith('readme'))
          : (wanted?.has(file.path) ?? false) ||
            [...(wanted ?? [])].some((p) => file.path.startsWith(`${p}/`));
    if (inScope) corpus.files.set(file.path, file);
    else corpus.outsideScope.add(file.path);
  }
  return corpus;
}

/** The corpus of a fake disk (the mock's files), like `Corpus::build`. */
export function corpusOfFiles(
  files: Map<string, string>,
  scope: SourceScope,
  agentNames: string[],
): QuizCorpus {
  const entries = [...files]
    .filter(
      ([path]) => !isSecret(path) && !/(?:^|\/)(?:node_modules|build|dist|target)\//.test(path),
    )
    .map(([path, content]) => {
      const markdown = isMarkdownPath(path);
      const binary = !markdown && content.includes('\u0000');
      return {
        file: { path, binary, markdown, lines: binary ? [] : textLines(content) },
        agent: isAgentFile(path, agentNames),
      };
    });
  return buildQuizCorpus(entries, scope);
}

export interface QuizValidationContext {
  corpus: QuizCorpus;
  agentNames: string[];
  projectName: string;
  modules: string[];
  exclude: QuizExclusion[];
  count: number;
}

export interface ValidatedQuiz {
  accepted: QuizQuestion[];
  rejected: { id: string; rejection: Rejection; message: string }[];
  insufficientMaterial: boolean;
  materialNote: string | null;
  suggestedSubjects: string[];
}

/** Like `words` in Rust. */
export function words(text: string): Set<string> {
  return new Set(
    text
      .split(/[^\p{L}\p{N}_]+/u)
      .map((w) => w.toLowerCase())
      .filter((w) => Array.from(w).length >= MIN_WORD_CHARS && !/^\d+$/.test(w) && !STOP.has(w)),
  );
}

const normalized = (text: string) =>
  Array.from(text.toLowerCase())
    .filter((c) => /[\p{L}\p{N}]/u.test(c))
    .join('');

function stem(path: string): string {
  const name = (path.split('/').pop() ?? path).toLowerCase();
  const i = name.indexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function namesTheProject(text: string, cited: Set<string>, ctx: QuizValidationContext): boolean {
  const lower = text.toLowerCase();
  const textWords = words(text);
  const allWords = new Set(
    text
      .split(/[^\p{L}\p{N}_]+/u)
      .map((w) => w.toLowerCase())
      .filter((w) => w !== ''),
  );
  for (const w of textWords) if (cited.has(w)) return true;
  const name = ctx.projectName.toLowerCase();
  if (Array.from(name).length >= MIN_WORD_CHARS && allWords.has(name)) return true;
  for (const m of ctx.modules) {
    const last = (m.split('/').pop() ?? m).toLowerCase();
    if (Array.from(last).length >= MIN_WORD_CHARS && allWords.has(last)) return true;
  }
  for (const path of [...ctx.corpus.files.keys(), ...ctx.corpus.outsideScope]) {
    const p = path.toLowerCase();
    const file = p.split('/').pop() ?? p;
    if ((file.includes('.') && file.length >= 4 && lower.includes(file)) || lower.includes(p)) {
      return true;
    }
    const s = stem(path);
    if (Array.from(s).length >= 5 && !GENERIC_STEMS.has(s) && allWords.has(s)) return true;
  }
  return false;
}

interface RawSource {
  path: string;
  firstLine?: number | null;
  lastLine?: number | null;
  why?: string | null;
}
interface RawQuestion {
  id: string;
  kind: QuestionKind;
  question: string;
  choices: string[];
  answer: number;
  hint: string;
  explanation: string;
  sources: RawSource[];
  difficulty: number;
  selfCheck: { projectSpecific: boolean; reason: string };
}
interface RawOutput {
  insufficientMaterial: boolean;
  materialNote?: string | null;
  suggestedSubjects?: string[];
  questions: RawQuestion[];
}

class ShapeError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function onlyKeys(v: Record<string, unknown>, allowed: string[], where: string) {
  for (const k of Object.keys(v)) {
    if (!allowed.includes(k)) throw new ShapeError(`unknown field \`${k}\` in ${where}`);
  }
}
function str(v: unknown, where: string): string {
  if (typeof v !== 'string') throw new ShapeError(`${where}: expected a string`);
  return v;
}
function int(v: unknown, where: string, max = 2 ** 32 - 1): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) {
    throw new ShapeError(`${where}: expected an integer`);
  }
  return v;
}
const optional = <T>(v: unknown, read: (v: unknown) => T): T | null =>
  v === undefined || v === null ? null : read(v);

/** Like serde with `deny_unknown_fields` on `QuizOutput`. */
function parseOutput(v: unknown): RawOutput {
  if (!isObject(v)) throw new ShapeError('expected an object');
  onlyKeys(
    v,
    ['insufficientMaterial', 'materialNote', 'suggestedSubjects', 'questions'],
    'the answer',
  );
  if (typeof v.insufficientMaterial !== 'boolean')
    throw new ShapeError('missing insufficientMaterial');
  if (!Array.isArray(v.questions)) throw new ShapeError('missing questions');
  const suggested = optional(v.suggestedSubjects, (s) => {
    if (!Array.isArray(s)) throw new ShapeError('suggestedSubjects: expected a list');
    return s.map((x, i) => str(x, `suggestedSubjects[${String(i)}]`));
  });
  return {
    insufficientMaterial: v.insufficientMaterial,
    materialNote: optional(v.materialNote, (n) => str(n, 'materialNote')),
    suggestedSubjects: suggested ?? [],
    questions: v.questions.map((q, i): RawQuestion => {
      const at = `questions[${String(i)}]`;
      if (!isObject(q)) throw new ShapeError(`${at}: expected an object`);
      onlyKeys(
        q,
        [
          'id',
          'kind',
          'question',
          'choices',
          'answer',
          'hint',
          'explanation',
          'sources',
          'difficulty',
          'selfCheck',
        ],
        at,
      );
      if (q.kind !== 'multipleChoice' && q.kind !== 'trueFalse') throw new ShapeError(`${at}.kind`);
      if (!Array.isArray(q.choices)) throw new ShapeError(`${at}.choices`);
      if (!Array.isArray(q.sources)) throw new ShapeError(`${at}.sources`);
      const check = q.selfCheck;
      if (!isObject(check)) throw new ShapeError(`${at}.selfCheck`);
      onlyKeys(check, ['projectSpecific', 'reason'], `${at}.selfCheck`);
      if (typeof check.projectSpecific !== 'boolean') throw new ShapeError(`${at}.selfCheck`);
      return {
        id: str(q.id, `${at}.id`),
        kind: q.kind,
        question: str(q.question, `${at}.question`),
        choices: q.choices.map((c, j) => str(c, `${at}.choices[${String(j)}]`)),
        answer: int(q.answer, `${at}.answer`),
        hint: str(q.hint, `${at}.hint`),
        explanation: str(q.explanation, `${at}.explanation`),
        sources: q.sources.map((s, j): RawSource => {
          const sat = `${at}.sources[${String(j)}]`;
          if (!isObject(s)) throw new ShapeError(sat);
          onlyKeys(s, ['path', 'firstLine', 'lastLine', 'why'], sat);
          return {
            path: str(s.path, `${sat}.path`),
            firstLine: optional(s.firstLine, (n) => int(n, `${sat}.firstLine`)),
            lastLine: optional(s.lastLine, (n) => int(n, `${sat}.lastLine`)),
            why: optional(s.why, (w) => str(w, `${sat}.why`)),
          };
        }),
        difficulty: int(q.difficulty, `${at}.difficulty`, 255),
        selfCheck: {
          projectSpecific: check.projectSpecific,
          reason: str(check.reason, `${at}.selfCheck.reason`),
        },
      };
    }),
  };
}

type Verdict<T> = { ok: true; value: T } | { ok: false; rejection: Rejection; message: string };
const reject = (
  rejection: Rejection,
  message: string,
): { ok: false; rejection: Rejection; message: string } => ({
  ok: false,
  rejection,
  message,
});

function checkChoices(q: RawQuestion): Verdict<null> {
  if (q.kind === 'trueFalse') {
    const ok =
      q.choices.length === 2 &&
      q.choices[0]?.trim().toLowerCase() === 'true' &&
      q.choices[1]?.trim().toLowerCase() === 'false';
    if (!ok)
      return reject(
        'trueFalse',
        'a true/false question needs exactly the choices ["True", "False"]',
      );
  } else {
    if (q.choices.length < 3 || q.choices.length > 5) {
      return reject(
        'choices',
        `has ${String(q.choices.length)} choices; a multiple choice question has 3 to 5`,
      );
    }
    const seen = new Set<string>();
    for (const c of q.choices) {
      const n = normalized(c);
      if (n === '' || seen.has(n)) return reject('choices', 'has empty or duplicate choices');
      seen.add(n);
      if (n.includes('theabove'))
        return reject('allOfTheAbove', 'uses an "all/none of the above" choice');
    }
  }
  if (q.answer >= q.choices.length) {
    return reject('answerRange', `its answer index ${String(q.answer)} is not one of its choices`);
  }
  return { ok: true, value: null };
}

function checkSources(
  q: RawQuestion,
  ctx: QuizValidationContext,
): Verdict<{ sources: QuizSource[]; cited: Set<string> }> {
  if (q.sources.length === 0) return reject('noSource', 'cites no source');
  const sources: QuizSource[] = [];
  const cited = new Set<string>();
  for (const s of q.sources) {
    const path = s.path
      .trim()
      .replace(/^(?:\.\/)+/, '')
      .replace(/\\/g, '/');
    const file = ctx.corpus.files.get(path);
    if (!file) {
      if (isSecret(path))
        return reject('secretFile', `cites ${path}, a file that may hold secrets`);
      if (isAgentFile(path, ctx.agentNames)) {
        return reject(
          'agentFile',
          `cites ${path}, an agent instruction file (context only, never a source)`,
        );
      }
      if (ctx.corpus.outsideScope.has(path)) {
        const what =
          ctx.corpus.scope.type === 'documentationOnly'
            ? 'this quiz is limited to the documentation'
            : 'this quiz is limited to other files';
        return reject('outOfScope', `cites ${path}, but ${what}`);
      }
      return reject(
        'unknownPath',
        `cites ${path}, which is not a file of this project (use the paths of the corpus map)`,
      );
    }
    let first = s.firstLine ?? null;
    let last = s.lastLine ?? null;
    if (first === null && last !== null) first = last;
    if (last === null && first !== null) last = first;
    if (file.binary) {
      if (first !== null)
        return reject('binaryRange', `cites lines of ${path}, a binary file that cannot be read`);
      sources.push({ path, firstLine: null, lastLine: null, why: s.why ?? null, kind: 'binary' });
      continue;
    }
    const count = file.lines.length;
    if (first === null || last === null) {
      if (count > WHOLE_FILE_MAX_LINES) {
        return reject(
          'missingRange',
          `cites ${path} (${String(count)} lines) without the line range that holds the fact`,
        );
      }
      for (const line of file.lines) for (const w of words(line)) cited.add(w);
    } else {
      if (first === 0 || first > last)
        return reject(
          'badRange',
          `cites lines ${String(first)}-${String(last)} of ${path}, which is not a range`,
        );
      if (last - first + 1 > MAX_RANGE_LINES) {
        return reject(
          'rangeTooLong',
          `cites ${String(last - first + 1)} lines of ${path}; cite at most ${String(MAX_RANGE_LINES)}, the ones that hold the fact`,
        );
      }
      if (last > count)
        return reject(
          'beyondEnd',
          `${path} has ${String(count)} lines; lines ${String(first)}-${String(last)} do not exist`,
        );
      for (const line of file.lines.slice(first - 1, last))
        for (const w of words(line)) cited.add(w);
    }
    sources.push({
      path,
      firstLine: first,
      lastLine: last,
      why: s.why ?? null,
      kind: file.markdown ? 'markdown' : 'code',
    });
  }
  if (sources.every((s) => s.kind === 'binary')) {
    return reject(
      'binaryOnly',
      'cites only binary files, whose content cannot be read; cite the text that uses them',
    );
  }
  return { ok: true, value: { sources, cited } };
}

/** Like `validate` in Rust: `{ ok: false }` is a shape error rejecting the whole answer. */
export function validateQuiz(
  output: unknown,
  ctx: QuizValidationContext,
): { ok: true; value: ValidatedQuiz } | { ok: false; error: string } {
  if (output === null || output === undefined)
    return { ok: false, error: 'no JSON answer was given' };
  let parsed: RawOutput;
  try {
    parsed = parseOutput(output);
  } catch (err) {
    if (err instanceof ShapeError) return { ok: false, error: err.message };
    throw err;
  }
  const outOfRange = parsed.questions.find((q) => q.difficulty < 1 || q.difficulty > 5);
  if (outOfRange) {
    return {
      ok: false,
      error: `${outOfRange.id}: difficulty ${String(outOfRange.difficulty)} is not between 1 and 5`,
    };
  }
  const v: ValidatedQuiz = {
    accepted: [],
    rejected: [],
    insufficientMaterial: parsed.insufficientMaterial,
    materialNote: parsed.materialNote?.trim() ? parsed.materialNote : null,
    suggestedSubjects: parsed.suggestedSubjects ?? [],
  };
  const ids = new Set<string>();
  const texts = new Set(ctx.exclude.map((e) => normalized(e.question)));
  const facts = new Set<string>();
  for (const q of parsed.questions) {
    const verdict = ((): Verdict<QuizSource[]> => {
      if (ids.has(q.id)) return reject('duplicate', `repeats the id ${q.id}`);
      ids.add(q.id);
      const choices = checkChoices(q);
      if (!choices.ok) return choices;
      const checked = checkSources(q, ctx);
      if (!checked.ok) return checked;
      if (!q.selfCheck.projectSpecific) {
        return reject('selfCheck', 'your own self-check says it is not specific to this project');
      }
      const text = `${q.question} ${q.explanation} ${q.choices.join(' ')}`;
      if (!namesTheProject(text, checked.value.cited, ctx)) {
        return reject(
          'generic',
          'generic: the question and its explanation name nothing of this project (a file, an identifier of the cited lines, a module)',
        );
      }
      const correct = (q.choices[q.answer] ?? '').trim();
      if (
        (Array.from(correct).length >= HINT_ANSWER_MIN_CHARS &&
          q.hint.toLowerCase().includes(correct.toLowerCase())) ||
        normalized(q.hint) === normalized(q.explanation)
      ) {
        return reject(
          'hintGivesAnswer',
          'its hint gives the answer away; point to where to look instead',
        );
      }
      const textKey = normalized(q.question);
      const first = checked.value.sources[0];
      const fact = JSON.stringify([
        first?.path,
        first?.firstLine,
        first?.lastLine,
        normalized(correct),
      ]);
      if (texts.has(textKey) || facts.has(fact))
        return reject('duplicate', 'repeats a question already asked');
      texts.add(textKey);
      facts.add(fact);
      return { ok: true, value: checked.value.sources };
    })();
    if (verdict.ok) {
      if (v.accepted.length < ctx.count) {
        v.accepted.push({
          id: q.id,
          kind: q.kind,
          question: q.question.trim(),
          choices: q.choices.map((c) => c.trim()),
          answer: q.answer,
          hint: q.hint.trim(),
          explanation: q.explanation.trim(),
          sources: verdict.value,
          difficulty: q.difficulty,
        });
      }
    } else {
      v.rejected.push({ id: q.id, rejection: verdict.rejection, message: verdict.message });
    }
  }
  return { ok: true, value: v };
}

const PLAIN: Record<Rejection, [string, string]> = {
  choices: ['had unusable choices', 'had unusable choices'],
  trueFalse: ['had unusable choices', 'had unusable choices'],
  allOfTheAbove: ['had unusable choices', 'had unusable choices'],
  answerRange: ['had unusable choices', 'had unusable choices'],
  noSource: ['cited nothing', 'cited nothing'],
  unknownPath: ['cited a file that does not exist', 'cited files that do not exist'],
  agentFile: ['cited an agent file', 'cited agent files'],
  secretFile: ['cited a secret file', 'cited secret files'],
  outOfScope: ['cited code outside the sources', 'cited code outside the sources'],
  missingRange: ['cited lines that do not check out', 'cited lines that do not check out'],
  badRange: ['cited lines that do not check out', 'cited lines that do not check out'],
  rangeTooLong: ['cited lines that do not check out', 'cited lines that do not check out'],
  beyondEnd: ['cited lines that do not check out', 'cited lines that do not check out'],
  binaryRange: ['cited lines that do not check out', 'cited lines that do not check out'],
  binaryOnly: ['cited only a binary file', 'cited only binary files'],
  selfCheck: ['was generic', 'were generic'],
  generic: ['was generic', 'were generic'],
  hintGivesAnswer: ['had a hint giving the answer', 'had hints giving the answer'],
  duplicate: ['was a repeat', 'were repeats'],
};

/** Like `Validated::summary`: "3 rejected: 2 cited agent files, 1 was generic". */
export function rejectionSummary(rejected: { rejection: Rejection }[]): string {
  const counts = new Map<string, { n: number; r: Rejection }>();
  for (const { rejection } of rejected) {
    const key = PLAIN[rejection][0];
    const c = counts.get(key);
    if (c) c.n += 1;
    else counts.set(key, { n: 1, r: rejection });
  }
  const parts = [...counts.values()].map(({ n, r }) => `${String(n)} ${PLAIN[r][n === 1 ? 0 : 1]}`);
  return `${String(rejected.length)} rejected: ${parts.join(', ')}`;
}
