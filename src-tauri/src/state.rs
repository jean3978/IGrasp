//! Shared application state managed by Tauri.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use crate::appdata::AppData;
use crate::error::{AppError, AppResult};
use crate::index::SharedIndex;
use crate::index::scanner::ScanOptions;
use crate::paths::RootGuard;

/// The folder currently open in the app.
pub struct Workspace {
    pub guard: RootGuard,
    /// Bumped on every open and rescan; results tagged with an older generation are dropped.
    pub generation: u64,
    pub options: ScanOptions,
    /// `None` until the scan of this generation completes.
    pub index: SharedIndex,
    /// Set to stop the running scan (and, later, the watcher).
    pub cancel: Arc<AtomicBool>,
}

impl Workspace {
    pub fn new(guard: RootGuard, generation: u64, options: ScanOptions) -> Self {
        Self {
            guard,
            generation,
            options,
            index: Arc::new(RwLock::new(None)),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        // Closing or replacing the workspace stops its background work.
        self.cancel.store(true, Ordering::SeqCst);
    }
}

pub struct AppState {
    pub appdata: AppData,
    pub workspace: RwLock<Option<Workspace>>,
    generation: AtomicU64,
}

impl AppState {
    pub fn new(appdata: AppData) -> Self {
        Self {
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
