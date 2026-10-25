# Code viewer

Links from markdown to source files (`src/main.rs`, `Makefile`, `config.yaml`…) open in a
**read-only, syntax-highlighted viewer** tab. It shares the preview slot and the shortcuts of
document tabs, is part of the back / forward history, and is restored with the session.

## What it shows

- Syntax highlighting by Shiki with the same GitHub themes as the preview, in all three app
  themes. The language comes from well-known file names (`Dockerfile`, `Makefile`,
  `CMakeLists.txt`…) and about 100 extensions; anything else is plain text.
- Line numbers in a gutter that stays visible when scrolling sideways.
- A header with the path, size, language and a **Read-only** badge, and the actions:

| Action | What it does |
|---|---|
| Go to Line (`Ctrl+G`) | Jumps to a line or a range (`12`, `10-20`). |
| Wrap Lines | Wraps long lines. |
| Copy Path | Copies the absolute path. |
| Reveal in File Manager | Shows the file in the system file manager. |
| Open in Default Editor | Opens the file with the system's default application (see below). |

- `#L12` or `#L12-L20` in a link selects and centers those lines. Clicking a line number selects
  it, shift-click extends the selection.
- The **AI tools** toolbar sits under the header, on the right: highlighting code with the text
  tool or dragging a region attaches exactly the rows it covers to the AI chat
  ([ai-chat.md](ai-chat.md#asking-about-a-selection)).

## Limits

| Case | Behavior |
|---|---|
| More than 300 KB or 5,000 lines | Shown as plain text (still fast: lines are virtualized). |
| More than 1 MB | The first 1 MB is shown, with a notice. |
| More than 5 MB | "File too large", with Reveal in File Manager. |
| Binary file | "Binary file", with Reveal in File Manager. A file is binary when its first 8 KB contain a NUL byte or more than 10 % invalid UTF-8 (git's rule). |
| Missing file | "File not found", with Close. |

## Changes on disk

Only markdown files are watched, so the viewer checks its file again when its tab is shown and
when the window gets the focus back. When the file changed, a **"This file changed on disk —
Reload"** banner appears; the content is never replaced by itself, so the reading position is
never lost.

## Open in Default Editor: safety

Opening a file with the system is the riskiest thing the app does, because some systems *run*
scripts instead of opening them ([ADR 0013](../decisions/0013-opening-files-with-the-default-app.md)).
The file is opened only when, at the moment of the click:

- it is a regular file inside the opened folder;
- it is text (same rule as above);
- it is not executable (Unix);
- its extension is not a program, installer, shortcut or script host: `exe com bat cmd ps1 psm1
  vbs vbe js jse wsf wsh msi msp scr pif lnk reg hta cpl inf url application gadget jar sh run
  appimage desktop command app`. Both the name in the link and the real name of the file are
  checked (a symlink counts as its target), and trailing dots and spaces are ignored like
  Windows does (`run.bat.` is `run.bat`).

Otherwise a message explains why, and **Reveal in File Manager** always works. A link in a
document can never open a file this way: only the button does.
