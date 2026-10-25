//! Live updates: file-system events are debounced (200 ms), classified, applied to the index
//! and sent to the frontend as one `fs://changes` per batch.
//!
//! Anything that may add markdown (created files, new folders, renames) is handled by a targeted
//! re-walk of the changed path through the same ignore-aware walker as the full scan, so
//! `.gitignore` rules apply to files that appear later. A change to an ignore file triggers a
//! full rescan.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, PollWatcher, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    DebounceEventResult, Debouncer, RecommendedCache, new_debouncer, new_debouncer_opt,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

use super::SharedIndex;
use super::model::{Changes, FileEntry, Index, is_markdown, is_within, name_of, parent_of};
use super::scanner::{self, ScanOptions, file_entry, rel_path};
use crate::graph::{self, SharedGraph};
use crate::paths::RootGuard;

pub const EVENT_CHANGES: &str = "fs://changes";
pub const EVENT_WATCH_STATUS: &str = "fs://watch-status";

const DEBOUNCE: Duration = Duration::from_millis(200);
const POLL_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct RenamedPath {
    pub from: String,
    pub to: String,
}

/// Payload of `fs://changes`: what changed in the markdown tree during one debounce window.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FsChangesEvent {
    pub generation: u64,
    pub added: Vec<FileEntry>,
    pub modified: Vec<FileEntry>,
    pub removed: Vec<String>,
    /// Files that moved; they are also listed in `removed` (old path) and `added` (new path).
    pub renamed: Vec<RenamedPath>,
    /// Folders whose listing may have changed (parents and ancestors of added/removed files).
    pub dirs_changed: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum WatchMode {
    Native,
    Poll,
    Off,
}

/// Payload of `fs://watch-status`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct WatchStatusEvent {
    pub mode: WatchMode,
    /// Why the native watcher could not be used, if it could not.
    pub reason: Option<String>,
}

/// A file-system event reduced to what the classifier needs: its kind and root-relative paths
/// (`None` for paths outside the root or with non-UTF-8 names).
pub type SimpleEvent = (EventKind, Vec<Option<String>>);

/// What to do about a batch of events.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub full_rescan: bool,
    pub modified: BTreeSet<String>,
    pub removed_files: BTreeSet<String>,
    pub removed_dirs: BTreeSet<String>,
    pub rewalk: BTreeSet<String>,
    pub renamed: Vec<(String, String)>,
}

fn is_ignore_file(rel: &str) -> bool {
    let name = name_of(rel);
    name == ".gitignore" || name == ".ignore" || rel == ".git/info/exclude"
}

fn is_skipped(rel: &str) -> bool {
    rel.split('/').any(|s| scanner::ALWAYS_SKIPPED.contains(&s))
}

/// Classifies a batch of events. `kind_on_disk(rel)` tells whether a path is now a file
/// (`Some(false)`), a folder (`Some(true)`) or gone (`None`).
pub fn classify(
    events: &[SimpleEvent],
    index: &Index,
    kind_on_disk: &dyn Fn(&str) -> Option<bool>,
) -> Plan {
    let mut plan = Plan::default();
    for (kind, paths) in events {
        if matches!(kind, EventKind::Access(_)) {
            continue;
        }
        let rels: Vec<&str> = paths.iter().flatten().map(String::as_str).collect();
        if rels.iter().any(|r| is_ignore_file(r)) {
            plan.full_rescan = true;
            continue;
        }
        if let (EventKind::Modify(ModifyKind::Name(RenameMode::Both)), [from, to]) =
            (kind, rels.as_slice())
            && index.file(from).is_some()
            && is_markdown(name_of(to))
        {
            plan.renamed.push(((*from).to_owned(), (*to).to_owned()));
        }
        for rel in rels {
            if rel.is_empty() || is_skipped(rel) {
                continue;
            }
            let known_file = index.file(rel).is_some();
            let markdown = is_markdown(name_of(rel));
            match kind {
                EventKind::Modify(
                    ModifyKind::Data(_) | ModifyKind::Metadata(_) | ModifyKind::Any,
                ) if known_file => {
                    plan.modified.insert(rel.to_owned());
                }
                EventKind::Remove(_) if known_file => {
                    plan.removed_files.insert(rel.to_owned());
                }
                EventKind::Remove(_) if index.has_dir(rel) => {
                    plan.removed_dirs.insert(rel.to_owned());
                }
                EventKind::Remove(_) => {}
                _ => match kind_on_disk(rel) {
                    // A non-markdown file can never add markdown: skip build output churn.
                    Some(false) if !markdown => {}
                    // Gone: forget whatever the index had there.
                    None if known_file => {
                        plan.removed_files.insert(rel.to_owned());
                    }
                    None if index.has_dir(rel) => {
                        plan.removed_dirs.insert(rel.to_owned());
                    }
                    None => {}
                    Some(_) => {
                        plan.rewalk.insert(rel.to_owned());
                    }
                },
            }
        }
    }
    // A path inside another re-walked path is covered by the outer walk.
    let all: Vec<String> = plan.rewalk.iter().cloned().collect();
    plan.rewalk
        .retain(|r| !all.iter().any(|o| o != r && is_within(r, o)));
    plan
}

/// Every ancestor folder of `rel`, from its parent up to the root (`""`).
fn ancestors(rel: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut p = parent_of(rel);
    loop {
        out.push(p.to_owned());
        if p.is_empty() {
            break;
        }
        p = parent_of(p);
    }
    out
}

fn merge(changes: &mut Changes, more: Changes) {
    changes.added.extend(more.added);
    changes.modified.extend(more.modified);
    changes.removed.extend(more.removed);
}

/// Applies `scoped` (a fresh walk of `scope`) to `index`, returning what changed.
fn apply_scope(index: &mut Index, scoped: &scanner::ScopedIndex, scope: &str) -> Changes {
    let changes = index.diff_within(&scoped.index, scope);
    for rel in &changes.removed {
        index.remove_file(rel);
    }
    for entry in changes.added.iter().chain(&changes.modified) {
        index.insert_file(entry.clone());
    }
    for (dir, hidden) in &scoped.dirs {
        if is_within(dir, scope) {
            index.set_dir_hidden(dir, *hidden);
        }
    }
    changes
}

/// Executes a plan against the disk and the index.
pub fn apply_plan(
    root: &Path,
    opts: &ScanOptions,
    index: &mut Index,
    plan: &Plan,
    cancel: &AtomicBool,
) -> Changes {
    let mut changes = Changes::default();
    if plan.full_rescan {
        if let Ok(scoped) = scanner::index_scope(root, opts, None, cancel, &|_| {}) {
            merge(&mut changes, apply_scope(index, &scoped, ""));
        }
        return changes;
    }
    for rel in &plan.modified {
        match std::fs::metadata(root.join(rel)) {
            Ok(m) if m.is_file() => {
                let mut entry = file_entry(rel.clone(), &m);
                let Some(old) = index.file(rel) else { continue };
                entry.hidden = old.hidden;
                if old.modified_ms != entry.modified_ms || old.size != entry.size {
                    index.insert_file(entry.clone());
                    changes.modified.push(entry);
                }
            }
            _ => {
                if index.remove_file(rel) {
                    changes.removed.push(rel.clone());
                }
            }
        }
    }
    for rel in &plan.removed_files {
        if index.remove_file(rel) {
            changes.removed.push(rel.clone());
        }
    }
    for dir in &plan.removed_dirs {
        changes.removed.extend(index.remove_dir(dir));
    }
    for scope in &plan.rewalk {
        if let Ok(scoped) = scanner::index_scope(root, opts, Some(scope), cancel, &|_| {}) {
            merge(&mut changes, apply_scope(index, &scoped, scope));
        }
    }
    changes
}

/// Builds the event sent to the frontend, or `None` when nothing visible changed.
pub fn to_event(generation: u64, mut changes: Changes, plan: &Plan) -> Option<FsChangesEvent> {
    if changes.is_empty() {
        return None;
    }
    changes.removed.sort();
    changes.removed.dedup();
    // Removed and added in the same batch: the file was replaced in place (saved through a
    // temporary file renamed over it, as editors and the AI CLI do). It is a modification, never
    // a deletion: an open tab must reload, not show "deleted". A markdown file renamed over
    // another one stays a rename (its tab follows it).
    let removed_set: BTreeSet<&str> = changes.removed.iter().map(String::as_str).collect();
    let rename_targets: BTreeSet<&str> = plan
        .renamed
        .iter()
        .filter(|(from, _)| removed_set.contains(from.as_str()))
        .map(|(_, to)| to.as_str())
        .collect();
    let replaced: BTreeSet<String> = changes
        .added
        .iter()
        .map(|f| f.rel_path.as_str())
        .filter(|rel| removed_set.contains(rel) && !rename_targets.contains(rel))
        .map(str::to_owned)
        .collect();
    drop(removed_set);
    if !replaced.is_empty() {
        changes.removed.retain(|rel| !replaced.contains(rel));
        let (moved, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut changes.added)
            .into_iter()
            .partition(|f| replaced.contains(&f.rel_path));
        changes.added = kept;
        changes.modified.retain(|f| !replaced.contains(&f.rel_path));
        changes.modified.extend(moved);
    }
    let added: BTreeSet<&str> = changes.added.iter().map(|f| f.rel_path.as_str()).collect();
    let removed: BTreeSet<&str> = changes.removed.iter().map(String::as_str).collect();
    let renamed = plan
        .renamed
        .iter()
        .filter(|(from, to)| removed.contains(from.as_str()) && added.contains(to.as_str()))
        .map(|(from, to)| RenamedPath {
            from: from.clone(),
            to: to.clone(),
        })
        .collect();
    let dirs_changed: BTreeSet<String> = added
        .iter()
        .chain(removed.iter())
        .flat_map(|p| ancestors(p))
        .collect();
    Some(FsChangesEvent {
        generation,
        added: changes.added,
        modified: changes.modified,
        removed: changes.removed,
        renamed,
        dirs_changed: dirs_changed.into_iter().collect(),
    })
}

struct WatchContext {
    app: AppHandle,
    root: PathBuf,
    /// The workspace's guard, reused for every batch (building one canonicalizes the root).
    guard: RootGuard,
    options: ScanOptions,
    generation: u64,
    index: SharedIndex,
    cancel: Arc<AtomicBool>,
    graph: SharedGraph,
}

impl WatchContext {
    fn handle(&self, result: DebounceEventResult) {
        if self.cancel.load(Ordering::SeqCst) {
            return;
        }
        let events = match result {
            Ok(events) => events,
            Err(errors) => {
                for e in errors {
                    log::warn!("file watcher error: {e}");
                }
                return;
            }
        };
        let simple: Vec<SimpleEvent> = events
            .iter()
            .map(|e| {
                let rels = e.paths.iter().map(|p| rel_path(&self.root, p)).collect();
                (e.kind, rels)
            })
            .collect();
        let mut guard = self.index.write().unwrap_or_else(|e| e.into_inner());
        // Events that arrive before the first scan completes are covered by that scan.
        let Some(index) = guard.as_mut() else { return };
        let root = self.root.clone();
        let plan = classify(&simple, index, &|rel| {
            std::fs::metadata(root.join(rel)).ok().map(|m| m.is_dir())
        });
        let changes = apply_plan(&self.root, &self.options, index, &plan, &self.cancel);
        drop(guard);
        if self.cancel.load(Ordering::SeqCst) {
            return;
        }
        let for_graph = changes.clone();
        if let Some(event) = to_event(self.generation, changes, &plan)
            && let Err(e) = self.app.emit(EVENT_CHANGES, event)
        {
            log::warn!("cannot emit {EVENT_CHANGES}: {e}");
        }
        // Every reported path, non-markdown ones included: links to source files are checked too.
        let raw: Vec<String> = simple
            .iter()
            .flat_map(|(_, paths)| paths.iter().flatten().cloned())
            .collect();
        if let Some(change) = graph::apply(&self.graph, &self.index, &self.guard, &for_graph, &raw)
            && !self.cancel.load(Ordering::SeqCst)
        {
            graph::emit_changed(&self.app, self.generation, change);
        }
    }
}

/// Keeps the watcher alive; dropping it stops watching.
pub enum WatchHandle {
    Native {
        _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
    },
    Poll {
        _debouncer: Debouncer<PollWatcher, RecommendedCache>,
    },
}

pub type SharedWatch = Arc<Mutex<Option<WatchHandle>>>;

fn emit_status(app: &AppHandle, mode: WatchMode, reason: Option<String>) {
    if let Err(e) = app.emit(EVENT_WATCH_STATUS, WatchStatusEvent { mode, reason }) {
        log::warn!("cannot emit {EVENT_WATCH_STATUS}: {e}");
    }
}

/// Starts watching the guarded root recursively. Falls back to polling every 2 s when the native
/// watcher cannot be used (for example when the Linux inotify watch limit is reached).
pub fn start_watcher(
    app: AppHandle,
    guard: RootGuard,
    options: ScanOptions,
    generation: u64,
    index: SharedIndex,
    cancel: Arc<AtomicBool>,
    graph: SharedGraph,
) -> Option<WatchHandle> {
    let root = guard.root().to_path_buf();
    let ctx = Arc::new(WatchContext {
        app: app.clone(),
        root: root.clone(),
        guard,
        options,
        generation,
        index,
        cancel,
        graph,
    });
    let handler = |ctx: Arc<WatchContext>| move |result: DebounceEventResult| ctx.handle(result);

    let reason = match new_debouncer(DEBOUNCE, None, handler(ctx.clone())) {
        Ok(mut debouncer) => match debouncer.watch(&root, RecursiveMode::Recursive) {
            Ok(()) => {
                emit_status(&app, WatchMode::Native, None);
                return Some(WatchHandle::Native {
                    _debouncer: debouncer,
                });
            }
            Err(e) => e.to_string(),
        },
        Err(e) => e.to_string(),
    };
    log::warn!("native file watching unavailable ({reason}); polling instead");

    let config = notify::Config::default().with_poll_interval(POLL_INTERVAL);
    match new_debouncer_opt::<_, PollWatcher, RecommendedCache>(
        DEBOUNCE,
        None,
        handler(ctx),
        RecommendedCache::new(),
        config,
    ) {
        Ok(mut debouncer) => match debouncer.watch(&root, RecursiveMode::Recursive) {
            Ok(()) => {
                emit_status(&app, WatchMode::Poll, Some(reason));
                Some(WatchHandle::Poll {
                    _debouncer: debouncer,
                })
            }
            Err(e) => {
                log::error!("cannot watch {}: {e}", root.display());
                emit_status(&app, WatchMode::Off, Some(e.to_string()));
                None
            }
        },
        Err(e) => {
            log::error!("cannot start the poll watcher: {e}");
            emit_status(&app, WatchMode::Off, Some(e.to_string()));
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::model::entry;
    use notify::event::{CreateKind, DataChange, RemoveKind};

    fn index(paths: &[&str]) -> Index {
        let mut i = Index::default();
        for p in paths {
            i.insert_file(entry(p));
        }
        i
    }

    fn ev(kind: EventKind, paths: &[&str]) -> SimpleEvent {
        (kind, paths.iter().map(|p| Some((*p).to_owned())).collect())
    }

    const MODIFY: EventKind = EventKind::Modify(ModifyKind::Data(DataChange::Content));
    const CREATE: EventKind = EventKind::Create(CreateKind::Any);
    const REMOVE: EventKind = EventKind::Remove(RemoveKind::Any);

    fn on_disk(
        dirs: &'static [&'static str],
        files: &'static [&'static str],
    ) -> impl Fn(&str) -> Option<bool> {
        move |rel: &str| {
            if dirs.contains(&rel) {
                Some(true)
            } else if files.contains(&rel) {
                Some(false)
            } else {
                None
            }
        }
    }

    #[test]
    fn modifications_of_known_files_are_restat() {
        let i = index(&["docs/a.md"]);
        let plan = classify(
            &[ev(MODIFY, &["docs/a.md"])],
            &i,
            &on_disk(&[], &["docs/a.md"]),
        );
        assert_eq!(plan.modified.into_iter().collect::<Vec<_>>(), ["docs/a.md"]);
        assert!(plan.rewalk.is_empty());
    }

    #[test]
    fn removals_drop_files_and_folders() {
        let i = index(&["docs/a.md", "guide/b.md"]);
        let plan = classify(
            &[
                ev(REMOVE, &["docs/a.md"]),
                ev(REMOVE, &["guide"]),
                ev(REMOVE, &["x.txt"]),
            ],
            &i,
            &on_disk(&[], &[]),
        );
        assert!(plan.removed_files.contains("docs/a.md"));
        assert!(plan.removed_dirs.contains("guide"));
        assert_eq!(plan.removed_files.len(), 1);
    }

    #[test]
    fn creations_and_new_folders_are_rewalked_but_other_files_skipped() {
        let i = index(&[]);
        let plan = classify(
            &[
                ev(CREATE, &["notes/new.md"]),
                ev(CREATE, &["newdir"]),
                ev(CREATE, &["newdir/deep/x.md"]),
                ev(CREATE, &["src/main.rs"]),
            ],
            &i,
            &on_disk(
                &["newdir", "newdir/deep"],
                &["notes/new.md", "newdir/deep/x.md", "src/main.rs"],
            ),
        );
        // newdir/deep/x.md is covered by the walk of newdir.
        assert_eq!(
            plan.rewalk.into_iter().collect::<Vec<_>>(),
            ["newdir", "notes/new.md"]
        );
    }

    #[test]
    fn ignore_files_and_skipped_folders() {
        let i = index(&["a.md"]);
        let plan = classify(&[ev(MODIFY, &["docs/.gitignore"])], &i, &on_disk(&[], &[]));
        assert!(plan.full_rescan);
        let plan = classify(
            &[ev(MODIFY, &[".git/info/exclude"])],
            &i,
            &on_disk(&[], &[]),
        );
        assert!(plan.full_rescan);
        let plan = classify(
            &[
                ev(CREATE, &[".git/objects/ab"]),
                ev(CREATE, &["node_modules/x/README.md"]),
            ],
            &i,
            &on_disk(&[".git/objects/ab"], &["node_modules/x/README.md"]),
        );
        assert_eq!(plan, Plan::default());
    }

    #[test]
    fn renames_are_paired() {
        let i = index(&["docs/old.md"]);
        let rename = EventKind::Modify(ModifyKind::Name(RenameMode::Both));
        let plan = classify(
            &[ev(rename, &["docs/old.md", "docs/new.md"])],
            &i,
            &on_disk(&[], &["docs/new.md"]),
        );
        assert_eq!(
            plan.renamed,
            [("docs/old.md".to_owned(), "docs/new.md".to_owned())]
        );
        assert!(plan.removed_files.contains("docs/old.md"));
        assert!(plan.rewalk.contains("docs/new.md"));
    }

    #[test]
    fn access_events_are_ignored() {
        let i = index(&["a.md"]);
        let access = EventKind::Access(notify::event::AccessKind::Any);
        assert_eq!(
            classify(&[ev(access, &["a.md"])], &i, &on_disk(&[], &["a.md"])),
            Plan::default()
        );
    }

    #[test]
    fn applying_a_plan_updates_the_index_and_reports_changes() {
        let d = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(d.path()).unwrap();
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::fs::write(root.join("docs/a.md"), "# A").unwrap();
        std::fs::write(root.join(".gitignore"), "build/\n").unwrap();
        let none = AtomicBool::new(false);
        let opts = ScanOptions::default();
        let mut idx = scanner::scan(&root, &opts, &none, &|_| {}).unwrap().index;

        // A new file in a new folder, a file in an ignored folder, and a deletion.
        std::fs::create_dir_all(root.join("guide/deep")).unwrap();
        std::fs::write(root.join("guide/deep/b.md"), "# B").unwrap();
        std::fs::create_dir_all(root.join("build")).unwrap();
        std::fs::write(root.join("build/out.md"), "x").unwrap();
        std::fs::remove_file(root.join("docs/a.md")).unwrap();

        let events = vec![
            ev(CREATE, &["guide"]),
            ev(CREATE, &["build"]),
            ev(REMOVE, &["docs/a.md"]),
        ];
        let r = root.clone();
        let plan = classify(&events, &idx, &|rel| {
            std::fs::metadata(r.join(rel)).ok().map(|m| m.is_dir())
        });
        let changes = apply_plan(&root, &opts, &mut idx, &plan, &none);
        let event = to_event(7, changes, &plan).unwrap();
        assert_eq!(event.generation, 7);
        assert_eq!(
            event
                .added
                .iter()
                .map(|f| f.rel_path.as_str())
                .collect::<Vec<_>>(),
            ["guide/deep/b.md"]
        );
        assert_eq!(event.removed, ["docs/a.md"]);
        assert!(event.dirs_changed.contains(&String::new()));
        assert!(event.dirs_changed.contains(&"guide/deep".to_owned()));
        assert!(idx.file("build/out.md").is_none());
        assert!(!idx.has_dir("docs"));
    }

    #[test]
    fn a_markdown_file_renamed_over_another_stays_a_rename() {
        let d = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(d.path()).unwrap();
        std::fs::write(root.join("README.md"), "# Old").unwrap();
        std::fs::write(root.join("draft.md"), "# Draft, now the readme").unwrap();
        let none = AtomicBool::new(false);
        let opts = ScanOptions::default();
        let mut idx = scanner::scan(&root, &opts, &none, &|_| {}).unwrap().index;

        std::fs::rename(root.join("draft.md"), root.join("README.md")).unwrap();
        let events = vec![
            ev(REMOVE, &["README.md"]),
            ev(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                &["draft.md", "README.md"],
            ),
        ];
        let r = root.clone();
        let plan = classify(&events, &idx, &|rel| {
            std::fs::metadata(r.join(rel)).ok().map(|m| m.is_dir())
        });
        let changes = apply_plan(&root, &opts, &mut idx, &plan, &none);
        let event = to_event(4, changes, &plan).unwrap();
        assert_eq!(
            event.renamed,
            [RenamedPath {
                from: "draft.md".into(),
                to: "README.md".into()
            }]
        );
        assert!(event.removed.contains(&"draft.md".to_owned()));
        assert!(
            event.added.iter().any(|f| f.rel_path == "README.md"),
            "{:?}",
            event.added
        );
    }

    #[test]
    fn a_file_replaced_by_a_rename_is_modified_not_deleted() {
        // How editors and the AI CLI save: write a temporary file, then rename it over the
        // original. Windows reports the original removed and the new name created in one batch.
        let d = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(d.path()).unwrap();
        std::fs::write(root.join("README.md"), "# Old").unwrap();
        let none = AtomicBool::new(false);
        let opts = ScanOptions::default();
        let mut idx = scanner::scan(&root, &opts, &none, &|_| {}).unwrap().index;

        std::fs::write(root.join("README.md.tmp.123"), "# New, and longer").unwrap();
        std::fs::rename(root.join("README.md.tmp.123"), root.join("README.md")).unwrap();
        let events = vec![
            ev(CREATE, &["README.md.tmp.123"]),
            ev(REMOVE, &["README.md"]),
            ev(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                &["README.md.tmp.123", "README.md"],
            ),
        ];
        let r = root.clone();
        let plan = classify(&events, &idx, &|rel| {
            std::fs::metadata(r.join(rel)).ok().map(|m| m.is_dir())
        });
        let changes = apply_plan(&root, &opts, &mut idx, &plan, &none);
        let event = to_event(3, changes, &plan).unwrap();
        assert!(event.removed.is_empty(), "{:?}", event.removed);
        assert!(event.added.is_empty());
        assert!(event.renamed.is_empty());
        assert_eq!(
            event
                .modified
                .iter()
                .map(|f| f.rel_path.as_str())
                .collect::<Vec<_>>(),
            ["README.md"]
        );
        assert!(idx.file("README.md").is_some());
    }

    #[test]
    #[ignore = "uses real file-system notifications; run with `cargo test -- --ignored`"]
    fn real_notifications_reach_the_handler() {
        let d = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(d.path()).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = new_debouncer(DEBOUNCE, None, tx).unwrap();
        debouncer.watch(&root, RecursiveMode::Recursive).unwrap();
        std::fs::write(root.join("a.md"), "# A").unwrap();
        let events = rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap();
        assert!(
            events
                .iter()
                .any(|e| e.paths.iter().any(|p| p.ends_with("a.md")))
        );
    }
}
