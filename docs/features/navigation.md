# Navigation

How to move around a large documentation tree: the activity bar and its sidebar views, back and
forward, recent changes, and the right panel.

## Activity bar and sidebar views

A vertical bar at the far left switches the sidebar between four views
([ADR 0012](../decisions/0012-activity-bar-sidebar-views-and-right-panel.md)):

| View | Keys | What it shows |
|---|---|---|
| Explorer | `Ctrl+Shift+E` | The markdown tree ([file-tree.md](file-tree.md)). |
| Search | `Ctrl+Shift+F` | Search in files ([search.md](search.md)). A spinner shows a running search. |
| Recent Changes | `Ctrl+Shift+R` | Files by last modification (below). |
| Broken Links | `Ctrl+Shift+L` | Every broken link of the folder ([links-and-graph.md](links-and-graph.md)). A badge shows the count. |

Clicking the active view hides the sidebar, clicking it again brings it back; the activity bar
itself stays visible (`Ctrl+B` also hides the sidebar). The bar is one tab stop: ↑ / ↓ move
between views, Enter or Space opens one. The views are also in the View menu. The current view
is saved with the folder's session.

## Back and forward (`Alt+←` / `Alt+→`)

Every time the active document changes — a click in the Explorer, a tab, a link, a search result,
Ctrl+T, `Ctrl+Tab` — it is recorded. Back and forward walk that history:

- `Alt+←` / `Alt+→`, the mouse's back / forward buttons, the arrows in the title bar (their
  tooltips name the target file), or View › Back / Forward;
- a closed tab is reopened as a preview tab; moving through the history does not record;
- files deleted on disk leave the history, renamed files are followed;
- the history holds 100 entries, lives in memory only and is cleared when another folder opens.

The webview's own history navigation is always prevented, so these keys never leave the app.

## Recent changes (`Ctrl+Shift+R`)

The markdown files sorted by **last modification time**, newest first, under **Today**,
**Yesterday**, **This week** and **Earlier** headers, with relative times ("4 minutes ago",
refreshed every minute; the tooltip shows the exact time).

- Files modified since the folder was opened (or reported by the watcher since) get a **dot and a
  bold name**, so the view answers "what did the agent just touch?". *Clear change markers* resets
  them. (Tracking what you have read comes with the Git phase.)
- The list reloads by itself on every change on disk; 200 files are shown, *Show more* adds 200.
- Click opens a preview tab, double click keeps it open; the row action reveals the file in the
  Explorer.

Measured: listing 200 of 10,000 files takes about 1 ms.

## Right panel (`Ctrl+Alt+B`)

A second panel on the right holds sections about the active document:

- **Outline**: its headings as a collapsible tree that follows the scroll position
  ([links-and-graph.md](links-and-graph.md#outline)); `Ctrl+Shift+O` opens the panel on the
  outline's filter box.
- **Backlinks**: the documents that link to it.

Toggle it with `Ctrl+Alt+B`, the toolbar button or View › Toggle Right Panel; resize it with the
sash, or drag it closed. Its visibility and width are saved with the folder's session (hidden by
default).

The sidebar and the right panel keep the width the user gives them: a drag of the sash (or the
arrow keys on a focused sash) sets it, and only that is saved. When the window shrinks the
layout may squeeze a panel for a while, and it returns to the user's width when the window grows
again (`useStoredWidth` in `features/shell/WorkspaceLayout.tsx`).
