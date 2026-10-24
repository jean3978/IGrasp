// Writes a large documentation project for manual performance checks in the app:
// 10,000 markdown files (20 headings and 15 links each, 2 % about 200 KB, ~2 % broken links) in
// 1,200 folders, next to 2,000 source files. Same shape as src-tauri/src/perf.rs.
//
// Usage: node scripts/gen-large-project.mjs [folder]   (default: a new folder in the temp dir)

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const DOCS = 10_000;
const FOLDERS = 1_200;
const WORDS = [
  'agent',
  'index',
  'graph',
  'search',
  'folder',
  'heading',
  'link',
  'preview',
  'release',
  'design',
  'watcher',
  'session',
  'outline',
  'backlink',
  'theme',
  'keyboard',
  'toast',
  'scan',
  'anchor',
  'parser',
  'commit',
  'branch',
  'review',
  'summary',
];

let seed = 0x5eed1234;
const below = (n) => {
  // Deterministic xorshift32, so every run writes the same project.
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) % n;
};

const docPath = (i) => `area${i % 60}/topic${i % FOLDERS}/doc-${i}.md`;
const paragraph = (words) =>
  Array.from({ length: words }, () => WORDS[below(WORDS.length)]).join(' ');

const root = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'igrasp-large-'));
const started = Date.now();
for (let i = 0; i < DOCS; i++) {
  const big = i % 50 === 0;
  let text = `# Document ${i}\n\n`;
  for (let h = 0; h < 20; h++) {
    text += `## Section ${h} ${WORDS[(i + h) % WORDS.length]}\n\n${paragraph(big ? 1400 : 25)}\n`;
    if (h < 15) {
      const target = below(DOCS + DOCS / 50);
      const section = below(20);
      text += `\nSee [doc ${target}](/${docPath(target)}#section-${section}-${WORDS[(target + section) % WORDS.length]}).\n\n`;
    }
  }
  const file = join(root, docPath(i));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (i % 5 === 0) writeFileSync(join(root, `area${i % 60}`, `code-${i}.rs`), 'fn main() {}\n');
}
console.log(`Wrote ${DOCS} markdown files to ${root} in ${Date.now() - started} ms.`);
