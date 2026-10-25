//! Provider-neutral contracts shared by every AI provider, the gateway and the frontend
//! (ADR 0015). Nothing here names a provider, a CLI flag or a wire format.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::learning::quiz::QuizGenerationInput;

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
    /// One line the provider gives about it (shown as a tooltip), if any.
    pub description: Option<String>,
    /// This model accepts images.
    pub image_input: bool,
}

/// A provider the "AI provider" setting can choose (no probe, no token).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiProviderInfo {
    pub id: String,
    pub display_name: String,
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

/// Why a document is part of the context.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AiContextRole {
    /// The document or code file the user is looking at.
    CurrentFile,
    /// An instruction file the provider declares (e.g. `AGENTS.md`), from the root down to the
    /// current file's folder.
    InstructionFile,
    /// The source of a region the user captured.
    Capture,
}

/// A document the user is looking at, sent with a message. The frontend only ever receives it
/// without `content` (paths, roles and sizes to show); the backend reads the content when the
/// message is sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiContextDocument {
    /// Root-relative with `/`.
    pub path: String,
    pub role: AiContextRole,
    /// The text, when it was read and is small enough to inline.
    pub content: Option<String>,
    pub bytes: u64,
    /// Too large to inline: the provider asks the model to read the path itself.
    pub truncated: bool,
}

/// A part of a document the user selected on screen: highlighted text, or a region dragged over
/// the view.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiCapture {
    /// Root-relative path of the captured document.
    pub source_path: String,
    /// 1-based, inclusive source lines of the selected blocks.
    pub first_line: u32,
    pub last_line: u32,
    /// The markdown (or code) source of those lines.
    pub text: String,
    /// The text exactly as the user highlighted it in the rendered view; a region has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub selection: Option<String>,
}

/// One bounded operation started by a user action, as the provider receives it.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct AiRequest {
    pub prompt: String,
    /// A model id or alias the provider accepts; the provider's default when absent.
    pub model: Option<String>,
    /// Continues the conversation that announced this id in `AiEvent::Session`.
    pub resume_id: Option<String>,
    /// What the user is looking at: instruction files from the root down, then the current
    /// file, with their contents when small enough (`ai::context`).
    pub context: Vec<AiContextDocument>,
    pub capture: Option<AiCapture>,
    pub images: Vec<AiImage>,
    pub policy: AiPolicy,
    /// JSON schema the final answer must follow, when the provider supports it.
    pub output_schema: Option<serde_json::Value>,
}

/// What the frontend sends to start an operation: the context as paths (the ones still listed
/// for this message); the backend reads them through the root guard.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, optional_fields)]
pub struct AiStartRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub resume_id: Option<String>,
    /// Root-relative paths from `ai_context`, in its order.
    pub context_paths: Vec<String>,
    pub capture: Option<AiCapture>,
    pub images: Vec<AiImage>,
    pub policy: AiPolicy,
    pub output_schema: Option<serde_json::Value>,
    /// For `QuizGeneration`: what the user chose. The backend composes the prompt and the schema
    /// and ignores `prompt`, `context_paths`, `capture`, `images`, `policy` and `output_schema`.
    pub quiz: Option<QuizGenerationInput>,
}

/// The size class of an operation, for the confirmation card.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AiSizeBucket {
    Small,
    Medium,
    Large,
}

/// A document a generation inlines in its prompt, for the confirmation card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiInlinedDocument {
    /// Root-relative with `/`.
    pub path: String,
    pub bytes: u64,
    /// Read for context only (an agent instruction file), never a source.
    pub context_only: bool,
}

/// An approximate size of what an operation sends (`ai::estimate`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AiSizeEstimate {
    pub bytes: u64,
    pub approx_tokens: u64,
    pub bucket: AiSizeBucket,
    pub documents: u32,
    pub images: u32,
    /// The documents a generation inlines in its prompt (a quiz: anchor files, agent files as
    /// context); empty for a chat message, whose context the chat lists itself.
    pub inlined: Vec<AiInlinedDocument>,
}

/// What `ai_estimate` measures: metadata only, nothing is read.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AiEstimateInput {
    /// UTF-8 bytes of the prompt (and of the capture text, if any).
    pub prompt_bytes: u64,
    pub context_paths: Vec<String>,
    pub images: u32,
    /// A quiz generation to measure (the inlined set the backend composes).
    #[ts(optional)]
    pub quiz: Option<QuizGenerationInput>,
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
    /// The final answer of an operation started with `AiRequest::output_schema`. In a validated
    /// operation (`ai::run`), only the accepted answer is emitted, once, before `Done`.
    StructuredOutput { value: serde_json::Value },
    /// A validated operation starts another attempt (a retry with a repair prompt), `number` of
    /// `of`, because of `reason` (plain language, for the user).
    Attempt {
        number: u32,
        of: u32,
        reason: String,
    },
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
