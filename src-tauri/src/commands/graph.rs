//! Queries on the document graph: link status, backlinks, broken links.

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::error::AppResult;
use crate::graph::links::LinkTarget;
use crate::graph::{Graph, GraphStatus, LinkInfo};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DocLinks {
    pub rel_path: String,
    /// False while the graph is building: statuses may still be `notChecked`.
    pub graph_ready: bool,
    pub links: Vec<LinkInfo>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Backlink {
    pub from_path: String,
    pub line: u32,
    /// The link text.
    pub text: String,
    /// The heading the link points at, if any.
    pub fragment: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Backlinks {
    pub rel_path: String,
    pub graph_ready: bool,
    /// Sorted by source path, then line.
    pub items: Vec<Backlink>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BrokenDoc {
    pub rel_path: String,
    pub links: Vec<LinkInfo>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BrokenLinksReport {
    pub generation: u64,
    pub graph_ready: bool,
    pub parsed_docs: u32,
    pub total_docs: u32,
    /// Documents with at least one broken link, sorted by path.
    pub docs: Vec<BrokenDoc>,
}

fn with_graph<R>(state: &AppState, f: impl FnOnce(&Graph, u64) -> R) -> AppResult<R> {
    state.with_workspace(|ws| {
        let graph = ws.graph.read().unwrap_or_else(|e| e.into_inner());
        Ok(f(&graph, ws.generation))
    })
}

/// Progress of the graph build and the number of broken links (the status bar asks on startup,
/// since it may have missed the events).
#[tauri::command]
pub fn get_graph_status(state: State<'_, AppState>) -> AppResult<GraphStatus> {
    with_graph(&state, |g, generation| g.status(generation))
}

/// The links of a document with their status, for the preview's flags.
#[tauri::command]
pub fn get_doc_links(state: State<'_, AppState>, rel_path: String) -> AppResult<DocLinks> {
    with_graph(&state, |g, _| DocLinks {
        links: g
            .doc(&rel_path)
            .map(|d| d.links.clone())
            .unwrap_or_default(),
        rel_path,
        graph_ready: g.ready,
    })
}

/// The documents that link to `rel_path`.
#[tauri::command]
pub fn get_backlinks(state: State<'_, AppState>, rel_path: String) -> AppResult<Backlinks> {
    with_graph(&state, |g, _| Backlinks {
        items: backlinks_of(g, &rel_path),
        rel_path,
        graph_ready: g.ready,
    })
}

pub fn backlinks_of(g: &Graph, rel_path: &str) -> Vec<Backlink> {
    g.backlinks(rel_path)
        .into_iter()
        .map(|(from_path, link)| Backlink {
            from_path,
            line: link.line,
            text: link.text,
            fragment: match link.target {
                LinkTarget::Document { fragment, .. } => fragment,
                _ => None,
            },
        })
        .collect()
}

/// Every broken link of the folder, grouped by document.
#[tauri::command]
pub fn list_broken_links(state: State<'_, AppState>) -> AppResult<BrokenLinksReport> {
    with_graph(&state, broken_report)
}

pub fn broken_report(g: &Graph, generation: u64) -> BrokenLinksReport {
    let status = g.status(generation);
    let mut docs: Vec<BrokenDoc> = g
        .docs_with_problems()
        .map(|(rel, links)| BrokenDoc {
            rel_path: rel.to_owned(),
            links,
        })
        .collect();
    docs.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    BrokenLinksReport {
        generation,
        graph_ready: status.ready,
        parsed_docs: status.parsed_docs,
        total_docs: status.total_docs,
        docs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::SharedGraph;
    use crate::index::SharedIndex;
    use crate::index::scanner::{self, ScanOptions};
    use crate::paths::RootGuard;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, RwLock};

    fn graph_of(files: &[(&str, &str)]) -> (tempfile::TempDir, SharedGraph) {
        let dir = tempfile::tempdir().unwrap();
        for (rel, text) in files {
            let p = dir.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        }
        let guard = RootGuard::new(dir.path()).unwrap();
        let none = AtomicBool::new(false);
        let index = scanner::scan(guard.root(), &ScanOptions::default(), &none, &|_| {})
            .unwrap()
            .index;
        let index: SharedIndex = Arc::new(RwLock::new(Some(index)));
        let graph: SharedGraph = Arc::default();
        crate::graph::build(&guard, &index, &graph, &none, &|_, _| {}).unwrap();
        (dir, graph)
    }

    #[test]
    fn broken_links_are_grouped_by_document_and_sorted() {
        let (_d, graph) = graph_of(&[
            ("z.md", "[x](missing.md) [ok](a.md)\n"),
            ("a.md", "# A\n\n[y](#nope) [w](../out.md)\n"),
            ("m.md", "[fine](a.md#a)\n"),
        ]);
        let g = graph.read().unwrap();
        let report = broken_report(&g, 3);
        assert!(report.graph_ready);
        assert_eq!(report.generation, 3);
        let docs: Vec<_> = report
            .docs
            .iter()
            .map(|d| (d.rel_path.as_str(), d.links.len()))
            .collect();
        assert_eq!(docs, [("a.md", 2), ("z.md", 1)]);
    }

    #[test]
    fn backlinks_carry_the_line_text_and_fragment() {
        let (_d, graph) = graph_of(&[
            ("a.md", "# A\n\n## Part\n"),
            ("docs/b.md", "intro\n\nsee [part](../a.md#part)\n"),
            ("c.md", "[a](a.md) [again](./a.md)\n"),
        ]);
        let g = graph.read().unwrap();
        let items = backlinks_of(&g, "a.md");
        let summary: Vec<_> = items
            .iter()
            .map(|b| {
                (
                    b.from_path.as_str(),
                    b.line,
                    b.text.as_str(),
                    b.fragment.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("c.md", 1, "a", None),
                ("c.md", 1, "again", None),
                ("docs/b.md", 3, "part", Some("part")),
            ]
        );
    }
}
