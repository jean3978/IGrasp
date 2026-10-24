//! Document graph: the headings, anchors and links of every markdown file of the folder, with
//! the status of every link and who links to whom. Built in the background once the index is
//! ready, then kept current by the file watcher. Answers the outline-free questions the frontend
//! asks about documents it has not opened: headings for Ctrl+T, link status, backlinks, and the
//! broken links of the whole folder.

pub mod links;
pub mod parse;
pub mod slug;

use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, RwLock, mpsc};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

use crate::commands::files::{MAX_MARKDOWN_BYTES, decode_text};
use crate::index::SharedIndex;
use crate::index::model::{Changes, Index};
use crate::paths::RootGuard;
use links::{LinkStatus, LinkTarget, TargetLookup};
use parse::{Heading, ParsedDoc};

pub const EVENT_PROGRESS: &str = "graph://progress";
pub const EVENT_READY: &str = "graph://ready";
pub const EVENT_CHANGED: &str = "graph://changed";

const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
/// Parsed documents are added to the shared graph in batches, to keep the lock short.
const INSERT_BATCH: usize = 64;
/// Above this many raw event paths, every link is re-checked instead of looking each one up.
const MAX_TARGETED_PATHS: usize = 200;

/// A link of a document with its resolved target and status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LinkInfo {
    /// As written in the document (the preview looks links up by it).
    pub href: String,
    pub text: String,
    /// 1-based line in the source.
    pub line: u32,
    pub target: LinkTarget,
    pub status: LinkStatus,
}

#[derive(Debug, Clone, Default)]
pub struct DocMeta {
    pub headings: Vec<Heading>,
    pub anchors: BTreeSet<String>,
    pub links: Vec<LinkInfo>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GraphProgressEvent {
    pub generation: u64,
    pub parsed_docs: u32,
    pub total_docs: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GraphReadyEvent {
    pub generation: u64,
    pub docs: u32,
    pub links: u32,
    pub broken_count: u32,
    pub elapsed_ms: u64,
    /// Files that could not be read or are too large.
    pub skipped: u32,
}

/// Payload of `graph://changed`: the documents whose links (status or target) may have changed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GraphChangedEvent {
    pub generation: u64,
    pub docs: Vec<String>,
    pub removed: Vec<String>,
    pub broken_count: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GraphStatus {
    pub generation: u64,
    pub ready: bool,
    pub parsed_docs: u32,
    pub total_docs: u32,
    pub broken_count: u32,
}

#[derive(Debug, Default)]
pub struct Graph {
    docs: HashMap<String, DocMeta>,
    /// Lower-cased target path → documents with a link to it (whether it exists or not), so a
    /// target appearing, vanishing or changing case re-checks only the links that point at it.
    by_target: HashMap<String, BTreeSet<String>>,
    /// Lower-cased markdown path → actual path, from the index (case mismatches, READMEs).
    lower_md: HashMap<String, String>,
    pub ready: bool,
    pub total: u32,
    pub skipped: u32,
    /// Bumped on every change, so caches built from the graph (symbol search) know when to rebuild.
    pub version: u64,
}

pub type SharedGraph = Arc<RwLock<Graph>>;

fn lower(rel: &str) -> String {
    rel.to_lowercase()
}

/// The lower-cased paths a link depends on: what it is written as and what it resolved to.
fn target_keys(from_doc: &str, link: &LinkInfo) -> Vec<String> {
    let mut keys = Vec::new();
    if let (_, Some(raw)) = links::classify(from_doc, &link.href) {
        keys.push(lower(&raw));
    }
    match &link.target {
        LinkTarget::Document { rel_path, .. } | LinkTarget::File { rel_path, .. } => {
            keys.push(lower(rel_path));
        }
        LinkTarget::Folder { rel_path, readme } => {
            keys.push(lower(rel_path));
            if let Some(r) = readme {
                keys.push(lower(r));
            }
        }
        _ => {}
    }
    keys.dedup();
    keys
}

/// The folder of a README: links to that folder resolve to it, so they must be re-checked when
/// it appears or vanishes.
fn readme_folder(rel: &str) -> Option<&str> {
    let (dir, name) = rel.rsplit_once('/').unwrap_or(("", rel));
    (name.eq_ignore_ascii_case("readme.md") || name.eq_ignore_ascii_case("readme.markdown"))
        .then_some(dir)
}

/// The folder as the link resolver sees it: the index, the parsed documents and the disk.
struct Lookup<'a> {
    graph: &'a Graph,
    index: &'a Index,
    guard: &'a RootGuard,
    disk: RefCell<HashMap<String, Option<bool>>>,
}

impl TargetLookup for Lookup<'_> {
    fn is_markdown_file(&self, rel: &str) -> bool {
        self.index.file(rel).is_some()
    }

    fn markdown_ignoring_case(&self, rel: &str) -> Option<String> {
        self.graph
            .lower_md
            .get(&lower(rel))
            .filter(|actual| actual.as_str() != rel)
            .cloned()
    }

    fn anchors(&self, rel: &str) -> Option<&BTreeSet<String>> {
        self.graph.docs.get(rel).map(|d| &d.anchors)
    }

    fn on_disk(&self, rel: &str) -> Option<bool> {
        if self.index.file(rel).is_some() {
            return Some(false);
        }
        if self.index.has_dir(rel) {
            return Some(true);
        }
        if let Some(known) = self.disk.borrow().get(rel) {
            return *known;
        }
        let found = self
            .guard
            .join_lexical(rel)
            .ok()
            .and_then(|p| std::fs::metadata(p).ok())
            .map(|m| m.is_dir());
        self.disk.borrow_mut().insert(rel.to_owned(), found);
        found
    }

    fn readme_of(&self, dir: &str) -> Option<String> {
        let prefix = if dir.is_empty() {
            String::new()
        } else {
            format!("{}/", lower(dir))
        };
        ["readme.md", "readme.markdown"]
            .iter()
            .find_map(|name| self.graph.lower_md.get(&format!("{prefix}{name}")).cloned())
    }
}

impl Graph {
    pub fn doc(&self, rel: &str) -> Option<&DocMeta> {
        self.docs.get(rel)
    }

    pub fn docs(&self) -> impl Iterator<Item = (&String, &DocMeta)> {
        self.docs.iter()
    }

    pub fn parsed(&self) -> u32 {
        u32::try_from(self.docs.len()).unwrap_or(u32::MAX)
    }

    pub fn link_count(&self) -> u32 {
        let n: usize = self.docs.values().map(|d| d.links.len()).sum();
        u32::try_from(n).unwrap_or(u32::MAX)
    }

    /// Documents with at least one problem link, with those links (any order).
    pub fn docs_with_problems(&self) -> impl Iterator<Item = (&str, Vec<LinkInfo>)> {
        self.docs.iter().filter_map(|(rel, doc)| {
            let bad: Vec<LinkInfo> = doc
                .links
                .iter()
                .filter(|l| l.status.is_problem())
                .cloned()
                .collect();
            (!bad.is_empty()).then_some((rel.as_str(), bad))
        })
    }

    pub fn broken_count(&self) -> u32 {
        let n = self
            .docs
            .values()
            .flat_map(|d| &d.links)
            .filter(|l| l.status.is_problem())
            .count();
        u32::try_from(n).unwrap_or(u32::MAX)
    }

    pub fn status(&self, generation: u64) -> GraphStatus {
        GraphStatus {
            generation,
            ready: self.ready,
            parsed_docs: self.parsed(),
            total_docs: self.total.max(self.parsed()),
            broken_count: self.broken_count(),
        }
    }

    fn unregister(&mut self, rel: &str) {
        let Some(doc) = self.docs.get(rel) else {
            return;
        };
        for key in doc.links.iter().flat_map(|l| target_keys(rel, l)) {
            if let Some(set) = self.by_target.get_mut(&key) {
                set.remove(rel);
                if set.is_empty() {
                    self.by_target.remove(&key);
                }
            }
        }
    }

    fn register(&mut self, rel: &str) {
        let Some(doc) = self.docs.get(rel) else {
            return;
        };
        let keys: Vec<String> = doc.links.iter().flat_map(|l| target_keys(rel, l)).collect();
        for key in keys {
            self.by_target
                .entry(key)
                .or_default()
                .insert(rel.to_owned());
        }
    }

    /// Adds or replaces a parsed document; its links stay unchecked until `resolve`.
    pub fn insert(&mut self, rel: &str, parsed: ParsedDoc) {
        self.version += 1;
        self.unregister(rel);
        let links = parsed
            .links
            .into_iter()
            .map(|l| LinkInfo {
                target: links::classify(rel, &l.href).0,
                href: l.href,
                text: l.text,
                line: l.line,
                status: LinkStatus::NotChecked,
            })
            .collect();
        self.docs.insert(
            rel.to_owned(),
            DocMeta {
                headings: parsed.headings,
                anchors: parsed.anchors,
                links,
            },
        );
        self.register(rel);
    }

    pub fn remove(&mut self, rel: &str) {
        self.version += 1;
        self.unregister(rel);
        self.docs.remove(rel);
    }

    /// Refreshes the case-insensitive view of the index.
    pub fn sync_index(&mut self, index: &Index) {
        self.lower_md = index
            .files_within("")
            .into_keys()
            .map(|k| (lower(k), k.to_owned()))
            .collect();
    }

    /// Re-checks the links of `docs` (all documents when `None`).
    pub fn resolve(&mut self, docs: Option<&BTreeSet<String>>, index: &Index, guard: &RootGuard) {
        let names: Vec<String> = match docs {
            Some(set) => set
                .iter()
                .filter(|d| self.docs.contains_key(*d))
                .cloned()
                .collect(),
            None => self.docs.keys().cloned().collect(),
        };
        let updates: Vec<(String, Vec<(LinkTarget, LinkStatus)>)> = {
            let lookup = Lookup {
                graph: self,
                index,
                guard,
                disk: RefCell::new(HashMap::new()),
            };
            names
                .iter()
                .filter_map(|name| {
                    let doc = self.docs.get(name)?;
                    let resolved = doc
                        .links
                        .iter()
                        .map(|l| links::resolve(name, &l.href, &doc.anchors, &lookup))
                        .collect();
                    Some((name.clone(), resolved))
                })
                .collect()
        };
        for (name, resolved) in updates {
            self.unregister(&name);
            if let Some(doc) = self.docs.get_mut(&name) {
                for (link, (target, status)) in doc.links.iter_mut().zip(resolved) {
                    link.target = target;
                    link.status = status;
                }
            }
            self.register(&name);
        }
    }

    /// Documents with a link that depends on `rel`.
    fn dependents(&self, rel: &str, out: &mut BTreeSet<String>) {
        if let Some(set) = self.by_target.get(&lower(rel)) {
            out.extend(set.iter().cloned());
        }
    }

    /// Documents with a link that depends on any of `paths` or on anything inside them, in one
    /// pass over the target map (instead of one pass per path).
    fn dependents_within(&self, paths: &[String], out: &mut BTreeSet<String>) {
        let keys: HashSet<String> = paths.iter().map(|p| lower(p)).collect();
        for (k, set) in &self.by_target {
            let inside = || k.match_indices('/').any(|(i, _)| keys.contains(&k[..i]));
            if keys.contains(k) || inside() {
                out.extend(set.iter().cloned());
            }
        }
    }

    /// The documents linking to `rel`, with each link, sorted by path then line.
    pub fn backlinks(&self, rel: &str) -> Vec<(String, LinkInfo)> {
        let mut sources = BTreeSet::new();
        self.dependents(rel, &mut sources);
        let mut out = Vec::new();
        for source in sources {
            if source == rel {
                continue;
            }
            let Some(doc) = self.docs.get(&source) else {
                continue;
            };
            for link in &doc.links {
                let to_rel = match &link.target {
                    LinkTarget::Document { rel_path, .. } => rel_path == rel,
                    LinkTarget::Folder { readme, .. } => readme.as_deref() == Some(rel),
                    _ => false,
                };
                if to_rel {
                    out.push((source.clone(), link.clone()));
                }
            }
        }
        out
    }
}

/// Reads a markdown file for parsing; retries once when it is briefly locked (Windows, while an
/// agent rewrites it). `None` when it cannot be read or is too large.
fn read_doc(path: &Path) -> Option<(String, i64)> {
    let attempt = || -> std::io::Result<Option<(String, i64)>> {
        let metadata = std::fs::metadata(path)?;
        if !metadata.is_file() || metadata.len() > MAX_MARKDOWN_BYTES {
            return Ok(None);
        }
        let bytes = std::fs::read(path)?;
        let modified_ms = crate::index::scanner::file_entry(String::new(), &metadata).modified_ms;
        Ok(Some((decode_text(&bytes), modified_ms)))
    };
    match attempt() {
        Ok(found) => found,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            std::thread::sleep(Duration::from_millis(50));
            attempt().ok().flatten()
        }
        Err(_) => None,
    }
}

fn parse_file(root: &Path, rel: &str) -> Option<(ParsedDoc, i64)> {
    let path = root.join(rel);
    let (text, modified_ms) = read_doc(&path)?;
    Some((parse::parse(&text), modified_ms))
}

/// Builds the graph of every indexed file with `min(cpus, 8)` reader threads, adding documents
/// to `graph` as they are parsed (so headings are searchable early), then resolves every link.
/// Returns the elapsed time, or `None` when cancelled.
pub fn build(
    guard: &RootGuard,
    index: &SharedIndex,
    graph: &SharedGraph,
    cancel: &AtomicBool,
    progress: &dyn Fn(u32, u32),
) -> Option<Duration> {
    let started = Instant::now();
    let files: Vec<String> = {
        let index = index.read().unwrap_or_else(|e| e.into_inner());
        let index = index.as_ref()?;
        index
            .files_within("")
            .into_keys()
            .map(str::to_owned)
            .collect()
    };
    let total = u32::try_from(files.len()).unwrap_or(u32::MAX);
    {
        let mut g = graph.write().unwrap_or_else(|e| e.into_inner());
        g.total = total;
    }
    let root = guard.root().to_path_buf();
    let next = AtomicUsize::new(0);
    let workers = std::thread::available_parallelism().map_or(4, |n| n.get().min(8));
    let (tx, rx) = mpsc::channel::<(String, Option<(ParsedDoc, i64)>)>();

    std::thread::scope(|scope| {
        for _ in 0..workers {
            let tx = tx.clone();
            let (files, next, root) = (&files, &next, &root);
            scope.spawn(move || {
                while !cancel.load(Ordering::Relaxed) {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(rel) = files.get(i) else { break };
                    if tx.send((rel.clone(), parse_file(root, rel))).is_err() {
                        break;
                    }
                }
            });
        }
        drop(tx);

        let mut batch = Vec::with_capacity(INSERT_BATCH);
        let mut done = 0u32;
        let mut last_report = Instant::now();
        let flush = |batch: &mut Vec<(String, Option<(ParsedDoc, i64)>)>| {
            let index = index.read().unwrap_or_else(|e| e.into_inner());
            let mut g = graph.write().unwrap_or_else(|e| e.into_inner());
            for (rel, parsed) in batch.drain(..) {
                // The watcher may have removed or already re-parsed the file meanwhile.
                let still_indexed = index.as_ref().is_some_and(|i| i.file(&rel).is_some());
                match parsed {
                    Some((doc, _)) if still_indexed && !g.docs.contains_key(&rel) => {
                        g.insert(&rel, doc);
                    }
                    Some(_) => {}
                    None => g.skipped += 1,
                }
            }
        };
        for item in rx {
            batch.push(item);
            done += 1;
            if batch.len() >= INSERT_BATCH {
                flush(&mut batch);
            }
            if last_report.elapsed() >= PROGRESS_INTERVAL {
                last_report = Instant::now();
                progress(done, total);
            }
        }
        flush(&mut batch);
    });
    if cancel.load(Ordering::SeqCst) {
        return None;
    }

    let index = index.read().unwrap_or_else(|e| e.into_inner());
    let index = index.as_ref()?;
    let mut g = graph.write().unwrap_or_else(|e| e.into_inner());
    g.sync_index(index);
    g.resolve(None, index, guard);
    g.ready = true;
    Some(started.elapsed())
}

/// Brings the graph up to date after a batch of file changes. `raw_paths` are every path the
/// watcher reported (non-markdown files included), so links to source files that appear or
/// vanish are re-checked too. Returns what changed, or `None` when nothing did.
pub fn apply(
    graph: &SharedGraph,
    index: &SharedIndex,
    guard: &RootGuard,
    changes: &Changes,
    raw_paths: &[String],
) -> Option<(Vec<String>, Vec<String>, u32)> {
    // Read and parse outside the lock.
    let parsed: Vec<(String, Option<(ParsedDoc, i64)>)> = changes
        .added
        .iter()
        .chain(&changes.modified)
        .map(|f| (f.rel_path.clone(), parse_file(guard.root(), &f.rel_path)))
        .collect();

    let index = index.read().unwrap_or_else(|e| e.into_inner());
    let index = index.as_ref()?;
    let mut g = graph.write().unwrap_or_else(|e| e.into_inner());
    g.sync_index(index);

    let mut affected = BTreeSet::new();
    let mut everything = raw_paths.len() > MAX_TARGETED_PATHS;
    for rel in &changes.removed {
        g.dependents(rel, &mut affected);
        if let Some(dir) = readme_folder(rel) {
            g.dependents(dir, &mut affected);
        }
        g.remove(rel);
    }
    for (rel, doc) in parsed {
        match doc {
            Some((doc, _)) => g.insert(&rel, doc),
            None => g.remove(&rel),
        }
        g.dependents(&rel, &mut affected);
        if let Some(dir) = readme_folder(&rel) {
            g.dependents(dir, &mut affected);
        }
        affected.insert(rel);
    }
    if !everything {
        g.dependents_within(raw_paths, &mut affected);
    }
    if changes.removed.len() + changes.added.len() > MAX_TARGETED_PATHS {
        everything = true;
    }
    for rel in &changes.removed {
        affected.remove(rel);
    }
    if everything {
        g.resolve(None, index, guard);
        affected = g.docs.keys().cloned().collect();
    } else {
        g.resolve(Some(&affected), index, guard);
    }
    if affected.is_empty() && changes.removed.is_empty() {
        return None;
    }
    Some((
        affected.into_iter().collect(),
        changes.removed.clone(),
        g.broken_count(),
    ))
}

fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(e) = app.emit(event, payload) {
        log::warn!("cannot emit {event}: {e}");
    }
}

pub fn emit_changed(app: &AppHandle, generation: u64, change: (Vec<String>, Vec<String>, u32)) {
    let (docs, removed, broken_count) = change;
    emit(
        app,
        EVENT_CHANGED,
        GraphChangedEvent {
            generation,
            docs,
            removed,
            broken_count,
        },
    );
}

/// Builds the graph of a scan generation on a background thread and emits its events.
pub fn start_build(
    app: AppHandle,
    guard: RootGuard,
    generation: u64,
    index: SharedIndex,
    graph: SharedGraph,
    cancel: Arc<AtomicBool>,
) {
    std::thread::Builder::new()
        .name(format!("igrasp-graph-{generation}"))
        .spawn(move || {
            let progress = |parsed_docs, total_docs| {
                emit(
                    &app,
                    EVENT_PROGRESS,
                    GraphProgressEvent {
                        generation,
                        parsed_docs,
                        total_docs,
                    },
                );
            };
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                build(&guard, &index, &graph, &cancel, &progress)
            }));
            match outcome {
                Ok(Some(elapsed)) => {
                    let g = graph.read().unwrap_or_else(|e| e.into_inner());
                    let ready = GraphReadyEvent {
                        generation,
                        docs: g.parsed(),
                        links: g.link_count(),
                        broken_count: g.broken_count(),
                        elapsed_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
                        skipped: g.skipped,
                    };
                    drop(g);
                    log::info!(
                        "document graph: {} docs, {} links ({} broken) in {} ms",
                        ready.docs,
                        ready.links,
                        ready.broken_count,
                        ready.elapsed_ms
                    );
                    emit(&app, EVENT_READY, ready);
                }
                Ok(None) => log::info!("graph {generation} cancelled"),
                Err(_) => log::error!("graph {generation} panicked"),
            }
        })
        .map_err(|e| log::error!("cannot start the graph thread: {e}"))
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::scanner::{self, ScanOptions};
    use std::fs;

    struct Fixture {
        _dir: tempfile::TempDir,
        guard: RootGuard,
        index: SharedIndex,
        graph: SharedGraph,
    }

    fn write(root: &Path, rel: &str, text: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn fixture(files: &[(&str, &str)]) -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        for (rel, text) in files {
            write(dir.path(), rel, text);
        }
        let guard = RootGuard::new(dir.path()).unwrap();
        let none = AtomicBool::new(false);
        let index = scanner::scan(guard.root(), &ScanOptions::default(), &none, &|_| {})
            .unwrap()
            .index;
        let f = Fixture {
            _dir: dir,
            guard,
            index: Arc::new(RwLock::new(Some(index))),
            graph: Arc::new(RwLock::new(Graph::default())),
        };
        build(&f.guard, &f.index, &f.graph, &none, &|_, _| {}).unwrap();
        f
    }

    /// Re-scans the folder and applies the difference like the watcher would.
    fn sync(f: &Fixture, raw: &[&str]) -> Option<(Vec<String>, Vec<String>, u32)> {
        let none = AtomicBool::new(false);
        let fresh = scanner::scan(f.guard.root(), &ScanOptions::default(), &none, &|_| {})
            .unwrap()
            .index;
        let changes = {
            let mut slot = f.index.write().unwrap();
            let old = slot.take().unwrap();
            let changes = old.diff_within(&fresh, "");
            *slot = Some(fresh);
            changes
        };
        let raw: Vec<String> = raw.iter().map(|s| (*s).to_owned()).collect();
        apply(&f.graph, &f.index, &f.guard, &changes, &raw)
    }

    fn status(f: &Fixture, doc: &str, href: &str) -> LinkStatus {
        let g = f.graph.read().unwrap();
        g.doc(doc)
            .unwrap()
            .links
            .iter()
            .find(|l| l.href == href)
            .unwrap()
            .status
            .clone()
    }

    #[test]
    fn builds_headings_links_and_statuses() {
        let f = fixture(&[
            (
                "README.md",
                "# Home\n\n[guide](docs/guide.md#setup) [gone](nope.md) [src](src/main.rs)\n",
            ),
            (
                "docs/guide.md",
                "# Guide\n\n## Setup\n\n[back](../README.md#home) [bad](#nowhere)\n",
            ),
            ("src/main.rs", "fn main() {}\n"),
        ]);
        let g = f.graph.read().unwrap();
        assert!(g.ready);
        assert_eq!(g.parsed(), 2);
        assert_eq!(g.doc("docs/guide.md").unwrap().headings.len(), 2);
        drop(g);
        assert_eq!(
            status(&f, "README.md", "docs/guide.md#setup"),
            LinkStatus::Ok
        );
        assert_eq!(status(&f, "README.md", "nope.md"), LinkStatus::MissingFile);
        assert_eq!(status(&f, "README.md", "src/main.rs"), LinkStatus::Ok);
        assert_eq!(
            status(&f, "docs/guide.md", "#nowhere"),
            LinkStatus::MissingAnchor
        );
        let g = f.graph.read().unwrap();
        assert_eq!(g.broken_count(), 2);
        let back = g.backlinks("README.md");
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].0, "docs/guide.md");
    }

    #[test]
    fn a_target_that_appears_later_fixes_its_links() {
        let f = fixture(&[("a.md", "[b](b.md#intro)\n")]);
        assert_eq!(status(&f, "a.md", "b.md#intro"), LinkStatus::MissingFile);
        write(f.guard.root(), "b.md", "# Intro\n");
        let (docs, removed, broken) = sync(&f, &["b.md"]).unwrap();
        assert!(docs.contains(&"a.md".to_owned()));
        assert!(removed.is_empty());
        assert_eq!(broken, 0);
        assert_eq!(status(&f, "a.md", "b.md#intro"), LinkStatus::Ok);
    }

    #[test]
    fn modifying_a_target_rechecks_anchors() {
        let f = fixture(&[("a.md", "[b](b.md#intro)\n"), ("b.md", "# Intro\n")]);
        assert_eq!(status(&f, "a.md", "b.md#intro"), LinkStatus::Ok);
        // Make sure the modification time changes.
        std::thread::sleep(Duration::from_millis(20));
        write(f.guard.root(), "b.md", "# Renamed heading, longer\n");
        sync(&f, &["b.md"]).unwrap();
        assert_eq!(status(&f, "a.md", "b.md#intro"), LinkStatus::MissingAnchor);
    }

    #[test]
    fn removing_and_renaming_documents() {
        let f = fixture(&[("a.md", "[b](b.md)\n"), ("b.md", "[a](a.md)\n")]);
        fs::rename(f.guard.root().join("b.md"), f.guard.root().join("c.md")).unwrap();
        let (_, removed, broken) = sync(&f, &["b.md", "c.md"]).unwrap();
        assert_eq!(removed, ["b.md"]);
        assert_eq!(broken, 1);
        assert_eq!(status(&f, "a.md", "b.md"), LinkStatus::MissingFile);
        let g = f.graph.read().unwrap();
        assert!(g.doc("b.md").is_none());
        assert_eq!(g.backlinks("a.md")[0].0, "c.md");
    }

    #[test]
    fn non_markdown_targets_are_rechecked_from_raw_event_paths() {
        let f = fixture(&[("a.md", "[code](src/lib.rs) [dir](src)\n")]);
        assert_eq!(status(&f, "a.md", "src/lib.rs"), LinkStatus::MissingFile);
        write(f.guard.root(), "src/lib.rs", "pub fn x() {}\n");
        let (docs, _, _) = sync(&f, &["src"]).unwrap();
        assert_eq!(docs, ["a.md"]);
        assert_eq!(status(&f, "a.md", "src/lib.rs"), LinkStatus::Ok);
        assert_eq!(status(&f, "a.md", "src"), LinkStatus::Ok);
        fs::remove_dir_all(f.guard.root().join("src")).unwrap();
        sync(&f, &["src"]).unwrap();
        assert_eq!(status(&f, "a.md", "src/lib.rs"), LinkStatus::MissingFile);
    }

    #[test]
    fn a_readme_added_or_removed_updates_links_to_its_folder() {
        let f = fixture(&[("a.md", "[docs](docs/)\n"), ("docs/other.md", "# O\n")]);
        let readme = |f: &Fixture| {
            let g = f.graph.read().unwrap();
            match &g.doc("a.md").unwrap().links[0].target {
                LinkTarget::Folder { readme, .. } => readme.clone(),
                other => panic!("not a folder link: {other:?}"),
            }
        };
        assert_eq!(readme(&f), None);
        write(f.guard.root(), "docs/README.md", "# Docs\n");
        let (docs, _, _) = sync(&f, &["docs/README.md"]).unwrap();
        assert!(docs.contains(&"a.md".to_owned()));
        assert_eq!(readme(&f).as_deref(), Some("docs/README.md"));
        assert_eq!(
            f.graph.read().unwrap().backlinks("docs/README.md")[0].0,
            "a.md"
        );

        fs::remove_file(f.guard.root().join("docs/README.md")).unwrap();
        sync(&f, &["docs/README.md"]).unwrap();
        assert_eq!(readme(&f), None);
    }

    #[test]
    fn case_mismatch_is_detected_when_the_file_is_renamed() {
        let f = fixture(&[("a.md", "[g](Guide.md)\n"), ("guide.md", "# G\n")]);
        assert_eq!(
            status(&f, "a.md", "Guide.md"),
            LinkStatus::CaseMismatch {
                actual: "guide.md".into()
            }
        );
    }

    #[test]
    fn cancelled_builds_stop() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.md", "# A\n");
        let guard = RootGuard::new(dir.path()).unwrap();
        let none = AtomicBool::new(false);
        let index = scanner::scan(guard.root(), &ScanOptions::default(), &none, &|_| {})
            .unwrap()
            .index;
        let index: SharedIndex = Arc::new(RwLock::new(Some(index)));
        let graph: SharedGraph = Arc::default();
        let cancelled = AtomicBool::new(true);
        assert!(build(&guard, &index, &graph, &cancelled, &|_, _| {}).is_none());
        assert!(!graph.read().unwrap().ready);
    }
}
