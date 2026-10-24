//! Parallel, ignore-aware scan of the root folder for markdown files.

use std::collections::HashSet;
use std::path::{Component, Path};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant, UNIX_EPOCH};

use ignore::overrides::OverrideBuilder;
use ignore::{WalkBuilder, WalkState};

use super::model::{FileEntry, Index, is_markdown, is_within, name_of};

/// Folders that are never shown, whatever the options.
pub const ALWAYS_SKIPPED: [&str; 2] = [".git", "node_modules"];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScanOptions {
    /// Show dot-prefixed files and folders.
    pub show_dotfiles: bool,
    /// Show entries matched by `.gitignore`, `.ignore` or `.git/info/exclude`.
    pub show_ignored: bool,
    /// The user's extra gitignore-style patterns, applied in every mode.
    pub extra_ignores: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ScanProgress {
    pub scanned_entries: u64,
    pub markdown_files: u64,
    pub elapsed: Duration,
}

#[derive(Debug)]
pub struct ScanResult {
    pub index: Index,
    /// Entries that could not be read (permission denied, broken links, non-UTF-8 names).
    pub skipped: u32,
    pub elapsed: Duration,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Cancelled;

const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

/// Root-relative `/`-separated path, or None for paths outside the root or non-UTF-8 names.
pub fn rel_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_str()?),
            _ => return None,
        }
    }
    Some(parts.join("/"))
}

/// Whether a relative path has a dot-prefixed component.
pub fn is_dotted(rel: &str) -> bool {
    rel.split('/').any(|s| s.starts_with('.'))
}

/// Builds the walker used by both the full scan and the watcher's targeted re-walks.
/// `respect_ignore = false` disables the ignore files (the "show ignored" mode).
///
/// With a `scope` (a root-relative path), the walk still starts at the root, so every ignore
/// rule applies, but only descends into the ancestors of the scope and the scope itself.
pub fn walk_builder(
    root: &Path,
    opts: &ScanOptions,
    respect_ignore: bool,
    scope: Option<&str>,
) -> WalkBuilder {
    let mut b = WalkBuilder::new(root);
    b.hidden(!opts.show_dotfiles)
        .git_ignore(respect_ignore)
        .git_exclude(respect_ignore)
        .ignore(respect_ignore)
        .git_global(false)
        .parents(true)
        // Apply .gitignore even when a subfolder of a repository is opened.
        .require_git(false)
        .follow_links(false)
        .threads(std::thread::available_parallelism().map_or(4, |n| n.get().min(8)));

    if !opts.extra_ignores.is_empty() {
        let mut ob = OverrideBuilder::new(root);
        for pattern in &opts.extra_ignores {
            // In override globs a leading `!` means "ignore".
            if let Err(e) = ob.add(&format!("!{pattern}")) {
                log::warn!("ignoring invalid pattern {pattern:?}: {e}");
            }
        }
        match ob.build() {
            Ok(o) => {
                b.overrides(o);
            }
            Err(e) => log::warn!("cannot build ignore patterns: {e}"),
        }
    }

    let root_buf = root.to_path_buf();
    let scope = scope.map(str::to_owned);
    b.filter_entry(move |e| {
        if let Some(scope) = &scope {
            match rel_path(&root_buf, e.path()) {
                // Keep the scope, what is inside it, and the folders leading to it.
                Some(rel) if is_within(&rel, scope) || is_within(scope, &rel) => {}
                _ => return false,
            }
        }
        let name = e.file_name().to_string_lossy();
        if e.file_type().is_some_and(|t| t.is_dir()) {
            !ALWAYS_SKIPPED.contains(&name.as_ref())
        } else {
            is_markdown(&name)
        }
    });
    b
}

pub fn file_entry(rel: String, metadata: &std::fs::Metadata) -> FileEntry {
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
    FileEntry {
        name: name_of(&rel).to_owned(),
        rel_path: rel,
        size: metadata.len(),
        modified_ms,
        hidden: false,
    }
}

enum Found {
    File(FileEntry),
    Dir(String),
    Skipped,
}

/// Walks the root (or only `scope`, see `walk_builder`) and collects markdown files and folders.
/// Calls `progress` at most every 250 ms.
pub fn collect(
    root: &Path,
    opts: &ScanOptions,
    respect_ignore: bool,
    scope: Option<&str>,
    cancel: &AtomicBool,
    progress: &dyn Fn(ScanProgress),
) -> Result<CollectedEntries, Cancelled> {
    let started = Instant::now();
    let (tx, rx) = mpsc::channel::<Found>();
    let walker = walk_builder(root, opts, respect_ignore, scope).build_parallel();

    let collected = std::thread::scope(|scope| {
        scope.spawn(move || {
            walker.run(|| {
                let tx = tx.clone();
                Box::new(move |result| {
                    if cancel.load(Ordering::Relaxed) {
                        return WalkState::Quit;
                    }
                    let found = match result {
                        Ok(entry) if entry.depth() == 0 => return WalkState::Continue,
                        Ok(entry) => match rel_path(root, entry.path()) {
                            None => Found::Skipped,
                            Some(rel) if entry.file_type().is_some_and(|t| t.is_dir()) => {
                                Found::Dir(rel)
                            }
                            Some(rel) => match entry.metadata() {
                                Ok(m) if m.is_file() => Found::File(file_entry(rel, &m)),
                                Ok(_) => return WalkState::Continue,
                                Err(_) => Found::Skipped,
                            },
                        },
                        Err(_) => Found::Skipped,
                    };
                    if tx.send(found).is_err() {
                        return WalkState::Quit;
                    }
                    WalkState::Continue
                })
            });
        });

        let mut out = CollectedEntries {
            files: Vec::new(),
            dirs: HashSet::new(),
            skipped: 0,
        };
        let mut scanned = 0u64;
        let mut last_report = Instant::now();
        for found in rx {
            scanned += 1;
            match found {
                Found::File(f) => out.files.push(f),
                Found::Dir(d) => {
                    out.dirs.insert(d);
                }
                Found::Skipped => out.skipped += 1,
            }
            if last_report.elapsed() >= PROGRESS_INTERVAL {
                last_report = Instant::now();
                progress(ScanProgress {
                    scanned_entries: scanned,
                    markdown_files: out.files.len() as u64,
                    elapsed: started.elapsed(),
                });
            }
        }
        out
    });

    if cancel.load(Ordering::Relaxed) {
        return Err(Cancelled);
    }
    Ok(collected)
}

pub struct CollectedEntries {
    pub files: Vec<FileEntry>,
    pub dirs: HashSet<String>,
    pub skipped: u32,
}

/// Marks entries shown only because of the dotfile/ignored toggles. `visible` is the result of
/// a walk that respects ignore files, available when ignored entries are shown.
pub fn apply_hidden(files: &mut [FileEntry], visible_files: Option<&HashSet<String>>) {
    for f in files {
        f.hidden =
            is_dotted(&f.rel_path) || visible_files.is_some_and(|v| !v.contains(&f.rel_path));
    }
}

/// An index of the files under `scope` (the whole root when `None`), plus the folders seen and
/// their hidden flags, so the watcher can merge a partial result into the full index.
pub struct ScopedIndex {
    pub index: Index,
    /// Folders found under the scope, with their hidden flag.
    pub dirs: Vec<(String, bool)>,
    pub skipped: u32,
}

/// Walks the root (or one scope) and builds an index of what it finds.
pub fn index_scope(
    root: &Path,
    opts: &ScanOptions,
    scope: Option<&str>,
    cancel: &AtomicBool,
    progress: &dyn Fn(ScanProgress),
) -> Result<ScopedIndex, Cancelled> {
    let mut all = collect(root, opts, !opts.show_ignored, scope, cancel, progress)?;

    // In "show ignored" mode, a second walk that respects the ignore files tells which entries
    // are ignored, so the tree can dim them.
    let visible = if opts.show_ignored {
        let v = collect(root, opts, true, scope, cancel, &|_| {})?;
        Some((
            v.files
                .into_iter()
                .map(|f| f.rel_path)
                .collect::<HashSet<_>>(),
            v.dirs,
        ))
    } else {
        None
    };

    apply_hidden(&mut all.files, visible.as_ref().map(|(f, _)| f));
    let mut index = Index::default();
    for f in all.files {
        index.insert_file(f);
    }
    let mut dirs = Vec::with_capacity(all.dirs.len());
    for dir in all.dirs {
        let hidden = is_dotted(&dir)
            || visible
                .as_ref()
                .is_some_and(|(_, visible_dirs)| !visible_dirs.contains(&dir));
        index.set_dir_hidden(&dir, hidden);
        dirs.push((dir, hidden));
    }
    Ok(ScopedIndex {
        index,
        dirs,
        skipped: all.skipped,
    })
}

/// Scans the whole root and builds the index.
pub fn scan(
    root: &Path,
    opts: &ScanOptions,
    cancel: &AtomicBool,
    progress: &dyn Fn(ScanProgress),
) -> Result<ScanResult, Cancelled> {
    let started = Instant::now();
    let scoped = index_scope(root, opts, None, cancel, progress)?;
    Ok(ScanResult {
        index: scoped.index,
        skipped: scoped.skipped,
        elapsed: started.elapsed(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }

    fn fixture() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        for rel in [
            "README.md",
            "docs/a.md",
            "docs/UPPER.MD",
            "docs/guide/b.markdown",
            "docs/notes.mdx",
            "src/main.rs",
            "build/out.md",
            "node_modules/pkg/README.md",
            ".git/info/x.md",
            ".github/CONTRIBUTING.md",
            "vendor/keep.md",
            "vendor/drop.md",
        ] {
            write(r, rel, "# x");
        }
        write(r, ".gitignore", "build/\n");
        write(r, "vendor/.ignore", "drop.md\n");
        d
    }

    fn paths(index: &Index) -> Vec<String> {
        let mut v: Vec<String> = index
            .files_within("")
            .keys()
            .map(|k| (*k).to_owned())
            .collect();
        v.sort();
        v
    }

    fn run(root: &Path, opts: &ScanOptions) -> ScanResult {
        let root = dunce::canonicalize(root).unwrap();
        scan(&root, opts, &AtomicBool::new(false), &|_| {}).unwrap()
    }

    #[test]
    fn default_scan_respects_ignore_rules() {
        let d = fixture();
        let r = run(d.path(), &ScanOptions::default());
        assert_eq!(
            paths(&r.index),
            [
                "README.md",
                "docs/UPPER.MD",
                "docs/a.md",
                "docs/guide/b.markdown",
                "vendor/keep.md"
            ]
        );
        // `src` has no markdown and must not appear.
        let (dirs, _) = r.index.list_dir("").unwrap();
        let names: Vec<_> = dirs.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, ["docs", "vendor"]);
    }

    #[test]
    fn show_dotfiles_reveals_dotfolders_but_never_git() {
        let d = fixture();
        let opts = ScanOptions {
            show_dotfiles: true,
            ..ScanOptions::default()
        };
        let r = run(d.path(), &opts);
        let p = paths(&r.index);
        assert!(p.contains(&".github/CONTRIBUTING.md".to_owned()));
        assert!(!p.iter().any(|x| x.starts_with(".git/")));
        assert!(r.index.file(".github/CONTRIBUTING.md").unwrap().hidden);
        let (dirs, _) = r.index.list_dir("").unwrap();
        assert!(dirs.iter().find(|d| d.name == ".github").unwrap().hidden);
    }

    #[test]
    fn show_ignored_reveals_and_flags_ignored_entries() {
        let d = fixture();
        let opts = ScanOptions {
            show_ignored: true,
            ..ScanOptions::default()
        };
        let r = run(d.path(), &opts);
        let p = paths(&r.index);
        assert!(p.contains(&"build/out.md".to_owned()));
        assert!(p.contains(&"vendor/drop.md".to_owned()));
        assert!(!p.iter().any(|x| x.starts_with("node_modules/")));
        assert!(r.index.file("build/out.md").unwrap().hidden);
        assert!(r.index.file("vendor/drop.md").unwrap().hidden);
        assert!(!r.index.file("vendor/keep.md").unwrap().hidden);
        let (dirs, _) = r.index.list_dir("").unwrap();
        assert!(dirs.iter().find(|d| d.name == "build").unwrap().hidden);
        assert!(!dirs.iter().find(|d| d.name == "docs").unwrap().hidden);
    }

    #[test]
    fn extra_patterns_apply_in_every_mode() {
        let d = fixture();
        for show_ignored in [false, true] {
            let opts = ScanOptions {
                show_ignored,
                extra_ignores: vec!["docs/guide/".into(), "*.MD".into()],
                ..ScanOptions::default()
            };
            let p = paths(&run(d.path(), &opts).index);
            assert!(
                !p.contains(&"docs/guide/b.markdown".to_owned()),
                "{show_ignored}"
            );
            assert!(!p.contains(&"docs/UPPER.MD".to_owned()), "{show_ignored}");
            assert!(p.contains(&"docs/a.md".to_owned()), "{show_ignored}");
        }
    }

    #[test]
    fn gitignore_of_a_parent_folder_applies_to_an_opened_subfolder() {
        let d = fixture();
        write(d.path(), ".gitignore", "build/\nsecret.md\n");
        write(d.path(), "docs/secret.md", "x");
        let r = run(&d.path().join("docs"), &ScanOptions::default());
        assert!(r.index.file("a.md").is_some());
        assert!(r.index.file("secret.md").is_none());
    }

    #[test]
    fn scoped_walk_only_covers_its_scope_and_keeps_ignore_rules() {
        let d = fixture();
        let root = dunce::canonicalize(d.path()).unwrap();
        let none = AtomicBool::new(false);
        let opts = ScanOptions::default();
        let s = index_scope(&root, &opts, Some("docs/guide"), &none, &|_| {}).unwrap();
        assert_eq!(paths(&s.index), ["docs/guide/b.markdown"]);
        // build/ is ignored by the root .gitignore, even when walked as a scope.
        let s = index_scope(&root, &opts, Some("build"), &none, &|_| {}).unwrap();
        assert!(paths(&s.index).is_empty());
        let s = index_scope(&root, &opts, Some("docs/a.md"), &none, &|_| {}).unwrap();
        assert_eq!(paths(&s.index), ["docs/a.md"]);
    }

    #[test]
    fn cancelled_scan_returns_cancelled() {
        let d = fixture();
        let root = dunce::canonicalize(d.path()).unwrap();
        let cancel = AtomicBool::new(true);
        assert_eq!(
            scan(&root, &ScanOptions::default(), &cancel, &|_| {}).unwrap_err(),
            Cancelled
        );
    }

    #[test]
    fn scans_twelve_thousand_files_quickly() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        // 120 folders x 100 files = 12,000 files, 10% markdown, plus ignored noise.
        for i in 0..120 {
            let dir = r.join(format!("pkg{i}/sub{}", i % 7));
            fs::create_dir_all(&dir).unwrap();
            for j in 0..100 {
                let name = if j % 10 == 0 {
                    format!("doc{j}.md")
                } else {
                    format!("code{j}.rs")
                };
                fs::write(dir.join(name), "x").unwrap();
            }
        }
        for j in 0..200 {
            write(r, &format!("node_modules/p{j}/README.md"), "x");
        }
        write(r, ".gitignore", "pkg1*/\n");
        let progress_calls = std::sync::atomic::AtomicU32::new(0);
        let root = dunce::canonicalize(r).unwrap();
        let started = Instant::now();
        let result = scan(
            &root,
            &ScanOptions::default(),
            &AtomicBool::new(false),
            &|_| {
                progress_calls.fetch_add(1, Ordering::Relaxed);
            },
        )
        .unwrap();
        let elapsed = started.elapsed();
        // pkg1, pkg10..pkg19, pkg100..pkg119 are ignored: 1 + 10 + 20 = 31 folders.
        assert_eq!(result.index.file_count(), (120 - 31) * 10);
        assert!(elapsed < Duration::from_secs(3), "scan took {elapsed:?}");
    }
}
