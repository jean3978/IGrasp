//! Shared application state managed by Tauri.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use crate::ai::gateway::AiGateway;
use crate::appdata::AppData;
use crate::error::{AppError, AppResult};
use crate::graph::SharedGraph;
use crate::index::SharedIndex;
use crate::index::scanner::ScanOptions;
use crate::index::watcher::SharedWatch;
use crate::paths::RootGuard;
use crate::search::SearchRegistry;
use crate::search::symbols::Candidates;

/// The folder currently open in the app.
pub struct Workspace {
    pub guard: RootGuard,
    /// Bumped on every open and rescan; results tagged with an older generation are dropped.
    pub generation: u64,
    pub options: ScanOptions,
    /// `None` until the scan of this generation completes.
    pub index: SharedIndex,
    /// Set to stop the running scan and make the watcher ignore further events.
    pub cancel: Arc<AtomicBool>,
    /// The file watcher, started once the scan is ready.
    pub watch: SharedWatch,
    /// Headings and links of every document, built after the scan.
    pub graph: SharedGraph,
    /// Search candidates (Ctrl+T), rebuilt when the index or the graph changes.
    pub symbols: Mutex<Option<Candidates>>,
    /// The running full-text search, cancelled with the workspace.
    pub searches: SearchRegistry,
}

/// What the background scan, the watcher and the graph builder of a workspace share.
#[derive(Clone)]
pub struct ScanContext {
    pub guard: RootGuard,
    pub options: ScanOptions,
    pub generation: u64,
    pub index: SharedIndex,
    pub cancel: Arc<AtomicBool>,
    pub watch: SharedWatch,
    pub graph: SharedGraph,
}

impl Workspace {
    pub fn new(guard: RootGuard, generation: u64, options: ScanOptions) -> Self {
        Self {
            guard,
            generation,
            options,
            index: Arc::new(RwLock::new(None)),
            cancel: Arc::new(AtomicBool::new(false)),
            watch: Arc::new(Mutex::new(None)),
            graph: Arc::default(),
            symbols: Mutex::new(None),
            searches: SearchRegistry::default(),
        }
    }

    pub fn scan_context(&self) -> ScanContext {
        ScanContext {
            guard: self.guard.clone(),
            options: self.options.clone(),
            generation: self.generation,
            index: self.index.clone(),
            cancel: self.cancel.clone(),
            watch: self.watch.clone(),
            graph: self.graph.clone(),
        }
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        // Closing or replacing the workspace stops its background work.
        self.cancel.store(true, Ordering::SeqCst);
        self.searches.cancel_all();
        self.watch.lock().unwrap_or_else(|e| e.into_inner()).take();
    }
}

pub struct AppState {
    pub appdata: AppData,
    pub workspace: RwLock<Option<Workspace>>,
    generation: AtomicU64,
    /// The only door to the AI providers (ADR 0015).
    pub ai: AiGateway,
}

impl AppState {
    pub fn new(appdata: AppData) -> Self {
        // The provider named in the settings (a broken settings file was reset to defaults and
        // is reported when the frontend first reads the settings).
        let settings = appdata.settings().unwrap_or_default();
        Self {
            ai: AiGateway::from_settings(&settings),
            appdata,
            workspace: RwLock::new(None),
            generation: AtomicU64::new(0),
        }
    }

    pub fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Runs `f` with the open workspace, or fails with `NoRootOpen`.
    pub fn with_workspace<R>(&self, f: impl FnOnce(&Workspace) -> AppResult<R>) -> AppResult<R> {
        let guard = self.workspace.read().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(ws) => f(ws),
            None => Err(AppError::NoRootOpen),
        }
    }
}
