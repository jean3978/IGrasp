//! The free local freshness check of a tutorial (no token): every cited range is hashed when
//! the tutorial is written (SHA-256 of its lines, `\n`-joined, `\r` removed, as the quiz files);
//! on open, the hashes are compared with the files. A range whose lines only moved (the same
//! lines elsewhere in the file) is relocated locally; a changed range or a missing file is
//! reported for the badge and the course map.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::schema::{Citation, SourceHash, Tutorial};
use crate::learning::corpus::read_text;

/// The SHA-256 (hex) of `lines` joined with `\n`, `\r` removed.
pub fn hash_lines(lines: &[String]) -> String {
    let mut h = Sha256::new();
    for (i, l) in lines.iter().enumerate() {
        if i > 0 {
            h.update(b"\n");
        }
        h.update(l.replace('\r', "").as_bytes());
    }
    format!("{:x}", h.finalize())
}

fn lines_of(root: &Path, path: &str) -> Option<Vec<String>> {
    read_text(root, path).map(|t| t.lines().map(str::to_owned).collect())
}

fn range(lines: &str) -> Option<(u32, u32)> {
    let (a, b) = match lines.split_once('-') {
        Some((a, b)) => (a.trim().parse().ok()?, b.trim().parse().ok()?),
        None => {
            let n = lines.trim().parse().ok()?;
            (n, n)
        }
    };
    (a >= 1 && a <= b).then_some((a, b))
}

/// Hashes every distinct citation of `t` against the files of `root` (the `sources` of its
/// front matter). A binary asset or an unreadable file gets no hash.
pub fn source_hashes(root: &Path, t: &Tutorial) -> Vec<SourceHash> {
    let mut cache: BTreeMap<String, Option<Vec<String>>> = BTreeMap::new();
    t.citations()
        .iter()
        .map(|c| {
            let lines = c.lines();
            let sha256 = match (c.first_line, c.last_line) {
                (Some(a), Some(b)) => cache
                    .entry(c.path.clone())
                    .or_insert_with(|| lines_of(root, &c.path))
                    .as_ref()
                    .filter(|l| a >= 1 && (b as usize) <= l.len())
                    .map(|l| hash_lines(&l[(a - 1) as usize..b as usize])),
                _ => None,
            };
            SourceHash {
                path: c.path.clone(),
                lines,
                sha256,
            }
        })
        .collect()
}

/// What a cited range looks like now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SourceState {
    UpToDate,
    /// The same lines are elsewhere in the file (relocated locally).
    #[serde(rename_all = "camelCase")]
    Moved {
        first_line: u32,
        last_line: u32,
    },
    /// The lines changed (or no longer exist).
    Changed,
    /// The file is gone (or is not text).
    Missing,
    /// No hash was recorded (a binary asset): only its existence is checked.
    Unchecked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCheck {
    pub path: String,
    pub lines: Option<String>,
    #[serde(flatten)]
    pub state: SourceState,
}

/// The badge of the Academy library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "badge", rename_all = "camelCase")]
pub enum Badge {
    UpToDate,
    MaybeOutdated { changed: usize, of: usize },
    SourcesMissing { missing: usize, of: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub checks: Vec<SourceCheck>,
    pub badge: Badge,
    pub moved: usize,
}

/// Finds the window of `file` whose lines hash to `sha256`, other than the one starting at
/// `except` (1-based): the nearest one when several match.
fn find_moved(file: &[String], len: usize, sha256: &str, except: u32) -> Option<u32> {
    if len == 0 || file.len() < len {
        return None;
    }
    let mut best: Option<u32> = None;
    for start in 0..=file.len() - len {
        let first = u32::try_from(start + 1).unwrap_or(u32::MAX);
        if first == except {
            continue;
        }
        if hash_lines(&file[start..start + len]) == sha256 {
            let better = best.is_none_or(|b| first.abs_diff(except) < b.abs_diff(except));
            if better {
                best = Some(first);
            }
        }
    }
    best
}

/// Checks every source of `t` against the files of `root`.
pub fn check(root: &Path, t: &Tutorial) -> Report {
    let mut cache: BTreeMap<String, Option<Vec<String>>> = BTreeMap::new();
    let mut checks = Vec::new();
    for s in &t.sources {
        let file = cache
            .entry(s.path.clone())
            .or_insert_with(|| lines_of(root, &s.path));
        let state = match (&s.sha256, s.lines.as_deref().and_then(range)) {
            (Some(sha), Some((a, b))) => match file {
                None => {
                    if root.join(&s.path).exists() {
                        SourceState::Changed
                    } else {
                        SourceState::Missing
                    }
                }
                Some(lines) => {
                    let len = (b - a + 1) as usize;
                    let same = (b as usize) <= lines.len()
                        && hash_lines(&lines[(a - 1) as usize..b as usize]) == *sha;
                    if same {
                        SourceState::UpToDate
                    } else {
                        match find_moved(lines, len, sha, a) {
                            Some(first) => SourceState::Moved {
                                first_line: first,
                                last_line: first + (b - a),
                            },
                            None => SourceState::Changed,
                        }
                    }
                }
            },
            _ => {
                if root.join(&s.path).exists() {
                    SourceState::Unchecked
                } else {
                    SourceState::Missing
                }
            }
        };
        checks.push(SourceCheck {
            path: s.path.clone(),
            lines: s.lines.clone(),
            state,
        });
    }
    let of = checks.len();
    let missing = checks
        .iter()
        .filter(|c| c.state == SourceState::Missing)
        .count();
    let changed = checks
        .iter()
        .filter(|c| c.state == SourceState::Changed)
        .count();
    let moved = checks
        .iter()
        .filter(|c| matches!(c.state, SourceState::Moved { .. }))
        .count();
    let badge = if missing > 0 {
        Badge::SourcesMissing { missing, of }
    } else if changed > 0 {
        Badge::MaybeOutdated { changed, of }
    } else {
        Badge::UpToDate
    };
    Report {
        checks,
        badge,
        moved,
    }
}

/// Applies the report's relocations to every citation of `t` and to its sources table;
/// returns how many citations moved. The hashes do not change (the lines are the same).
pub fn relocate(t: &mut Tutorial, report: &Report) -> usize {
    let mut moved = 0;
    for c in &report.checks {
        let SourceState::Moved {
            first_line,
            last_line,
        } = c.state
        else {
            continue;
        };
        let Some(from) = c.lines.as_deref().and_then(range) else {
            continue;
        };
        let to = (first_line, last_line);
        for chapter in &mut t.chapters {
            for step in &mut chapter.steps {
                let before = step.citations();
                step.relocate(&c.path, from, to);
                moved += before
                    .iter()
                    .filter(|x| {
                        x.path == c.path
                            && x.first_line == Some(from.0)
                            && x.last_line == Some(from.1)
                    })
                    .count();
            }
        }
        let new_lines = Citation::new(&c.path, to.0, to.1).lines();
        for s in &mut t.sources {
            if s.path == c.path && s.lines == c.lines {
                s.lines = new_lines.clone();
            }
        }
    }
    moved
}

/// The steps (chapter index, step index) that cite a changed or missing source: marked in the
/// course map.
pub fn affected_steps(t: &Tutorial, report: &Report) -> Vec<(usize, usize)> {
    let bad: Vec<(&str, Option<&str>)> = report
        .checks
        .iter()
        .filter(|c| matches!(c.state, SourceState::Changed | SourceState::Missing))
        .map(|c| (c.path.as_str(), c.lines.as_deref()))
        .collect();
    let mut out = Vec::new();
    for (ci, chapter) in t.chapters.iter().enumerate() {
        for (si, step) in chapter.steps.iter().enumerate() {
            let hit = step.citations().iter().any(|c| {
                let lines = c.lines();
                bad.iter()
                    .any(|(p, l)| *p == c.path && (*l == lines.as_deref() || l.is_none()))
            });
            if hit {
                out.push((ci, si));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::markdown::tests::sample;
    use super::super::schema::Step;
    use super::*;
    use crate::profile::tests::tree;

    const WATCHER: &str = "//! Watches the folder.\npub const DEBOUNCE_MS: u64 = 200;\n\npub struct WatchContext {\n    pub generation: u64,\n}\n";

    #[test]
    fn hashes_are_the_quiz_files_hashes() {
        // sha256("a\nb") with \r removed.
        let h = hash_lines(&["a\r".into(), "b".into()]);
        assert_eq!(h, hash_lines(&["a".into(), "b".into()]));
        assert_eq!(h.len(), 64);
        assert_eq!(
            hash_lines(&["".into()]),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn up_to_date_moved_changed_and_missing() {
        let dir = tree(&[
            ("src/index/watcher.rs", WATCHER),
            ("README.md", "# Orbit\n"),
        ]);
        let mut t = sample();
        // The sample cites watcher.rs 2-6 (and 1-6, 2-2, 4-6 through the tour and the spot-it).
        t.sources = source_hashes(dir.path(), &t);
        assert_eq!(t.sources.len(), 4);
        assert!(t.sources.iter().all(|s| s.sha256.is_some()));
        assert_eq!(check(dir.path(), &t).badge, Badge::UpToDate);

        // Three lines inserted at the top: every range moved, nothing changed.
        let moved_text = format!("// a\n// b\n// c\n{WATCHER}");
        std::fs::write(dir.path().join("src/index/watcher.rs"), &moved_text).unwrap();
        let report = check(dir.path(), &t);
        assert_eq!(report.badge, Badge::UpToDate);
        assert_eq!(report.moved, 4);
        assert_eq!(
            report.checks[0].state,
            SourceState::Moved {
                first_line: 5,
                last_line: 9
            }
        );
        let mut relocated = t.clone();
        let n = relocate(&mut relocated, &report);
        assert!(n >= 4, "{n} citations moved");
        assert_eq!(relocated.sources[0].lines.as_deref(), Some("5-9"));
        let Step::SpotIt(s) = &relocated.chapters[0].steps[6] else {
            panic!()
        };
        assert_eq!((s.first_line, s.last_line, s.answer_line), (4, 9, 5));
        assert_eq!(check(dir.path(), &relocated).moved, 0);
        assert_eq!(check(dir.path(), &relocated).badge, Badge::UpToDate);

        // A cited line changed: maybe outdated, the steps citing it are affected.
        std::fs::write(
            dir.path().join("src/index/watcher.rs"),
            WATCHER.replace("200", "250"),
        )
        .unwrap();
        let report = check(dir.path(), &t);
        assert!(
            matches!(report.badge, Badge::MaybeOutdated { changed: 3, of: 4 }),
            "{:?}",
            report.badge
        );
        let affected = affected_steps(&t, &report);
        assert!(affected.contains(&(0, 0)) && affected.contains(&(0, 6)));
        // 4-6 (the struct) did not change.
        assert_eq!(report.checks[2].state, SourceState::UpToDate);

        // The file is gone: sources missing.
        std::fs::remove_file(dir.path().join("src/index/watcher.rs")).unwrap();
        let report = check(dir.path(), &t);
        assert_eq!(report.badge, Badge::SourcesMissing { missing: 4, of: 4 });
        assert_eq!(affected_steps(&t, &report).len(), 9);
    }

    #[test]
    fn the_nearest_identical_window_wins_and_binary_assets_are_unchecked() {
        let dir = tree(&[("a.txt", "x\ny\nx\ny\nz\nx\ny\n"), ("logo.png", "\u{0}bin")]);
        let file: Vec<String> = "x\ny\nx\ny\nz\nx\ny".lines().map(str::to_owned).collect();
        let sha = hash_lines(&file[0..2]);
        assert_eq!(find_moved(&file, 2, &sha, 1), Some(3));
        assert_eq!(find_moved(&file, 2, &sha, 7), Some(6));
        assert_eq!(find_moved(&file, 9, &sha, 1), None);
        let mut t = sample();
        t.sources = vec![
            SourceHash {
                path: "logo.png".into(),
                lines: None,
                sha256: None,
            },
            SourceHash {
                path: "gone.png".into(),
                lines: None,
                sha256: None,
            },
        ];
        let report = check(dir.path(), &t);
        assert_eq!(report.checks[0].state, SourceState::Unchecked);
        assert_eq!(report.checks[1].state, SourceState::Missing);
    }
}
