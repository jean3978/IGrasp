//! Claude commands (proof of concept): status check, one turn at a time, permission answers.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::claude::turn::{self, EventSink, TurnEvent};
use crate::claude::{
    ClaudeMessageEvent, ClaudePermissionDecision, ClaudePermissionEvent, ClaudeStatus,
    ClaudeTurnEndEvent, ClaudeTurnRequest, EVENT_MESSAGE, EVENT_PERMISSION, EVENT_TURN_END, cli,
};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

fn emit<T: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(e) = app.emit(event, payload) {
        log::warn!("cannot emit {event}: {e}");
    }
}

/// Whether the `claude` CLI is installed and logged in. Runs the CLI, so it takes a second.
#[tauri::command]
pub async fn claude_status() -> AppResult<ClaudeStatus> {
    tauri::async_runtime::spawn_blocking(cli::status)
        .await
        .map_err(|e| AppError::Claude(format!("The status check failed: {e}")))
}

/// Starts a turn in the open folder and returns its id. Messages arrive as `claude://message`,
/// permission prompts as `claude://permission`, and `claude://turn-end` closes the turn.
#[tauri::command]
pub fn claude_start_turn(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ClaudeTurnRequest,
) -> AppResult<u32> {
    let root = state.with_workspace(|ws| Ok(ws.guard.root().to_path_buf()))?;
    let exe = cli::locate().ok_or_else(|| AppError::Claude(cli::NOT_INSTALLED.to_owned()))?;
    let mut slot = state.claude.lock().unwrap_or_else(|e| e.into_inner());
    if slot.as_ref().is_some_and(|t| !t.is_done()) {
        return Err(AppError::Claude(
            "Claude is still answering; stop it first.".to_owned(),
        ));
    }
    let id = state.next_claude_turn();
    let sink: EventSink = Box::new(move |event| match event {
        TurnEvent::Message(message) => {
            emit(
                &app,
                EVENT_MESSAGE,
                ClaudeMessageEvent {
                    turn_id: id,
                    message,
                },
            );
        }
        TurnEvent::Permission(request) => emit(
            &app,
            EVENT_PERMISSION,
            ClaudePermissionEvent {
                turn_id: id,
                request_id: request.request_id,
                tool_name: request.tool_name,
                input: request.input,
                description: request.description,
            },
        ),
        TurnEvent::End {
            outcome,
            exit_code,
            stderr,
        } => {
            {
                let state = app.state::<AppState>();
                let mut slot = state.claude.lock().unwrap_or_else(|e| e.into_inner());
                if slot.as_ref().is_some_and(|t| t.id == id) {
                    slot.take();
                }
            }
            emit(
                &app,
                EVENT_TURN_END,
                ClaudeTurnEndEvent {
                    turn_id: id,
                    outcome,
                    exit_code,
                    stderr,
                },
            );
        }
    });
    *slot = Some(turn::start(&exe, &root, &request, id, sink)?);
    Ok(id)
}

/// Answers a `claude://permission` request of the running turn.
#[tauri::command]
pub fn claude_respond_permission(
    state: State<'_, AppState>,
    turn_id: u32,
    request_id: String,
    decision: ClaudePermissionDecision,
) -> AppResult<()> {
    let slot = state.claude.lock().unwrap_or_else(|e| e.into_inner());
    match slot.as_ref() {
        Some(turn) if turn.id == turn_id => turn.respond(&request_id, &decision),
        _ => Err(AppError::Claude("This Claude turn is over.".to_owned())),
    }
}

/// Stops the running turn (idempotent); `claude://turn-end` follows with `Cancelled`.
#[tauri::command]
pub fn claude_cancel(state: State<'_, AppState>, turn_id: u32) -> AppResult<()> {
    let slot = state.claude.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(turn) = slot.as_ref()
        && turn.id == turn_id
    {
        turn.cancel();
    }
    Ok(())
}
