# 0014 — AI provider layer, and no token without a user action

- Status: Accepted (principles; the Phase 3 proof of concept settles the types and may refine
  this record)
- Date: 2026-10-24

## Context

From Phase 3, IGrasp uses an AI model for the chat, region capture, the quiz and tutorials. Two
risks shape how that code is built:

- **Unwanted spending.** Every AI call costs the user tokens, and often money. A desktop app that
  watches a folder full of agent-written files has many tempting triggers (a file changed, a
  folder was opened, a tutorial may be outdated) that could quietly call a model in the
  background. Users must be able to trust that the app never does.
- **Lock-in.** Claude, through the user's installed `claude` CLI, is the only provider planned.
  Other CLIs and APIs (OpenAI Codex CLI, Gemini CLI, DeepSeek or other OpenAI-compatible HTTP
  APIs, local models through Ollama) may be wanted later. If features call the `claude` CLI
  directly, adding one means rewriting every feature.

## Decision

**1. No token without a user action.**

- Tokens are only spent as the direct result of a specific user action: a click on a clearly
  marked control, sending a chat message, or confirming a generation. Nothing calls a model on
  start, on folder open, on file change, on a timer, on idle or when a view opens; there is no
  prefetching, warm-up, automatic summary, automatic freshness check or automatic retry loop.
- One action authorizes one bounded operation. Retries on invalid output belong to it, are
  capped and are visible; anything more needs a new action.
- Every AI call goes through a **single gateway** in the Rust backend, reachable only from an
  explicit IPC request issued by a user action. Watchers, timers, startup code and event
  handlers have no path to a provider. A test asserts that opening a folder, changing files and
  opening every view triggers no AI call.
- The AI process (CLI subprocess or HTTP request) lives only as long as that operation, and is
  stopped on completion, cancellation, window close or app exit.
- The UI marks every control that spends tokens with the same "uses AI" icon; larger operations
  show a confirmation card (what will run, provider and model, what it may read, a size
  estimate) first, and the reported usage afterwards. Generation for the quiz and tutorials is
  read-only.

**2. A provider-neutral layer, with Claude as the only provider for now.**

- Rust module `ai/` defines an `AiProvider` trait; `ai/providers/claude_cli.rs` is the first
  implementation. Features (chat, quiz, tutorials) only use the trait, through the gateway; no
  feature knows the `claude` CLI or its flags.
- Requests (prompt, context files, images, model, permission policy or read-only mode, output
  schema, resume id) and a streamed event type (text delta, tool use, permission request,
  proposed edit, usage, error, done) are provider-neutral, and so are the IPC types and
  everything in the frontend.
- Each provider declares its **capabilities** (streaming, resume, structured output, image input,
  permission prompts, read-only mode, usage and cost reporting, model list, context file names
  such as `CLAUDE.md` or `AGENTS.md`). The UI adapts to capabilities, never to provider names.
- Prompts and JSON schemas for the quiz and tutorials belong to the app and are the same for
  every provider; provider-specific adjustments stay inside the provider.
- App data records the provider and model of each conversation, quiz and tutorial. Settings show
  an "AI provider" selector with Claude as the only entry. Future API-key providers store keys
  in the OS keychain, never in app-data files.
- The mock backend gets a mock provider: it powers the browser dev mode and the tests, and is a
  second implementation that keeps the trait honest.

## Consequences

- Users can rely on a simple promise: IGrasp spends tokens only when they click for it.
- Features that would be convenient in the background (an automatic "is this tutorial still up
  to date?" check) are split into a free local part and an explicit AI part.
- Adding a provider later means one new module plus its capability declaration, without touching
  the features, as long as the trait stays provider-neutral. Some indirection is paid now for a
  single provider.
- The gateway is a choke point every AI feature must use; code review rejects any other path to a
  provider.
