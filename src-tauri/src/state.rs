//! Shared application state managed by Tauri.

use std::sync::RwLock;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::appdata::AppData;
use crate::error::{AppError, AppResult};
use crate::paths::RootGuard;

/// The folder currently open in the app.
pub struct Workspace {
    pub guard: RootGuard,
    /// Bumped on every open and rescan; results tagged with an older generation are dropped.
    #[expect(dead_code, reason = "read by the scanner")]
    pub generation: u64,
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
    #[expect(dead_code, reason = "used by list_dir")]
    pub fn with_workspace<R>(&self, f: impl FnOnce(&Workspace) -> AppResult<R>) -> AppResult<R> {
        let guard = self.workspace.read().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(ws) => f(ws),
            None => Err(AppError::NoRootOpen),
        }
    }
}
