//! "Search everything" (Ctrl+T): fuzzy matching over file names and markdown headings.
//!
//! Candidates come from the index (files) and the document graph (headings) and are cached until
//! either changes. Matching goes through the `Scorer` trait; the implementation is
//! `nucleo-matcher` (the matcher of the Helix editor's picker), see ADR 0011.

use std::collections::HashMap;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32String};
use serde::Serialize;
use ts_rs::TS;

use crate::graph::Graph;
use crate::index::model::{Index, name_of};

/// Results per group unless the request asks for fewer.
pub const DEFAULT_LIMIT: usize = 50;
/// Bonus of a file the user opened recently (scaled by recency).
const RECENT_BONUS: u32 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SymbolKind {
    File,
    Heading,
}

/// Where the matched characters are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MatchedIn {
    Name,
    Path,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SymbolHit {
    pub kind: SymbolKind,
    /// The file (for a heading, the file that contains it).
    pub rel_path: String,
    /// File name or heading text.
    pub name: String,
    pub line: Option<u32>,
    /// Heading anchor (without the preview's id prefix).
    pub slug: Option<String>,
    pub level: Option<u8>,
    pub score: u32,
    /// Matched character (code point) positions in `name` or `rel_path`, see `matched_in`.
    pub matched: Vec<u32>,
    pub matched_in: MatchedIn,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SymbolSearchResult {
    pub request_id: u32,
    pub generation: u64,
    /// False while headings are still being indexed.
    pub graph_ready: bool,
    pub files: Vec<SymbolHit>,
    pub headings: Vec<SymbolHit>,
}

/// A fuzzy matcher: a score and the matched character positions, or `None` for no match.
pub trait Scorer {
    fn score(&mut self, haystack: &Utf32String) -> Option<(u32, Vec<u32>)>;
}

/// `nucleo-matcher` with smart case and Unicode normalization.
pub struct NucleoScorer {
    matcher: Matcher,
    pattern: Pattern,
    indices: Vec<u32>,
}

impl NucleoScorer {
    pub fn new(query: &str, paths: bool) -> Self {
        let config = if paths {
            Config::DEFAULT.match_paths()
        } else {
            Config::DEFAULT
        };
        Self {
            matcher: Matcher::new(config),
            pattern: Pattern::parse(query, CaseMatching::Smart, Normalization::Smart),
            indices: Vec::new(),
        }
    }
}

impl Scorer for NucleoScorer {
    fn score(&mut self, haystack: &Utf32String) -> Option<(u32, Vec<u32>)> {
        self.indices.clear();
        let score =
            self.pattern
                .indices(haystack.slice(..), &mut self.matcher, &mut self.indices)?;
        let mut indices = self.indices.clone();
        indices.sort_unstable();
        indices.dedup();
        Some((score, indices))
    }
}

struct FileCandidate {
    rel_path: String,
    name: Utf32String,
    path: Utf32String,
}

struct HeadingCandidate {
    rel_path: String,
    text: String,
    haystack: Utf32String,
    slug: String,
    line: u32,
    level: u8,
}

/// Every searchable item, built from one version of the index and the graph.
pub struct Candidates {
    key: (u64, usize),
    files: Vec<FileCandidate>,
    headings: Vec<HeadingCandidate>,
}

impl Candidates {
    pub fn build(index: &Index, graph: &Graph) -> Self {
        let files = index
            .files_within("")
            .into_keys()
            .map(|rel| FileCandidate {
                rel_path: rel.to_owned(),
                name: Utf32String::from(name_of(rel)),
                path: Utf32String::from(rel),
            })
            .collect();
        let mut headings: Vec<HeadingCandidate> = graph
            .docs()
            .flat_map(|(rel, doc)| {
                doc.headings.iter().map(move |h| HeadingCandidate {
                    rel_path: rel.clone(),
                    text: h.text.clone(),
                    haystack: Utf32String::from(h.text.as_str()),
                    slug: h.slug.clone(),
                    line: h.line,
                    level: h.level,
                })
            })
            .collect();
        headings.sort_by(|a, b| a.rel_path.cmp(&b.rel_path).then(a.line.cmp(&b.line)));
        Self {
            key: Self::key_of(index, graph),
            files,
            headings,
        }
    }

    fn key_of(index: &Index, graph: &Graph) -> (u64, usize) {
        (graph.version, index.file_count())
    }

    /// Whether this cache still describes the index and the graph.
    pub fn is_current(&self, index: &Index, graph: &Graph) -> bool {
        self.key == Self::key_of(index, graph)
    }
}

pub struct SymbolQuery<'a> {
    pub query: &'a str,
    pub limit: usize,
    pub headings_only: bool,
    /// Files the user opened recently, most recent first.
    pub recent: &'a [String],
}

fn recent_bonus(recent: &HashMap<&str, usize>, rel: &str) -> u32 {
    recent.get(rel).map_or(0, |&i| {
        RECENT_BONUS.saturating_sub(u32::try_from(i).unwrap_or(u32::MAX))
    })
}

fn sort_and_cut(hits: &mut Vec<SymbolHit>, limit: usize) {
    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(a.rel_path.len().cmp(&b.rel_path.len()))
            .then(a.rel_path.cmp(&b.rel_path))
            .then(a.line.cmp(&b.line))
    });
    hits.truncate(limit);
}

/// Searches the candidates. A leading `#` restricts to headings; a `/` matches whole paths.
pub fn search(candidates: &Candidates, q: &SymbolQuery) -> (Vec<SymbolHit>, Vec<SymbolHit>) {
    let limit = if q.limit == 0 { DEFAULT_LIMIT } else { q.limit };
    let recent: HashMap<&str, usize> = q
        .recent
        .iter()
        .enumerate()
        .map(|(i, r)| (r.as_str(), i))
        .collect();
    let (query, headings_only) = match q.query.trim().strip_prefix('#') {
        Some(rest) => (rest.trim(), true),
        None => (q.query.trim(), q.headings_only),
    };

    if query.is_empty() {
        // Nothing typed yet: the recent files, most recent first.
        let files = if headings_only {
            Vec::new()
        } else {
            q.recent
                .iter()
                .filter(|r| candidates.files.iter().any(|f| &f.rel_path == *r))
                .take(limit)
                .map(|r| SymbolHit {
                    kind: SymbolKind::File,
                    rel_path: r.clone(),
                    name: name_of(r).to_owned(),
                    line: None,
                    slug: None,
                    level: None,
                    score: 0,
                    matched: Vec::new(),
                    matched_in: MatchedIn::Name,
                })
                .collect()
        };
        return (files, Vec::new());
    }

    let mut files = Vec::new();
    if !headings_only {
        let by_path = query.contains('/');
        let mut name_scorer = NucleoScorer::new(query, false);
        let mut path_scorer = NucleoScorer::new(query, true);
        for f in &candidates.files {
            let found = if by_path {
                path_scorer.score(&f.path).map(|m| (m, MatchedIn::Path))
            } else {
                name_scorer
                    .score(&f.name)
                    .map(|m| (m, MatchedIn::Name))
                    // The folder can match too, ranked below name matches.
                    .or_else(|| {
                        path_scorer
                            .score(&f.path)
                            .map(|(s, i)| ((s / 2, i), MatchedIn::Path))
                    })
            };
            if let Some(((score, matched), matched_in)) = found {
                files.push(SymbolHit {
                    kind: SymbolKind::File,
                    rel_path: f.rel_path.clone(),
                    name: name_of(&f.rel_path).to_owned(),
                    line: None,
                    slug: None,
                    level: None,
                    score: score + recent_bonus(&recent, &f.rel_path),
                    matched,
                    matched_in,
                });
            }
        }
        sort_and_cut(&mut files, limit);
    }

    let mut headings = Vec::new();
    let mut scorer = NucleoScorer::new(query, false);
    for h in &candidates.headings {
        if let Some((score, matched)) = scorer.score(&h.haystack) {
            headings.push(SymbolHit {
                kind: SymbolKind::Heading,
                rel_path: h.rel_path.clone(),
                name: h.text.clone(),
                line: Some(h.line),
                slug: Some(h.slug.clone()),
                level: Some(h.level),
                score: score + recent_bonus(&recent, &h.rel_path) / 2,
                matched,
                matched_in: MatchedIn::Name,
            });
        }
    }
    sort_and_cut(&mut headings, limit);
    (files, headings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::parse;
    use crate::index::model::entry;

    fn candidates(files: &[(&str, &str)]) -> Candidates {
        let mut index = Index::default();
        let mut graph = Graph::default();
        for (rel, text) in files {
            index.insert_file(entry(rel));
            graph.insert(rel, parse::parse(text));
        }
        Candidates::build(&index, &graph)
    }

    fn query<'a>(q: &'a str, recent: &'a [String]) -> SymbolQuery<'a> {
        SymbolQuery {
            query: q,
            limit: 10,
            headings_only: false,
            recent,
        }
    }

    fn names(hits: &[SymbolHit]) -> Vec<&str> {
        hits.iter().map(|h| h.rel_path.as_str()).collect()
    }

    fn fixture() -> Candidates {
        candidates(&[
            ("README.md", "# Project\n\n## Getting started\n"),
            ("docs/architecture.md", "# Architecture\n\n## Data flow\n"),
            (
                "docs/guide/getting-started.md",
                "# Getting started\n\n## Install\n",
            ),
            ("docs/arch/notes.md", "# Notes\n"),
            ("notes/install-log.md", "# Install log\n"),
        ])
    }

    #[test]
    fn file_names_rank_above_folders() {
        let c = fixture();
        let (files, _) = search(&c, &query("arch", &[]));
        assert_eq!(files[0].rel_path, "docs/architecture.md");
        assert_eq!(files[0].matched_in, MatchedIn::Name);
        assert_eq!(files[0].matched, [0, 1, 2, 3]);
        // docs/arch/notes.md matches through its folder only.
        let notes = files
            .iter()
            .find(|f| f.rel_path == "docs/arch/notes.md")
            .unwrap();
        assert_eq!(notes.matched_in, MatchedIn::Path);
    }

    #[test]
    fn fuzzy_headings_with_their_location() {
        let c = fixture();
        let (_, headings) = search(&c, &query("gtst", &[]));
        assert_eq!(
            names(&headings),
            ["README.md", "docs/guide/getting-started.md"]
        );
        assert_eq!(headings[0].slug.as_deref(), Some("getting-started"));
        assert_eq!(headings[0].line, Some(3));
        assert_eq!(headings[0].level, Some(2));
    }

    #[test]
    fn hash_prefix_searches_headings_only_and_slash_matches_paths() {
        let c = fixture();
        let (files, headings) = search(&c, &query("#install", &[]));
        assert!(files.is_empty());
        assert_eq!(headings.len(), 2);
        let (files, _) = search(&c, &query("guide/get", &[]));
        assert_eq!(names(&files), ["docs/guide/getting-started.md"]);
        assert_eq!(files[0].matched_in, MatchedIn::Path);
    }

    #[test]
    fn recent_files_come_first() {
        let c = fixture();
        let recent = vec!["notes/install-log.md".to_owned(), "README.md".to_owned()];
        let (files, _) = search(&c, &query("", &recent));
        assert_eq!(names(&files), ["notes/install-log.md", "README.md"]);
        let (files, _) = search(&c, &query("md", &recent));
        assert_eq!(files[0].rel_path, "notes/install-log.md");
    }

    #[test]
    fn smart_case() {
        let c = fixture();
        assert!(!search(&c, &query("readme", &[])).0.is_empty());
        assert!(search(&c, &query("ReadMe", &[])).0.is_empty());
    }

    #[test]
    fn cache_follows_the_graph_version() {
        let mut index = Index::default();
        let mut graph = Graph::default();
        index.insert_file(entry("a.md"));
        let c = Candidates::build(&index, &graph);
        assert!(c.is_current(&index, &graph));
        graph.insert("a.md", parse::parse("# A\n"));
        assert!(!c.is_current(&index, &graph));
    }

    #[test]
    #[ignore = "performance check; run with `cargo test --release -- --ignored`"]
    fn ten_thousand_files_and_two_hundred_thousand_headings() {
        let mut index = Index::default();
        let mut graph = Graph::default();
        for i in 0..10_000 {
            let rel = format!("docs/area{}/topic-{i}.md", i % 100);
            index.insert_file(entry(&rel));
            let text: String = (0..20)
                .map(|h| format!("## Heading {h} about subject {}\n\n", i * h))
                .collect();
            graph.insert(&rel, parse::parse(&text));
        }
        let started = std::time::Instant::now();
        let c = Candidates::build(&index, &graph);
        let built = started.elapsed();
        let started = std::time::Instant::now();
        let (files, headings) = search(&c, &query("top", &[]));
        let searched = started.elapsed();
        println!("candidates built in {built:?}, searched in {searched:?}");
        assert_eq!(files.len(), 10);
        assert!(headings.is_empty());
        assert!(searched.as_millis() < 50, "search took {searched:?}");
        let started = std::time::Instant::now();
        let (_, headings) = search(&c, &query("subj 42", &[]));
        let searched = started.elapsed();
        println!("heading search in {searched:?}");
        assert!(!headings.is_empty());
        assert!(searched.as_millis() < 50, "search took {searched:?}");
    }
}
