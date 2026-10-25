# 0014 — Claude integration through the `claude` CLI and its `stream-json` protocol

- Status: Accepted, Linux verification pending (the Linux run was deferred in Phase 3, 0.3.0; Windows 11 is verified). Lives behind the provider abstraction of [ADR 0015](0015-ai-provider-abstraction-and-gateway.md). The model list comes from the CLI's `initialize` control request ([ADR 0020](0020-viewport-ai-tools-and-text-selections.md)).
- Date: 2026-10-24

## Context

Phase 3 brings a Claude chat into IGrasp. The specification rules out bundling an API client:
Claude runs through the user's installed Claude Code CLI, with the user's own login, in the
opened folder, so that it behaves exactly like opening `claude` in a terminal there (CLAUDE.md
files, settings, MCP servers), except for the app's stricter permission defaults. Three things
had to be proven before planning the phase: streaming a conversation out of the CLI, routing its
**permission prompts** to the app so a proposed markdown edit can be accepted or rejected in a
diff, and surviving the failure modes (CLI missing, not logged in, crash, cancel) on Windows and
Linux.

The proof of concept was built against Claude Code **2.1.310**.

## Decision

### One process per turn, `--resume` between turns

Each user message spawns

```text
claude -p --output-format stream-json --input-format stream-json --verbose
       --include-partial-messages --permission-prompt-tool stdio
       [--model <alias or id>] [--resume <session id>]
```

with the opened folder as working directory. The message is written to stdin as a
`{"type":"user","message":{"role":"user","content":…}}` line; the CLI prints one JSON object per
line on stdout (`system/init` with the session id, `assistant`, `user` tool results, `result`),
which the provider translates into neutral `AiEvent`s (`protocol.rs`) forwarded as `ai://event`. The session id of the first turn is
passed back with `--resume` for the next ones, so a conversation survives a cancelled or crashed
turn, and the CLI (not the app) owns the transcript. A long-lived process would avoid the
start-up cost of each turn (about one second) but would make cancel and crash recovery harder;
the per-turn process is the simplest thing that works and can be revisited.

### Permissions over stdio, not over an MCP server

`--permission-prompt-tool` normally names an MCP tool, which would have forced IGrasp to run an
MCP server (HTTP on localhost, or a helper process) just to receive prompts. The CLI also
accepts the value `stdio`, the mode the Agent SDK uses: with `--input-format stream-json`, a
permission prompt arrives on stdout as

```json
{"type":"control_request","request_id":"…","request":{"subtype":"can_use_tool",
 "tool_name":"Edit","input":{"file_path":"…","old_string":"…","new_string":"…"},
 "description":"notes.md","permission_suggestions":[…]}}
```

and the app answers on stdin with
`{"type":"control_response","response":{"subtype":"success","request_id":"…","response":
{"behavior":"allow","updatedInput":{…}}}}` or `{"behavior":"deny","message":"…"}`. The provider turns the
request into an `AiEvent::PermissionRequest` (with the proposed edit extracted from the tool
input) and the gateway's `respond` writes the answer.
Stdin stays open until the CLI prints its `result`, so a late answer still reaches it; if stdin
closes while a prompt is pending, the CLI denies the tool itself ("Tool permission stream
closed") and finishes the turn, which is a safe default. Control requests of a kind the app does
not understand are refused with an error response so the CLI never waits forever.

The flag is not listed in `claude --help` (only mentioned by `--permission-prompts`), so this
relies on a documented-but-hidden option; the Agent SDK uses the same path, which makes it
unlikely to disappear without notice. Every protocol shape the app depends on is recorded in
tests (`src-tauri/src/ai/providers/claude_cli/{turn,protocol}.rs`) so a CLI update
that changes them is caught.

### The permission model is the CLI's default

The proof of concept runs the CLI with its default permission mode: reading files inside the
folder needs no prompt; `Edit`, `Write`, `MultiEdit`, `Bash` and the other tools prompt. The app
shows an `Edit`/`Write`/`MultiEdit` of a `.md`/`.markdown` file as a line diff with **Accept**
and **Reject**, and every other prompt as the tool name and its input with **Allow** and **Deny**.
A rejection is sent as a deny with a message the model sees ("The user rejected this in IGrasp."),
so it stops instead of retrying. The specification's finer defaults (settings for what is
pre-approved) will build on the same hook.

### Process control

- `claude` is located with the `which` crate (honouring `PATHEXT` on Windows), falling back to
  the installer's usual locations (`~/.local/bin`, `%APPDATA%\npm`, `~/.claude/local`, …) because
  an app launched from a desktop menu often has a shorter `PATH` than a terminal.
- `claude --version` and `claude auth status` (JSON, exit code 1 when logged out) give the status
  shown in the chat, with a **Check again** button. A login that expires between the check and a
  message surfaces as the CLI's own error result ("Not logged in · Please run /login"), shown as
  an error.
- Cancel kills the whole process tree: `taskkill /T /F` on Windows, `kill -TERM -- -<pgid>` on
  Unix where the child is started in its own process group. Killing only the direct child is not
  enough on Windows when a shell wrapper is involved (verified: the CLI kept running and even
  completed the edit after its parent `cmd.exe` died), hence spawning the executable directly and
  killing the tree.
- A process that exits without printing a `result` is reported as a crash with its exit code and
  the last lines of stderr. On Windows, every spawned process gets `CREATE_NO_WINDOW` so no
  console flashes.
- Closing the folder cancels the running turn; dropping the turn kills the process.

## Results of the proof of concept

Verified on **Windows 11** with the real CLI (model `haiku`) through the `#[ignore]` tests (two in the proof of concept, two more in Phase 3) in
`src-tauri/src/ai/providers/claude_cli/turn.rs` (`cargo test --manifest-path src-tauri/Cargo.toml --
--ignored claude_cli::`), by shell probes of the protocol, and in the app (launch; the chat itself is driven end
to end by Playwright against the production build with the scripted CLI, and by Vitest).

| Case | Windows 11 | Linux |
|---|---|---|
| Stream a turn, capture the session id, `--resume` it | ✔ | not run |
| Permission prompt → deny → file untouched, turn completes | ✔ | not run |
| Permission prompt → allow → file edited | ✔ | not run |
| Cancel with a prompt pending → process tree gone, `Cancelled` event | ✔ (`taskkill /T`) | not run (`process_group` + `kill -- -pgid`) |
| Partial accept of a two-place change → only the accepted hunk on disk (`updatedInput` honoured for `Edit`; Phase 3, [ADR 0019](0019-permission-policy-history-and-floating-chat.md)) | ✔ (2.1.310) | not run |
| `Write` allowed with composed content → the composed content on disk (Phase 3) | ✔ (2.1.310) | not run |
| CLI not installed → clear message | ✔ | not run |
| Not logged in (`CLAUDE_CONFIG_DIR` pointing at an empty folder) → clear message | ✔ | not run |
| Wrong model name → the CLI's error result is shown | ✔ | not run |

**Linux was not verified, and the run was deferred past Phase 3 (0.3.0)**: the development machine has neither WSL nor a running Docker engine,
so no Linux environment with the CLI was available. The Linux-specific code is small and
conventional (`which` on `PATH`, the `~/.local/bin` fallback, a process group per child and
`kill -TERM -- -<pgid>` on cancel), and the protocol itself is platform-independent, but the
table above must be completed on a Linux machine: run the ignored tests there and the not-installed / not-logged-in probes. CI runs the non-ignored tests
on Ubuntu on every push.

## Consequences and limitations

- The app depends on an undocumented-but-SDK-used protocol; a CLI update can break it. The
  protocol tests and a visible CLI version in the chat make a break easy to spot, and the chat
  degrades to the CLI's own error messages.
- Each turn pays the CLI start-up (~1 s before the first token). Acceptable for a chat; a
  long-lived process with `stream-json` input would remove it if it ever matters.
- Permission prompts are **modal for the CLI**: it waits for the answer (or for stdin to close).
  The app must always answer, including when the dialog is closed; closing the folder cancels
  the turn for that reason.
- `--include-partial-messages` gives token-level streaming (`TextDelta`); the complete
  `assistant` message that follows becomes a `Text` event that replaces the streamed text, so
  the UI never shows a stale partial.
- A `Write` of a markdown file used to be shown as all-new content; since Phase 3 it is compared
  with the current file in the rendered diff ([ADR 0017](0017-rendered-markdown-diff-at-block-level.md)).
- The CLI's permission suggestions (`permission_suggestions`, e.g. "accept edits for this
  session") are still ignored: the app's permission settings and "Allow for this conversation"
  rules replace them ([ADR 0019](0019-permission-policy-history-and-floating-chat.md)).
- Chat history, model persistence, instruction-file context and region capture, left out of the
  proof of concept, were delivered in Phase 3 (ADR 0019, [ADR 0018](0018-region-capture-by-dom-rendering.md),
  [the feature page](../features/ai-chat.md)).
