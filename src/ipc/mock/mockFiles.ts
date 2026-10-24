// Text file rules of the mock backend, mirroring `commands/files.rs`.

import { BackendError } from '../types';
import type { TextFileContent } from '../types';

export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_RETURNED = 1024 * 1024;

const NEVER_OPENED = new Set(
  (
    'exe com bat cmd ps1 psm1 vbs vbe js jse wsf wsh msi msp scr pif lnk reg hta cpl inf url ' +
    'application gadget jar sh run appimage desktop command app'
  ).split(' '),
);

const extension = (relPath: string) => {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

export const isNeverOpened = (relPath: string) => NEVER_OPENED.has(extension(relPath));

/** The mock's text check: content without NUL characters. */
export const isText = (content: string) => !content.includes('\u0000');

interface FakeFile {
  content: string;
  size: number;
  modifiedMs: number;
}

export function readText(relPath: string, file: FakeFile | undefined): TextFileContent {
  if (!file) throw new BackendError('NotFound', `Not found: ${relPath}`);
  if (file.size > MAX_TEXT_BYTES) {
    throw new BackendError(
      'TooLarge',
      `The file is too large to open (${String(file.size)} bytes).`,
    );
  }
  if (!isText(file.content)) throw new BackendError('NotText', `${relPath} is not a text file.`);
  const content = file.content.startsWith('﻿') ? file.content.slice(1) : file.content;
  const truncated = content.length > MAX_TEXT_RETURNED;
  return {
    relPath,
    content: truncated ? content.slice(0, MAX_TEXT_RETURNED) : content,
    size: file.size,
    modifiedMs: file.modifiedMs,
    truncated,
  };
}

export function checkOpenable(relPath: string, file: FakeFile | undefined): void {
  if (!file) throw new BackendError('NotFound', `Not found: ${relPath}`);
  const refuse = (why: string) =>
    new BackendError(
      'Forbidden',
      `${relPath} is not opened from IGrasp (${why}). Use Reveal in file manager instead.`,
    );
  if (isNeverOpened(relPath)) throw refuse('programs and scripts are never launched');
  if (!isText(file.content)) throw refuse('only text files are opened');
}
