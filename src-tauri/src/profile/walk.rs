//! One ignore-aware walk of the whole folder: every file, not only markdown (the project profile
//! and the learning corpus need code, configuration and build files). Dot-folders are included
//! whatever the tree's toggle (`.github/workflows` is part of how a project is built); `.git`
//! and `node_modules` are always skipped; `.gitignore` and the user's patterns apply.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use ignore::WalkState;

use crate::index::scanner::{ALWAYS_SKIPPED, ScanOptions, base_walk_builder, rel_path};

/// Entries visited before the walk stops and reports `truncated`.
pub const MAX_ENTRIES: usize = 200_000;
/// Time spent before the walk stops and reports `truncated`.
pub const MAX_DURATION: Duration = Duration::from_secs(10);

/// What the walk knows about one file, without reading it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFact {
    /// Root-relative with `/`.
    pub path: String,
    pub size: u64,
    /// Lower-case extension without the dot (`""` when none).
    pub ext: String,
    /// Lower-case file name.
    pub name: String,
}

impl FileFact {
    pub fn new(path: &str, size: u64) -> Self {
        let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
        let ext = match name.rfind('.') {
            Some(i) if i > 0 => name[i + 1..].to_owned(),
            _ => String::new(),
        };
        Self {
            path: path.to_owned(),
            size,
            ext,
            name,
        }
    }

    /// The parent folder (`""` for the root).
    pub fn dir(&self) -> &str {
        self.path.rfind('/').map_or("", |i| &self.path[..i])
    }

    pub fn depth(&self) -> usize {
        self.path.matches('/').count()
    }
}

/// The files of a folder, sorted by path.
#[derive(Debug, Clone, Default)]
pub struct Walk {
    pub files: Vec<FileFact>,
    /// The walk hit `MAX_ENTRIES` or `MAX_DURATION` (or was cancelled).
    pub truncated: bool,
}

impl Walk {
    /// A walk of an in-memory list (tests and callers that already have the files).
    pub fn from_files(mut files: Vec<FileFact>) -> Self {
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Self {
            files,
            truncated: false,
        }
    }

    pub fn get(&self, path: &str) -> Option<&FileFact> {
        self.files
            .binary_search_by(|f| f.path.as_str().cmp(path))
            .ok()
            .and_then(|i| self.files.get(i))
    }

    pub fn contains(&self, path: &str) -> bool {
        self.get(path).is_some()
    }

    /// Files whose lower-case name is `name`.
    pub fn named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a FileFact> + 'a {
        self.files.iter().filter(move |f| f.name == name)
    }

    pub fn with_ext<'a>(&'a self, ext: &'a str) -> impl Iterator<Item = &'a FileFact> + 'a {
        self.files.iter().filter(move |f| f.ext == ext)
    }

    /// Files inside `dir` (any depth).
    pub fn under<'a>(&'a self, dir: &'a str) -> impl Iterator<Item = &'a FileFact> + 'a {
        self.files.iter().filter(move |f| {
            dir.is_empty() || f.path.starts_with(dir) && f.path[dir.len()..].starts_with('/')
        })
    }

    /// Files and bytes per folder, counting every ancestor.
    pub fn folder_totals(&self) -> BTreeMap<String, (u64, u64)> {
        let mut out: BTreeMap<String, (u64, u64)> = BTreeMap::new();
        for f in &self.files {
            let mut dir = f.dir();
            loop {
                let e = out.entry(dir.to_owned()).or_default();
                e.0 += 1;
                e.1 += f.size;
                if dir.is_empty() {
                    break;
                }
                dir = dir.rfind('/').map_or("", |i| &dir[..i]);
            }
        }
        out
    }
}

/// Walks `root` with the scan's ignore rules (`extra_ignores` are the user's patterns), dotfiles
/// included. Stops at the budget or when `cancel` is set.
pub fn walk(root: &Path, extra_ignores: &[String], cancel: &AtomicBool) -> Walk {
    walk_with_budget(root, extra_ignores, cancel, MAX_ENTRIES, MAX_DURATION)
}

pub fn walk_with_budget(
    root: &Path,
    extra_ignores: &[String],
    cancel: &AtomicBool,
    max_entries: usize,
    max_duration: Duration,
) -> Walk {
    let opts = ScanOptions {
        show_dotfiles: true,
        show_ignored: false,
        extra_ignores: extra_ignores.to_vec(),
    };
    let mut builder = base_walk_builder(root, &opts, true);
    builder.filter_entry(|e| {
        let is_dir = e.file_type().is_some_and(|t| t.is_dir());
        !(is_dir && ALWAYS_SKIPPED.contains(&e.file_name().to_string_lossy().as_ref()))
    });
    let walker = builder.build_parallel();
    let started = Instant::now();
    let seen = AtomicUsize::new(0);
    let stopped = AtomicBool::new(false);
    let (tx, rx) = mpsc::channel::<FileFact>();
    std::thread::scope(|scope| {
        scope.spawn(|| {
            walker.run(|| {
                let tx = tx.clone();
                let (seen, stopped) = (&seen, &stopped);
                Box::new(move |result| {
                    let n = seen.fetch_add(1, Ordering::Relaxed);
                    if cancel.load(Ordering::Relaxed)
                        || n >= max_entries
                        || (n % 512 == 0 && started.elapsed() > max_duration)
                    {
                        stopped.store(true, Ordering::Relaxed);
                        return WalkState::Quit;
                    }
                    let Ok(entry) = result else {
                        return WalkState::Continue;
                    };
                    if !entry.file_type().is_some_and(|t| t.is_file()) {
                        return WalkState::Continue;
                    }
                    let Some(rel) = rel_path(root, entry.path()) else {
                        return WalkState::Continue;
                    };
                    let size = entry.metadata().map_or(0, |m| m.len());
                    if tx.send(FileFact::new(&rel, size)).is_err() {
                        return WalkState::Quit;
                    }
                    WalkState::Continue
                })
            });
            drop(tx);
        });
    });
    let mut walk = Walk::from_files(rx.into_iter().collect());
    walk.truncated = stopped.load(Ordering::Relaxed);
    walk
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::tests::tree;

    #[test]
    fn walks_every_file_with_ignore_rules_and_dotfolders() {
        let dir = tree(&[
            (".gitignore", "build/\n*.log\n"),
            ("src/main.rs", "fn main() {}\n"),
            (".github/workflows/ci.yml", "on: push\n"),
            ("build/package.json", "{}"),
            ("node_modules/x/package.json", "{}"),
            ("debug.log", "x"),
            ("README.md", "# x\n"),
        ]);
        let w = walk(dir.path(), &[], &AtomicBool::new(false));
        let paths: Vec<&str> = w.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                ".github/workflows/ci.yml",
                ".gitignore",
                "README.md",
                "src/main.rs"
            ]
        );
        assert!(!w.truncated);
        assert_eq!(w.get("src/main.rs").unwrap().ext, "rs");
        assert_eq!(w.get("README.md").unwrap().name, "readme.md");
    }

    #[test]
    fn the_user_patterns_apply() {
        let dir = tree(&[("a/x.ts", "1"), ("b/y.ts", "2")]);
        let w = walk(dir.path(), &["b/".to_owned()], &AtomicBool::new(false));
        assert_eq!(w.files.len(), 1);
    }

    #[test]
    fn the_budget_truncates() {
        let files: Vec<(String, String)> = (0..50)
            .map(|i| (format!("f{i}.txt"), "x".to_owned()))
            .collect();
        let refs: Vec<(&str, &str)> = files
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        let dir = tree(&refs);
        let w = walk_with_budget(dir.path(), &[], &AtomicBool::new(false), 10, MAX_DURATION);
        assert!(w.truncated);
        assert!(w.files.len() < 50);
    }

    #[test]
    fn folder_totals_count_ancestors() {
        let w = Walk::from_files(vec![
            FileFact::new("a/b/c.rs", 10),
            FileFact::new("a/d.rs", 5),
            FileFact::new("e.rs", 1),
        ]);
        let t = w.folder_totals();
        assert_eq!(t["a"], (2, 15));
        assert_eq!(t["a/b"], (1, 10));
        assert_eq!(t[""], (3, 16));
    }
}
