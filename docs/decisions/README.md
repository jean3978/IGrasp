# Architecture Decision Records

One short record per significant choice: the context, the decision, and its consequences. Records
are never deleted; a decision that changes gets a new record that supersedes the old one.

| # | Decision | Status |
|---|---|---|
| [0001](0001-tauri-v2-react-vite-stack.md) | Tauri v2 with a React + TypeScript + Vite frontend | Accepted |
| [0002](0002-file-access-through-rust-commands.md) | File access only through guarded Rust commands | Accepted |
| [0003](0003-markdown-pipeline-sanitize-before-generators.md) | Markdown pipeline: sanitize before the trusted generators | Accepted |
| [0004](0004-background-index-with-ignore-crate.md) | Background index built with the `ignore` crate | Accepted |
| [0005](0005-app-data-as-versioned-json-files.md) | App data as versioned JSON files | Accepted |
| [0006](0006-custom-title-bar-and-menu-bar.md) | Custom title bar and in-window menu bar | Accepted |
| [0007](0007-e2e-with-playwright-and-mock-ipc.md) | End-to-end tests with Playwright and a mock backend | Accepted |
| [0008](0008-pin-typescript-5-and-vite-8.md) | Pin TypeScript 5.9 and Vite 8 | Accepted |
| [0009](0009-document-graph-in-rust.md) | Document graph (headings, links, backlinks) built in Rust | Accepted |
| [0010](0010-full-text-search-with-grep-crates.md) | Full-text search with the ripgrep crates, streamed, without an index | Accepted |
| [0011](0011-fuzzy-matching-with-nucleo.md) | Fuzzy matching for Ctrl+T with nucleo-matcher (MPL-2.0, unmodified) | Accepted |
| [0012](0012-activity-bar-sidebar-views-and-right-panel.md) | Activity bar with sidebar views, and a right panel for the active document | Accepted |
| [0013](0013-opening-files-with-the-default-app.md) | Opening files with the default application: text only, deny-listed, user-initiated | Accepted |
| [0014](0014-claude-cli-integration.md) | Claude through the `claude` CLI: one `stream-json` process per turn, permissions over stdio | Accepted, Linux verification pending |
| [0015](0015-ai-provider-abstraction-and-gateway.md) | AI provider abstraction (`AiProvider`, neutral events) and the "no token without a user action" gateway | Accepted |
| [0016](0016-learning-features-grounded-in-the-project.md) | Learning features (quiz, tutorials) grounded in the whole project | Accepted |
| [0017](0017-rendered-markdown-diff-at-block-level.md) | Rendered markdown diff at block level, shared by AI review, tutorials and Git | Accepted |
| [0018](0018-region-capture-by-dom-rendering.md) | Region capture by rendering the DOM (modern-screenshot) with `data-line` mapping | Accepted (Linux verification pending) |
| [0019](0019-permission-policy-history-and-floating-chat.md) | Permission policy in the gateway, conversation history owned by the app, chat as an in-page floating panel | Accepted |
