// What the mock keeps per folder for the Academy, like the Rust app data (`appdata/tutorials.rs`
// and the tutorial fields of `appdata/learning.rs`): the private tutorials, the reader's
// progress, the AI's subject suggestions and the usage of the tutorial operations.

import { BackendError } from '../types';
import type {
  StoredTutorial,
  Tutorial,
  TutorialProgress,
  TutorialRef,
  TutorialSubject,
  TutorialSummary,
  TutorialUsage,
} from '../types';
import {
  mergeSourceHashes,
  newTutorialId,
  normalizeTutorial,
  stepHash,
  stepKey,
} from '../../lib/tutorial';

export const MAX_PRIVATE_TUTORIALS = 200;
export const MAX_SUGGESTED = 24;
export const MAX_USAGE = 20;
export const MAX_PROGRESS_STEPS = 200;

export interface FolderTutorials {
  /** The subject cards the AI suggested ("Suggest more subjects"). */
  suggested: TutorialSubject[];
  /** Private tutorials by id. */
  stored: Map<string, StoredTutorial>;
  progress: Map<string, TutorialProgress>;
  usage: TutorialUsage[];
}

export const emptyTutorials = (): FolderTutorials => ({
  suggested: [],
  stored: new Map(),
  progress: new Map(),
  usage: [],
});

export const validTutorialId = (id: string) => /^[A-Za-z0-9_-]{1,80}$/.test(id);

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Like Rust's `prepared`: a new tutorial's id, date and provider, normalized, its ranges hashed. */
export function prepared(
  input: Tutorial,
  providerId: string,
  read: (path: string) => string | undefined,
): Tutorial {
  const t = normalizeTutorial(input);
  if (t.generated.trim() === '') t.generated = now();
  if (t.id.trim() === '') {
    t.id = newTutorialId(t.subject, t.generated);
    // The fixture is a repository whose HEAD is this commit.
    t.generationCommit ??= MOCK_HEAD;
  }
  if (t.provider.trim() === '') t.provider = providerId;
  t.sources = mergeSourceHashes(t, read);
  return t;
}

/** The commit the fixture's `.git/HEAD` points at (the mock has no `.git` folder). */
export const MOCK_HEAD = '1f3c5e7a9b0d2f4a6c8e0b1d3f5a7c9e1b3d5f70';
/** The `[user] name` of the fixture's repository. */
export const MOCK_USER = 'Demo Reader';

export function saveStored(folder: FolderTutorials, t: Tutorial, nowMs: number): StoredTutorial {
  if (!validTutorialId(t.id))
    throw new BackendError('InvalidPath', `invalid tutorial id "${t.id}"`);
  const previous = folder.stored.get(t.id);
  if (!previous && folder.stored.size >= MAX_PRIVATE_TUTORIALS)
    throw new BackendError(
      'AppData',
      `App data error: at most ${MAX_PRIVATE_TUTORIALS} private tutorials per folder; delete one first`,
    );
  const stored: StoredTutorial = {
    version: 1,
    tutorial: structuredClone(t),
    createdMs: previous?.createdMs ?? nowMs,
    updatedMs: nowMs,
    sharedAs: previous?.sharedAs ?? null,
  };
  folder.stored.set(t.id, stored);
  return structuredClone(stored);
}

export function summaryOf(
  reference: TutorialRef,
  t: Tutorial,
  sharedAs: string | null,
  updatedMs: number,
  progress: TutorialProgress | undefined,
): TutorialSummary {
  return {
    reference,
    id: t.id,
    title: t.title,
    subject: t.subject,
    familiarity: t.familiarity,
    length: t.length,
    domainGap: t.domainGap ?? null,
    chapters: t.chapters.length,
    chaptersWritten: t.chapters.filter((c) => c.steps.length > 0).length,
    stepsTotal: t.chapters.reduce((n, c) => n + c.steps.length, 0),
    generated: t.generated,
    model: t.model,
    verified: t.verified ?? null,
    sharedAs,
    updatedMs,
    progress: progress
      ? {
          stepsDone: Object.keys(progress.completed).length,
          xp: progress.xp,
          graduated: progress.graduated,
          lastOpenedMs: progress.lastOpenedMs,
          chapter: progress.chapter,
          step: progress.step,
          updated: t.chapters.reduce(
            (n, c) =>
              n +
              c.steps.filter((s, i) => {
                const hash = progress.completed[stepKey(c.id, i)];
                return hash !== undefined && hash !== stepHash(s);
              }).length,
            0,
          ),
        }
      : null,
  };
}

/** The private tutorials of a folder, newest first. */
export const privateSummaries = (folder: FolderTutorials): TutorialSummary[] =>
  [...folder.stored.values()]
    .sort((a, b) => b.updatedMs - a.updatedMs || a.tutorial.id.localeCompare(b.tutorial.id))
    .map((s) =>
      summaryOf(
        { type: 'private', id: s.tutorial.id },
        s.tutorial,
        s.sharedAs,
        s.updatedMs,
        folder.progress.get(s.tutorial.id),
      ),
    );

/** Caps the progress like Rust's `TutorialProgress::normalized`. */
export function normalizedProgress(p: TutorialProgress): TutorialProgress {
  const cap = <T>(r: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(r)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .slice(0, MAX_PROGRESS_STEPS),
    );
  return {
    ...structuredClone(p),
    completed: cap(p.completed),
    answers: cap(p.answers),
    chaptersDone: p.chaptersDone.slice(0, 64),
  };
}

export function addSuggested(folder: FolderTutorials, subjects: TutorialSubject[]) {
  for (const s of subjects)
    if (!folder.suggested.some((o) => o.title === s.title)) folder.suggested.push(s);
  folder.suggested = folder.suggested.slice(-MAX_SUGGESTED);
}

export function recordUsage(folder: FolderTutorials, usage: TutorialUsage) {
  folder.usage = [...folder.usage, usage].slice(-MAX_USAGE);
}
