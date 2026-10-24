//! AI commands: the only way the frontend reaches a provider, through the gateway. Every start
//! names the user action that pays for it.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai::context::{self, Caps};
use crate::ai::estimate::estimate;
use crate::ai::types::{
    AiCapabilities, AiContextDocument, AiEstimateInput, AiEventEnvelope, AiProviderStatus,
    AiSizeEstimate, AiStartRequest, AiUserAction, PermissionDecision,
};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const EVENT_AI: &str = "ai://event";

/// Whether the active provider is installed and signed in. Runs the provider's probes, so it
/// may take a second; never spends tokens.
#[tauri::command]
pub async fn ai_status(app: AppHandle) -> AppResult<AiProviderStatus> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().ai.status())
        .await
        .map_err(|e| AppError::Ai(format!("The status check failed: {e}")))
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
