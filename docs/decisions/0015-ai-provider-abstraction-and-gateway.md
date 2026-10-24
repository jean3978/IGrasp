# 0015 — AI provider abstraction and the "no token without a user action" gateway

- Status: Accepted (proof of concept on the `poc-claude-cli` branch; completed in Phase 3, 0.3.0)
- Date: 2026-10-24

## Context

Claude is the only AI the app supports today, through the `claude` CLI ([ADR 0014](0014-claude-cli-integration.md)).
The specification adds two non-negotiable rules for every AI feature (chat, region capture, quiz,
tutorials): **tokens are only ever spent as the direct result of a user action**, enforced in
code, and **the provider must be replaceable** (Codex CLI, Gemini CLI, HTTP APIs, local models)
without touching the features built on top. The first version of the proof of concept forwarded
the CLI's `stream-json` objects to the frontend and parsed them there, which tied the chat to one
provider; this record describes the abstraction that replaced it.

## Decision

### One trait, provider-neutral contracts

Rust module `src-tauri/src/ai/`:

- `AiProvider` (`mod.rs`): `id`, `display_name`, `capabilities`, `status`, and
  `start(request, root, sink) -> AiOperation`. `AiOperation` has `respond(request_id, decision)`,
  `cancel` and `is_done`; dropping it must stop whatever runs behind it.
- `types.rs`, exported to TypeScript by ts-rs, names nothing provider-specific:
  - `AiRequest { prompt, model, resume_id, context (instruction files and current file),
    capture, images, policy (Interactive | ReadOnly), output_schema }`. The frontend sends an
    `AiStartRequest` with context *paths*, and the backend builds the `AiRequest` (Phase 3).
  - `AiEvent`: `Session { resume_id, model }`, `TextDelta`, `Text`, `ToolUse`, `ToolResult`,
    `PermissionRequest { request_id, tool, kind, description, input, proposed_edit }`,
    `PermissionDecided { tool, kind, allowed, reason }` (an automatic answer, Phase 3), `Usage`,
    `Error`, `Done { outcome: Completed | Cancelled | Failed, detail }`.
  - `ProposedEdit { path (root-relative), is_markdown, whole_file, hunks[{ old_text, new_text }] }`
    is extracted by the provider from its tool call, so the UI shows a diff without knowing the
    tool.
  - `PermissionDecision`: `Allow { updated_edit }` (a subset of the proposed edit, which the
    provider maps back to its own tool input; the frontend never builds a tool input, see
    [ADR 0019](0019-permission-policy-history-and-floating-chat.md)) | `Deny { message }`.
  - `AiCapabilities`: streaming, resume, structured output, image input, permission prompts,
    read-only mode, usage and cost reporting, suggested models (each says whether it reads
    images), context file names.
  - `AiProviderStatus`: installed, logged in, version, account, plan, `problem`, `help`.
- `providers/claude_cli/` implements the trait: `cli.rs` (find and probe the executable),
  `turn.rs` (one process per operation), `protocol.rs` (the only code that reads `stream-json`,
  turning it into `AiEvent`s and `ProposedEdit`s). The `providers` module is private to `ai`.
- `providers/mock.rs` is a scripted second implementation used by the gateway tests; the
  frontend's mock backend (`src/ipc/mock/mockAi.ts`) speaks the same neutral events and powers
  the browser dev mode and the UI tests.

The frontend (`src/stores/ai{Provider,Conversation,Panel}.ts`, `src/features/ai/`) consumes `AiEvent`s only. UI labels use
`AiProviderStatus.display_name` ("Claude" today), the model list comes from the capabilities, and a
Vitest test (`neutrality.test.ts`) fails if a provider name or a wire-format token appears in the
AI feature, store, IPC or mock files.

### The gateway: no token without a user action

`ai/gateway.rs` is the only owner of a provider. `AiGateway::start` requires an `AiUserAction`
(`ChatMessage`, `RegionCapture`, `QuizGeneration`, `TutorialGeneration`, `TutorialReview`) and
logs it; the Tauri command `ai_start` is the only caller and the frontend's only way in. Nothing
else in the backend (watchers, timers, startup, event handlers) can reach a provider because the
provider types are not visible outside `ai`. `status` and `capabilities` never start a provider
operation (a CLI status probe runs `--version` and `auth status`, which spend no tokens).

One operation runs at a time. Its process lives exactly as long as the operation:

- **Cancel**, **New conversation**, closing the folder and a new operation all stop the running one.
- The Tauri run loop calls `cancel_all` on `ExitRequested`, `Exit` and the main window's
  `Destroyed`, so nothing survives the window or the app.
- On Windows, every provider child is assigned to a **job object with kill-on-close**
  (`ai/process.rs`, `win32job` crate): if the app dies hard, the OS kills the CLI. On Unix the
  child runs in its own process group, which the cancel path kills; a SIGKILL of the app can leave
  a child until it notices its closed pipes (documented limitation).

Tests: the gateway tests with the mock provider (nothing runs until `start`; one at a time;
cancel ends with `Cancelled`; answers reach the provider) and `noTokenWithoutAction.test.ts`
(opening a folder, every sidebar view, the right panel, documents, searches, disk changes and the
AI panel itself start no operation; sending a message starts exactly one, tagged `chatMessage`).

### Paper check against other providers

How the abstraction would host the providers the specification names, from their public
documentation as of October 2026 (nothing implemented; to be re-checked when one is added):

| Need | Codex CLI (OpenAI) | Gemini CLI | OpenAI-compatible HTTP API (e.g. DeepSeek) |
|---|---|---|---|
| Streaming | `codex exec --json` prints JSONL events → `TextDelta`/`Text`, `ToolUse`/`ToolResult` | `gemini -p … --output-format stream-json` → same mapping | SSE chunks of `chat/completions` with `stream: true` |
| Resume | `codex exec resume <thread id>` → `resume_id` = thread id | `--resume <session>` → `resume_id` = session id | No server session: the provider stores the message history under an app-generated `resume_id` (or `previous_response_id` with the Responses API) |
| Permission prompts | None in headless mode: approvals come from `--ask-for-approval` / `--sandbox` policies → `permission_prompts: false`, `read_only_mode: true` via `--sandbox read-only` | None headless: `--approval-mode` and `--sandbox` → same as Codex | The provider implements the tools itself (read, list, search, edit) and emits `PermissionRequest` **before** executing one: prompts fit naturally, read-only is just not registering write tools |
| Proposed edits as diffs | From the `item.completed` file-change events (patch text) | From the edit tool call arguments | From the provider's own edit tool arguments |
| Structured output | `--output-schema` | `--output-format json` plus schema in the prompt | `response_format: { type: "json_schema" }` |
| Images | `-i <file>` | `@file` references in the prompt | `image_url` content parts when the model supports vision (`image_input` per model) |
| Usage and cost | Usage in the final event; cost from a price table | Usage in the final event | `usage` in the last chunk; cost from a price table |
| Status | `codex login status`, `codex --version` | `gemini --version`, auth through browser login or `GEMINI_API_KEY` | API key present in the OS keychain + a free `GET /models` |
| Context files | `AGENTS.md` loaded by the CLI | `GEMINI.md` loaded by the CLI | None: the provider inlines `context_files` into the prompt |

Two consequences for the contracts: a provider without permission prompts must be able to say so
(`permission_prompts: false`) so the UI explains that edits cannot be reviewed one by one and
offers read-only mode instead; and `resume_id` is opaque to the app (thread id, session id or an
app-side conversation key). Both are already in the types. The HTTP case shows the trait is not
tied to "a CLI with a prompt tool": a provider that runs its own tools emits the same events.

## Consequences

- Features never import a provider: the chat, and later the quiz and tutorials, depend on
  `ai::types` and the gateway only. Adding a provider is one module plus a line in the gateway's
  constructor; the provider id lives in `settings.ai.provider` (`ai_providers`, `ai_set_provider`).
- The CLI's wire format is isolated in `protocol.rs` with tests on recorded samples; a CLI update
  that changes it breaks one file.
- The frontend lost its protocol parser and became simpler; the Rust side gained ~400 lines of
  types, gateway and mapping.
- The mock provider exists twice (Rust for gateway tests, TypeScript for the UI), which is the
  price of keeping Rust out of the Vitest suite.
- The proof of concept left a list for Phase 3. Resolved in 0.3.0: the "uses AI" marker on every
  AI control (the sparkle, with the provider's name in its tooltip); the confirmation card with
  a size estimate (`ai/estimate.rs`, `src/features/ai/ConfirmCard.tsx`, `settings.ai.confirmFrom`);
  the "AI provider" setting (`settings.ai.provider`, Settings → AI); recording provider and model
  in app data (every stored conversation in `appdata/conversations.rs` keeps both, and
  `settings.ai.model` remembers the picker); per-model capabilities (a model says whether it
  accepts images). Still open on purpose: keychain storage for API keys, which only a provider
  with an API key needs (out of scope of Phase 3).
