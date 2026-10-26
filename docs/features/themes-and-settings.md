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
`--diff-removed-fg`, defined in each theme (Light removed background `#fff0ef`) and used by the rendered diff of a proposed edit and by
the line-diff cards. Colour is not the only cue: in High Contrast, removed blocks get a dashed
border and added blocks a solid one, and the flash after a decision is off under
`prefers-reduced-motion`.

The AI chat has its own tokens in each theme (`--ai-accent`, `--ai-accent-soft`, `--ai-surface`,
`--ai-surface-raised`, `--ai-border`, `--ai-bubble-*`, `--ai-send-*`, `--ai-bloom`,
`--ai-bloom-far`, `--ai-highlight-*`, `--ai-selection-*`): a warm orange accent and warm
surfaces so the chat stands apart from the app, a bloom of layered shadows behind the panel, and
the colour of a selection highlighted for the chat. High Contrast keeps black surfaces, orange
outlines, no bloom and no tinted highlight (an underline and a dashed outline instead).

The quiz has `--quiz-*` tokens (`--quiz-good`, `--quiz-bad` and their `-bg`, `--quiz-flame`,
`--quiz-flame-core`, `--quiz-flame-idle` for an unlit level flame at 3:1, `--quiz-flame-off` for
the progress tracks, `--quiz-card`, `--quiz-card-border`, `--quiz-card-shadow`), the project
profile `--profile-bar-*` for the language bar, and Hoot `--hoot-*` (feathers, belly, beak,
glasses frame, eyes, blush, outline: transparent in Light and Dark, white in High Contrast).
Verdict colours and texts on the quiz card meet 4.5:1 in the three themes.

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
| Learning | Questions per quiz (5–30) | Where the quiz home starts. |
| | Default mode | Fixed (one AI call) or Adaptive (rounds of 5, one call per round). |
| | Default sources | Whole project or Documentation only. |
| | Effects | Confetti, sparks and Hoot's animations; always off under reduced motion. |
| | Results folder / Quizzes folder | Where Save results… and Save quiz… open, inside the open folder (`quiz-results`, `quizzes`); an invalid folder is shown and not saved. |
| | Forget this folder's quizzes | Deletes the quiz history and the quiz in progress kept for the open folder (app data); asks first. Saved files stay. |
| | Tutorials: Default familiarity | New here, Already contributing or Deep dive for maintainers: who a new tutorial is written for (each tutorial's options can change it). |
| | Tutorials: Default length | Quick, Standard (default) or Deep. |
| | Tutorials: Tutorials folder | Where Share with the project writes a tutorial, one folder per tutorial, inside the open folder (default `docs/tutorials`, created only when you share); an invalid folder is shown and not saved. |
| | Forget this folder's tutorials | Deletes the folder's private tutorials, your progress in every tutorial and the suggested subjects (app data); asks first. Tutorials shared in the folder stay. See [academy.md](academy.md). |
| | Profile corrections / Project profile | The profile of the open folder, Edit, Detect again, and Reset to detected. See [project-profile.md](project-profile.md). |
| Data | App data folder | Shows the folder and opens it in the file manager. |
| | Reset settings | Restores every default. |

A corrupt `settings.json` is moved aside as `settings.corrupt-<time>.json`, defaults are used,
and a notification says so.
