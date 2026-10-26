//! Performance checks on a generated project of 10,000 markdown files (the plan's reference:
//! ~4 KB, 20 headings and 15 links each, 2 % at ~200 KB, in 1,200 folders, next to other files).
//! They are ignored by default; run them with
//! `cargo test --release --manifest-path src-tauri/Cargo.toml perf -- --ignored --nocapture`.
//! `scripts/gen-large-project.mjs` writes the same kind of project for manual checks in the app.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use crate::graph::{self, SharedGraph};
use crate::index::SharedIndex;
use crate::index::model::Changes;
use crate::index::scanner::{self, ScanOptions};
use crate::paths::RootGuard;
use crate::search::text::{TextSearch, TextSearchRequest, build_matcher};

pub const DOCS: usize = 10_000;
const FOLDERS: usize = 1_200;

/// A small deterministic generator (xorshift), so every run builds the same project.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

const WORDS: [&str; 24] = [
    "agent", "index", "graph", "search", "folder", "heading", "link", "preview", "release",
    "design", "watcher", "session", "outline", "backlink", "theme", "keyboard", "toast", "scan",
    "anchor", "parser", "commit", "branch", "review", "summary",
];

fn doc_path(i: usize) -> String {
    format!("area{}/topic{}/doc-{i}.md", i % 60, i % FOLDERS)
}

fn paragraph(rng: &mut Rng, words: usize) -> String {
    (0..words)
        .map(|_| WORDS[rng.below(WORDS.len())])
        .collect::<Vec<_>>()
        .join(" ")
}

/// Writes the reference project under `root`.
pub fn generate(root: &Path) {
    let mut rng = Rng(0x5eed_1234_abcd_ef01);
    for i in 0..DOCS {
        let path = root.join(doc_path(i));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let big = i % 50 == 0;
        let mut text = format!("# Document {i}\n\n");
        for h in 0..20 {
            text.push_str(&format!(
                "## Section {h} {}\n\n",
                WORDS[(i + h) % WORDS.len()]
            ));
            let words = if big { 1_400 } else { 25 };
            text.push_str(&paragraph(&mut rng, words));
            text.push('\n');
            if h < 15 {
                let target = rng.below(DOCS + DOCS / 50);
                let section = rng.below(20);
                // About 2 % of the links point to documents that do not exist.
                text.push_str(&format!(
                    "\nSee [doc {target}](/{}#section-{section}-{}).\n\n",
                    doc_path(target),
                    WORDS[(target + section) % WORDS.len()]
                ));
            }
        }
        std::fs::write(path, text).unwrap();
        if i % 5 == 0 {
            std::fs::write(
                root.join(format!("area{}/code-{i}.rs", i % 60)),
                "fn main() {}\n",
            )
            .unwrap();
        }
    }
}

struct Project {
    _dir: tempfile::TempDir,
    guard: RootGuard,
    index: SharedIndex,
    graph: SharedGraph,
}

fn timed<T>(label: &str, budget: Duration, f: impl FnOnce() -> T) -> T {
    let started = Instant::now();
    let out = f();
    let elapsed = started.elapsed();
    println!("{label}: {elapsed:?} (budget {budget:?})");
    assert!(
        elapsed <= budget,
        "{label} took {elapsed:?}, over {budget:?}"
    );
    out
}

fn project() -> Project {
    let dir = tempfile::tempdir().unwrap();
    timed("generate 10k docs", Duration::from_secs(120), || {
        generate(dir.path())
    });
    let guard = RootGuard::new(dir.path()).unwrap();
    let none = AtomicBool::new(false);
    let index = timed("scan", Duration::from_secs(3), || {
        scanner::scan(guard.root(), &ScanOptions::default(), &none, &|_| {}).unwrap()
    })
    .index;
    assert_eq!(index.file_count(), DOCS);
    Project {
        _dir: dir,
        guard,
        index: Arc::new(RwLock::new(Some(index))),
        graph: Arc::default(),
    }
}

#[test]
#[ignore = "performance check; run in release with --ignored"]
fn perf_reference_project() {
    let p = project();
    let none = AtomicBool::new(false);

    timed("graph build", Duration::from_secs(2), || {
        graph::build(&p.guard, &p.index, &p.graph, &none, &|_, _| {}).unwrap()
    });
    {
        let g = p.graph.read().unwrap();
        println!(
            "graph: {} docs, {} links, {} broken",
            g.parsed(),
            g.link_count(),
            g.broken_count()
        );
        assert!(g.broken_count() > 0);
    }

    let broken = timed("broken links report", Duration::from_millis(50), || {
        let g = p.graph.read().unwrap();
        crate::commands::graph::broken_report(&g, 1)
    });
    assert!(!broken.docs.is_empty());

    timed(
        "recent files (first 200)",
        Duration::from_millis(20),
        || {
            p.index
                .read()
                .unwrap()
                .as_ref()
                .unwrap()
                .recent_files(0, 200)
        },
    );

    // 50 modified files, re-parsed and re-linked.
    let modified: Vec<_> = (0..50)
        .map(|i| {
            let rel = doc_path(i * 7);
            std::fs::write(
                p.guard.root().join(&rel),
                "# Rewritten\n\n[x](/area0/topic0/doc-0.md)\n",
            )
            .unwrap();
            crate::index::model::entry(&rel)
        })
        .collect();
    let changes = Changes {
        modified,
        ..Changes::default()
    };
    timed(
        "incremental update of 50 files",
        Duration::from_millis(100),
        || graph::apply(&p.graph, &p.index, &p.guard, &changes, &[]),
    );

    let files: Vec<String> = p
        .index
        .read()
        .unwrap()
        .as_ref()
        .unwrap()
        .files_within("")
        .into_keys()
        .map(str::to_owned)
        .collect();
    for (label, request, budget) in [
        (
            "full-text literal",
            TextSearchRequest {
                query: "backlink".into(),
                ..Default::default()
            },
            Duration::from_secs(1),
        ),
        (
            "full-text regex",
            TextSearchRequest {
                query: r"\bagent\b.*summary".into(),
                regex: true,
                ..Default::default()
            },
            Duration::from_secs(3),
        ),
    ] {
        let matcher = build_matcher(&request).unwrap();
        let mut first_batch: Option<Duration> = None;
        let started = Instant::now();
        let mut done = None;
        timed(label, budget, || {
            TextSearch {
                root: p.guard.root(),
                files: files.clone(),
                request: &request,
                cancel: &none,
            }
            .run(&matcher, &mut |b| {
                first_batch.get_or_insert(started.elapsed());
                if b.done {
                    done = Some(b.stats);
                }
            });
        });
        let stats = done.unwrap();
        println!(
            "  first batch after {:?}; {} matches in {} files",
            first_batch.unwrap(),
            stats.matches,
            stats.files_matched
        );
    }
}

/// The Academy on the reference project: the subject cards (the corpus, the subject detection
/// and the families; the profile has its own check) and the freshness check of a tutorial citing
/// 20 ranges, the check run when a tutorial opens and when the library lists it.
#[test]
#[ignore = "performance check; run in release with --ignored"]
fn perf_tutorials() {
    use crate::learning::tutorial::schema::{SourceHash, Tutorial};
    use crate::learning::tutorial::{families, freshness};
    use crate::learning::{corpus, subjects};

    let p = project();
    let none = AtomicBool::new(false);
    let (profile, walk) = crate::profile::build(p.guard.root(), &[], &none);
    let cards = timed("tutorial cards", Duration::from_secs(1), || {
        let corpus = corpus::Corpus::build(
            p.guard.root(),
            &walk,
            &corpus::SourceScope::WholeProject,
            &[],
        );
        let detected = subjects::propose(&profile, &corpus);
        families::build(&profile, &corpus, &detected)
    });
    println!("  {} cards", cards.cards.len());
    // 20 ranges of 10 lines, hashed as when the tutorial was written.
    let t = Tutorial {
        sources: (0..20)
            .map(|i| {
                let path = doc_path(i * 397);
                let text = std::fs::read_to_string(p.guard.root().join(&path)).unwrap();
                let lines: Vec<String> = text.lines().map(str::to_owned).collect();
                SourceHash {
                    path,
                    lines: Some(format!("{}-{}", 3 + i, 12 + i)),
                    sha256: Some(freshness::hash_lines(&lines[2 + i..12 + i])),
                }
            })
            .collect(),
        ..Tutorial::default()
    };
    let report = timed(
        "freshness check, 20 sources",
        Duration::from_millis(200),
        || freshness::check(p.guard.root(), &t),
    );
    assert!(
        report
            .checks
            .iter()
            .all(|c| c.state == freshness::SourceState::UpToDate)
    );
}
