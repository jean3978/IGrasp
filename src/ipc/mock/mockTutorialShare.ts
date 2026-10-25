// Shared tutorials in the mock, like `learning/tutorial/share.rs`: a tutorial file recognised by
// its front matter (the graph's flag), the folder a share goes to (`TutorialFolderTaken` when
// another tutorial is there), the write plan, and the write itself on the fake disk through the
// writer that mirrors Rust's (`mockTutorialMarkdown.ts`). The mock has no reader of the format:
// it keeps the JSON of each shared README it knows (the fixture's, or what it wrote).

import { BackendError } from '../types';
import type { PlannedFile, Tutorial, WritePlan } from '../types';
import { frontMatter } from './mockSave';
import { slug } from '../../lib/tutorial';
import { writeTutorialMarkdown } from './mockTutorialMarkdown';
import type { TutorialFile } from './mockTutorialMarkdown';

const MAX_SLUG = 60;

/** What the graph keeps of a tutorial file (Rust `markdown::info`). */
export interface TutorialFileInfo {
  id: string;
  /** `null` for the README, the chapter's id for a chapter file. */
  chapter: string | null;
  title: string | null;
}

/** A top-level scalar of a front matter (plain, single- or double-quoted). */
function field(fm: string, key: string): string | null {
  for (const line of fm.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0 || line.slice(0, colon) !== key) continue;
    const v = line.slice(colon + 1).trim();
    if (v.startsWith('"')) {
      try {
        return JSON.parse(v) as string;
      } catch {
        return v.slice(1, -1);
      }
    }
    if (v.startsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
    return v;
  }
  return null;
}

export function tutorialFileInfo(text: string): TutorialFileInfo | null {
  if (!text.startsWith('---') || !text.includes('igrasp: tutorial')) return null;
  const fm = frontMatter(text.replace(/\r\n/g, '\n'));
  if (fm === null) return null;
  const kind = field(fm, 'igrasp');
  if (kind === 'tutorial') {
    const id = field(fm, 'id');
    return id ? { id, chapter: null, title: field(fm, 'title') } : null;
  }
  if (kind === 'tutorial-chapter') {
    const id = field(fm, 'tutorial');
    return id ? { id, chapter: field(fm, 'chapter') ?? '', title: null } : null;
  }
  return null;
}

/** `docs/tutorials/x/README.md` → `docs/tutorials/x`. */
export const folderOf = (readme: string) => {
  const i = readme.lastIndexOf('/');
  return i < 0 ? '' : readme.slice(0, i);
};

const join = (folder: string, name: string) => (folder === '' ? name : `${folder}/${name}`);

const slugOf = (title: string) => slug(title).slice(0, MAX_SLUG).replace(/-+$/, '');

/** The folder a private tutorial is shared to (Rust `share::share_folder`). */
export function shareFolder(
  files: Map<string, string>,
  tutorialsFolder: string,
  t: Tutorial,
  sharedAs: string | null,
): string {
  const holds = (readme: string): boolean | null => {
    const text = files.get(readme);
    if (text === undefined) return null;
    const info = tutorialFileInfo(text);
    return info ? info.id === t.id : null;
  };
  if (sharedAs !== null && holds(sharedAs) === true) return folderOf(sharedAs);
  const folder = join(tutorialsFolder.replace(/^\/+|\/+$/g, ''), slugOf(t.title));
  const readme = join(folder, 'README.md');
  const same = holds(readme);
  const taken = same === null ? files.has(readme) || files.has(folder) : !same;
  if (taken)
    throw new BackendError('TutorialFolderTaken', `${folder} already holds another tutorial.`);
  return folder;
}

/** The chapter files a README on disk names: what the mock wrote there. */
function chapterFilesOf(written: Map<string, Tutorial>, readme: string): string[] {
  const t = written.get(readme);
  if (!t) return [];
  return writeTutorialMarkdown(t, folderOf(readme))
    .map((f) => f.name)
    .filter((n) => n !== 'README.md');
}

/** Compares the files of `t` with the fake disk (Rust `share::plan`). */
export function planWrite(
  files: Map<string, string>,
  written: Map<string, Tutorial>,
  folder: string,
  t: Tutorial,
): WritePlan {
  const out = writeTutorialMarkdown(t, folder);
  const planned: PlannedFile[] = out.map((f) => {
    const old = files.get(join(folder, f.name));
    return {
      name: f.name,
      state: old === undefined ? 'new' : old === f.text ? 'unchanged' : 'changed',
      bytes: new TextEncoder().encode(f.text).length,
    };
  });
  const readme = join(folder, 'README.md');
  const old = files.get(readme);
  const removed =
    old !== undefined && tutorialFileInfo(old)?.id === t.id
      ? chapterFilesOf(written, readme).filter(
          (n) => !out.some((f) => f.name === n) && files.has(join(folder, n)),
        )
      : [];
  return { folder, files: planned, removed };
}

/** The plan of a Save as…: every file new, the folder chosen in the dialog. */
export const exportPlan = (t: Tutorial): WritePlan => ({
  folder: '',
  files: writeTutorialMarkdown(t, '').map((f) => ({
    name: f.name,
    state: 'new',
    bytes: new TextEncoder().encode(f.text).length,
  })),
  removed: [],
});

/** The files to set on the fake disk (root-relative) for `t` in `folder`. */
export function filesFor(folder: string, t: Tutorial): Record<string, string> {
  return Object.fromEntries(
    writeTutorialMarkdown(t, folder).map((f: TutorialFile) => [join(folder, f.name), f.text]),
  );
}

export { slugOf as tutorialSlug, join as joinPath };
