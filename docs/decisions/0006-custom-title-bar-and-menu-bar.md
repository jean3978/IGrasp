# 0006 — Custom title bar and in-window menu bar

- Status: Accepted
- Date: 2026-10-23

## Context

IGrasp should look like VS Code: one compact bar with the logo, the menus, the window title,
a few toolbar actions and the window controls. Native menus (Tauri's `Menu` API) look different
on every platform, cannot hold toolbar buttons, and on Linux render as a separate GTK bar.

## Decision

- The window is **undecorated** (`decorations: false`, `shadow: true`) and the frontend draws a
  32 px title bar on every screen: logo, menu bar (radix `Menubar`), centered title, toolbar
  (Open Folder, sidebar, mute notifications, theme) and minimize / maximize / close buttons.
- Moving uses `data-tauri-drag-region` on the empty parts of the bar; double-click maximizes.
  Windows hit-tests the edges of undecorated windows natively; on Linux, invisible edge and corner
  handles call `startResizeDragging`.
- Every menu item, toolbar button and shortcut dispatches through one table of actions
  (`menuActions.ts`), so each behavior has a single implementation, and check or radio states are
  read from the stores.
- Keyboard access matches native Windows menus: Alt+letter opens a menu (mnemonics are
  underlined while Alt is held), F10 or a lone Alt focuses the menu bar, arrows navigate, Enter
  activates, Esc closes.
- **Fallback**: Settings › Appearance › "Window frame: Native" turns OS decorations back on
  (`setDecorations(true)`), hides the custom window controls and drag regions, and keeps the
  in-window menu bar (VS Code's own default on Linux).
- The Git menu is added in phase 4, when it has content.

## Consequences

- Identical look on Windows and Linux, themed like the rest of the app (including High
  Contrast).
- Known limitations of the custom frame, documented in the README: no Windows 11 snap-layout
  flyout on the maximize button, no `Alt+Space` system menu. Window-manager quirks on Linux
  (GNOME/KDE, X11/Wayland) are covered by the native-frame fallback.
