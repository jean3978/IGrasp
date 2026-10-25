//! AI commands: the only way the frontend reaches a provider, through the gateway. Every start
//! names the user action that pays for it.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai::context::{self, Caps};
use crate::ai::estimate::estimate;
use crate::ai::types::{
    AiCapabilities, AiContextDocument, AiEstimateInput, AiEventEnvelope, AiProviderInfo,
    AiProviderStatus, AiSizeEstimate, AiStartRequest, AiUserAction, PermissionDecision,
};
use crate::appdata::conversations::{Conversation, ConversationSummary};
use crate::appdata::settings::Settings;
use crate::commands::appdata::notify_recovered;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const EVENT_AI: &str = "ai://event";

/// Whether the active provider is installed and signed in. Runs the provider's probes, so it
/// may take a second; never spends tokens. A check younger than a minute is reused unless
/// `force` ("Check again").
#[tauri::command]
pub async fn ai_status(app: AppHandle, force: Option<bool>) -> AppResult<AiProviderStatus> {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().ai.status(force))
        .await
        .map_err(|e| AppError::Ai(format!("The status check failed: {e}")))
}

/// The providers the "AI provider" setting offers (no probe, no token).
#[tauri::command]
pub fn ai_providers() -> Vec<AiProviderInfo> {
    crate::ai::provider_infos()
}

/// Switches the AI provider and records it in the settings. Refused while an operation runs.
#[tauri::command]
pub fn ai_set_provider(state: State<'_, AppState>, id: String) -> AppResult<Settings> {
    state.ai.set_provider(&id)?;
    state.appdata.update_settings(|s| s.ai.provider = id)
}

#[tauri::command]
pub fn ai_capabilities(state: State<'_, AppState>) -> AiCapabilities {
    state.ai.capabilities()
}

/// What the next message would carry for `current_path` (the active document or code file):
/// the provider's instruction files from the root down, then the current file. Paths, roles and
/// sizes only; the contents are read when the message is sent. Never calls the provider.
#[tauri::command]
pub fn ai_context(
    state: State<'_, AppState>,
    current_path: Option<String>,
) -> AppResult<Vec<AiContextDocument>> {
    let names = state.ai.capabilities().context_file_names;
    state.with_workspace(|ws| {
        context::collect(&ws.guard, current_path.as_deref(), &names, Caps::default())
    })
}

/// The approximate size of a message, from file metadata (nothing is read).
#[tauri::command]
pub fn ai_estimate(
    state: State<'_, AppState>,
    input: AiEstimateInput,
) -> AppResult<AiSizeEstimate> {
    let names = state.ai.capabilities().context_file_names;
    let documents = state.with_workspace(|ws| {
        context::documents(
            &ws.guard,
            &input.context_paths,
            &names,
            Caps::default(),
            false,
        )
    })?;
    Ok(estimate(input.prompt_bytes, &documents, input.images))
}

/// Starts an operation in the open folder for `action` and returns its id. Its events arrive
/// as `ai://event`, ending with `done`. The context documents are read here, through the root
/// guard, from the paths the frontend kept.
#[tauri::command]
pub fn ai_start(
    app: AppHandle,
    state: State<'_, AppState>,
    action: AiUserAction,
    request: AiStartRequest,
) -> AppResult<u32> {
    let names = state.ai.capabilities().context_file_names;
    let (root, request) = state.with_workspace(|ws| {
        Ok((
            ws.guard.root().to_path_buf(),
            context::request_from(&ws.guard, &names, request)?,
        ))
    })?;
    // The permission settings of this moment: a later change never alters this operation.
    let permissions = state.appdata.settings()?.ai.permissions;
    state.ai.start(
        action,
        request,
        &root,
        permissions,
        Box::new(move |operation_id, event| {
            if let Err(e) = app.emit(
                EVENT_AI,
                AiEventEnvelope {
                    operation_id,
                    event,
                },
            ) {
                log::warn!("cannot emit {EVENT_AI}: {e}");
            }
        }),
    )
}

/// Answers a `permissionRequest` event of the running operation.
#[tauri::command]
pub fn ai_respond_permission(
    state: State<'_, AppState>,
    operation_id: u32,
    request_id: String,
    decision: PermissionDecision,
) -> AppResult<()> {
    state.ai.respond(operation_id, &request_id, &decision)
}

/// Stops the running operation (idempotent); a `done` event with `Cancelled` follows.
#[tauri::command]
pub fn ai_cancel(state: State<'_, AppState>, operation_id: u32) -> AppResult<()> {
    state.ai.cancel(operation_id);
    Ok(())
}

/// The key of the open folder's conversations: its canonical path.
fn root_key(state: &AppState) -> AppResult<String> {
    state.with_workspace(|ws| Ok(ws.guard.root().display().to_string()))
}

/// The conversations of the open folder, newest first. Reads app data only.
#[tauri::command]
pub fn list_conversations(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<ConversationSummary>> {
    let list = state.appdata.list_conversations(&root_key(&state)?);
    notify_recovered(&app, &state.appdata);
    list
}

#[tauri::command]
pub fn get_conversation(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Conversation> {
    let conversation = state.appdata.get_conversation(&root_key(&state)?, &id);
    notify_recovered(&app, &state.appdata);
    conversation
}

/// Adds or replaces a conversation of the open folder, trimmed to the history limit.
#[tauri::command]
pub fn save_conversation(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation: Conversation,
) -> AppResult<()> {
    let limit = state.appdata.settings()?.ai.history_limit as usize;
    let saved = state
        .appdata
        .save_conversation(&root_key(&state)?, conversation, limit);
    notify_recovered(&app, &state.appdata);
    saved
}

/// Deletes every conversation of the open folder (Settings → "Forget this folder's
/// conversations").
#[tauri::command]
pub fn forget_conversations(state: State<'_, AppState>) -> AppResult<()> {
    state.appdata.forget_conversations(&root_key(&state)?)
}

#[tauri::command]
pub fn delete_conversation(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.appdata.delete_conversation(&root_key(&state)?, &id)
}
