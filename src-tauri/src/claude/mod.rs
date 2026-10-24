//! Claude integration (proof of concept, ADR 0014).
//!
//! The user's installed `claude` CLI is spawned as a subprocess, one process per turn, with the
//! opened folder as working directory. It streams `stream-json` messages on stdout, which are
//! forwarded to the frontend as events; permission prompts come back on the same stream as
//! `control_request` messages (`--permission-prompt-tool stdio`) and the UI's decision is written
//! to the CLI's stdin as a `control_response`.

pub mod cli;
pub mod turn;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const EVENT_MESSAGE: &str = "claude://message";
pub const EVENT_PERMISSION: &str = "claude://permission";
pub const EVENT_TURN_END: &str = "claude://turn-end";

/// Whether the CLI can be used, and why not.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClaudeStatus {
    pub installed: bool,
    /// Resolved path of the executable, when found.
    pub path: Option<String>,
    /// E.g. `2.1.310`.
    pub version: Option<String>,
    pub logged_in: bool,
    pub email: Option<String>,
    /// E.g. `max`, `pro`, `team`.
    pub subscription: Option<String>,
    /// What prevents using Claude, in plain language (absent when usable).
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, optional_fields)]
pub struct ClaudeTurnRequest {
    pub prompt: String,
    /// CLI alias (`opus`, `sonnet`, `haiku`) or a full model id; the CLI default when absent.
    pub model: Option<String>,
    /// Session id of a previous turn to continue (`--resume`).
    pub resume_session_id: Option<String>,
}

/// One `stream-json` object printed by the CLI, forwarded as is.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClaudeMessageEvent {
    pub turn_id: u32,
    pub message: serde_json::Value,
}

/// The CLI asks whether a tool may run; the UI answers with `claude_respond_permission`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClaudePermissionEvent {
    pub turn_id: u32,
    pub request_id: String,
    pub tool_name: String,
    pub input: serde_json::Value,
    /// Short description from the CLI (e.g. the file name for an edit).
    pub description: Option<String>,
}

/// The UI's answer to a permission request, in the shape the CLI expects.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(tag = "behavior", rename_all = "camelCase")]
#[ts(export)]
pub enum ClaudePermissionDecision {
    #[serde(rename_all = "camelCase")]
    Allow {
        /// The tool input to run with (the original one, or an edited version).
        updated_input: serde_json::Value,
    },
    #[serde(rename_all = "camelCase")]
    Deny {
        /// Shown to the model as the tool result, so it knows why.
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum ClaudeTurnOutcome {
    /// The CLI printed its `result` and exited normally.
    Completed,
    /// Stopped by the user.
    Cancelled,
    /// The process exited without a `result` or with a failure code.
    Crashed,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClaudeTurnEndEvent {
    pub turn_id: u32,
    pub outcome: ClaudeTurnOutcome,
    pub exit_code: Option<i32>,
    /// The last lines the CLI wrote on stderr, to explain a crash.
    pub stderr: Option<String>,
}
