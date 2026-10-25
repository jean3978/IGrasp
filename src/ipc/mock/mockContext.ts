// The context of a message and its size estimate, like `ai/context.rs` and `ai/estimate.rs`:
// instruction files from the root down to the current file's folder, then the current file,
// bounded, read from the fake disk.

import { BackendError } from '../types';
import type {
  AiContextDocument,
  AiContextRole,
  AiSizeBucket,
  AiSizeEstimate,
  AiStartRequest,
  AiRequest,
} from '../types';

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

export const INSTRUCTION_CAP = 32 * 1024;
export const CURRENT_CAP = 96 * 1024;
export const BYTES_PER_TOKEN = 4;
export const TOKENS_PER_IMAGE = 1500;
export const SMALL_BELOW_TOKENS = 20_000;
export const MEDIUM_BELOW_TOKENS = 80_000;

/** A file of the fake disk: its text and its size in bytes. */
export interface FakeFile {
  content: string;
  size: number;
}

export type FileLookup = (relPath: string) => FakeFile | undefined;

/** Like `RootGuard::join_lexical`: root-relative, `/`-separated, no `.`/`..`/empty segments. */
export function checkRelPath(rel: string): void {
  const valid =
    rel !== '' &&
    !/^\/|\\|:|\0/.test(rel) &&
    rel.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
  if (!valid) throw new BackendError('InvalidPath', `Invalid path: ${rel}`);
}

const baseName = (rel: string) => rel.split('/').pop() ?? rel;

function document(
  file: FakeFile,
  path: string,
  role: AiContextRole,
  read: boolean,
): AiContextDocument {
  const truncated = file.size > (role === 'instructionFile' ? INSTRUCTION_CAP : CURRENT_CAP);
  const binary = file.content.includes('\0');
  const content = read && !truncated && !binary ? file.content.replace(BOM, '') : null;
  return { path, role, content, bytes: file.size, truncated };
}

/** The folders from the root (`''`) down to the folder of `file`. */
function foldersDownTo(file: string | null): string[] {
  const out = [''];
  const parts = file?.split('/').slice(0, -1) ?? [];
  parts.forEach((_, i) => out.push(parts.slice(0, i + 1).join('/')));
  return out;
}

/** What the next message would carry, without contents (`ai_context`). */
export function collectContext(
  files: FileLookup,
  current: string | null,
  names: string[],
): AiContextDocument[] {
  if (current !== null) checkRelPath(current);
  const out: AiContextDocument[] = [];
  for (const folder of foldersDownTo(current)) {
    for (const name of names) {
      const rel = folder === '' ? name : `${folder}/${name}`;
      const file = rel === current ? undefined : files(rel);
      if (file) out.push(document(file, rel, 'instructionFile', false));
    }
  }
  const file = current === null ? undefined : files(current);
  if (current !== null && file) out.push(document(file, current, 'currentFile', false));
  return out;
}

/** The documents at `paths`, in order, read when asked; deleted ones are skipped. */
export function contextDocuments(
  files: FileLookup,
  paths: string[],
  names: string[],
  read: boolean,
): AiContextDocument[] {
  return paths.flatMap((rel) => {
    checkRelPath(rel);
    const file = files(rel);
    if (!file) return [];
    const role: AiContextRole = names.includes(baseName(rel)) ? 'instructionFile' : 'currentFile';
    return [document(file, rel, role, read)];
  });
}

/** `ai/estimate.rs`. */
export function estimateSize(
  promptBytes: number,
  documents: AiContextDocument[],
  images: number,
): AiSizeEstimate {
  const bytes = promptBytes + documents.reduce((n, d) => n + d.bytes, 0);
  const approxTokens = Math.ceil(bytes / BYTES_PER_TOKEN) + images * TOKENS_PER_IMAGE;
  const bucket: AiSizeBucket =
    approxTokens < SMALL_BELOW_TOKENS
      ? 'small'
      : approxTokens < MEDIUM_BELOW_TOKENS
        ? 'medium'
        : 'large';
  return {
    bytes,
    approxTokens,
    bucket,
    documents: documents.length,
    images,
    inlined: [],
    calls: 1,
    costHint: null,
  };
}

/** The request the provider receives (`context::request_from`). */
export function requestFrom(files: FileLookup, names: string[], start: AiStartRequest): AiRequest {
  if (start.capture) checkRelPath(start.capture.sourcePath);
  const { contextPaths, ...rest } = start;
  return { ...rest, context: contextDocuments(files, contextPaths, names, true) };
}
