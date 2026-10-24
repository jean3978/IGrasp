//! AI commands: the only way the frontend reaches a provider, through the gateway. Every start
//! names the user action that pays for it.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai::types::{
    AiCapabilities, AiEventEnvelope, AiProviderStatus, AiRequest, AiUserAction, PermissionDecision,
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

/// Starts an operation in the open folder for `action` and returns its id. Its events arrive
/// as `ai://event`, ending with `done`.
#[tauri::command]
pub fn ai_start(
    app: AppHandle,
    state: State<'_, AppState>,
    action: AiUserAction,
    request: AiRequest,
) -> AppResult<u32> {
    let root = state.with_workspace(|ws| Ok(ws.guard.root().to_path_buf()))?;
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
