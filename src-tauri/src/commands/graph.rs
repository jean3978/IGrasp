//! Queries on the document graph: link status, backlinks, broken links.

use tauri::State;

use crate::error::AppResult;
use crate::graph::GraphStatus;
use crate::state::AppState;

/// Progress of the graph build and the number of broken links (the status bar asks on startup,
/// since it may have missed the events).
#[tauri::command]
pub fn get_graph_status(state: State<'_, AppState>) -> AppResult<GraphStatus> {
    state.with_workspace(|ws| {
        let graph = ws.graph.read().unwrap_or_else(|e| e.into_inner());
        Ok(graph.status(ws.generation))
    })
}
