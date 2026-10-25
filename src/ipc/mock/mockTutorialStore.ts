// What the mock keeps per folder for the Academy, like the Rust app data (`appdata/tutorials.rs`
// and the tutorial fields of `appdata/learning.rs`).

import type { TutorialSubject } from '../types';

export interface FolderTutorials {
  /** The subject cards the AI suggested ("Suggest more subjects"). */
  suggested: TutorialSubject[];
}

export const emptyTutorials = (): FolderTutorials => ({ suggested: [] });
