//! Provider-neutral contracts shared by every AI provider, the gateway and the frontend
//! (ADR 0015). Nothing here names a provider, a CLI flag or a wire format.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Whether a provider can be used right now, and how to fix it when it cannot.
#[derive(Debug, Clone, Default, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiProviderStatus {
    /// Stable id, e.g. `claude-cli`.
    pub provider_id: String,
    /// Shown in the UI, e.g. `Claude`.
    pub display_name: String,
    pub installed: bool,
    pub logged_in: bool,
    pub version: Option<String>,
    /// The signed-in account, when the provider reports one.
    pub account: Option<String>,
    /// Subscription or plan, when reported.
    pub plan: Option<String>,
    /// What prevents using the provider, in plain language (absent when usable).
    pub problem: Option<String>,
    /// Provider-specific instructions to fix `problem` (install command, login command).
    pub help: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiModel {
    /// What the provider accepts, e.g. an alias or a full model id.
    pub id: String,
    pub label: String,
}

/// What a provider supports; the UI adapts to these instead of checking provider names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiCapabilities {
    pub streaming: bool,
    /// Continuing a conversation with `AiRequest::resume_id`.
    pub resume: bool,
    /// `AiRequest::output_schema` is honoured.
    pub structured_output: bool,
    pub image_input: bool,
    /// Tool calls can be approved or refused through `AiEvent::PermissionRequest`.
    pub permission_prompts: bool,
    /// `AiPolicy::ReadOnly` is enforced by the provider.
    pub read_only_mode: bool,
    pub usage_reporting: bool,
    pub cost_reporting: bool,
    /// Suggested models; the UI may also accept a free-text id.
    pub models: Vec<AiModel>,
    /// Instruction files the provider loads on its own (e.g. `CLAUDE.md`, `AGENTS.md`).
    pub context_file_names: Vec<String>,
}

/// The user action that pays for an operation. Every call into a provider names one
/// (rule 1 of the AI integration principles: no token without a user action).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AiUserAction {
    ChatMessage,
    RegionCapture,
    QuizGeneration,
    TutorialGeneration,
    TutorialReview,
}

/// What the AI may do during the operation.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AiPolicy {
    /// Tools that change something ask through a permission prompt.
    #[default]
    Interactive,
    /// Read, list and search files only; never edit, run commands or browse.
    ReadOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiImage {
    /// E.g. `image/png`.
    pub media_type: String,
    pub data_base64: String,
}

/// One bounded operation started by a user action.
#[derive(Debug, Clone, Default, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, optional_fields)]
pub struct AiRequest {
    pub prompt: String,
    /// A model id or alias the provider accepts; the provider's default when absent.
    pub model: Option<String>,
    /// Continues the conversation that announced this id in `AiEvent::Session`.
    pub resume_id: Option<String>,
    /// Root-relative files the AI should read for context (e.g. the open document).
    pub context_files: Vec<String>,
    pub images: Vec<AiImage>,
    pub policy: AiPolicy,
    /// JSON schema the final answer must follow, when the provider supports it.
    pub output_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditHunk {
    /// Text to replace (empty for new content).
    pub old_text: String,
    pub new_text: String,
}

/// A change to a file the AI asks permission for, extracted from its tool call so the UI can
/// show a diff without knowing the tool. Also the shape of a partial acceptance
/// (`PermissionDecision::Allow { updated_edit }`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProposedEdit {
    /// Root-relative with `/` when inside the opened folder, else the path as given.
    pub path: String,
    pub is_markdown: bool,
    /// The file is created or fully rewritten (`hunks` holds the whole new content).
    pub whole_file: bool,
    pub hunks: Vec<EditHunk>,
}

/// What a permission request would let the AI do. The policy and the UI key on this, never on
/// a tool name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AiPermissionKind {
    /// Edit or create a markdown file inside the folder (reviewed as a diff).
    MarkdownEdit,
    /// Edit or create any other file inside the folder.
    FileEdit,
    /// Run a command or a script.
    Command,
    /// Fetch a URL or search the web.
    Web,
    /// Read outside the folder, or anything the provider cannot classify.
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum AiOutcome {
    Completed,
    Cancelled,
    /// The provider stopped without finishing (process crash, transport error).
    Failed,
}

/// The provider-neutral event stream of an operation. Ends with exactly one `Done`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum AiEvent {
    /// The conversation can be continued later with `resume_id`.
    #[serde(rename_all = "camelCase")]
    Session { resume_id: String, model: String },
    /// A piece of the answer as it is produced.
    TextDelta { text: String },
    /// A complete block of the answer; replaces the deltas streamed before it.
    Text { text: String },
    #[serde(rename_all = "camelCase")]
    ToolUse {
        tool_id: String,
        tool: String,
        /// One line describing the call, e.g. `Edit docs/plan.md`.
        summary: String,
        input: serde_json::Value,
    },
    #[serde(rename_all = "camelCase")]
    ToolResult {
        tool_id: String,
        content: String,
        is_error: bool,
    },
    /// A tool waits for the user; answer with the gateway's `respond`.
    #[serde(rename_all = "camelCase")]
    PermissionRequest {
        request_id: String,
        tool: String,
        /// What the tool would do; the policy and the UI key on this.
        kind: AiPermissionKind,
        description: Option<String>,
        input: serde_json::Value,
        proposed_edit: Option<ProposedEdit>,
    },
    /// A permission request answered without asking (by the settings or the read-only policy):
    /// the transcript shows every automatic decision.
    #[serde(rename_all = "camelCase")]
    #[allow(
        dead_code,
        reason = "emitted by the gateway's permission policy (next step)"
    )]
    PermissionDecided {
        tool: String,
        kind: AiPermissionKind,
        /// The request's description (the file, the command), when it had one.
        description: Option<String>,
        allowed: bool,
        /// Why, in a few words, e.g. `allowed by your settings`.
        reason: String,
    },
    #[serde(rename_all = "camelCase")]
    Usage {
        input_tokens: u64,
        output_tokens: u64,
        cost_usd: Option<f64>,
        duration_ms: u64,
    },
    /// An error the provider reported inside the conversation (not logged in, unknown model).
    Error { message: String },
    #[serde(rename_all = "camelCase")]
    Done {
        outcome: AiOutcome,
        /// Exit code, stderr tail or transport error, when there is something to say.
        detail: Option<String>,
    },
}

/// `ai://event` payload.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiEventEnvelope {
    pub operation_id: u32,
    pub event: AiEvent,
}

/// What the model is told when the user rejects a tool call.
pub const REJECTED_BY_USER: &str = "The user rejected this in IGrasp.";

/// The user's answer to a permission request.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, TS)]
#[serde(tag = "behavior", rename_all = "camelCase")]
#[ts(export)]
pub enum PermissionDecision {
    #[serde(rename_all = "camelCase")]
    Allow {
        /// Run the tool on these hunks only: a subset of the proposed edit, or the whole-file
        /// content composed by the user. The provider maps it back to its own tool input; the
        /// frontend never builds a tool input. Absent: run the tool as proposed.
        #[serde(default)]
        updated_edit: Option<ProposedEdit>,
    },
    #[serde(rename_all = "camelCase")]
    Deny {
        /// Shown to the model as the tool result, so it knows why.
        message: String,
    },
}
