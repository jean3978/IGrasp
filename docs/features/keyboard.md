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
| `Ctrl+Alt+B` | Show or hide the right panel (Outline, Backlinks) |
| `Ctrl+Shift+E` | Explorer view |
| `Ctrl+Shift+F` | Search view (search in files; selected text becomes the query) |
| `Ctrl+Shift+R` | Recent Changes view |
| `Ctrl+Shift+L` | Broken Links view |
| `Ctrl+Shift+O` | Focus the outline (opens the right panel) |
| `Ctrl+Alt+C` | Show or hide the AI chat panel |
| `Ctrl+Alt+S` | Ask about selected text: turn the text mode on or off (highlight text, release the mouse, and the chat opens next to it) |
| `Ctrl+Alt+R` | Ask about a region: select a rectangle of the tab (markdown or code) and attach its text to the chat |
| `Ctrl+Alt+N` / `Ctrl+Alt+H` | New AI conversation / show or hide the history (chat panel open) |
| `Alt+arrows` / `Alt+Shift+arrows` | Move / resize the AI chat panel (its title focused) |
| `Enter` / `Shift+Enter` (message box) | Send / new line |
| `Escape` (AI chat panel) | Stop the running answer; pressed again, close the panel |
| `Alt+Shift+A` / `Alt+Shift+R` | Accept all / Reject all proposed changes (while an AI edit is shown in review mode) |
| `Ctrl+Alt+Q` | Quiz Me: open the Quiz tab (free; only the confirmation card's Start spends tokens) |
| `Ctrl+Alt+A` | Hoot's Academy: open the Academy tab (free; only a confirmation card's Start spends tokens) |
| `Ctrl+T` | Search everything: files and headings |
| `Alt+←` / `Alt+→`, mouse back / forward | Back / forward through the documents read |
| `F4` / `Shift+F4` | Next / previous search result |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Document text larger / smaller / default |
| `Ctrl+W` | Close the tab |
| `Ctrl+Tab`, `Ctrl+PageDown` / `Ctrl+Shift+Tab`, `Ctrl+PageUp` | Next / previous tab |
| `Alt+1` … `Alt+9` | Go to a tab (9 = last) |
| `Ctrl+Shift+PageUp` / `PageDown` | Move the tab left / right |
| `Alt+F`, `Alt+E`, `Alt+V`, `Alt+L`, `Alt+H` | Open a menu (L: Learn) |
| `F10` or `Alt` | Focus the menu bar |
| `Esc` | Close menus, dialogs and full-screen views |

In a view or dialog:

| Where | Keys |
|---|---|
| Search view | `Alt+C` match case, `Alt+W` whole word, `Alt+R` regex; Enter searches now; ↑ / ↓ recall searches; Esc clears; Delete dismisses a result |
| Ctrl+T dialog | ↑ / ↓, PageUp / PageDown; Enter opens, `Ctrl+Enter` keeps the tab open, `Alt+Enter` opens and keeps searching |
| Code viewer | `Ctrl+G` go to line |
| Review mode (an AI edit in the preview) | `Tab` moves between the changes and their buttons; `A` / `R` on a focused change accepts / rejects it |
| Quiz question | `1`–`4` choose, `T` / `F` true / false, `H` hint, `L` look it up (the cited files in a window; `Esc` closes it and the focus returns to its button), `Enter` next (after the answer; the Next button has the focus), `Esc` back to the quiz home (the quiz is kept). The focus starts on the first choice; the verdict, level and streak are announced; the results screen takes the focus on its heading, which reads the score |
| Academy welcome | Any key or a click skips Hoot's welcome when the tab opens |
| Academy outline review | `Shift+↑` / `Shift+↓` move the focused chapter; `Enter` ends a rename |
| Academy course map | Arrows (and `Home` / `End`) move between chapters, `Enter` opens one |
| Academy step | `Enter` / `→` next (a read step) or check the answer, `←` previous, `R` read more (the first cited file), `Esc` or `M` back to the course map (the place is kept). Code tour: `→` / `←` or `N` / `P` stops, `O` open in the code viewer. Spot it: `↑` / `↓` move to a line, `Enter` picks it. Put in order: `Space` picks up or drops an item, `↑` / `↓` move it, `Enter` checks. Match: `↑` / `↓` within a column, `Enter` selects, `Backspace` undoes a pair. Quick check: the quiz question's keys. Try it yourself: `C` copy the command, `O` open the file, `Enter` I did it, `S` skip. The step card takes the focus on every transition; XP gains, a streak and a completed chapter are announced |
| Academy review | `A` / `R` on a focused proposal accepts / rejects it |
| Region selection | Arrows move a 200 × 120 rectangle from the centre, `Shift+arrows` resize it, `Enter` captures, `Esc` cancels (a mouse drag works too) |
| Links, results, backlinks | `Ctrl+click`, middle click, double click or `Ctrl+Enter` open in a kept tab |

While typing in a text box, plain keys are never taken by shortcuts (F-keys and Ctrl/Alt
combinations still work).

Reserved for upcoming features (not bound yet, so they never need to be re-learned): `F2`,
`Delete` (in the Explorer), `Ctrl+S`, `Ctrl+E`.

## Moving around

- **Tab order** follows the screen: "Skip to document" link, menu bar, title-bar toolbar,
  the AI chat panel when open, window controls, activity bar, the active sidebar view (its header actions, its boxes, then
  its tree or list), sidebar resizer (arrow keys resize it), tabs, the document, the AI tools
  over it (AI Chat, Ask About Selected Text, Ask About a Region), the right panel resizer and the
  right panel (Outline, then Backlinks), then the status bar items.
- **Activity bar**: one tab stop; ↑ / ↓ move between views, Enter or Space opens one.
- **Explorer**: the tree follows the WAI-ARIA tree pattern (arrows, Home/End, Enter, Space, `*`,
  type-ahead). See [file-tree.md](file-tree.md).
- **Search results, Broken links, Outline, Recent changes, Backlinks**: the same list and tree
  keys (arrows, Home/End, PageUp/PageDown, ← / → to collapse or expand, Enter to open and keep,
  Space to preview).
- **Ctrl+T** follows the combobox pattern (`aria-activedescendant`), search status changes are
  announced politely.
- **Tabs**: ← / → move between tabs, Enter activates, Delete closes.
- **Document**: the preview is focusable, so PageUp / PageDown / arrows scroll it. Code blocks are
  focusable to scroll them horizontally. Mermaid diagrams have their own keys (`+`, `-`, `F`, `0`,
  Enter).
- **AI chat panel**: a floating dialog (`aria-modal="false"`), movable and resizable from the
  keyboard (above); the focus returns to the AI Chat button when it closes. AI events are announced
  through one polite live region (streamed text is not read as it arrives). When a card is
  answered the focus goes to the message box.
- **Review mode**: each change is a focusable group labelled "Change 2 of 3: replaced paragraph"
  with Accept, Reject and Undo buttons, and a polite live region announces each decision. "Review in preview" and the status bar
  item focus the first undecided change; once the review is answered the focus goes to the
  document.
- **Region selection**: operable without a mouse (above), with its instruction as the overlay's
  accessible name
  and the selection size announced while it is resized; cancelling returns the focus where it
  was.
- **Menus and dialogs** (radix-ui) trap focus, close with Esc and return focus where it was.

## Accessibility checklist

| Area | How it is handled |
|---|---|
| Focus visibility | Every focusable element shows a focus ring (`:focus-visible`), 3 px yellow in High Contrast. Trees and lists show focus on the active row. |
| Roles and names | Title bar menus (`menubar`), activity bar and tabs (`tablist`), Explorer, search results, outline and broken links (`tree`), backlinks (`list`), Ctrl+T (`combobox` + `listbox`), notifications (`region` + `aria-live="polite"`), view status lines such as "12 results in 4 files" (`status`, announced politely), status bar, icon buttons with labels and tooltips, task-list checkboxes with "Done / Not done" labels, MathML kept next to KaTeX output. |
| Contrast | Measured with an automated check in every theme: all body, UI and code text is at least 4.5:1 (WCAG AA) in Light and Dark and at least 9:1 in High Contrast; Mermaid labels 12:1 or more. Code uses GitHub's Primer themes (`github-light-default`, `github-dark-default`, `github-dark-high-contrast`). |
| Motion | `prefers-reduced-motion` turns off the splash animation (static logo), toast animations and transitions; the flash of a heading you jump to becomes a static highlight. |
| Highlights (phase 2) | Search matches and broken-link underlines have their own tokens in each theme; matches carry a border or underline with at least 3:1 contrast against the page. |
| Zoom | Document text size is adjustable from 12 to 24 px; the UI follows the system scale factor. |
