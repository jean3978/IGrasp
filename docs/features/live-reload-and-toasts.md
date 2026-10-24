# Live reload and change notifications

IGrasp is built for folders that AI agents keep editing. Everything updates on its own; nothing
needs a manual refresh.

## How changes are detected

1. Once the folder is indexed, Rust watches it recursively (`notify`, debounced for 200 ms).
2. Each batch of events is classified:
   - a known markdown file was modified → its size and date are read again;
   - a file or folder was removed → it leaves the index;
   - `.gitignore`, `.ignore` or `.git/info/exclude` changed → the whole folder is re-indexed;
   - anything else that may add markdown (new files, new folders, renames) → that path is
     re-walked with the same ignore rules as the full scan, so a new file inside an ignored
     folder stays hidden;
   - `.git`, `node_modules` and non-markdown files are skipped early.
3. One `fs://changes` event per batch tells the frontend what was added, modified, removed and
   renamed, and which folder listings changed.
4. The same batch updates the document graph: changed documents are parsed again and the links
   pointing at any reported path (source files and folders included) are checked again. One
   `graph://changed` event lists the documents whose links changed and the new broken count, so
   link flags, backlinks and the Broken Links view refresh only where needed
   ([links-and-graph.md](links-and-graph.md)).

If the operating system cannot provide native notifications (on Linux, usually because the
inotify watch limit is reached), IGrasp polls every 2 seconds instead and the status bar shows
"Polling for changes". Raising `fs.inotify.max_user_watches` restores instant updates.

## What you see

| Change | Effect |
|---|---|
| File modified | Its open tab re-renders in place; the scroll position is kept and the previous version stays visible until the new one is ready. |
| File added | It appears in the Explorer (expanded folders refresh; new folders appear). |
| File deleted | It leaves the Explorer; an open tab keeps the last version with a "deleted on disk" banner, which disappears if the file comes back. |
| File renamed | The open tab follows the file to its new name. |
| Any change | Recent Changes reloads and marks the file; search results drop deleted files and mark modified ones; links to a file that appears or vanishes are flagged or unflagged. |
| Source file changed | Not watched as such: an open code viewer checks again when shown or when the window regains focus, and offers Reload. |

## Notifications

Changes are announced with toasts in the bottom-right corner: green for added, blue for
modified, red for deleted. Clicking a toast opens the file.

To avoid noise when an agent rewrites many files at once, changes are collected during a 1.5 s
quiet window:

- up to 3 changes → one toast each;
- more → a single grouped toast such as "12 files modified · 3 added", which keeps updating
  while the burst continues. Clicking it lists every file, grouped by kind.

Toasts last 5 s (8 s for grouped ones), pause while hovered or focused, and at most 4 are shown
at once. They are announced politely to screen readers.

**Mute** notifications from the bell in the title bar, View › Mute Notifications, or Settings.
Live reload continues; the status bar counts the changes made while muted (click to reset).
