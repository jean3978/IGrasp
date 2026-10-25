// The interactive steps of a shared tutorial's chapter file, as the preview reads them: one
// fenced `igrasp-*` block of YAML (ADR 0025) parsed into what its folded card shows. Rust owns
// the format; this reader is tolerant (a block that does not parse shows as plain code) and never
// turns any of it into markup.

import { parse } from 'yaml';

export const TUTORIAL_BLOCK_KINDS = [
  'code-tour',
  'spot-it',
  'put-in-order',
  'match',
  'try-it',
  'question',
] as const;
export type TutorialBlockKind = (typeof TUTORIAL_BLOCK_KINDS)[number];

export const isTutorialBlockKind = (s: string): s is TutorialBlockKind =>
  (TUTORIAL_BLOCK_KINDS as readonly string[]).includes(s);

export interface BlockCitation {
  path: string;
  firstLine: number | null;
  lastLine: number | null;
  why: string | null;
}

export type TutorialBlock =
  | { kind: 'code-tour'; stops: (BlockCitation & { annotation: string })[] }
  | {
      kind: 'spot-it';
      prompt: string;
      at: BlockCitation;
      answerLine: number;
      explanation: string;
    }
  | {
      kind: 'put-in-order';
      prompt: string;
      items: string[];
      explanation: string;
      sources: BlockCitation[];
    }
  | {
      kind: 'match';
      prompt: string;
      pairs: { left: string; right: string }[];
      explanation: string;
      sources: BlockCitation[];
    }
  | {
      /** A question a reader saved on step `step` (1-based, as the file's headings). */
      kind: 'question';
      step: number;
      quote: string | null;
      question: string;
      answer: string;
    }
  | {
      kind: 'try-it';
      instruction: string;
      command: string | null;
      where: string | null;
      expected: string | null;
      sources: BlockCitation[];
    };

type Fields = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;

const fields = (v: unknown): Fields | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Fields) : null;

/** `"12-30"`, `"7"` or `7`. */
function lines(v: unknown): [number | null, number | null] {
  const s = str(v);
  if (s === null) return [null, null];
  const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(s);
  if (!m) return [null, null];
  const first = Number(m[1]);
  return [first, m[2] === undefined ? first : Number(m[2])];
}

function citation(v: unknown): BlockCitation | null {
  const f = fields(v);
  const path = str(f?.path);
  if (!f || !path) return null;
  const [firstLine, lastLine] = lines(f.lines);
  return { path, firstLine, lastLine, why: str(f.why) };
}

const citations = (v: unknown): BlockCitation[] =>
  Array.isArray(v) ? v.flatMap((c) => citation(c) ?? []) : [];

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((s) => typeof s === 'string') ? v : null;

/** Parses one block's YAML; `null` when it is not the shape of its kind. */
export function parseTutorialBlock(kind: TutorialBlockKind, source: string): TutorialBlock | null {
  let data: unknown;
  try {
    data = parse(source);
  } catch {
    return null;
  }
  const f = fields(data);
  if (!f) return null;
  switch (kind) {
    case 'code-tour': {
      if (!Array.isArray(f.stops)) return null;
      const stops = f.stops.flatMap((s) => {
        const c = citation(s);
        const annotation = str(fields(s)?.annotation);
        return c && annotation !== null ? [{ ...c, annotation }] : [];
      });
      return stops.length > 0 ? { kind, stops } : null;
    }
    case 'spot-it': {
      const at = citation(f);
      const answerLine = Number(f.answerLine);
      const prompt = str(f.prompt);
      if (!at || !prompt || !Number.isInteger(answerLine)) return null;
      return { kind, prompt, at, answerLine, explanation: str(f.explanation) ?? '' };
    }
    case 'put-in-order': {
      const items = strings(f.items);
      const prompt = str(f.prompt);
      if (!items || !prompt) return null;
      return {
        kind,
        prompt,
        items,
        explanation: str(f.explanation) ?? '',
        sources: citations(f.sources),
      };
    }
    case 'match': {
      const prompt = str(f.prompt);
      if (!prompt || !Array.isArray(f.pairs)) return null;
      const pairs = f.pairs.flatMap((p) => {
        const left = str(fields(p)?.left);
        const right = str(fields(p)?.right);
        return left !== null && right !== null ? [{ left, right }] : [];
      });
      if (pairs.length === 0) return null;
      return {
        kind,
        prompt,
        pairs,
        explanation: str(f.explanation) ?? '',
        sources: citations(f.sources),
      };
    }
    case 'question': {
      const step = Number(f.step);
      const question = str(f.question);
      const answer = str(f.answer);
      if (!Number.isInteger(step) || step < 1 || !question || !answer) return null;
      return { kind, step, quote: str(f.quote), question, answer };
    }
    case 'try-it': {
      const instruction = str(f.instruction);
      if (!instruction) return null;
      return {
        kind,
        instruction,
        command: str(f.command),
        where: str(f.where),
        expected: str(f.expected),
        sources: citations(f.sources),
      };
    }
  }
}

/** `src/a.rs:12-30`, `src/a.rs:12` or the path alone. */
export function blockCitationLabel(c: BlockCitation): string {
  if (c.firstLine === null) return c.path;
  if (c.lastLine === null || c.lastLine === c.firstLine) return `${c.path}:${String(c.firstLine)}`;
  return `${c.path}:${String(c.firstLine)}-${String(c.lastLine)}`;
}
