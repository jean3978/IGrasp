//! Search commands.

use tauri::State;

use crate::error::AppResult;
use crate::search::symbols::{self, Candidates, SymbolQuery, SymbolSearchResult};
use crate::state::AppState;

/// Fuzzy search over file names and headings (Ctrl+T). Never fails on an empty or unready index:
/// it returns empty lists. `request_id` is echoed so the UI can drop stale responses.
#[tauri::command]
pub fn search_symbols(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
    headings_only: Option<bool>,
    recent: Vec<String>,
    request_id: u32,
) -> AppResult<SymbolSearchResult> {
    state.with_workspace(|ws| {
        let index = ws.index.read().unwrap_or_else(|e| e.into_inner());
        let graph = ws.graph.read().unwrap_or_else(|e| e.into_inner());
        let mut result = SymbolSearchResult {
            request_id,
            generation: ws.generation,
            graph_ready: graph.ready,
            files: Vec::new(),
            headings: Vec::new(),
        };
        let Some(index) = index.as_ref() else {
            return Ok(result);
        };
        let mut cache = ws.symbols.lock().unwrap_or_else(|e| e.into_inner());
        if !cache.as_ref().is_some_and(|c| c.is_current(index, &graph)) {
            *cache = Some(Candidates::build(index, &graph));
        }
        if let Some(candidates) = cache.as_ref() {
            let query = SymbolQuery {
                query: &query,
                limit: limit.map_or(symbols::DEFAULT_LIMIT, |l| l as usize),
                headings_only: headings_only.unwrap_or(false),
                recent: &recent[..recent.len().min(50)],
            };
            (result.files, result.headings) = symbols::search(candidates, &query);
        }
        Ok(result)
    })
}
