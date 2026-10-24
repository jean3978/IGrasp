# Tabs and session restore

## Tabs

Tabs behave like VS Code:

- A **single click** in the Explorer opens the file in the *preview tab* (title in italics). The
  next single click replaces it, so browsing does not pile up tabs. Links, search results,
  Ctrl+T, recent changes and backlinks use the preview tab too.
- Source files open in a [code viewer](code-viewer.md) tab, which shares the preview slot.
- A **double click** (in the Explorer or on the tab), Enter in the Explorer, or "Keep Open" in
  the tab's context menu **pins** the tab.
- One tab per file. A new tab opens to the right of the active one.
- Close with the × button, a middle click, `Ctrl+W`, or Delete on a focused tab. The neighbor to
  the right (else to the left) becomes active.
- Switch with `Ctrl+Tab` / `Ctrl+Shift+Tab`, `Ctrl+PageDown` / `Ctrl+PageUp`, or `Alt+1` … `Alt+8`
  (`Alt+9` is the last tab). Move the active tab with `Ctrl+Shift+PageUp` / `PageDown`.
- Context menu: Keep Open, Close, Close Others, Close All, Copy Relative Path, Copy Path.
- Two open files with the same name show their folder next to the name.
- Each tab remembers its scroll position.

The tab bar follows the WAI-ARIA tabs pattern with manual activation: ← / → move the focus,
Enter or Space activates.

## Session restore

For every folder, IGrasp remembers (in the app-data folder, `sessions.json`):

- the open tabs (documents and code viewers), whether each is pinned, and its scroll position;
- the active tab;
- the expanded folders of the Explorer;
- the sidebar visibility and width, and its view (Explorer, Search, Recent Changes, Broken Links);
- the right panel visibility and width;
- the AI chat panel: open or closed, position and size (0.3.0);
- the "show dotfiles" and "show ignored files" toggles.

The fields added in 0.2.0 have defaults, so sessions saved by 0.1.0 load unchanged. The
back / forward history is not saved.

The session is saved 750 ms after any change, when the folder is closed or another one is
opened, and when the window closes. Opening the folder again brings everything back once the
folder is indexed: files and folders that no longer exist are silently dropped, and scroll
positions are re-applied after the documents (and their images and diagrams) have rendered.
Code viewer tabs are not checked on startup (that would read every file); a file that vanished
shows "File not found" when its tab is first shown.

The 50 most recently used folders keep a session. The window's own size, position and maximized
state are restored by `tauri-plugin-window-state`.
