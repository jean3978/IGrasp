//! Search commands.

use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};
use crate::search::globs::PathFilter;
use crate::search::symbols::{self, Candidates, SymbolQuery, SymbolSearchResult};
use crate::search::text::{self, SearchResultsEvent, TextSearch, TextSearchRequest};
use crate::state::AppState;

pub const EVENT_RESULTS: &str = "search://results";

/// Starts a full-text search (Ctrl+Shift+F) and returns its id; results arrive as
/// `search://results` batches. Starting a search cancels the previous one. An invalid regex or
/// glob fails right away with `InvalidPattern`.
#[tauri::command]
pub fn search_text(
    app: AppHandle,
    state: State<'_, AppState>,
    request: TextSearchRequest,
) -> AppResult<u32> {
    state.with_workspace(|ws| {
        let matcher = text::build_matcher(&request)?;
        let filter = PathFilter::new(&request.include, &request.exclude)?;
        let files: Vec<String> = {
            let index = ws.index.read().unwrap_or_else(|e| e.into_inner());
            let index = index.as_ref().ok_or(AppError::IndexNotReady)?;
            index
                .files_within("")
                .into_keys()
                .filter(|rel| filter.accepts(rel))
                .map(str::to_owned)
                .collect()
        };
        let (search_id, cancel) = ws.searches.start();
        let generation = ws.generation;
        let root = ws.guard.root().to_path_buf();
        std::thread::Builder::new()
            .name(format!("igrasp-search-{search_id}"))
            .spawn(move || {
                let search = TextSearch {
                    root: &root,
                    files,
                    request: &request,
                    cancel: &cancel,
                };
                search.run(&matcher, &mut |batch| {
                    let event = SearchResultsEvent {
                        search_id,
                        generation,
                        files: batch.files,
                        done: batch.done,
                        cancelled: batch.cancelled,
                        truncated: batch.truncated,
                        stats: batch.stats,
                    };
                    if let Err(e) = app.emit(EVENT_RESULTS, event) {
                        log::warn!("cannot emit {EVENT_RESULTS}: {e}");
                    }
                });
            })
            .map_err(AppError::Io)?;
        Ok(search_id)
    })
}

/// Cancels a running text search (idempotent); a final `done` + `cancelled` batch follows.
#[tauri::command]
pub fn cancel_search(state: State<'_, AppState>, search_id: u32) -> AppResult<()> {
    state.with_workspace(|ws| {
        ws.searches.cancel(search_id);
        Ok(())
    })
}

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
