// Document graph of the mock backend: a line-based extractor (no full markdown parser) with the
// same slugs (github-slugger) and the same link rules as `src-tauri/src/graph/`.

import GithubSlugger from 'github-slugger';
import { classifyHref } from '../../lib/linkTargets';
import type { Backlink, BrokenDoc, LinkInfo, LinkStatus, LinkTarget } from '../types';
import { quizInfo } from './mockSave';
import type { QuizFileInfo } from './mockSave';

export interface MockHeading {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface MockDoc {
  headings: MockHeading[];
  anchors: Set<string>;
  links: LinkInfo[];
  /** Set for a quiz file (Rust `ParsedDoc::quiz`). */
  quiz: QuizFileInfo | null;
}

interface RawLink {
  href: string;
  text: string;
  line: number;
}

const isMarkdown = (rel: string) => /.\.(md|markdown)$/i.test(rel);

/** Inline markdown to the text the preview slugs (code, emphasis and link markup removed). */
function plainText(inline: string): string {
  return inline
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .trim();
}

export function parseMarkdown(text: string): {
  headings: MockHeading[];
  anchors: Set<string>;
  links: RawLink[];
} {
  const lines = text.split(/\r?\n/);
  const slugger = new GithubSlugger();
  const headings: MockHeading[] = [];
  const anchors = new Set<string>();
  const links: RawLink[] = [];
  let fence: string | null = null;
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) start = end + 1;
  }
  const addHeading = (level: number, raw: string, line: number) => {
    const headingText = plainText(raw);
    const slug = slugger.slug(headingText);
    anchors.add(slug);
    headings.push({ level, text: headingText, slug, line });
  };
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker[0] ?? null;
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null || /^( {4}|\t)/.test(line)) continue;
    const atx = /^\s{0,3}(?:[-*>]\s*)?(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (atx?.[1] && atx[2] !== undefined) addHeading(atx[1].length, atx[2], i + 1);
    const setext = /^\s{0,3}(=+|-+)\s*$/.exec(line);
    const previous = lines[i - 1] ?? '';
    if (setext?.[1] && i > start && previous.trim() !== '' && !/^\s{0,3}#/.test(previous)) {
      addHeading(setext[1].startsWith('=') ? 1 : 2, previous, i);
    }
    for (const m of line.matchAll(/(!?)\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g)) {
      if (m[1] !== '!') links.push({ href: m[3] ?? '', text: plainText(m[2] ?? ''), line: i + 1 });
    }
    for (const m of line.matchAll(/<(https?:\/\/[^>\s]+|[^@>\s]+@[^>\s]+\.[a-z]+)>/gi)) {
      const href = m[1] ?? '';
      links.push({ href: href.includes('@') ? `mailto:${href}` : href, text: href, line: i + 1 });
    }
    for (const m of line.matchAll(/<a\s[^>]*?\bhref\s*=\s*["']([^"']*)["']/gi)) {
      links.push({ href: m[1] ?? '', text: '', line: i + 1 });
    }
    for (const m of line.matchAll(
      /<[a-z][a-z0-9]*\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi,
    )) {
      if (m[1]) anchors.add(m[1]);
    }
  }
  return { headings, anchors, links };
}

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

export const classify = classifyHref;

export interface GraphLookup {
  /** Indexed markdown files. */
  markdown: Set<string>;
  anchorsOf: (rel: string) => Set<string> | undefined;
  /** 'file', 'dir' or null for nothing. */
  onDisk: (rel: string) => 'file' | 'dir' | null;
}

const hasAnchor = (anchors: Set<string>, fragment: string) =>
  anchors.has(fragment) || [...anchors].some((a) => a.toLowerCase() === fragment.toLowerCase());

export function resolveLink(
  fromDoc: string,
  href: string,
  own: Set<string>,
  lookup: GraphLookup,
): { target: LinkTarget; status: LinkStatus } {
  const target = classify(fromDoc, href);
  switch (target.kind) {
    case 'external':
      return { target, status: { kind: 'ok' } };
    case 'unsupported':
      return { target, status: { kind: 'notChecked' } };
    case 'outside':
      return { target, status: { kind: 'outsideRoot' } };
    case 'anchor':
      return {
        target,
        status: { kind: hasAnchor(own, target.fragment) ? 'ok' : 'missingAnchor' },
      };
    case 'file':
      break;
    default:
      return { target, status: { kind: 'ok' } };
  }
  const { relPath: rel, fragment } = target;
  const fragmentStatus = (anchors: Set<string> | undefined): LinkStatus => {
    if (fragment === null) return { kind: 'ok' };
    if (!anchors) return { kind: 'notChecked' };
    return { kind: hasAnchor(anchors, fragment) ? 'ok' : 'missingAnchor' };
  };
  if (isMarkdown(rel)) {
    if (lookup.markdown.has(rel)) {
      return {
        target: { kind: 'document', relPath: rel, fragment },
        status: fragmentStatus(lookup.anchorsOf(rel)),
      };
    }
    const actual = [...lookup.markdown].find((m) => m.toLowerCase() === rel.toLowerCase());
    if (actual) {
      return {
        target: { kind: 'document', relPath: actual, fragment },
        status: { kind: 'caseMismatch', actual },
      };
    }
  }
  const readme = (dir: string) =>
    [...lookup.markdown].find(
      (m) =>
        parentOf(m) === dir && /^readme\.(md|markdown)$/i.test(m.slice(m.lastIndexOf('/') + 1)),
    ) ?? null;
  const found = rel === '' ? 'dir' : lookup.onDisk(rel);
  if (found === 'dir')
    return {
      target: { kind: 'folder', relPath: rel, readme: readme(rel) },
      status: { kind: 'ok' },
    };
  if (found === 'file') {
    return isMarkdown(rel)
      ? {
          target: { kind: 'document', relPath: rel, fragment },
          status: { kind: fragment ? 'notChecked' : 'ok' },
        }
      : { target: { kind: 'file', relPath: rel, fragment }, status: { kind: 'ok' } };
  }
  return {
    target: isMarkdown(rel)
      ? { kind: 'document', relPath: rel, fragment }
      : { kind: 'file', relPath: rel, fragment },
    status: { kind: 'missingFile' },
  };
}

export const isProblem = (status: LinkStatus) =>
  status.kind === 'missingFile' ||
  status.kind === 'missingAnchor' ||
  status.kind === 'caseMismatch' ||
  status.kind === 'outsideRoot';

/** Parses and resolves every indexed document. */
export function buildGraph(
  files: Map<string, string>,
  indexed: Iterable<string>,
): Map<string, MockDoc> {
  const markdown = new Set(indexed);
  const parsed = new Map<string, ReturnType<typeof parseMarkdown>>();
  for (const rel of markdown) parsed.set(rel, parseMarkdown(files.get(rel) ?? ''));
  const lookup: GraphLookup = {
    markdown,
    anchorsOf: (rel) => parsed.get(rel)?.anchors,
    onDisk: (rel) => {
      if (files.has(rel)) return 'file';
      const prefix = `${rel}/`;
      return [...files.keys()].some((k) => k.startsWith(prefix)) ? 'dir' : null;
    },
  };
  const graph = new Map<string, MockDoc>();
  for (const [rel, doc] of parsed) {
    graph.set(rel, {
      headings: doc.headings,
      anchors: doc.anchors,
      links: doc.links.map((l) => ({ ...l, ...resolveLink(rel, l.href, doc.anchors, lookup) })),
      quiz: quizInfo(files.get(rel) ?? ''),
    });
  }
  return graph;
}

/** Who links to `rel`, sorted by source path then line (Rust `backlinks_of`). */
export function backlinksOf(graph: Map<string, MockDoc>, rel: string): Backlink[] {
  const items: Backlink[] = [];
  for (const [from, doc] of [...graph].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (from === rel) continue;
    for (const link of doc.links) {
      const t = link.target;
      const hits =
        (t.kind === 'document' && t.relPath === rel) || (t.kind === 'folder' && t.readme === rel);
      if (hits) {
        items.push({
          fromPath: from,
          line: link.line,
          text: link.text,
          fragment: t.kind === 'document' ? t.fragment : null,
        });
      }
    }
  }
  return items;
}

/** Documents with broken links, sorted by path (Rust `broken_report`). */
export function brokenDocs(graph: Map<string, MockDoc>): BrokenDoc[] {
  return [...graph]
    .map(([relPath, doc]) => ({ relPath, links: doc.links.filter((l) => isProblem(l.status)) }))
    .filter((d) => d.links.length > 0)
    .sort((a, b) => (a.relPath < b.relPath ? -1 : 1));
}

export const brokenCount = (graph: Map<string, MockDoc>) =>
  [...graph.values()].reduce((n, d) => n + d.links.filter((l) => isProblem(l.status)).length, 0);
