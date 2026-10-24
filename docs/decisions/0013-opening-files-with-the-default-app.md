# 0013 — Opening files with the default application

- Status: Accepted
- Date: 2026-10-24

## Context

Links to source files open in IGrasp's read-only code viewer, which needs an **Open in default
editor** button. Handing a path to the operating system is the riskiest thing the app does: the
documents it shows are written by AI agents and anyone else with access to the repository, and
on Windows (and some Linux desktops) "opening" a `.bat`, `.js`, `.lnk` or `.desktop` file runs it.
ADR 0002 already limits the asset protocol and `open_external` to media for the same reason.

## Decision

`open_with_default_app` (Rust) opens a file only when **all** of these hold, checked when the
button is clicked:

1. The path resolves under the opened folder through `RootGuard` (symlinks included) and is a
   regular file.
2. Its extension is not on a deny-list of executables, installers, shortcuts and script hosts:
   `exe com bat cmd ps1 psm1 vbs vbe js jse wsf wsh msi msp scr pif lnk reg hta cpl inf url
   application gadget jar sh run appimage desktop command app`. `.js` and `.sh` are on it
   because Windows Script Host and some desktops execute them instead of opening an editor.
3. On Unix, it has no execute bit.
4. It passes the same text check as `read_text_file` (no NUL byte and at most 10 % invalid UTF-8
   in the first 8 KiB, the heuristic git uses), so a binary is never launched.

A refusal returns `Forbidden` with a plain explanation, and the UI offers **Reveal in file
manager**, which always works (`reveal_item_in_dir` on a guarded path, no execution). The
command is called only from a button click in the code viewer, never from a link in a document.
Every opening is logged. No Tauri capability is added: both calls are made from Rust.

## Consequences

- A document can never launch a program, even through a crafted link or a renamed file.
- Some legitimate text files (`.js`, `.sh`, `.cmd` scripts the user wants to read in an editor)
  cannot be opened from IGrasp; they are still readable in the viewer and reachable with Reveal
  in file manager. A configurable "editor command" setting can lift this later (Editing phase).
- The deny-list is duplicated in the mock backend (`src/ipc/mock/mockFiles.ts`) so tests and the
  browser dev mode refuse the same files.
