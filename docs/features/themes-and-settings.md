# Themes and settings

## Themes

| Theme | Notes |
|---|---|
| Light | VS Code "Light Modern" colors, GitHub-like document styles. |
| Dark | VS Code "Dark Modern" colors. |
| High Contrast | Pure black and white, 2 px borders, a 3 px yellow focus ring, no transparency or shadows, underlined links; code, math, alerts and diagrams use high-contrast variants. |
| Follow System | Light or Dark following the operating system, updated live. |

Switch themes from the theme button in the title bar, View › Theme, or Settings. The choice is
saved immediately.

Every color comes from semantic CSS variables (`src/styles/tokens.css`,
`src/styles/themes/*.css`); components never hard-code colors. The active theme is set as
`<html data-theme="light|dark|high-contrast">`. Code highlighting renders all themes at once as
CSS variables, so switching themes never re-renders documents; Mermaid diagrams are re-rendered
once with the matching diagram theme.

The AI review adds four tokens, `--diff-added-bg`, `--diff-added-fg`, `--diff-removed-bg` and
`--diff-removed-fg`, defined in each theme and used by the rendered diff of a proposed edit and by
the line-diff cards. Colour is not the only cue: in High Contrast, removed blocks get a dashed
border and added blocks a solid one, and the flash after a decision is off under
`prefers-reduced-motion`. Capture selections and screenshots outline the region with the accent
token.

## Settings

Open with File › Settings or `Ctrl+,`. Changes apply instantly and are saved in the app-data
folder (`settings.json`), never in the opened folder.

| Section | Setting | Effect |
|---|---|---|
| Appearance | Theme | See above. |
| | Font size (12–24 px) | Document text size, with a live sample. `Ctrl+=`, `Ctrl+-` and `Ctrl+0` change it too. |
| | Reading width | Narrow, medium, wide or full width for documents. |
| | Window frame | Custom (the VS Code-style title bar) or Native (the system's title bar and borders). |
| Notifications | Mute notifications | Hides change toasts; files still reload. |
| Files | Extra ignore patterns | gitignore-style patterns hidden from the Explorer in every mode. Applied with the Apply button (the folder is re-indexed). |
| | Show dotfiles / ignored files by default | Initial toggles for folders opened for the first time. |
| AI | Status | The provider's version and account, or what is missing, with Check again (the check is cached for 60 s). |
| | AI provider | One entry for now (disabled). |
| | Default model | The model new conversations start with (the chat's picker changes it too). |
| | Permissions | Ask / Allow / Deny per category: markdown edits, other file edits, commands, web access, anything else; a warning next to a risky Allow; Reset to defaults. |
| | Confirm before sending | From medium, from large (default) or never: the confirmation card with the size estimate. |
| | Conversations kept per folder | 25, 100 (default) or 500. |
| | Forget this folder's conversations | Deletes the chat history kept for the open folder (app data); asks first. |
| Data | App data folder | Shows the folder and opens it in the file manager. |
| | Reset settings | Restores every default. |

A corrupt `settings.json` is moved aside as `settings.corrupt-<time>.json`, defaults are used,
and a notification says so.
