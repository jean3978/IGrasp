//! The Academy on a real project with the installed provider (ignored tests: they spend tokens).
//! `real_academy` drives the same calls as the app's IPC commands: the outline through
//! `compose_operation` and the gateway (one validated run), every chapter (one staged run), each
//! result saved privately as the frontend saves it; then, on request, shares it into the folder,
//! changes a cited line, runs the local freshness check, the AI review, applies its proposals and
//! checks again. Every AI operation is started here explicitly, one per step, and counted.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;

use super::compose::{ChapterResult, OutlineResult};
use super::freshness::{self, Badge};
use super::operation::compose_operation;
use super::review::TutorialReview;
use super::schema::Tutorial;
use super::{Familiarity, Length, TutorialInput, TutorialRef, TutorialRequest, markdown, share};
use crate::ai::gateway::AiGateway;
use crate::ai::types::{AiEvent, AiOutcome, AiUserAction};
use crate::appdata::AppData;
use crate::appdata::settings::{AiPermissionSettings, Settings};
use crate::commands::tutorials::{check_freshness, prepared, read_tutorial};
use crate::graph;
use crate::index::scanner::{self, ScanOptions};
use crate::learning::root_key;
use crate::paths::RootGuard;
use crate::state::Workspace;

fn var(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

/// What one operation cost and did.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationSummary {
    kind: String,
    stages: u32,
    attempts: u32,
    attempt_reasons: Vec<String>,
    tool_uses: u32,
    input_tokens: u64,
    output_tokens: u64,
    /// As the provider reports it (the session so far, per stage).
    cost_usd: f64,
    wall_ms: u64,
    rejected_count: u32,
    outcome: String,
    error: Option<String>,
}

/// Starts one operation exactly as `ai_start` does and collects its structured outputs.
#[allow(clippy::too_many_arguments)] // A test driver: the app state, spelled out.
fn operate(
    ws: &Workspace,
    appdata: &AppData,
    gateway: &AiGateway,
    names: &[String],
    action: AiUserAction,
    request: &TutorialRequest,
    model: &str,
    log: &mut String,
) -> (OperationSummary, Vec<Value>) {
    let op =
        compose_operation(ws, appdata, names, action, request, Some(model.to_owned())).unwrap();
    let started = Instant::now();
    let (tx, rx) = std::sync::mpsc::channel();
    gateway
        .start(
            action,
            op.request,
            ws.guard.root(),
            AiPermissionSettings::default(),
            Some(op.plan),
            Box::new(move |_, e| {
                let _ = tx.send(e);
            }),
        )
        .unwrap();
    let mut s = OperationSummary {
        kind: op.kind.to_owned(),
        attempts: 1,
        ..OperationSummary::default()
    };
    let mut outputs = Vec::new();
    let mut stage_cost = 0.0;
    while let Ok(e) = rx.recv_timeout(std::time::Duration::from_secs(3600)) {
        match e {
            AiEvent::Stage { number, of, label } => {
                s.stages = of;
                s.cost_usd += stage_cost;
                stage_cost = 0.0;
                log.push_str(&format!("STAGE {number}/{of}: {label}\n"));
            }
            AiEvent::ToolUse { summary, .. } => {
                s.tool_uses += 1;
                log.push_str(&format!("TOOL {summary}\n"));
            }
            AiEvent::Attempt { number, of, reason } => {
                s.attempts += 1;
                s.attempt_reasons.push(reason.clone());
                log.push_str(&format!("ATTEMPT {number}/{of}: {reason}\n"));
            }
            AiEvent::Usage {
                input_tokens,
                output_tokens,
                cost_usd,
                ..
            } => {
                s.input_tokens += input_tokens;
                s.output_tokens += output_tokens;
                stage_cost = cost_usd.unwrap_or(stage_cost);
                log.push_str(&format!(
                    "USAGE {input_tokens} in, {output_tokens} out, {cost_usd:?} USD\n"
                ));
            }
            AiEvent::Error { message } => {
                s.error = Some(message.clone());
                log.push_str(&format!("ERROR {message}\n"));
            }
            AiEvent::StructuredOutput { value } => {
                s.rejected_count += value["rejectedCount"].as_u64().unwrap_or(0) as u32;
                outputs.push(value);
            }
            AiEvent::Done { outcome, detail } => {
                log.push_str(&format!("DONE {outcome:?} {detail:?}\n"));
                s.outcome = format!("{outcome:?}");
                if outcome != AiOutcome::Completed {
                    s.error = s.error.or(detail);
                }
                break;
            }
            _ => {}
        }
    }
    s.cost_usd += stage_cost;
    s.wall_ms = started.elapsed().as_millis() as u64;
    println!("OPERATION {}", serde_json::to_string(&s).unwrap());
    (s, outputs)
}

fn workspace(root: &Path) -> Workspace {
    let guard = RootGuard::new(root).unwrap();
    let options = ScanOptions::default();
    let ws = Workspace::new(guard.clone(), 1, options.clone());
    let never = AtomicBool::new(false);
    let scanned = scanner::scan(guard.root(), &options, &never, &|_| {}).unwrap();
    *ws.index.write().unwrap() = Some(scanned.index);
    graph::build(&guard, &ws.index, &ws.graph, &never, &|_, _| {}).unwrap();
    ws
}

/// Changes the first line of a cited text range of the tutorial (a comment appended), as a
/// developer editing the code would; returns `path:line`.
fn change_a_cited_line(root: &Path, t: &Tutorial) -> Option<String> {
    for s in &t.sources {
        let (Some(lines), Some(_)) = (&s.lines, &s.sha256) else {
            continue;
        };
        let first: usize = lines.split('-').next()?.trim().parse().ok()?;
        let path = root.join(&s.path);
        let text = std::fs::read_to_string(&path).ok()?;
        let mut all: Vec<String> = text.lines().map(str::to_owned).collect();
        let line = all.get_mut(first - 1)?;
        if line.trim().is_empty() {
            continue;
        }
        line.push_str("  ");
        line.push_str(if s.path.ends_with(".md") {
            "<!-- edited -->"
        } else if s.path.ends_with(".py") || s.path.ends_with(".gd") || s.path.ends_with(".toml") {
            "# edited"
        } else {
            "/* edited */"
        });
        std::fs::write(&path, all.join("\n") + "\n").ok()?;
        return Some(format!("{}:{first}", s.path));
    }
    None
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    root: String,
    subject: String,
    model: String,
    starts: u32,
    operations: Vec<OperationSummary>,
    chapters: usize,
    steps: usize,
    shared_as: Option<String>,
    changed_line: Option<String>,
    badge_after_change: Option<Badge>,
    affected_after_change: usize,
    review_outdated_chapters: usize,
    review_proposals: usize,
    review_missing_topics: Vec<String>,
    badge_after_review: Option<Badge>,
}

/// `IGRASP_ACADEMY_ROOT` (a folder to write into: use a temporary clone), `IGRASP_ACADEMY_SUBJECT`,
/// `IGRASP_ACADEMY_FAMILIARITY`, `IGRASP_ACADEMY_LENGTH`, `IGRASP_ACADEMY_GAP` ("I'm new to …"),
/// `IGRASP_ACADEMY_MODEL` (sonnet), `IGRASP_ACADEMY_SHARE=1` (then change a cited line, check,
/// review, apply), `IGRASP_ACADEMY_OUT` (the report, the tutorial's markdown and JSON, the log).
/// `cargo test --manifest-path src-tauri/Cargo.toml real_academy -- --ignored --nocapture`.
#[test]
#[ignore = "uses the real AI provider and spends tokens"]
fn real_academy() {
    let root = dunce::canonicalize(PathBuf::from(
        var("IGRASP_ACADEMY_ROOT").expect("IGRASP_ACADEMY_ROOT: a temporary clone"),
    ))
    .unwrap();
    let out = PathBuf::from(var("IGRASP_ACADEMY_OUT").expect("IGRASP_ACADEMY_OUT"));
    std::fs::create_dir_all(&out).unwrap();
    let model = var("IGRASP_ACADEMY_MODEL").unwrap_or_else(|| "sonnet".into());
    let input = TutorialInput {
        subject: var("IGRASP_ACADEMY_SUBJECT").unwrap_or_else(|| "The big picture".into()),
        familiarity: var("IGRASP_ACADEMY_FAMILIARITY")
            .and_then(|f| Familiarity::parse(&f))
            .unwrap_or_default(),
        domain_gap: var("IGRASP_ACADEMY_GAP"),
        length: var("IGRASP_ACADEMY_LENGTH")
            .and_then(|l| Length::parse(&l))
            .unwrap_or_default(),
        ..TutorialInput::default()
    };
    let appdata_dir = tempfile::tempdir().unwrap();
    let appdata = AppData::new(appdata_dir.path().to_path_buf());
    let gateway = AiGateway::from_settings(&Settings::default());
    let names = gateway.capabilities().context_file_names;
    let ws = workspace(&root);
    let key = root_key(&ws);
    let mut log = String::new();
    let mut report = Report {
        root: root.display().to_string(),
        subject: input.subject.clone(),
        model: model.clone(),
        ..Report::default()
    };

    // 1. The outline (one validated run), saved privately as the frontend does.
    let (op, outputs) = operate(
        &ws,
        &appdata,
        &gateway,
        &names,
        AiUserAction::TutorialGeneration,
        &TutorialRequest::Outline {
            input: input.clone(),
        },
        &model,
        &mut log,
    );
    report.operations.push(op);
    let outline: OutlineResult =
        serde_json::from_value(outputs.last().cloned().expect("an outline")).unwrap();
    assert!(!outline.chapters.is_empty(), "{:?}", outline.material_note);
    let project = ws
        .guard
        .root()
        .file_name()
        .map_or("project".into(), |n| n.to_string_lossy().into_owned());
    let planned = Tutorial {
        title: outline.title.clone(),
        intro: outline.intro.clone(),
        project,
        subject: input.subject.clone(),
        familiarity: input.familiarity,
        domain_gap: input.domain_gap.clone(),
        length: input.length,
        model: model.clone(),
        material_note: outline.material_note.clone(),
        docs_note: outline.docs_note.clone(),
        chapters: outline.chapters.clone(),
        ..Tutorial::default()
    };
    let mut t = appdata
        .save_private_tutorial(&key, prepared(&root, gateway.provider_id(), planned))
        .unwrap()
        .tutorial;

    // 2. Every chapter (one staged run), each saved as it arrives.
    let indices: Vec<u32> = (0..t.chapters.len() as u32).collect();
    let (op, outputs) = operate(
        &ws,
        &appdata,
        &gateway,
        &names,
        AiUserAction::TutorialGeneration,
        &TutorialRequest::Chapters {
            id: t.id.clone(),
            indices,
        },
        &model,
        &mut log,
    );
    report.operations.push(op);
    for v in outputs {
        let r: ChapterResult = serde_json::from_value(v).unwrap();
        if let Some(c) = t.chapters.iter_mut().find(|c| c.id == r.chapter.id) {
            *c = r.chapter;
        }
        if t.docs_note.is_none() {
            t.docs_note = r.docs_note;
        }
        t = appdata
            .save_private_tutorial(&key, prepared(&root, gateway.provider_id(), t))
            .unwrap()
            .tutorial;
    }
    report.chapters = t.chapters.iter().filter(|c| c.is_written()).count();
    report.steps = t.chapters.iter().map(|c| c.steps.len()).sum();
    let write_out = |name: &str, t: &Tutorial| {
        let dir = out.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        for f in markdown::write(t, "") {
            std::fs::write(dir.join(&f.name), &f.text).unwrap();
        }
        std::fs::write(
            dir.join("tutorial.json"),
            serde_json::to_string_pretty(t).unwrap(),
        )
        .unwrap();
    };
    write_out("tutorial", &t);

    if var("IGRASP_ACADEMY_SHARE").is_some() {
        // 3. Share with the project (the confirmed write), read it back.
        let folder = share::share_folder(&ws.guard, "docs/tutorials", &t, None).unwrap();
        let readme = share::write(&ws.guard, &folder, &t)
            .unwrap()
            .readme
            .unwrap();
        appdata
            .set_tutorial_shared_as(&key, &t.id, &readme)
            .unwrap();
        let shared = TutorialRef::Shared {
            rel_path: readme.clone(),
        };
        assert_eq!(read_tutorial(&ws, &appdata, &shared).unwrap(), t);
        report.shared_as = Some(readme.clone());

        // 4. A developer changes a cited line; the local check sees it (no token).
        report.changed_line = change_a_cited_line(&root, &t);
        let fresh = check_freshness(&ws, &appdata, &shared).unwrap();
        report.badge_after_change = Some(fresh.badge);
        report.affected_after_change = fresh.affected.len();

        // 5. Check with the AI (one validated run), accept every proposal, write the shared copy.
        let (op, outputs) = operate(
            &ws,
            &appdata,
            &gateway,
            &names,
            AiUserAction::TutorialReview,
            &TutorialRequest::Review {
                tutorial: shared.clone(),
            },
            &model,
            &mut log,
        );
        report.operations.push(op);
        if let Some(v) = outputs.last() {
            let review: TutorialReview = serde_json::from_value(v.clone()).unwrap();
            std::fs::write(
                out.join("review.json"),
                serde_json::to_string_pretty(&review).unwrap(),
            )
            .unwrap();
            report.review_outdated_chapters = review
                .chapters
                .iter()
                .filter(|c| c.verdict == super::review::ChapterVerdict::Outdated)
                .count();
            report.review_proposals = review.chapters.iter().map(|c| c.proposals.len()).sum();
            report.review_missing_topics = review
                .missing_topics
                .iter()
                .map(|m| m.title.clone())
                .collect();
            let mut next = read_tutorial(&ws, &appdata, &shared).unwrap();
            for c in &review.chapters {
                for p in &c.proposals {
                    if let Some(step) = next.chapters[c.index as usize]
                        .steps
                        .get_mut(p.step as usize)
                    {
                        *step = p.replacement.clone();
                    }
                }
            }
            let next = prepared(&root, gateway.provider_id(), next);
            share::write(&ws.guard, share::folder_of(&readme), &next).unwrap();
            write_out("reviewed", &next);
            report.badge_after_review = Some(freshness::check(&root, &next).badge);
        }
    }

    report.starts = gateway.starts();
    let expected = report.operations.len() as u32;
    std::fs::write(out.join("events.log"), &log).unwrap();
    std::fs::write(
        out.join("report.json"),
        serde_json::to_string_pretty(&report).unwrap(),
    )
    .unwrap();
    println!("REPORT {}", serde_json::to_string_pretty(&report).unwrap());
    // One AI operation per explicit step, nothing else.
    assert_eq!(report.starts, expected);
}
