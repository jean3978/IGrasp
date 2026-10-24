# Keyboard and accessibility

IGrasp can be used entirely from the keyboard. Press **F1** for the full list of shortcuts
(Help › Keyboard Shortcuts).

## Global shortcuts

| Keys | Action |
|---|---|
| `Ctrl+O` | Open a folder |
| `Ctrl+,` | Settings |
| `F1` | Keyboard shortcuts |
| `Ctrl+B` | Show or hide the sidebar |
| `Ctrl+Shift+E` | Focus the Explorer |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Document text larger / smaller / default |
| `Ctrl+W` | Close the tab |
| `Ctrl+Tab`, `Ctrl+PageDown` / `Ctrl+Shift+Tab`, `Ctrl+PageUp` | Next / previous tab |
| `Alt+1` … `Alt+9` | Go to a tab (9 = last) |
| `Ctrl+Shift+PageUp` / `PageDown` | Move the tab left / right |
| `Alt+F`, `Alt+E`, `Alt+V`, `Alt+H` | Open a menu |
| `F10` or `Alt` | Focus the menu bar |
| `Esc` | Close menus, dialogs and full-screen views |

Reserved for upcoming features (not bound yet, so they never need to be re-learned): `Ctrl+T`,
`Ctrl+Shift+F`, `Alt+←` / `Alt+→`, `F2`, `Delete` (in the Explorer), `Ctrl+S`, `Ctrl+E`.

## Moving around

- **Tab order** follows the screen: "Skip to document" link, menu bar, title-bar toolbar,
  window controls, Explorer toolbar, file tree, sidebar resizer (arrow keys resize it), tabs,
  then the document.
- **Explorer**: the tree follows the WAI-ARIA tree pattern (arrows, Home/End, Enter, Space, `*`,
  type-ahead). See [file-tree.md](file-tree.md).
- **Tabs**: ← / → move between tabs, Enter activates, Delete closes.
- **Document**: the preview is focusable, so PageUp / PageDown / arrows scroll it. Code blocks are
  focusable to scroll them horizontally. Mermaid diagrams have their own keys (`+`, `-`, `F`, `0`,
  Enter).
- **Menus and dialogs** (radix-ui) trap focus, close with Esc and return focus where it was.

## Accessibility checklist (phase 1)

| Area | How it is handled |
|---|---|
| Focus visibility | Every focusable element shows a focus ring (`:focus-visible`), 3 px yellow in High Contrast. The tree shows focus on the active row. |
| Roles and names | Title bar menus (`menubar`), Explorer (`tree`), tabs (`tablist`), notifications (`region` + `aria-live="polite"`), status bar, icon buttons with labels and tooltips, task-list checkboxes with "Done / Not done" labels, MathML kept next to KaTeX output. |
| Contrast | Measured with an automated check in every theme: all body, UI and code text is at least 4.5:1 (WCAG AA) in Light and Dark and at least 9:1 in High Contrast; Mermaid labels 12:1 or more. Code uses GitHub's Primer themes (`github-light-default`, `github-dark-default`, `github-dark-high-contrast`). |
| Motion | `prefers-reduced-motion` turns off the splash animation (static logo), toast animations and transitions. |
| Zoom | Document text size is adjustable from 12 to 24 px; the UI follows the system scale factor. |
