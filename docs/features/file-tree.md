# File tree

The left panel (Explorer) shows **only the markdown files** of the open folder, in their
hierarchy.

## What is shown

- Files with the `.md` or `.markdown` extension, in any letter case. `.mdx` is not markdown.
- Folders that contain at least one markdown file, directly or in a subfolder. Other folders are
  hidden.
- `.gitignore`, `.ignore` and `.git/info/exclude` rules are respected, including ignore files of
  parent folders when a subfolder of a repository is opened.
- `.git` and `node_modules` are always skipped.
- The extra ignore patterns from Settings (gitignore syntax) always apply.

Two toggles in the Explorer toolbar (and, later, the View menu) change this per folder:

| Toggle | Effect |
|---|---|
| Show dotfiles (eye) | Shows files and folders whose name starts with `.` |
| Show ignored files (filter) | Shows entries matched by the ignore files |

Entries visible only because of a toggle are dimmed. The toggles are remembered per folder; the
defaults for new folders are in Settings.

## How it works

1. Opening a folder starts a background scan in Rust (see
   [ADR 0004](../decisions/0004-background-index-with-ignore-crate.md)). The Explorer shows
   "Indexing…" with a live count until the index is ready.
2. The tree then asks for folders one at a time (`list_dir`) when they are expanded.
3. Rows are flattened (expanded folders and their children, depth first, folders before files,
   natural order) and **virtualized**: only the rows on screen exist in the DOM. With 12,000
   visible rows, about 40 DOM rows are rendered and scrolling stays at 60 fps.

## Keyboard

The tree follows the WAI-ARIA tree pattern. The tree itself holds the keyboard focus and points
at the focused row with `aria-activedescendant`, so focus is never lost when rows scroll out of
the rendered window.

| Key | Action |
|---|---|
| ↑ / ↓ | Previous / next row |
| Home / End | First / last row |
| → | Expand a folder, or move to its first child |
| ← | Collapse a folder, or move to the parent folder |
| Enter | Open the file (pinned tab), or toggle the folder |
| Space | Open the file as a preview tab, or toggle the folder |
| `*` | Expand all sibling folders |
| Letters | Jump to the next row starting with the typed text |

Mouse: a click opens a preview tab, a double click pins it; clicking a folder toggles it.
