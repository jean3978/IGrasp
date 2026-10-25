// The shared markdown format of a tutorial (ADR 0025), written by the mock backend: mirrors
// `markdown::write` in Rust (`learning/tutorial/markdown.rs`) byte for byte, so the browser dev
// mode and the tests share what the app would write. The front matters and the `igrasp-*` blocks
// are YAML: a small emitter below reproduces what Rust's YAML serializer (a libyaml emitter)
// prints for the shapes used here (block mappings and sequences, its scalar quoting choices,
// literal blocks for multi-line strings). Both run on `src/test/fixtures/tutorial/format/`.

import type { Chapter, Citation, Familiarity, Length, Step, Tutorial } from '../types';
import { citationLines, slug, stepTitle } from '../../lib/tutorial';

/** A file of the shared format: its name in the tutorial's folder and its text. */
export interface TutorialFile {
  name: string;
  text: string;
}

const KIND = 'tutorial';
const CHAPTER_KIND = 'tutorial-chapter';
const SOURCES = 'Sources: ';
const HOOT = '> **Hoot:** ';
const CONCEPT = '> **Concept:** ';
const DOCS = '> Official docs: ';

// ---------------------------------------------------------------------------------------------
// Rust's string helpers (`char::is_whitespace` is Unicode's White_Space, not JavaScript's `\s`).

const WS =
  '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const WS_RUN = new RegExp(`[${WS}]+`, 'u');
const TRIM = new RegExp(`^[${WS}]+|[${WS}]+$`, 'gu');

/** Rust's `str::trim`. */
const trim = (s: string): string => s.replace(TRIM, '');

/** `split_whitespace().join(" ")`. */
const oneLine = (s: string): string =>
  s
    .split(WS_RUN)
    .filter((w) => w !== '')
    .join(' ');

/** Rust's `s.get(..n)` on bytes: the prefix, or `s` when it is shorter or `n` splits a char. */
function bytePrefix(s: string, n: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length < n) return s;
  const next = bytes[n];
  if (next !== undefined && (next & 0xc0) === 0x80) return s;
  return new TextDecoder().decode(bytes.slice(0, n));
}

// ---------------------------------------------------------------------------------------------
// YAML: the values, then serde's choice of style for a string, then libyaml's emitter.

type Yaml =
  | { kind: 'str'; value: string }
  | { kind: 'num'; value: number }
  | { kind: 'seq'; items: Yaml[] }
  | { kind: 'map'; entries: [string, Yaml][] };

const str = (value: string): Yaml => ({ kind: 'str', value });
const num = (value: number): Yaml => ({ kind: 'num', value });
const seq = (items: Yaml[]): Yaml => ({ kind: 'seq', items });
/** A struct: fields in declaration order, `undefined` ones skipped (`skip_serializing_if`). */
const map = (entries: [string, Yaml | undefined][]): Yaml => ({
  kind: 'map',
  entries: entries.filter((e): e is [string, Yaml] => e[1] !== undefined),
});
const optStr = (value: string | undefined): Yaml | undefined =>
  value === undefined ? undefined : str(value);

type Style = 'any' | 'plain' | 'single' | 'double' | 'literal';

/** Leading zeros followed by digits: a string in YAML 1.2 (serde_yaml's `digits_but_not_number`). */
function digitsButNotNumber(s: string): boolean {
  const t = s.startsWith('-') || s.startsWith('+') ? s.slice(1) : s;
  return t.length > 1 && t.startsWith('0') && /^[0-9]*$/.test(t.slice(1));
}

const U128_MAX = (1n << 128n) - 1n;
const I128_MIN = -(1n << 127n);
const I128_MAX = (1n << 127n) - 1n;

/** Rust's `from_str_radix` into a u128 (`signed` false) or an i128. */
function fromStrRadix(src: string, radix: number, signed: boolean): bigint | undefined {
  if (src === '') return undefined;
  let digits = src;
  let negative = false;
  const first = src[0];
  if ((first === '+' || first === '-') && src.length === 1) return undefined;
  if (first === '+') digits = src.slice(1);
  else if (first === '-' && signed) {
    digits = src.slice(1);
    negative = true;
  }
  let value = 0n;
  for (const c of digits) {
    const d = parseInt(c, 36);
    if (!/^[0-9a-zA-Z]$/.test(c) || Number.isNaN(d) || d >= radix) return undefined;
    value = value * BigInt(radix) + BigInt(d);
  }
  if (negative) value = -value;
  if (signed ? value < I128_MIN || value > I128_MAX : value > U128_MAX) return undefined;
  return value;
}

const PREFIXES: [string, number][] = [
  ['0x', 16],
  ['0o', 8],
  ['0b', 2],
];

function parseUnsignedInt(s: string): boolean {
  const unpositive = s.startsWith('+') ? s.slice(1) : s;
  for (const [prefix, radix] of PREFIXES) {
    if (!unpositive.startsWith(prefix)) continue;
    const rest = unpositive.slice(2);
    if (rest.startsWith('+') || rest.startsWith('-')) return false;
    if (fromStrRadix(rest, radix, false) !== undefined) return true;
  }
  if (unpositive.startsWith('+') || unpositive.startsWith('-')) return false;
  if (digitsButNotNumber(s)) return false;
  return fromStrRadix(unpositive, 10, false) !== undefined;
}

function parseNegativeInt(s: string): boolean {
  for (const [prefix, radix] of PREFIXES) {
    if (!s.startsWith(`-${prefix}`)) continue;
    if (fromStrRadix(`-${s.slice(3)}`, radix, true) !== undefined) return true;
  }
  if (digitsButNotNumber(s)) return false;
  return fromStrRadix(s, 10, true) !== undefined;
}

function parseF64(s: string): boolean {
  let unpositive = s;
  if (s.startsWith('+')) {
    unpositive = s.slice(1);
    if (unpositive.startsWith('+') || unpositive.startsWith('-')) return false;
  }
  if (['.inf', '.Inf', '.INF'].includes(unpositive)) return true;
  if (['-.inf', '-.Inf', '-.INF', '.nan', '.NaN', '.NAN'].includes(s)) return true;
  // Rust's `f64::from_str`, finite results only (`inf` and `nan` are not).
  if (!/^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(unpositive)) return false;
  return Number.isFinite(Number(unpositive));
}

/** serde_yaml's `serialize_str`: quote what would read back as null, a bool or a number. */
function serdeStyle(value: string): Style {
  if (value.includes('\n')) return 'literal';
  if (value === '' || ['~', 'null', 'Null', 'NULL'].includes(value)) return 'single';
  if (['true', 'True', 'TRUE', 'false', 'False', 'FALSE'].includes(value)) return 'single';
  if (parseUnsignedInt(value) || parseNegativeInt(value)) return 'single';
  if (!digitsButNotNumber(value) && parseF64(value)) return 'single';
  return digitsButNotNumber(value) ? 'single' : 'any';
}

const isBreak = (c: string | undefined): boolean =>
  c === '\r' || c === '\n' || c === '\u0085' || c === ' ' || c === ' ';
const isBlankZ = (c: string | undefined): boolean =>
  c === undefined || c === '\0' || c === ' ' || c === '\t' || isBreak(c);

function isPrintable(c: string): boolean {
  const cp = c.codePointAt(0) ?? 0;
  return (
    cp === 0x0a ||
    (cp >= 0x20 && cp <= 0x7e) ||
    (cp >= 0xa0 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd && cp !== 0xfeff) ||
    (cp >= 0x10000 && cp <= 0x10ffff)
  );
}

interface Analysis {
  multiline: boolean;
  blockPlainAllowed: boolean;
  singleQuotedAllowed: boolean;
  blockAllowed: boolean;
}

/** libyaml's `yaml_emitter_analyze_scalar` (block context; flow styles are never chosen here). */
function analyze(value: string): Analysis {
  const cps = Array.from(value);
  if (cps.length === 0) {
    return {
      multiline: false,
      blockPlainAllowed: true,
      singleQuotedAllowed: true,
      blockAllowed: false,
    };
  }
  let blockIndicators = false;
  let lineBreaks = false;
  let special = false;
  let leadingSpace = false;
  let leadingBreak = false;
  let trailingSpace = false;
  let trailingBreak = false;
  let breakSpace = false;
  let spaceBreak = false;
  let previousSpace = false;
  let previousBreak = false;
  if (value.startsWith('---') || value.startsWith('...')) blockIndicators = true;
  let precededByWhitespace = true;
  let followedByWhitespace = isBlankZ(cps[1]);
  const last = cps.length - 1;
  for (const [i, c] of cps.entries()) {
    if (i === 0) {
      if ('#,[]{}&*!|>\'"%@`'.includes(c)) blockIndicators = true;
      if ((c === '?' || c === ':') && followedByWhitespace) blockIndicators = true;
      if (c === '-' && followedByWhitespace) blockIndicators = true;
    } else {
      if (c === ':' && followedByWhitespace) blockIndicators = true;
      if (c === '#' && precededByWhitespace) blockIndicators = true;
    }
    if (!isPrintable(c)) special = true;
    if (isBreak(c)) lineBreaks = true;
    if (c === ' ') {
      if (i === 0) leadingSpace = true;
      if (i === last) trailingSpace = true;
      if (previousBreak) breakSpace = true;
      previousSpace = true;
      previousBreak = false;
    } else if (isBreak(c)) {
      if (i === 0) leadingBreak = true;
      if (i === last) trailingBreak = true;
      if (previousSpace) spaceBreak = true;
      previousSpace = false;
      previousBreak = true;
    } else {
      previousSpace = false;
      previousBreak = false;
    }
    precededByWhitespace = isBlankZ(c);
    if (i + 1 <= last) followedByWhitespace = isBlankZ(cps[i + 2]);
  }
  let blockPlainAllowed = true;
  let singleQuotedAllowed = true;
  let blockAllowed = true;
  if (leadingSpace || leadingBreak || trailingSpace || trailingBreak) blockPlainAllowed = false;
  if (trailingSpace) blockAllowed = false;
  if (breakSpace) {
    blockPlainAllowed = false;
    singleQuotedAllowed = false;
  }
  if (spaceBreak || special) {
    blockPlainAllowed = false;
    singleQuotedAllowed = false;
    blockAllowed = false;
  }
  if (lineBreaks) blockPlainAllowed = false;
  if (blockIndicators) blockPlainAllowed = false;
  return { multiline: lineBreaks, blockPlainAllowed, singleQuotedAllowed, blockAllowed };
}

const ESCAPES: Record<number, string> = {
  0x00: '0',
  0x07: 'a',
  0x08: 'b',
  0x09: 't',
  0x0a: 'n',
  0x0b: 'v',
  0x0c: 'f',
  0x0d: 'r',
  0x1b: 'e',
  0x22: '"',
  0x5c: '\\',
  0x85: 'N',
  0xa0: '_',
  0x2028: 'L',
  0x2029: 'P',
};

/** libyaml's emitter state for one document (indent 2, unlimited width, unicode). */
class Emitter {
  out = '';
  private column = 0;
  private whitespace = true;
  private indention = true;
  private indent = -1;
  private readonly indents: number[] = [];
  private openEnded = 0;

  private put(s: string) {
    this.out += s;
    this.column += Array.from(s).length;
  }

  private putBreak() {
    this.out += '\n';
    this.column = 0;
  }

  private writeBreak(c: string) {
    if (c === '\n') this.putBreak();
    else {
      this.out += c;
      this.column = 0;
    }
  }

  private increaseIndent(flow: boolean, indentless: boolean) {
    this.indents.push(this.indent);
    if (this.indent < 0) this.indent = flow ? 2 : 0;
    else if (!indentless) this.indent += 2;
  }

  private popIndent() {
    this.indent = this.indents.pop() ?? -1;
  }

  private writeIndent() {
    const indent = Math.max(this.indent, 0);
    if (!this.indention || this.column > indent || (this.column === indent && !this.whitespace)) {
      this.putBreak();
    }
    while (this.column < indent) this.put(' ');
    this.whitespace = true;
    this.indention = true;
  }

  private writeIndicator(
    s: string,
    needWhitespace: boolean,
    isWhitespace: boolean,
    isIndention: boolean,
  ) {
    if (needWhitespace && !this.whitespace) this.put(' ');
    this.put(s);
    this.whitespace = isWhitespace;
    this.indention = this.indention && isIndention;
  }

  document(root: Yaml) {
    this.node(root, false);
    this.writeIndent();
    if (this.openEnded === 2) {
      this.writeIndicator('...', true, false, false);
      this.writeIndent();
    }
  }

  private node(n: Yaml, mappingContext: boolean) {
    switch (n.kind) {
      case 'str':
        this.scalar(n.value, serdeStyle(n.value), false);
        return;
      case 'num':
        this.scalar(String(n.value), 'plain', false);
        return;
      case 'seq':
        if (n.items.length === 0) {
          this.writeIndicator('[', true, true, false);
          this.writeIndicator(']', false, false, false);
          return;
        }
        this.increaseIndent(false, mappingContext && !this.indention);
        for (const item of n.items) {
          this.writeIndent();
          this.writeIndicator('-', true, false, true);
          this.node(item, false);
        }
        this.popIndent();
        return;
      case 'map':
        if (n.entries.length === 0) {
          this.writeIndicator('{', true, true, false);
          this.writeIndicator('}', false, false, false);
          return;
        }
        this.increaseIndent(false, false);
        for (const [key, value] of n.entries) {
          this.writeIndent();
          this.scalar(key, serdeStyle(key), true);
          this.writeIndicator(':', false, false, false);
          this.node(value, true);
        }
        this.popIndent();
    }
  }

  /** `yaml_emitter_select_scalar_style`, then the writer of the chosen style. */
  private scalar(value: string, requested: Style, simpleKey: boolean) {
    const a = analyze(value);
    let style: Style = requested === 'any' ? 'plain' : requested;
    if (simpleKey && a.multiline) style = 'double';
    if (style === 'plain') {
      if (!a.blockPlainAllowed) style = 'single';
      if (value === '' && simpleKey) style = 'single';
    }
    if (style === 'single' && !a.singleQuotedAllowed) style = 'double';
    if (style === 'literal' && (!a.blockAllowed || simpleKey)) style = 'double';
    this.increaseIndent(true, false);
    if (style === 'plain') this.plain(value);
    else if (style === 'single') this.singleQuoted(value);
    else if (style === 'double') this.doubleQuoted(value);
    else this.literal(value);
    this.popIndent();
  }

  private plain(value: string) {
    if (!this.whitespace && value !== '') this.put(' ');
    this.put(value);
    this.whitespace = false;
    this.indention = false;
  }

  private singleQuoted(value: string) {
    this.writeIndicator("'", true, false, false);
    let breaks = false;
    for (const c of value) {
      if (c === ' ') {
        this.put(c);
      } else if (isBreak(c)) {
        if (!breaks && c === '\n') this.putBreak();
        this.writeBreak(c);
        this.indention = true;
        breaks = true;
      } else {
        if (breaks) this.writeIndent();
        if (c === "'") this.put("'");
        this.put(c);
        this.indention = false;
        breaks = false;
      }
    }
    if (breaks) this.writeIndent();
    this.writeIndicator("'", false, false, false);
    this.whitespace = false;
    this.indention = false;
  }

  private doubleQuoted(value: string) {
    this.writeIndicator('"', true, false, false);
    for (const c of value) {
      const cp = c.codePointAt(0) ?? 0;
      if (!isPrintable(c) || cp === 0xfeff || isBreak(c) || c === '"' || c === '\\') {
        const known = ESCAPES[cp];
        if (known !== undefined) this.put(`\\${known}`);
        else if (cp <= 0xff) this.put(`\\x${cp.toString(16).toUpperCase().padStart(2, '0')}`);
        else if (cp <= 0xffff) this.put(`\\u${cp.toString(16).toUpperCase().padStart(4, '0')}`);
        else this.put(`\\U${cp.toString(16).toUpperCase().padStart(8, '0')}`);
      } else {
        this.put(c);
      }
    }
    this.writeIndicator('"', false, false, false);
    this.whitespace = false;
    this.indention = false;
  }

  private literal(value: string) {
    this.writeIndicator('|', true, false, false);
    const cps = Array.from(value);
    const first = cps[0];
    if (first === ' ' || isBreak(first)) this.writeIndicator('2', false, false, false);
    this.openEnded = 0;
    const last = cps[cps.length - 1];
    const beforeLast = cps[cps.length - 2];
    if (cps.length === 0 || !isBreak(last)) this.writeIndicator('-', false, false, false);
    else if (cps.length === 1 || isBreak(beforeLast)) {
      this.writeIndicator('+', false, false, false);
      this.openEnded = 2;
    }
    this.putBreak();
    this.indention = true;
    this.whitespace = true;
    let breaks = true;
    for (const c of cps) {
      if (isBreak(c)) {
        this.writeBreak(c);
        this.indention = true;
        breaks = true;
      } else {
        if (breaks) this.writeIndent();
        this.put(c);
        this.indention = false;
        breaks = false;
      }
    }
  }
}

/** `serde_yaml::to_string`. */
function toYaml(value: Yaml): string {
  const e = new Emitter();
  e.document(value);
  return e.out;
}

// ---------------------------------------------------------------------------------------------
// Writing.

/** `01-the-watcher.md`. */
export function chapterFileName(index: number, title: string): string {
  const s = Array.from(slug(title)).slice(0, 60).join('').replace(/-+$/, '');
  return `${String(index + 1).padStart(2, '0')}-${s}.md`;
}

/** A fence longer than any backtick run inside the text. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  return '`'.repeat(Math.max(longest, 2) + 1);
}

function yamlBlock(kind: string, value: Yaml): string {
  const yaml = toYaml(value);
  const fence = fenceFor(yaml);
  return `${fence}${kind}\n${yaml}${fence}`;
}

const yamlCitation = (c: Citation): Yaml =>
  map([
    ['path', str(c.path)],
    ['lines', optStr(citationLines(c))],
    ['why', optStr(c.why)],
  ]);
const yamlCitations = (v: Citation[]): Yaml => seq(v.map(yamlCitation));
const strings = (v: string[]): Yaml => seq(v.map(str));
const rangeLines = (firstLine: number, lastLine: number): string =>
  citationLines({ firstLine, lastLine }) ?? '';

/** The `Sources:` line: links relative to the tutorial's folder, root-relative paths as text. */
function sourcesLine(sources: Citation[], up: string): string {
  const items = sources.map((c) => {
    const lines = citationLines(c);
    const label = lines === undefined ? c.path : `${c.path}:${lines}`;
    const a = c.firstLine;
    const b = c.lastLine;
    const anchor =
      a !== undefined && b !== undefined && a !== b
        ? `#L${a}-L${b}`
        : a !== undefined
          ? `#L${a}`
          : '';
    let item = `[\`${label}\`](${up}${c.path}${anchor})`;
    if (c.why !== undefined) item += ` — ${oneLine(c.why)}`;
    return item;
  });
  return `${SOURCES}${items.join(' · ')}`;
}

function stepMarkdown(step: Step, up: string): string {
  switch (step.type) {
    case 'explain':
      return `${trim(step.body)}\n\n${sourcesLine(step.sources, up)}`;
    case 'conceptBridge': {
      let alert = `> [!NOTE]\n${CONCEPT}${oneLine(step.concept)}`;
      if (step.docsUrl !== undefined) alert += `\n${DOCS}<${step.docsUrl}>`;
      return `${alert}\n\n${trim(step.applied)}\n\n${sourcesLine(step.sources, up)}`;
    }
    case 'codeTour':
      return yamlBlock(
        'igrasp-code-tour',
        map([
          [
            'stops',
            seq(
              step.stops.map((t) =>
                map([
                  ['path', str(t.path)],
                  ['lines', str(rangeLines(t.firstLine, t.lastLine))],
                  ['annotation', str(t.annotation)],
                ]),
              ),
            ),
          ],
        ]),
      );
    case 'diagram': {
      const fence = fenceFor(step.mermaid);
      let out = `${fence}mermaid\n${trim(step.mermaid)}\n${fence}`;
      if (step.caption !== undefined) out += `\n\n${trim(step.caption)}`;
      return `${out}\n\n${sourcesLine(step.sources, up)}`;
    }
    case 'putInOrder':
      return yamlBlock(
        'igrasp-put-in-order',
        map([
          ['prompt', str(step.prompt)],
          ['items', strings(step.items)],
          ['explanation', str(step.explanation)],
          ['sources', yamlCitations(step.sources)],
        ]),
      );
    case 'match':
      return yamlBlock(
        'igrasp-match',
        map([
          ['prompt', str(step.prompt)],
          [
            'pairs',
            seq(
              step.pairs.map((p) =>
                map([
                  ['left', str(p.left)],
                  ['right', str(p.right)],
                ]),
              ),
            ),
          ],
          ['explanation', str(step.explanation)],
          ['sources', yamlCitations(step.sources)],
        ]),
      );
    case 'spotIt':
      return yamlBlock(
        'igrasp-spot-it',
        map([
          ['prompt', str(step.prompt)],
          ['path', str(step.path)],
          ['lines', str(rangeLines(step.firstLine, step.lastLine))],
          ['answerLine', num(step.answerLine)],
          ['explanation', str(step.explanation)],
        ]),
      );
    case 'quickCheck':
      return yamlBlock(
        'igrasp-quiz',
        map([
          ['kind', str(step.kind)],
          ['choices', strings(step.choices)],
          ['answer', num(step.answer)],
          ['hint', str(step.hint)],
          ['explanation', str(step.explanation)],
          ['sources', yamlCitations(step.sources)],
        ]),
      );
    case 'tryIt':
      return yamlBlock(
        'igrasp-try-it',
        map([
          ['instruction', str(step.instruction)],
          ['command', optStr(step.command)],
          ['where', optStr(step.where)],
          ['expected', optStr(step.expected)],
          ['sources', yamlCitations(step.sources)],
        ]),
      );
    case 'recap': {
      let out = step.takeaways.map((t) => `- ${oneLine(t)}`).join('\n');
      if (step.sources.length > 0) out += `\n\n${sourcesLine(step.sources, up)}`;
      return out;
    }
  }
}

function chapterMarkdown(t: Tutorial, index: number, c: Chapter, up: string): string {
  const front = toYaml(
    map([
      ['igrasp', str(CHAPTER_KIND)],
      ['tutorial', str(t.id)],
      ['chapter', str(c.id)],
    ]),
  );
  let out = `---\n${front}---\n\n# ${index + 1}. ${oneLine(c.title)}\n`;
  if (c.hootIntro !== undefined) out += `\n${HOOT}${oneLine(c.hootIntro)}\n`;
  c.steps.forEach((step, i) => {
    out += `\n## ${i + 1}. ${oneLine(stepTitle(step))}\n\n${stepMarkdown(step, up)}\n`;
  });
  // The questions readers saved, anonymous; `step` counts from 1 as the headings do.
  const questions = c.questions;
  if (questions.length > 0) {
    out += '\n## Questions from readers\n';
    for (const q of questions) {
      const block = map([
        ['step', num(q.step + 1)],
        ['quote', optStr(q.quote)],
        ['question', str(q.question)],
        ['answer', str(q.answer)],
      ]);
      out += `\n${yamlBlock('igrasp-question', block)}\n`;
    }
  }
  return out;
}

const FAMILIARITY_WORDS: Record<Familiarity, string> = {
  newHere: 'developers new to the project',
  contributing: 'developers already contributing',
  maintainer: 'maintainers (deep dive)',
};

const LENGTH_MINUTES: Record<Length, number> = { quick: 5, standard: 15, deep: 30 };

/**
 * The files of `t`: `README.md` first, then one file per written chapter. `folder` is where they
 * will live, root-relative (`docs/tutorials/the-watcher`), for the links to the sources. `t` is
 * normalized (`normalizeTutorial`), as Rust's `write` expects.
 */
export function writeTutorialMarkdown(t: Tutorial, folder: string): TutorialFile[] {
  const depth = folder.split('/').filter((p) => p !== '').length;
  const up = '../'.repeat(depth);
  const files: TutorialFile[] = [];
  const metas: { id: string; title: string; goal: string; minutes: number; file?: string }[] = [];
  t.chapters.forEach((c, i) => {
    const written = c.steps.length > 0;
    const file = written ? chapterFileName(i, c.title) : undefined;
    if (file !== undefined) files.push({ name: file, text: chapterMarkdown(t, i, c, up) });
    metas.push({
      id: c.id,
      title: c.title,
      goal: c.goal,
      minutes: c.minutes,
      ...(file !== undefined ? { file } : {}),
    });
  });
  const v = t.verified;
  const front = map([
    ['igrasp', str(KIND)],
    ['id', str(t.id)],
    ['title', str(t.title)],
    ['intro', str(t.intro)],
    ['project', str(t.project)],
    ['subject', str(t.subject)],
    ['familiarity', str(t.familiarity)],
    ['domainGap', optStr(t.domainGap)],
    ['length', str(t.length)],
    ['role', optStr(t.role)],
    ['generated', str(t.generated)],
    ['provider', str(t.provider)],
    ['model', str(t.model)],
    ['generationCommit', optStr(t.generationCommit)],
    [
      'verified',
      v === undefined
        ? undefined
        : map([
            ['date', str(v.date)],
            ['commit', optStr(v.commit)],
            ['by', optStr(v.by)],
          ]),
    ],
    ['materialNote', optStr(t.materialNote)],
    ['docsNote', optStr(t.docsNote)],
    [
      'chapters',
      seq(
        metas.map((m) =>
          map([
            ['id', str(m.id)],
            ['title', str(m.title)],
            ['goal', str(m.goal)],
            ['minutes', num(m.minutes)],
            ['file', optStr(m.file)],
          ]),
        ),
      ),
    ],
    [
      'sources',
      seq(
        t.sources.map((s) =>
          map([
            ['path', str(s.path)],
            ['lines', optStr(s.lines)],
            ['sha256', optStr(s.sha256)],
          ]),
        ),
      ),
    ],
  ]);
  let body = `---\n${toYaml(front)}---\n\n# ${t.title}\n\n${trim(t.intro)}\n\n`;
  const facts = [
    `**Project:** ${t.project}`,
    `**Subject:** ${t.subject}`,
    `**For:** ${FAMILIARITY_WORDS[t.familiarity]}`,
  ];
  if (t.domainGap !== undefined) facts.push(`**New to:** ${t.domainGap}`);
  if (t.role !== undefined) facts.push(`**Role:** ${t.role}`);
  facts.push(`**Length:** ${t.length} (~${LENGTH_MINUTES[t.length]} min)`);
  facts.push(`**Written:** ${bytePrefix(t.generated, 10)} by Hoot with ${t.model}`);
  if (v !== undefined) facts.push(`**Verified:** ${v.date}`);
  body += facts.join(' · ');
  body += '\n\n## Chapters\n\n';
  metas.forEach((m, i) => {
    body +=
      m.file !== undefined
        ? `${i + 1}. [${m.title}](${m.file}) — ${m.goal} (${m.minutes} min)\n`
        : `${i + 1}. ${m.title} — ${m.goal} (not written yet)\n`;
  });
  if (t.materialNote !== undefined || t.docsNote !== undefined) {
    body += "\n## Hoot's notes\n\n";
    if (t.materialNote !== undefined) body += `- Material: ${t.materialNote}\n`;
    if (t.docsNote !== undefined) body += `- Documentation: ${t.docsNote}\n`;
  }
  body += `\n<sub>Written by IGrasp's Academy. Open this folder in IGrasp to take the tutorial; the ${t.sources.length} cited ranges are checked against the files when it opens.</sub>\n`;
  files.unshift({ name: 'README.md', text: body });
  return files;
}
