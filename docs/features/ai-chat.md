# AI chat

IGrasp talks to an **AI provider** behind one abstraction
([ADR 0015](../decisions/0015-ai-provider-abstraction-and-gateway.md)). The only provider today
is **Claude, through the Claude Code CLI installed by the user**
([ADR 0014](../decisions/0014-claude-cli-integration.md)), spawned in the open folder with the
user's own login. Nothing is bundled and no API key is stored by the app. The chat never names
the provider in its code: the name, version, account, model list and capabilities all come from
the provider's status.

Two rules hold for every AI feature:

1. **No token without a user action.** Every operation starts from an explicit request (Send,
   Start on the confirmation card), never from a watcher, a timer, startup or an event handler.
   Controls that can start one carry a small sparkle with the provider's name in its tooltip.
2. **The provider is replaceable.** Features use the neutral types and the gateway only.

The app never writes inside the opened folder by itself. An accepted edit is written by the
provider, with the input the app sends back.

## Using it

- **Open**: the sparkles button in the toolbar, **View → AI Chat**, or `Ctrl+Alt+C` (a folder must
  be open). The chat is a floating panel (default: bottom-right corner, 420 × 560); the document
  behind it stays readable and clickable (`role="dialog"`, `aria-modal="false"`).
- **Move and resize**: drag the header, or focus the title and press `Alt+arrows`; resize from
  any edge or corner (minimum 360 × 320, at most the window), or `Alt+Shift+arrows`. The panel
  stays inside the window when it shrinks. Its place, size and open state are saved per folder in
  the session (app data).
- **Status line**: the provider's name, version and account, or what is missing (not installed,
  not logged in) with the provider's own instructions and a **Check again** button. The status
  is cached for 60 s.
- **Model**: the provider's suggested models (`sonnet`, `opus`, `haiku` for Claude) or a custom
  id. The choice is remembered (`settings.ai.model`) and is the default of new conversations; a
  conversation reopened from the history continues with the model it ran with (shown in the
  header).
- **Send** with Enter (Shift+Enter for a new line). Every message is one user action that spends
  tokens, and the Send button says so. A message whose estimated size reaches the confirmation
  threshold (Settings → AI, default "large", about 80k tokens) first shows a **confirmation
  card** (provider, model, documents, size class) and starts only on **Start**.
- **Stop** kills the running operation. **Escape** stops a running answer; pressed again (or with
  nothing running) it closes the panel and the focus returns to the AI Chat button. Closing the
  panel never stops an answer: the status bar shows it with **Stop**, and a badge when a
  permission waits.
- **New conversation** (+, `Ctrl+Alt+N`) saves the conversation in the history and starts an
  empty one; otherwise every message continues the same conversation (the provider's resume id),
  even after a stop or a crash.
- Accepted edits land on disk through the provider, so the file tree, the open tab and the toasts
  update through the normal live reload. Usage (tokens, and cost when the provider reports it)
  is shown under each answer and accumulates in the status line.

## Context

The **context bar** above the message box shows what the next message carries, from `ai_context`
(paths and sizes only; no content reaches the frontend):

- the provider's **instruction files** (`CLAUDE.md` and `CLAUDE.local.md` for Claude; `AGENTS.md`
  for the mock provider) from the root down to the current file's folder;
- the **current file** (a document or a code tab; a settings tab adds none), with the total size;
- a **region capture**, when there is one, as a chip ([below](#region-capture)).

Hover shows the path, a click opens the file, and ✕ leaves a document out of the messages sent
from this file (+ adds it back; another active tab brings it back). The list is computed when the
panel opens and when the active tab changes, never on a disk change or a timer. On Send,
`ai_start` receives the paths still listed and Rust reads their contents through the root guard:
32 KB per instruction file and 96 KB for the current file; larger ones go by path and the model
reads them itself.

## Permissions and settings

Every permission request carries a **kind** set by the provider (markdown edit, other file edit,
command, web, other) and the app decides by the user's settings
([ADR 0019](../decisions/0019-permission-policy-history-and-floating-chat.md)). Reading files
inside the folder needs no approval.

- **Ask** (the default for the five kinds) shows the request in the chat. A markdown edit inside
  the folder is reviewed as a rendered diff ([below](#inline-edit-review)); other edits are a
  line diff with **Accept** / **Reject**. Any other tool shows its name, a one-line summary and
  its input (under **Details**) with **Allow**, **Deny** and **Allow for this conversation**: the
  last one also allows the same tool for the same kind without asking until New conversation;
  the header's shield button lists these rules, each with a ✕.
- **Allow** and **Deny** answer at once, without showing a card. Every automatic answer (settings,
  conversation rule, read-only operation) is a line in the transcript: "Allowed by your settings:
  Bash npm test", "Allowed for this conversation: Bash ls".
- A rejection tells the model "The user rejected this in IGrasp." so it does not retry; a denial
  by the settings says "Denied by the user's IGrasp settings.".
- **Settings → AI**: the provider's status with **Check again**, the provider (one entry, so
  disabled), the default model, one row per permission category with Ask / Allow / Deny, a
  sentence each and a warning when Allow is chosen for commands or non-markdown edits, **Reset
  to defaults**, the confirmation threshold (from medium, from large, never), the conversations
  kept per folder (25, 100, 500) and **Forget this folder's conversations**. A change applies
  from the next message. See [themes-and-settings.md](themes-and-settings.md).

## Inline edit review

A markdown edit inside the folder opens the file's tab in **review mode**: the rendered
document with the removed and added blocks in place, Accept / Reject per change, and a review
bar (Accept all, Reject all, Open in chat, Apply). Only the accepted changes are written. The
chat shows an Edit card with **Review in preview**; with the chat closed, the status bar item
("1 edit to review") leads to the review. The details are in
[markdown-preview.md](markdown-preview.md#review-mode-an-ai-edit); the diff itself is
[ADR 0017](../decisions/0017-rendered-markdown-diff-at-block-level.md). Edits of other files, of
files outside the folder, of documents too large to render, or whose text is no longer in the
file keep the line-diff card in the chat.

## Region capture

- **Start**: the region button in the toolbar, **View → Ask About a Region**, or `Ctrl+Alt+R`.
  It needs a markdown or code tab and is disabled otherwise. The action only shows the overlay;
  it never calls the provider.
- **Select**: a crosshair covers the tab's scroll area. Drag a rectangle (at least 24 × 24 px),
  or use the keyboard: arrows move a rectangle from the centre, `Shift+arrows` resize it, `Enter`
  captures, `Escape` cancels.
- **Lines**: in a markdown tab every block with a `data-line` marker that the rectangle touches
  gives the range, from the first block's start line to the line before the next block (blank
  separator lines trimmed); in a code tab, the rendered rows. A selection over an image only
  keeps the nearest block's line with an empty text.
- **Screenshot**: after the overlay is removed, the visible part of the tab is rendered with
  `modern-screenshot`, cut to the rectangle plus a 12 px margin, the selection outlined in the
  accent colour, at most 1568 px on the long edge (PNG, JPEG above 1.5 MB). The chip and the
  transcript item show a thumbnail. If it cannot be taken (an image the webview refuses to
  draw, a render error) the text alone is attached with the notice "The screenshot could not be
  taken; the text was attached." A model that cannot read images (`imageInput: false`) gets no
  screenshot, with a notice saying so; switching to such a model before Send drops it too. See
  [ADR 0018](../decisions/0018-region-capture-by-dom-rendering.md).
- **Result**: the chat opens with a chip ("docs/a.md lines 40–58", ✕ to drop it), the draft
  "About this region:" (an existing draft is kept) and the focus in the message box. Nothing is
  sent until Send, which passes the region with the message; the transcript then shows a
  "Selected region" item right after it, and the history keeps its text and range.

## History

**History** (clock button, `Ctrl+Alt+H`) lists this folder's conversations, newest first, with
their date, model and tokens, a filter box, and **Delete** (with a confirmation). Opening one
shows its transcript; the next message continues it with its resume id.

The app keeps its own readable copy (app data, `conversations/`, never in the folder): written
when an operation ends and on New conversation, trimmed to `settings.ai.historyLimit`
conversations and 400 items each, tool calls kept as summaries with the first 2 KB of their
result. A conversation therefore stays readable even when the provider has forgotten it; the
provider's own transcript remains what the model resumes from. Sending into a conversation the
provider lost shows its error and **Start a new conversation from here** (it spends tokens: it
re-sends the message without a resume id, same history entry). Settings → AI → **Forget this
folder's conversations** deletes them all. Listing, opening, deleting and forgetting never start
the AI.

## How it works

```mermaid
sequenceDiagram
  actor User
  participant UI as Chat (React, provider-neutral)
  participant G as AI gateway (Rust, ai/gateway.rs)
  participant P as Claude provider (ai/providers/claude_cli)
  participant C as claude CLI
  User->>UI: message
  UI->>G: ai_start(action = chatMessage, request)
  G->>P: start(request, root)
  P->>C: spawn claude -p --output-format stream-json --input-format stream-json --permission-prompt-tool stdio …
  C-->>P: stream-json lines
  P-->>G: AiEvent: session, textDelta, text, toolUse …
  G-->>UI: ai://event (operation id + event)
  C-->>P: control_request can_use_tool (Edit …)
  P-->>G: permissionRequest (kind, proposedEdit)
  G->>G: policy: Ask, Allow or Deny
  G-->>UI: permissionRequest (Ask)
  UI->>User: review in the preview, or a card
  User->>UI: Accept (all or some hunks)
  UI->>G: ai_respond_permission(allow, updatedEdit)
  G->>P: respond, mapped to the tool input
  P->>C: stdin control_response
  C-->>P: tool result, text, result
  P-->>UI: toolResult, text, usage, done(Completed)
```

The full flow of a message, with the estimate and the history save, is in
[architecture.md](../architecture.md#sending-a-message).

| Piece | Where |
|---|---|
| Neutral contracts (`AiRequest`, `AiEvent`, `AiCapabilities`, `AiProviderStatus`, …) | `src-tauri/src/ai/types.rs` → `src/ipc/generated/` |
| `AiProvider` / `AiOperation` traits | `src-tauri/src/ai/mod.rs` |
| Gateway: user action required, one operation at a time, cancel on close | `src-tauri/src/ai/gateway.rs` |
| Permission policy: kind (markdown edit, file edit, command, web, other) → Ask / Allow / Deny from `settings.ai.permissions` (snapshot at start); read-only operations refuse every prompt; automatic answers emit `permissionDecided` | `src-tauri/src/ai/policy.rs`, `gateway.rs` |
| Context of a message: instruction files from the root down, then the current file, read through the root guard (32 KB / 96 KB caps); size estimate (bytes / 4, 1 500 tokens per image, small < 20k ≤ medium < 80k ≤ large) | `src-tauri/src/ai/context.rs`, `estimate.rs` |
| Child processes die with the app (job object on Windows) | `src-tauri/src/ai/process.rs` |
| Claude provider: CLI discovery and probes, one process per operation, wire-format mapping, permission kinds, neutral edit → tool input | `src-tauri/src/ai/providers/claude_cli/{cli,turn,protocol}.rs` |
| Rust mock provider (gateway tests) | `src-tauri/src/ai/providers/mock.rs` |
| Commands `ai_status` (60 s cache, `force`), `ai_capabilities`, `ai_providers`, `ai_set_provider`, `ai_context`, `ai_estimate`, `ai_start`, `ai_respond_permission`, `ai_cancel`; conversations | `src-tauri/src/commands/ai.rs`, `appdata/conversations.rs` |
| Event reducer (events → chat items), saved-item format, line diff | `src/features/ai/timeline.ts`, `diff.ts` |
| Stores: provider (status, capabilities, model), conversation (items, operation, permissions, usage, history), panel (geometry, draft, context, attachment) | `src/stores/aiProvider.ts`, `aiConversation.ts`, `aiPanel.ts` |
| Floating panel and its parts: `AiPanel`, `StatusLine`, `ContextBar`, `Transcript`, `PermissionCard`, `ConfirmCard`, `Composer`, `ModelPicker`, `HistoryList` | `src/features/ai/` |
| Inline review (rendered diff, change units, composing the accepted result) | `src/features/diff/`, `src/features/ai/InlineEditReview.tsx`, `editReview.ts` |
| Region capture (overlay, source lines, screenshot) | `src/features/capture/`, `src/stores/capture.ts` |
| Mock provider for the browser and the tests | `src/ipc/mock/mockAi.ts` |

The frontend never builds a provider's tool input: it sends the neutral `updatedEdit` (the
accepted hunks, or the composed content of a whole-file write) and the provider maps it.

In the browser dev mode (`npm run dev`), the mock provider ("Mock AI") answers by words of the
prompt: `edit README.md` proposes one change to it, `edit twice README.md` two changes in
different paragraphs, `rewrite README.md` a rewrite, `create notes/new.md` a new file,
`command` asks to run one, and so on (the full list is at the top of `src/ipc/mock/mockAi.ts`).
The fixture has `AGENTS.md` at its root and in `docs/` (the mock provider's instruction-file
name), so opening `docs/guide/getting-started.md` lists both in the context bar. The mock applies
the same permission policy as the Rust gateway.

## Failure handling

| Situation | What happens |
|---|---|
| Provider not installed | Status line shows the provider's install instructions; the composer is disabled. |
| Not logged in | Status line shows the login command; if the login expires later, the provider's own error is shown in the conversation. |
| Process exits without finishing | "Claude stopped unexpectedly (exit code …)" with the last lines of stderr. |
| Stop | The process tree is killed; "Stopped." appears; the next message resumes the conversation. |
| Folder, window or app closed while an operation runs | The operation is cancelled; on Windows the OS also kills the child if the app dies hard. |
| Conversation lost by the provider | The provider's error is shown with **Start a new conversation from here**; the app's copy of the history is intact. |
| Screenshot cannot be taken | The text of the region is attached alone, with a notice. |
| An edit that cannot be shown in the preview | The line-diff card in the chat. |
| Unknown control request from a newer CLI | Refused with an error response so the CLI never hangs. |

## What the app cannot enforce

- **The CLI's own allow rules.** Rules in the user's `~/.claude/settings.json` or the project's
  `.claude/settings.json` (for example `Bash(npm test)`) let the CLI run those tools without
  asking, so the app's permission settings never see them. They are the user's explicit choices
  for that folder, and every tool call still appears in the chat, so nothing runs invisibly. The
  CLI is started with `--permission-mode default` so a default mode in the user's settings (for
  example `acceptEdits`) cannot bypass the app. See
  [ADR 0019](../decisions/0019-permission-policy-history-and-floating-chat.md).
- **What a command does.** An allowed command runs with the user's rights; the app shows it, it
  does not sandbox it.
- **A hard kill of the app on Linux** can leave the CLI running until it notices its closed
  pipes (on Windows a job object kills it).
- **Linux is not verified yet**: the CLI integration and the capture of asset images were tested
  on Windows 11 only (ADR 0014, ADR 0018).

## Testing

- `npm test`: event reducer, line and block diff, the chat against the mock provider (accept,
  reject, command prompt, stop, not installed, not logged in, late login error, new
  conversation, history, context bar, confirmation card), the inline review and the capture, the
  "no token without a user action" test, and the provider-neutrality scan of the frontend.
- `npm run test:e2e`: smoke tests of the panel, the context bar, permissions, the inline review
  (`e2e/ai-review.spec.ts`) and region capture (`e2e/ai-capture.spec.ts`).
- `cargo test`: gateway with the mock provider, the permission policy, context and estimate,
  conversations, protocol mapping on recorded samples, argument building, stdin line shapes, CLI
  probes parsing, and `no_start.rs` (no command but `ai_start` can start an operation).
- Against the real CLI (needs a login, costs a few tokens):
  `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored claude_cli::`.

## Performance

Budgets and what was measured (Chromium against the Vite dev server with the mock backend, Windows
11 dev box, `performance.now()`; the Vitest test `src/features/ai/perf.test.tsx` repeats the
measurements in jsdom with a 3x margin and logs its numbers):

| Budget | Measured | Verdict |
|---|---|---|
| 400-item conversation, one streamed event until the next frame | 16.6 ms median, 18.4 ms worst of 20 (one frame; mounting the 400 items takes 9 ms) | Met; the transcript is not virtualized |
| Block diff of a 5 000-line document, `buildWriteReview` (11 change groups) | 126-162 ms (first call 162 ms, then about 130 ms) | Met (200 ms) |
| Same, `buildEditReview` (one hunk) | 127-135 ms | Met (200 ms) |

The diff time is dominated by parsing the two versions into blocks (`splitBlocks`). Not budgeted,
for information: rendering that 5 000-line diff with `RenderedDiff` shows its first change after
about 0.7 s (the markdown pipeline runs per block); documents over the preview size limit fall
back to the line diff.
