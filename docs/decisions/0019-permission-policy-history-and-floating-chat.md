# 0019 — Permission policy in the gateway, app-owned conversation history, floating chat panel

- Status: Accepted
- Date: 2026-10-24

## Context

The proof of concept ([ADR 0014](0014-claude-cli-integration.md),
[ADR 0015](0015-ai-provider-abstraction-and-gateway.md)) sent every permission prompt of the
CLI to the chat and left history, model choice and settings to later. Phase 3 needs:

- the specification's permission defaults, configurable by the user, applied to every AI
  operation whatever the provider;
- a chat history per folder that the user can reopen;
- a "small, modern, movable modal window" for the chat, which must also cooperate with the inline
  diff review in the preview and with region capture;
- partial acceptance of a proposed edit (accept some hunks, reject others), which only works if
  the provider runs the tool with the input the app sends back.

## Decision

### Permission policy in the gateway

- The **provider classifies**, the **app decides**. Each permission request carries an
  `AiPermissionKind` (`MarkdownEdit`, `FileEdit`, `Command`, `Web`, `Other`) set by the provider,
  which is the only layer that knows its tools (for Claude, `protocol::permission_kind`: an
  `Edit`/`MultiEdit`/`Write`/`NotebookEdit` of a `.md`/`.markdown` file inside the root is a
  markdown edit, other files inside the root are file edits, `Bash`/`PowerShell`/`Task`/`KillShell`
  are commands, `WebFetch`/`WebSearch` are web, anything else, including an edit outside the root
  and MCP tools, is other).
- The gateway (`ai/gateway.rs`) applies `ai/policy.rs` `decide(kind, settings)` before a request
  reaches the frontend: **Ask** forwards it, **Allow** and **Deny** answer it at once and emit the
  outcome with its reason ("allowed by your settings", "denied by your settings") so the
  transcript shows it. A read-only operation denies every request whatever the settings.
- The five rules live in `settings.json` (`ai.permissions`), all **Ask** by default; the settings
  page warns next to **Allow** for commands and non-markdown edits. The CLI runs with
  `--permission-mode default` explicitly so a default mode in the user's CLI settings (for
  example `acceptEdits`) cannot bypass the app's policy.

### What the app cannot enforce: the CLI's own allow rules

Allow rules in the user's `~/.claude/settings.json` or the project's `.claude/settings.json` (for
example `Bash(npm test)`) let the CLI run those tools without prompting, so the app's policy never
sees them. They are accepted (plan §15 Q9): they are the user's explicit choices for that folder,
and every tool call still appears in the chat as a `ToolUse` event, so nothing runs invisibly.
Running the CLI with `--settings` pointing at an app-controlled file would neutralize them but
would also drop the user's other settings; a strict mode can be revisited if users ask for it.
The feature page documents the limitation.

### Conversation history owned by the app

- The **CLI's transcript is the resume source**: the provider passes the session id back with
  `--resume`, so the model keeps its full context.
- The **app keeps its own readable copy** per folder in the app-data folder
  (`appdata/conversations.rs`: `conversations/index.json` maps the canonical root to a file,
  `c0001.json` holds that folder's conversations), written once per operation end, trimmed to
  `ai.historyLimit` conversations and 400 items each, never inside the opened folder. It is
  provider-neutral, readable without the provider, and survives a deleted CLI session; sending
  into a conversation whose CLI session is gone shows the CLI's error and offers to start a new
  conversation from the app's copy (plan §3.8).
- The model is remembered globally (`settings.ai.model`); each conversation records the model it
  ran with.

### Chat as an in-page floating panel

The chat is a draggable, resizable panel inside the main window, its geometry remembered and
clamped to the window, not a second Tauri window (plan §15 Q1). One webview keeps the stores
shared; the inline review and region capture need the main document; no second capability set
is needed; and it behaves the same on Windows and Linux, where a second window on Wayland cannot
be positioned by the app.

### Partial accept through the provider's tool input

The frontend sends `Allow { updatedEdit }` with the accepted hunks (or, for a `Write`, the
content composed from the accepted groups); it never builds a tool input. The provider maps it
(`protocol::tool_input_for`): `Edit` → `old_string`/`new_string` of its single hunk;
`MultiEdit` → the `edits` array filtered to the accepted hunks in their original order (a hunk
that was never proposed is refused, not invented); `Write` → `content` replaced by the composed
content. An update that cannot be expressed (no hunk, two hunks for an `Edit`) is answered as a
deny with the standard rejection message. The app never edits a file itself.

**Result on Windows 11, Claude Code 2.1.310, model `haiku`** (ignored tests in
`src-tauri/src/ai/providers/claude_cli/turn.rs`):

| Case | Tool the CLI used | Result |
|---|---|---|
| Two-place change in a markdown file, one hunk accepted (`partial_accept_writes_only_the_accepted_hunk`) | two `Edit` calls (asked for one call "MultiEdit if you have it", the model chose two `Edit`s) | the first `Edit` allowed with an `updatedInput` whose `new_string` differs from the proposal, the second denied: the file holds the **`updatedInput` text** for the first place and the original text for the second |
| `Write` allowed with composed content (`write_runs_with_the_composed_content`) | `Write` | the file holds the **composed content**, not the proposed one |

`updatedInput` is **honoured on CLI 2.1.310 for `Edit` and `Write`, so no fallback is needed**.
The `MultiEdit` mapping is covered by unit tests only, since the model did not use it here. The
fallback planned in plan §12 (deny with a message listing the accepted hunks and asking the model
to propose exactly those) is not implemented; if a later CLI version ignores `updatedInput`, the
ignored tests fail on the file contents and the fallback is added then.

## Consequences

- The policy is provider-neutral and fully unit-tested; a new provider only has to classify its
  tools into the five kinds.
- The app depends on the CLI running the input it sends back. The ignored tests are the check to
  rerun on each CLI version used for a release (with the Linux run of ADR 0014).
- Two copies of a conversation exist (the CLI's and the app's); they can diverge only in what the
  app chose to summarize (tool results are stored as short summaries), never in the model's context.
- The floating panel shares the window with the document, so geometry must be clamped on every
  resize; a detachable window remains possible later without changing the stores.
