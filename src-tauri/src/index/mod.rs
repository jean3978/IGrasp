//! Background index of the markdown files under the open folder.

pub mod model;
pub mod scanner;
pub mod watcher;

use std::sync::atomic::Ordering;
use std::sync::{Arc, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

use model::Index;
use scanner::ScanProgress;

use crate::state::ScanContext;

pub const EVENT_PROGRESS: &str = "index://progress";
pub const EVENT_READY: &str = "index://ready";
pub const EVENT_ERROR: &str = "index://error";

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IndexProgressEvent {
    pub generation: u64,
    pub scanned_entries: u64,
    pub markdown_files: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IndexReadyEvent {
    pub generation: u64,
    pub markdown_files: u64,
    pub dirs: u64,
    pub elapsed_ms: u64,
    /// Entries that could not be read.
    pub skipped: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IndexErrorEvent {
    pub generation: u64,
    pub message: String,
}

/// The index of one scan generation, shared between the scan thread and the commands.
pub type SharedIndex = Arc<RwLock<Option<Index>>>;

fn millis(d: std::time::Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(e) = app.emit(event, payload) {
        log::warn!("cannot emit {event}: {e}");
    }
}

/// Scans the root on a background thread, stores the result in the index unless cancelled, then
/// starts watching the folder and builds the document graph.
pub fn start_scan(app: AppHandle, ctx: ScanContext) {
    let ScanContext {
        guard,
        options,
        generation,
        index,
        cancel,
        watch,
        graph,
        disk_revision,
    } = ctx;
    let root = guard.root().to_path_buf();
    std::thread::Builder::new()
        .name(format!("igrasp-scan-{generation}"))
        .spawn(move || {
            let progress = |p: ScanProgress| {
                emit(
                    &app,
                    EVENT_PROGRESS,
                    IndexProgressEvent {
                        generation,
                        scanned_entries: p.scanned_entries,
                        markdown_files: p.markdown_files,
                        elapsed_ms: millis(p.elapsed),
                    },
                );
            };
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                scanner::scan(&root, &options, &cancel, &progress)
            }));
            match outcome {
                Ok(Ok(result)) if !cancel.load(Ordering::SeqCst) => {
                    let ready = IndexReadyEvent {
                        generation,
                        markdown_files: result.index.file_count() as u64,
                        dirs: result.index.dir_count() as u64,
                        elapsed_ms: millis(result.elapsed),
                        skipped: result.skipped,
                    };
                    log::info!(
                        "indexed {} markdown files in {} ms ({} skipped)",
                        ready.markdown_files,
                        ready.elapsed_ms,
                        ready.skipped
                    );
                    *index.write().unwrap_or_else(|e| e.into_inner()) = Some(result.index);
                    emit(&app, EVENT_READY, ready);
                    let handle = watcher::start_watcher(
                        app.clone(),
                        guard.clone(),
                        options.clone(),
                        generation,
                        index.clone(),
                        cancel.clone(),
                        graph.clone(),
                        disk_revision,
                    );
                    if !cancel.load(Ordering::SeqCst) {
                        *watch.lock().unwrap_or_else(|e| e.into_inner()) = handle;
                        crate::graph::start_build(
                            app.clone(),
                            guard,
                            generation,
                            index,
                            graph,
                            cancel,
                        );
                    }
                }
                Ok(_) => log::info!("scan {generation} cancelled"),
                Err(_) => {
                    log::error!("scan {generation} panicked");
                    emit(
                        &app,
                        EVENT_ERROR,
                        IndexErrorEvent {
                            generation,
                            message: "Indexing the folder failed unexpectedly.".into(),
                        },
                    );
                }
            }
        })
        .map_err(|e| log::error!("cannot start the scan thread: {e}"))
        .ok();
}
