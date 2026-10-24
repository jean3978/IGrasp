//! Full-text search in the markdown files (Ctrl+Shift+F) with ripgrep's crates. There is no
//! index: the live file list is scanned on demand, in parallel, and results stream back in
//! batches (ADR 0010).

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use grep_matcher::{LineTerminator, Matcher as _};
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::sinks::Lossy;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::commands::files::MAX_MARKDOWN_BYTES;
use crate::error::{AppError, AppResult};

/// Stop after this many matches (like VS Code) …
pub const DEFAULT_MAX_RESULTS: u32 = 20_000;
/// … or this many files with matches.
pub const MAX_FILES: u32 = 2_000;
/// Match lines are cut to this many characters around the first match.
pub const MAX_LINE_CHARS: usize = 500;
const FLUSH_INTERVAL: Duration = Duration::from_millis(50);
const FLUSH_MATCHES: usize = 200;

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, optional_fields)]
pub struct TextSearchRequest {
    pub query: String,
    pub match_case: bool,
    pub whole_word: bool,
    pub regex: bool,
    /// Comma-separated globs ("files to include").
    pub include: String,
    /// Comma-separated globs ("files to exclude").
    pub exclude: String,
    pub max_results: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TextMatch {
    /// 1-based line number.
    pub line: u32,
    /// The line (cut around the first match when long), without its line ending.
    pub text: String,
    /// `[start, end)` character offsets of every match within `text`.
    pub ranges: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileMatches {
    pub rel_path: String,
    pub matches: Vec<TextMatch>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SearchStats {
    pub files_searched: u32,
    pub files_matched: u32,
    pub matches: u32,
    /// Files too large or unreadable.
    pub skipped: u32,
    pub elapsed_ms: u64,
}

/// Payload of `search://results`. A file may appear in several batches.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SearchResultsEvent {
    pub search_id: u32,
    pub generation: u64,
    pub files: Vec<FileMatches>,
    pub done: bool,
    pub cancelled: bool,
    /// Stopped at the result or file cap.
    pub truncated: bool,
    pub stats: SearchStats,
}

/// Builds the matcher of a request; an invalid pattern is reported with the engine's message.
pub fn build_matcher(req: &TextSearchRequest) -> AppResult<RegexMatcher> {
    if req.query.is_empty() {
        return Err(AppError::InvalidPattern("The search is empty.".into()));
    }
    RegexMatcherBuilder::new()
        .case_insensitive(!req.match_case)
        .word(req.whole_word)
        .fixed_strings(!req.regex)
        .crlf(true)
        .multi_line(false)
        // Rust regexes are linear-time; these caps bound the memory of huge patterns.
        .size_limit(10 * 1024 * 1024)
        .dfa_size_limit(2 * 1024 * 1024)
        .build(&req.query)
        .map_err(|e| AppError::InvalidPattern(e.to_string()))
}

fn char_offset(text: &str, byte: usize) -> u32 {
    u32::try_from(text[..byte].chars().count()).unwrap_or(u32::MAX)
}

/// The match line as shown: line ending and BOM removed, cut to `MAX_LINE_CHARS` characters
/// around the first match, with every match as character ranges.
pub fn make_match(matcher: &RegexMatcher, line_number: u64, raw: &str) -> Option<TextMatch> {
    let line = raw
        .trim_end_matches(['\n', '\r'])
        .trim_start_matches('\u{FEFF}');
    let mut spans: Vec<(usize, usize)> = Vec::new();
    let _ = matcher.find_iter(line.as_bytes(), |m| {
        if m.start() < m.end() {
            spans.push((m.start(), m.end()));
        }
        true
    });
    let &(first, _) = spans.first()?;
    // Cut on character boundaries so that the first match stays visible.
    let total = line.chars().count();
    let (mut start, mut end) = (0usize, line.len());
    if total > MAX_LINE_CHARS {
        let before = char_offset(line, first) as usize;
        let skip = before.saturating_sub(MAX_LINE_CHARS / 5);
        start = line.char_indices().nth(skip).map_or(0, |(i, _)| i);
        end = line[start..]
            .char_indices()
            .nth(MAX_LINE_CHARS)
            .map_or(line.len(), |(i, _)| start + i);
    }
    let text = &line[start..end];
    let ranges = spans
        .into_iter()
        .filter(|&(s, e)| s >= start && e <= end)
        .map(|(s, e)| [char_offset(text, s - start), char_offset(text, e - start)])
        .collect();
    Some(TextMatch {
        line: u32::try_from(line_number).unwrap_or(u32::MAX),
        text: text.to_owned(),
        ranges,
    })
}

/// Searches one file. `None` when it is skipped (too large or unreadable).
pub fn search_file(matcher: &RegexMatcher, path: &Path, limit: usize) -> Option<Vec<TextMatch>> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_MARKDOWN_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    // Markdown is text: a NUL byte must not stop the search silently.
    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .line_terminator(LineTerminator::crlf())
        .binary_detection(BinaryDetection::none())
        .build();
    let mut matches = Vec::new();
    let sink = Lossy(|line_number, line: &str| {
        if let Some(m) = make_match(matcher, line_number, line) {
            matches.push(m);
        }
        Ok(matches.len() < limit)
    });
    searcher.search_slice(matcher, &bytes, sink).ok()?;
    Some(matches)
}

/// One run of a text search over `files`, reporting batches through `emit`.
pub struct TextSearch<'a> {
    pub root: &'a Path,
    pub files: Vec<String>,
    pub request: &'a TextSearchRequest,
    pub cancel: &'a AtomicBool,
}

/// What `emit` receives: the batch, whether the search is over, and the stats so far.
pub struct Batch {
    pub files: Vec<FileMatches>,
    pub done: bool,
    pub cancelled: bool,
    pub truncated: bool,
    pub stats: SearchStats,
}

impl TextSearch<'_> {
    /// Runs the search on `min(cpus, 8)` threads. The matcher must come from `build_matcher`.
    pub fn run(self, matcher: &RegexMatcher, emit: &mut dyn FnMut(Batch)) {
        let started = Instant::now();
        let max_results = self
            .request
            .max_results
            .unwrap_or(DEFAULT_MAX_RESULTS)
            .max(1);
        let truncated = AtomicBool::new(false);
        let total_matches = AtomicU64::new(0);
        let next = AtomicUsize::new(0);
        let workers = std::thread::available_parallelism().map_or(4, |n| n.get().min(8));
        let (tx, rx) = mpsc::channel::<(String, Option<Vec<TextMatch>>)>();
        let stopped = || self.cancel.load(Ordering::Relaxed) || truncated.load(Ordering::Relaxed);

        std::thread::scope(|scope| {
            for _ in 0..workers {
                let tx = tx.clone();
                let matcher = matcher.clone();
                let (files, next, root) = (&self.files, &next, self.root);
                let total_matches = &total_matches;
                scope.spawn(move || {
                    while !stopped() {
                        let i = next.fetch_add(1, Ordering::Relaxed);
                        let Some(rel) = files.get(i) else { break };
                        // The budget only bounds the work: the collector applies the caps
                        // exactly. One match more than what is left lets it tell whether any
                        // match was really left out (with nothing left, one match proves it).
                        let left = u64::from(max_results)
                            .saturating_sub(total_matches.load(Ordering::Relaxed));
                        let limit = usize::try_from(left + 1).unwrap_or(usize::MAX);
                        let found = search_file(&matcher, &root.join(rel), limit);
                        if let Some(m) = &found {
                            total_matches.fetch_add(m.len() as u64, Ordering::Relaxed);
                        }
                        if tx.send((rel.clone(), found)).is_err() {
                            break;
                        }
                    }
                });
            }
            drop(tx);

            let mut stats = SearchStats::default();
            let mut batch: Vec<FileMatches> = Vec::new();
            let mut pending = 0usize;
            let mut last_flush = Instant::now();
            for (rel, found) in rx {
                stats.files_searched += 1;
                match found {
                    None => stats.skipped += 1,
                    Some(m) if m.is_empty() => {}
                    Some(mut m) => {
                        // Truncated only when a match is actually left out, never merely
                        // because a cap was reached exactly.
                        let room = usize::try_from(max_results.saturating_sub(stats.matches))
                            .unwrap_or(usize::MAX);
                        if room == 0 || stats.files_matched >= MAX_FILES {
                            truncated.store(true, Ordering::Relaxed);
                            continue;
                        }
                        if m.len() > room {
                            m.truncate(room);
                            truncated.store(true, Ordering::Relaxed);
                        }
                        stats.files_matched += 1;
                        stats.matches += u32::try_from(m.len()).unwrap_or(u32::MAX);
                        pending += m.len();
                        batch.push(FileMatches {
                            rel_path: rel,
                            matches: m,
                        });
                    }
                }
                if !batch.is_empty()
                    && (pending >= FLUSH_MATCHES || last_flush.elapsed() >= FLUSH_INTERVAL)
                    && !self.cancel.load(Ordering::Relaxed)
                {
                    stats.elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(0);
                    emit(Batch {
                        files: std::mem::take(&mut batch),
                        done: false,
                        cancelled: false,
                        truncated: false,
                        stats: stats.clone(),
                    });
                    pending = 0;
                    last_flush = Instant::now();
                }
            }
            let cancelled = self.cancel.load(Ordering::SeqCst);
            stats.elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(0);
            emit(Batch {
                files: if cancelled { Vec::new() } else { batch },
                done: true,
                cancelled,
                truncated: truncated.load(Ordering::SeqCst) && !cancelled,
                stats,
            });
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::globs::PathFilter;
    use std::fs;

    fn req(query: &str) -> TextSearchRequest {
        TextSearchRequest {
            query: query.into(),
            ..Default::default()
        }
    }

    fn matches_in(r: &TextSearchRequest, text: &str) -> Vec<(u32, String, Vec<[u32; 2]>)> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, text).unwrap();
        let matcher = build_matcher(r).unwrap();
        search_file(&matcher, &path, usize::MAX)
            .unwrap()
            .into_iter()
            .map(|m| (m.line, m.text, m.ranges))
            .collect()
    }

    #[test]
    fn options_matrix() {
        let text = "Agent writes\nan agent's TODO\nreagent\n";
        assert_eq!(matches_in(&req("agent"), text).len(), 3);
        let case = TextSearchRequest {
            match_case: true,
            ..req("agent")
        };
        assert_eq!(matches_in(&case, text).len(), 2);
        let word = TextSearchRequest {
            whole_word: true,
            ..req("agent")
        };
        assert_eq!(
            matches_in(&word, text)
                .iter()
                .map(|m| m.0)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        let regex = TextSearchRequest {
            regex: true,
            ..req(r"^\w+ag")
        };
        assert_eq!(matches_in(&regex, text)[0].0, 3);
        // Without the regex option, special characters are literal.
        assert!(matches_in(&req("a.e"), text).is_empty());
        assert_eq!(matches_in(&req("'s"), text).len(), 1);
    }

    #[test]
    fn ranges_are_character_offsets_of_every_match() {
        let found = matches_in(&req("é"), "café et thé\r\n");
        assert_eq!(found, [(1, "café et thé".into(), vec![[3, 4], [10, 11]])]);
    }

    #[test]
    fn crlf_bom_and_nul_bytes() {
        let found = matches_in(&req("x"), "\u{FEFF}x first\r\nbin\0ary x\r\n");
        assert_eq!(found[0].1, "x first");
        assert_eq!(found[1].0, 2);
    }

    #[test]
    fn long_lines_are_cut_around_the_first_match() {
        let line = format!("{}needle{}", "a".repeat(2000), "b".repeat(2000));
        let found = matches_in(&req("needle"), &line);
        let (_, text, ranges) = &found[0];
        assert_eq!(text.chars().count(), MAX_LINE_CHARS);
        let [s, e] = ranges[0];
        assert_eq!(
            text.chars()
                .skip(s as usize)
                .take((e - s) as usize)
                .collect::<String>(),
            "needle"
        );
    }

    #[test]
    fn invalid_and_empty_patterns() {
        let bad = TextSearchRequest {
            regex: true,
            ..req("(unclosed")
        };
        assert!(matches!(
            build_matcher(&bad),
            Err(AppError::InvalidPattern(_))
        ));
        assert!(matches!(
            build_matcher(&req("")),
            Err(AppError::InvalidPattern(_))
        ));
        // Look-around is not supported by the linear-time engine.
        let look = TextSearchRequest {
            regex: true,
            ..req("(?=a)")
        };
        assert!(build_matcher(&look).is_err());
    }

    fn run(dir: &Path, files: &[&str], r: &TextSearchRequest, cancel: bool) -> Vec<Batch> {
        let flag = AtomicBool::new(cancel);
        let matcher = build_matcher(r).unwrap();
        let mut batches = Vec::new();
        TextSearch {
            root: dir,
            files: files.iter().map(|s| (*s).to_owned()).collect(),
            request: r,
            cancel: &flag,
        }
        .run(&matcher, &mut |b| batches.push(b));
        batches
    }

    #[test]
    fn streams_batches_and_ends_with_done() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..30 {
            fs::write(dir.path().join(format!("{i}.md")), "hit\nhit\n").unwrap();
        }
        let names: Vec<String> = (0..30).map(|i| format!("{i}.md")).collect();
        let files: Vec<&str> = names
            .iter()
            .map(String::as_str)
            .chain(["gone.md"])
            .collect();
        let batches = run(dir.path(), &files, &req("hit"), false);
        let last = batches.last().unwrap();
        assert!(last.done && !last.cancelled && !last.truncated);
        assert_eq!(last.stats.files_searched, 31);
        assert_eq!(last.stats.files_matched, 30);
        assert_eq!(last.stats.matches, 60);
        assert_eq!(last.stats.skipped, 1);
        let total: usize = batches
            .iter()
            .flat_map(|b| &b.files)
            .map(|f| f.matches.len())
            .sum();
        assert_eq!(total, 60);
    }

    #[test]
    fn stops_at_the_result_cap() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..20 {
            fs::write(dir.path().join(format!("{i}.md")), "hit\n".repeat(10)).unwrap();
        }
        let names: Vec<String> = (0..20).map(|i| format!("{i}.md")).collect();
        let files: Vec<&str> = names.iter().map(String::as_str).collect();
        let capped = TextSearchRequest {
            max_results: Some(25),
            ..req("hit")
        };
        let batches = run(dir.path(), &files, &capped, false);
        let last = batches.last().unwrap();
        assert!(last.truncated);
        // Exactly the cap, however many workers were in flight.
        assert_eq!(last.stats.matches, 25);
        let total: usize = batches
            .iter()
            .flat_map(|b| &b.files)
            .map(|f| f.matches.len())
            .sum();
        assert_eq!(total, 25);
    }

    #[test]
    fn reaching_the_cap_exactly_is_not_truncated() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            fs::write(dir.path().join(format!("{i}.md")), "hit\n".repeat(5)).unwrap();
        }
        fs::write(dir.path().join("none.md"), "nothing here\n").unwrap();
        let names: Vec<String> = (0..5).map(|i| format!("{i}.md")).collect();
        let files: Vec<&str> = names
            .iter()
            .map(String::as_str)
            .chain(["none.md"])
            .collect();
        let capped = TextSearchRequest {
            max_results: Some(25),
            ..req("hit")
        };
        let last = run(dir.path(), &files, &capped, false).pop().unwrap();
        assert_eq!(last.stats.matches, 25);
        assert!(!last.truncated);
    }

    #[test]
    fn a_cancelled_search_reports_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "hit\n").unwrap();
        let batches = run(dir.path(), &["a.md"], &req("hit"), true);
        assert_eq!(batches.len(), 1);
        assert!(batches[0].done && batches[0].cancelled);
        assert!(batches[0].files.is_empty());
    }

    #[test]
    fn filters_apply_before_searching() {
        let filter = PathFilter::new("docs", "*.draft.md").unwrap();
        let files = ["docs/a.md", "docs/b.draft.md", "notes/c.md"];
        let kept: Vec<&str> = files.into_iter().filter(|f| filter.accepts(f)).collect();
        assert_eq!(kept, ["docs/a.md"]);
    }
}
