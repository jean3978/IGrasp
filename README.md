# IGrasp

> [!IMPORTANT]
> **IGrasp is AI-generated and conscientiously prompted.**
> The point of this repository is not to learn how to build this app: it is a "disposable" app.
> The point of the app is to help you understand the structure of big, long-term projects.

IGrasp is a desktop app for Windows and Linux that shows **only the markdown files** of a project,
in their folder hierarchy, with a reading experience designed for one job: keeping a clear human
understanding of a project whose documentation is increasingly written and maintained by AI agents.
No Confluence, no editor plugin, no note-taking vault — just the project's own docs, live.

![IGrasp showing a project's README in the dark theme](docs/screenshots/preview-dark.png)

| | |
|---|---|
| ![A Mermaid diagram in the light theme](docs/screenshots/mermaid-light.png) | ![A grouped notification after an agent changed 15 files](docs/screenshots/live-changes-light.png) |

## Features

- **Markdown only.** The Explorer shows `.md` and `.markdown` files and the folders that contain
  them, nothing else. `.gitignore` is respected; `.git` and `node_modules` are always skipped.
  Toggles reveal dotfiles and ignored files. Smooth with 10,000+ files.
- **A real reading view.** GitHub Flavored Markdown, GitHub alerts, syntax highlighting, math
  (KaTeX), YAML front matter as a card, images and videos, and **Mermaid diagrams** with zoom,
  pan, fit and full screen.
- **Live.** When an agent (or anything else) changes files, the tree and the open documents update
  on their own, keeping your scroll position. Notifications say what changed; a burst of changes
  becomes one grouped notification. Mute them when you want quiet.
- **VS Code-style workspace.** Preview and pinned tabs, a custom title bar with menus, keyboard
  shortcuts for everything, and per-folder sessions: tabs, scroll positions and expanded folders
  come back when you reopen a folder.
- **Themes.** Light, Dark, High Contrast and Follow System.
- **Safe by design.** IGrasp never writes inside the folder you open. HTML in markdown is
  sanitized, links never navigate the app, and the app reads only the folder you chose.

Coming next: search, outline and backlinks; editing; a beginner-friendly git view and "what
changed since I last looked"; Claude integration; and a quiz about your project. See the
[roadmap](#roadmap).

## Download and installation

Installers are published on the [Releases](https://github.com/jean3978/IGrasp/releases) page:

| Platform | Files |
|---|---|
| Windows 10/11 (x64) | `IGrasp_x.y.z_x64-setup.exe` (NSIS) or `IGrasp_x.y.z_x64_en-US.msi` |
| Linux (x64) | `IGrasp_x.y.z_amd64.AppImage` or `IGrasp_x.y.z_amd64.deb` |

The installers are not code-signed yet: Windows SmartScreen will warn about an unknown publisher
("More info" › "Run anyway"). On Linux, make the AppImage executable (`chmod +x`) before running
it.

## Requirements

- **Windows**: the Microsoft Edge WebView2 runtime (preinstalled on Windows 11 and recent
  Windows 10).
- **Linux**: WebKitGTK 4.1, version **2.44 or newer** (Ubuntu 22.04 and later with updates,
  Debian 12, Fedora 39+). Mermaid diagrams need it.
- **Claude features** (from phase 5) will use your installed
  [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code); it is not bundled.

### Video on Linux

Videos play through GStreamer. If a video shows an "Open externally" card instead of playing,
install the codecs:

```sh
# Debian, Ubuntu
sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav gstreamer1.0-gl
# Fedora (with RPM Fusion for the ffmpeg codecs)
sudo dnf install gstreamer1-plugins-good gstreamer1-plugins-bad-free gstreamer1-libav
```

The AppImage does not bundle GStreamer.

### Live updates on Linux

IGrasp watches the opened folder with inotify. On very large folders the system limit can be
reached; IGrasp then polls every 2 seconds and the status bar shows "Polling for changes". To get
instant updates again, raise the limit:

```sh
echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/60-igrasp.conf && sudo sysctl --system
```

## Build from source

You need Node.js ≥ 24.15, npm ≥ 11 and Rust (stable) with the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```sh
git clone https://github.com/jean3978/IGrasp.git
cd IGrasp
npm install
npm run tauri dev      # run the app
npm run tauri build    # build installers into src-tauri/target/release/bundle
npm run check          # type checks, lint, formatting and all unit tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the details, and
[docs/architecture.md](docs/architecture.md) for how it works.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+O` | Open a folder |
| `Ctrl+,` | Settings |
| `F1` | All keyboard shortcuts |
| `Ctrl+B` | Show or hide the sidebar |
| `Ctrl+Shift+E` | Focus the Explorer |
| `Ctrl+W` | Close the tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Alt+1` … `Alt+9` | Go to a tab |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Larger / smaller / default text |
| `Alt+F`, `Alt+E`, `Alt+V`, `Alt+H` | Open a menu |

In the Explorer: arrows, Home/End, Enter (open), Space (preview), `*` (expand siblings) and
type-ahead. More in [docs/features/keyboard.md](docs/features/keyboard.md).

### Known limitations

- The custom title bar has no Windows 11 snap-layout flyout on the maximize button and no
  `Alt+Space` system menu. Settings › Appearance › Window frame › Native switches to the system
  title bar.

## Roadmap

- [x] **Phase 1 — MVP** (0.1.0): open folder and recent folders, markdown-only file tree, rich
      preview (GFM, code highlighting, math, front matter, images, videos, Mermaid), tabs, live
      reload, change notifications, themes, settings, session restore, keyboard accessibility.
- [ ] **Phase 2 — Navigation**: search everything (Ctrl+T), search in files (Ctrl+Shift+F), recent
      changes, back/forward history, outline, internal links, code viewer, broken links, backlinks.
- [ ] **Phase 3 — Editing**: WYSIWYG editing with lossless round-trip, file management, edit
      conflicts.
- [ ] **Phase 4 — Git**: branch graph, commit details, status panel, stash, beginner-friendly
      operations, and "what changed since I last looked".
- [ ] **Phase 5 — Claude**: chat through the Claude CLI, inline diff review, region capture.
- [ ] **Phase 6 — Quiz**: a fun quiz about the project with Hoot the owl.
- [ ] **Phase 7 — Mermaid visual editor**: flowcharts first.

## License

[MIT](LICENSE) © 2026 Jean-Rene Choiniere
