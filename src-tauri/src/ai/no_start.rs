//! Rule 1 of the AI integration principles, at the level of the whole backend: nothing that
//! happens without a user action ever starts an AI operation.
//!
//! Two tests:
//!
//! - `no_ai_operation_starts_without_a_user_action` builds the real `AppState` with a gateway
//!   over the scripted `MockProvider` and runs what the commands run: open (scan, graph build),
//!   listings, reads, graph queries, symbol and text search, a watcher batch, settings, the AI
//!   read-only commands (status, capabilities, context, estimate, provider setting),
//!   conversations and close. The gateway's counter and the provider's last request stay at
//!   zero; only the final `AiGateway::start` moves them. (The commands themselves need an
//!   `AppHandle` of the real runtime or a `State`, which a test cannot build, so the test calls
//!   the code behind them.)
//! - `only_ai_start_calls_the_gateway_start` reads the sources: `.start(` on the gateway appears
//!   in the `ai_start` command and nowhere else, so no other command can spend tokens.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use notify::EventKind;
use notify::event::CreateKind;

use super::context::{self, Caps};
use super::estimate::estimate;
use super::gateway::AiGateway;
use super::providers::mock::MockProvider;
use super::types::{AiEvent, AiRequest, AiUserAction};
use crate::appdata::AppData;
use crate::appdata::conversations::Conversation;
use crate::appdata::settings::{AiPermissionSettings, SettingsPatch};
use crate::commands::files::{read_markdown_file, read_text_file_at};
use crate::commands::graph::{backlinks_of, broken_report};
use crate::graph;
use crate::index::scanner::{self, ScanOptions};
use crate::index::watcher::{SimpleEvent, apply_plan, classify};
use crate::paths::RootGuard;
use crate::search::symbols::{Candidates, SymbolQuery, search};
use crate::search::text::{TextSearch, TextSearchRequest, build_matcher};
use crate::state::{AppState, Workspace};

fn write(root: &Path, rel: &str, content: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

#[test]
fn no_ai_operation_starts_without_a_user_action() {
    let folder = tempfile::tempdir().unwrap();
    let root = folder.path();
    write(root, "README.md", "# Demo\n\nSee [guide](docs/guide.md).\n");
    write(
        root,
        "docs/guide.md",
        "# Guide\n\n## Install\n\nagent text\n",
    );
    write(root, "CLAUDE.md", "# Rules\n");
    write(root, "src/main.ts", "export const x = 1;\n");
    let appdata = tempfile::tempdir().unwrap();

    // The state of the app, with the scripted provider behind the gateway.
    let provider = MockProvider::default();
    let mut state = AppState::new(AppData::new(appdata.path().to_path_buf()));
    state.ai = AiGateway::new(Box::new(provider.clone()));
    let starts = |state: &AppState| state.ai.starts();
    assert_eq!(starts(&state), 0);

    // open_root: the guard, the workspace, the scan, the graph build, the recent list.
    let guard = RootGuard::new(root).unwrap();
    let options = ScanOptions::default();
    let ws = Workspace::new(guard.clone(), state.next_generation(), options.clone());
    let never = AtomicBool::new(false);
    let scanned = scanner::scan(root, &options, &never, &|_| {}).unwrap();
    *ws.index.write().unwrap() = Some(scanned.index);
    graph::build(&guard, &ws.index, &ws.graph, &never, &|_, _| {}).unwrap();
    let (index, graph_handle, generation) = (ws.index.clone(), ws.graph.clone(), ws.generation);
    *state.workspace.write().unwrap() = Some(ws);
    state
        .appdata
        .with_recent(|r| r.touch(&root.display().to_string(), "demo", 1))
        .unwrap();
    assert_eq!(starts(&state), 0, "open, scan and graph build");

    // Listings, reading, the graph and the symbol search.
    {
        let idx = index.read().unwrap();
        let idx = idx.as_ref().unwrap();
        assert!(idx.list_dir("").is_some());
        assert!(idx.recent_files(0, 50).0 > 0);
        let g = graph_handle.read().unwrap();
        g.status(generation);
        assert_eq!(backlinks_of(&g, "docs/guide.md").len(), 1);
        broken_report(&g, generation);
        let candidates = Candidates::build(idx, &g);
        let query = SymbolQuery {
            query: "guide",
            limit: 10,
            headings_only: false,
            recent: &[],
        };
        assert!(!search(&candidates, &query).0.is_empty());
    }
    read_markdown_file(&root.join("README.md"), "README.md").unwrap();
    read_text_file_at(&root.join("src/main.ts"), "src/main.ts").unwrap();
    assert_eq!(
        starts(&state),
        0,
        "listings, reading, graph and symbol search"
    );

    // Full-text search, as `search_text` runs it.
    let request = TextSearchRequest {
        query: "agent".into(),
        ..TextSearchRequest::default()
    };
    let matcher = build_matcher(&request).unwrap();
    let files: Vec<String> = index
        .read()
        .unwrap()
        .as_ref()
        .unwrap()
        .files_within("")
        .into_keys()
        .map(str::to_owned)
        .collect();
    let mut found = 0;
    TextSearch {
        root,
        files,
        request: &request,
        cancel: &never,
    }
    .run(&matcher, &mut |batch| found += batch.stats.matches);
    assert!(found > 0);
    assert_eq!(starts(&state), 0, "full-text search");

    // A watcher batch: an agent writes a file; the plan is applied to the index and the graph.
    write(
        root,
        "docs/new.md",
        "# New\n\nBack to [home](../README.md).\n",
    );
    let events: Vec<SimpleEvent> = vec![(
        EventKind::Create(CreateKind::File),
        vec![Some("docs/new.md".to_owned())],
    )];
    let changes = {
        let mut slot = index.write().unwrap();
        let idx = slot.as_mut().unwrap();
        let plan = classify(&events, idx, &|rel| {
            std::fs::metadata(root.join(rel)).ok().map(|m| m.is_dir())
        });
        apply_plan(root, &options, idx, &plan, &never)
    };
    assert_eq!(changes.added.len(), 1);
    graph::apply(
        &graph_handle,
        &index,
        &guard,
        &changes,
        &["docs/new.md".to_owned()],
    );
    assert_eq!(starts(&state), 0, "a watcher batch");

    // Settings, including the AI ones and the provider setting.
    let patch: SettingsPatch = serde_json::from_value(serde_json::json!({
        "theme": "dark",
        "ai": {
            "model": "mock",
            "confirmFrom": "medium",
            "permissions": { "commands": "allow", "markdownEdits": "deny" },
            "historyLimit": 20
        }
    }))
    .unwrap();
    let settings = state.appdata.update_settings(|s| patch.apply(s)).unwrap();
    assert_eq!(settings.ai.model, "mock");
    state.appdata.settings().unwrap();
    state.ai.set_provider("mock").unwrap();
    state
        .appdata
        .update_settings(|s| s.ai.provider = "mock".into())
        .unwrap();
    assert_eq!(starts(&state), 0, "settings and the provider setting");

    // The AI commands that are not a start: capabilities, status, context, estimate, cancel.
    let names = state.ai.capabilities().context_file_names;
    state.ai.status(true);
    let documents = context::collect(&guard, Some("docs/guide.md"), &names, Caps::default());
    let documents = documents.unwrap();
    let paths: Vec<String> = documents.iter().map(|d| d.path.clone()).collect();
    let documents = context::documents(&guard, &paths, &names, Caps::default(), false).unwrap();
    estimate(10, &documents, 0);
    state.ai.cancel_all();
    assert_eq!(starts(&state), 0, "AI commands other than the start");

    // Conversations: saving, listing, reading, deleting, forgetting.
    let key = root.display().to_string();
    let conversation = Conversation {
        id: "c1".into(),
        title: "hello".into(),
        ..Conversation::default()
    };
    state
        .appdata
        .save_conversation(&key, conversation, 20)
        .unwrap();
    assert_eq!(state.appdata.list_conversations(&key).unwrap().len(), 1);
    state.appdata.get_conversation(&key, "c1").unwrap();
    state.appdata.delete_conversation(&key, "c1").unwrap();
    state.appdata.forget_conversations(&key).unwrap();
    assert_eq!(starts(&state), 0, "conversation commands");

    // Closing the folder.
    state.ai.cancel_all();
    state.workspace.write().unwrap().take();
    assert_eq!(starts(&state), 0, "close");
    assert!(
        provider.last_request.lock().unwrap().is_none(),
        "the provider never received a request"
    );

    // The counter does count: the gateway's start is the only thing that moves it.
    let (tx, rx) = std::sync::mpsc::channel();
    state
        .ai
        .start(
            AiUserAction::ChatMessage,
            AiRequest {
                prompt: "hello".into(),
                ..AiRequest::default()
            },
            root,
            AiPermissionSettings::default(),
            Box::new(move |_, event| {
                let _ = tx.send(event);
            }),
        )
        .unwrap();
    while let Ok(event) = rx.recv_timeout(std::time::Duration::from_secs(5)) {
        if matches!(event, AiEvent::Done { .. }) {
            break;
        }
    }
    assert_eq!(starts(&state), 1);
    assert!(provider.last_request.lock().unwrap().is_some());
}

/// Every Rust source file under `dir`, with its path relative to `src`.
fn sources(dir: &Path, base: &Path, out: &mut Vec<(String, String)>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            sources(&path, base, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            let rel = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, std::fs::read_to_string(&path).unwrap()));
        }
    }
}

#[test]
fn only_ai_start_calls_the_gateway_start() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    sources(&src, &src, &mut files);
    assert!(files.len() > 20, "the sources were found");

    let mut callers = Vec::new();
    for (rel, text) in &files {
        // The gateway itself, its tests and this file are the door and its checks.
        if rel == "ai/gateway.rs" || rel == "ai/no_start.rs" {
            continue;
        }
        // Only the code before a `#[cfg(test)]` module counts.
        let code = text.split("#[cfg(test)]").next().unwrap_or(text);
        for (n, line) in code.lines().enumerate() {
            let line = line.trim();
            if line.starts_with("//") {
                continue;
            }
            if line.contains(".ai.start(") || line.contains("gateway.start(") {
                callers.push(format!("{rel}:{}", n + 1));
            }
        }
    }
    assert_eq!(
        callers.len(),
        1,
        "the gateway is started from the ai_start command only, found: {callers:?}"
    );
    assert!(
        callers[0].starts_with("commands/ai.rs:"),
        "found: {callers:?}"
    );
    // And that call is inside `ai_start`.
    let (_, text) = files.iter().find(|(r, _)| r == "commands/ai.rs").unwrap();
    let at = text.find("pub fn ai_start(").expect("ai_start exists");
    let call = text.find(".ai.start(").expect("the call exists");
    assert!(call > at);
    let next_command = text[at + 1..]
        .find("#[tauri::command]")
        .map_or(text.len(), |i| at + 1 + i);
    assert!(call < next_command, "the call is in the body of ai_start");
}
