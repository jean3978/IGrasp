//! Composing a quiz generation: from what the user chose (`QuizGenerationInput`) to the one
//! read-only `AiRequest` the gateway starts, with the app's prompt and schema, and the validator
//! that accepts, repairs or gives up on each attempt (`ai::run`). The frontend never writes a
//! prompt for a quiz.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;

use super::difficulty::plan;
use super::prompt::{PromptInput, continuation_prompt, generation_prompt, repair_prompt};
use super::schema::{QuizResult, schema};
use super::validate::{Context, Validated, validate};
use super::{QuizCategory, QuizExclusion, QuizGenerationInput};
use crate::ai::run::{MAX_RETRIES, OutputValidator, Verdict};
use crate::ai::types::{AiPolicy, AiRequest};
use crate::error::{AppError, AppResult};
use crate::learning::corpus::{Corpus, Inlined, SourceScope, read_text};
use crate::learning::subjects::{Subject, custom_anchors, pick_anchors, propose};
use crate::learning::tutorial::schema::Tutorial;
use crate::profile::ProjectProfile;
use crate::profile::walk::Walk;

/// A composed generation: the request, its validator and what the prompt inlines.
pub struct Composed {
    pub request: AiRequest,
    pub validator: QuizValidator,
    /// The documents inlined in the prompt (anchor files, then agent files).
    pub inlined: Vec<Inlined>,
    pub prompt_bytes: u64,
}

/// The anchors of "No specific subject": the README, the architecture page, the main manifest
/// and the largest module's entry (the overview subject's anchors when proposed).
fn default_anchors(profile: &ProjectProfile, subjects: &[Subject], corpus: &Corpus) -> Vec<String> {
    if let Some(overview) = subjects.iter().find(|s| s.id == "concept:architecture") {
        return overview.anchors.clone();
    }
    let mut out: Vec<String> = Vec::new();
    out.extend(profile.docs.readme.clone());
    out.extend(profile.docs.architecture.clone());
    for m in [
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "go.mod",
        "project.godot",
    ] {
        if corpus.files.contains_key(m) {
            out.push(m.to_owned());
        }
    }
    out
}

/// Composes the generation for `input` in the folder of `root`.
#[allow(clippy::too_many_arguments)] // What a quiz request is made of.
pub fn compose(
    root: &Path,
    profile: &ProjectProfile,
    walk: &Walk,
    agent_names: &[String],
    input: QuizGenerationInput,
    tutorial: Option<&Tutorial>,
    model: Option<String>,
    resume_id: Option<String>,
) -> AppResult<Composed> {
    let mut input = input.normalized();
    // "Quiz me on this tutorial": the tutorial's cited files are the sources.
    if let Some(t) = tutorial {
        let mut paths: Vec<String> = t.citations().into_iter().map(|c| c.path).collect();
        paths.sort();
        paths.dedup();
        if paths.is_empty() {
            return Err(AppError::ChapterNotWritten(t.title.clone()));
        }
        input.scope = SourceScope::Paths { paths };
        input.subject_id = None;
        input.custom_subject = None;
        input.category = Some(QuizCategory::Tutorial);
        if input.domain_gap.is_none() {
            input.domain_gap = t.domain_gap.clone();
        }
    }
    let whole = Corpus::build(root, walk, &SourceScope::WholeProject, agent_names);
    let subjects = propose(profile, &whole);
    let subject = match &input.subject_id {
        Some(id) => Some(subjects.iter().find(|s| &s.id == id).cloned().ok_or_else(|| {
            AppError::Ai(format!(
                "The subject \"{id}\" is no longer proposed for this folder; pick another one."
            ))
        })?),
        None => None,
    };
    let typed = input
        .custom_subject
        .as_deref()
        .map(|t| custom_anchors(&whole, t))
        .unwrap_or_default();
    let corpus = if input.scope == SourceScope::WholeProject {
        whole
    } else {
        Corpus::build(root, walk, &input.scope, agent_names)
    };
    if let SourceScope::Paths { paths } = &input.scope
        && corpus.files.values().all(|f| f.binary)
    {
        return Err(AppError::Ai(format!(
            "None of these paths holds text files of the project: {}. Check the paths (root-relative, like src/main.rs or src/save).",
            paths.join(", ")
        )));
    }
    let mut anchors: Vec<String> = match (&subject, &input.scope) {
        (Some(s), _) => s.anchors.clone(),
        // The code to check: its entry files and largest files.
        (None, SourceScope::Paths { .. }) => pick_anchors(corpus.files.values()),
        (None, _) if !typed.is_empty() => typed,
        (None, _) => default_anchors(profile, &subjects, &corpus),
    };
    if input.scope == SourceScope::DocumentationOnly {
        // The subject's documentation, then the README and the architecture page.
        anchors.extend(profile.docs.readme.clone());
        anchors.extend(profile.docs.architecture.clone());
    }
    let mut seen = std::collections::BTreeSet::new();
    anchors.retain(|a| corpus.files.contains_key(a) && seen.insert(a.clone()));
    let level = input.round.map_or(input.start_level, |r| r.level);
    let difficulty_plan = plan(input.count, level);
    let (anchor_text, mut inlined) = corpus.anchors_text(root, &anchors);
    let (agent_text, agent_inlined) = corpus.agent_text(root);
    let map = corpus.map();
    let prompt_input = PromptInput {
        profile,
        subject: subject.as_ref(),
        custom_subject: input.custom_subject.as_deref(),
        category: input.category,
        role: input.role.as_deref(),
        count: input.count,
        plan: difficulty_plan,
        scope: &input.scope,
        round: input.round,
        exclude: &input.exclude,
        domain_gap: input.domain_gap.as_deref(),
        tutorial,
        corpus_map: &map,
        anchor_files: &anchor_text,
        agent_files: &agent_text,
    };
    // A continued conversation already has the project, the corpus and the rules.
    let prompt = if resume_id.is_some() {
        inlined.clear();
        continuation_prompt(&prompt_input)
    } else {
        inlined.extend(agent_inlined);
        generation_prompt(&prompt_input)
    };
    let prompt_bytes = prompt.len() as u64;
    let validator = QuizValidator {
        root: root.to_path_buf(),
        corpus,
        agent_names: agent_names.to_vec(),
        project_name: profile.name.clone(),
        modules: profile.modules.iter().map(|m| m.path.clone()).collect(),
        exclude: input.exclude.clone(),
        count: input.count as usize,
        plan: difficulty_plan,
        cache: HashMap::new(),
        best: None,
        rejected_total: 0,
        last_reason: String::new(),
    };
    Ok(Composed {
        request: AiRequest {
            prompt,
            model,
            resume_id,
            policy: AiPolicy::ReadOnly,
            output_schema: Some(schema()),
            ..AiRequest::default()
        },
        validator,
        inlined,
        prompt_bytes,
    })
}

/// Accepts, repairs or gives up on the answers of a quiz generation.
pub struct QuizValidator {
    root: PathBuf,
    corpus: Corpus,
    agent_names: Vec<String>,
    project_name: String,
    modules: Vec<String>,
    exclude: Vec<QuizExclusion>,
    count: usize,
    plan: [u32; 5],
    /// Lines of the files read so far.
    cache: HashMap<String, Arc<Vec<String>>>,
    /// The attempt with the most accepted questions.
    best: Option<Validated>,
    rejected_total: u32,
    last_reason: String,
}

/// Verified questions that are enough to play when the retries are exhausted.
pub fn enough(count: usize) -> usize {
    (count / 2).clamp(1, 3)
}

impl QuizValidator {
    fn result(&self, v: &Validated, note: Option<String>) -> Value {
        let result = QuizResult {
            questions: v.accepted.clone(),
            insufficient_material: v.insufficient_material,
            material_note: note.or_else(|| v.material_note.clone()),
            docs_note: v.docs_note.clone(),
            suggested_subjects: v.suggested_subjects.clone(),
            rejected_count: self.rejected_total,
        };
        serde_json::to_value(result).unwrap_or(Value::Null)
    }

    /// Plan levels without any accepted question.
    fn missing_levels(&self, v: &Validated) -> Vec<u32> {
        (1..=5u32)
            .filter(|l| {
                self.plan[(*l - 1) as usize] > 0 && !v.accepted.iter().any(|q| q.difficulty == *l)
            })
            .collect()
    }
}

impl OutputValidator for QuizValidator {
    fn check(&mut self, attempt: u32, output: &Value) -> Verdict {
        let root = self.root.clone();
        let cache = &mut self.cache;
        let mut read = |path: &str| {
            if let Some(lines) = cache.get(path) {
                return Some(lines.clone());
            }
            let text = read_text(&root, path)?;
            let lines = Arc::new(text.lines().map(str::to_owned).collect::<Vec<_>>());
            cache.insert(path.to_owned(), lines.clone());
            Some(lines)
        };
        let mut ctx = Context {
            corpus: &self.corpus,
            agent_names: &self.agent_names,
            read: &mut read,
            project_name: &self.project_name,
            modules: &self.modules,
            exclude: &self.exclude,
            count: self.count,
        };
        let validated = match validate(output, &mut ctx) {
            Ok(v) => v,
            Err(shape) => {
                log::info!("quiz attempt {attempt}: not quiz JSON ({shape})");
                self.last_reason = "the answer was not valid quiz JSON".to_owned();
                return Verdict::Retry {
                    repair_prompt: format!("{}\n({shape})", repair_prompt(0, &[], &[], 0)),
                    reason: self.last_reason.clone(),
                };
            }
        };
        self.rejected_total += u32::try_from(validated.rejected.len()).unwrap_or(u32::MAX);
        let accepted = validated.accepted.len();
        let codes: Vec<String> = validated
            .rejected
            .iter()
            .map(|(id, r, _)| format!("{id}={}", r.code()))
            .collect();
        log::info!(
            "quiz attempt {attempt}: {accepted} of {} accepted, rejected [{}]{}",
            self.count,
            codes.join(", "),
            if validated.insufficient_material {
                ", insufficient material"
            } else {
                ""
            }
        );
        if validated.insufficient_material || accepted >= self.count {
            let result = self.result(&validated, None);
            return Verdict::Accept(result);
        }
        let short_by = self.count - accepted;
        let reason = if validated.rejected.is_empty() {
            format!("{short_by} questions missing")
        } else {
            validated.summary()
        };
        let rejected: Vec<(String, String)> = validated
            .rejected
            .iter()
            .map(|(id, _, message)| (id.clone(), message.clone()))
            .collect();
        let repair = repair_prompt(
            accepted,
            &rejected,
            &self.missing_levels(&validated),
            if rejected.is_empty() { short_by } else { 0 },
        );
        if self
            .best
            .as_ref()
            .is_none_or(|b| accepted > b.accepted.len())
        {
            self.best = Some(validated);
        }
        self.last_reason = reason.clone();
        Verdict::Retry {
            repair_prompt: repair,
            reason,
        }
    }

    fn on_exhausted(&mut self) -> Verdict {
        let attempts = 1 + MAX_RETRIES;
        match self.best.take() {
            Some(best) if best.accepted.len() >= enough(self.count) => {
                let note = format!(
                    "Hoot could verify {} of the {} questions after {attempts} attempts.",
                    best.accepted.len(),
                    self.count
                );
                let result = self.result(&best, Some(note));
                Verdict::Accept(result)
            }
            best => {
                let suggestions = best
                    .map(|b| b.suggested_subjects)
                    .filter(|s| !s.is_empty())
                    .map(|s| format!(" Subjects that may work better: {}.", s.join("; ")))
                    .unwrap_or_default();
                Verdict::Fail {
                    message: format!(
                        "Hoot could not verify enough questions after {attempts} attempts ({}). Try another subject or fewer questions.{suggestions}",
                        self.last_reason
                    ),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use serde_json::json;

    use super::*;
    use crate::profile::{build, tests::tree};

    const README: &str = "# Orbit\n\nOrbit keeps a live index of markdown files.\n";
    const WATCHER: &str = "//! Watches the folder.\npub const DEBOUNCE_MS: u64 = 200;\n\npub struct WatchContext {\n    pub generation: u64,\n}\n";

    fn project() -> tempfile::TempDir {
        tree(&[
            ("README.md", README),
            ("package.json", r#"{"name":"orbit","main":"index.js"}"#),
            ("src/index/watcher.rs", WATCHER),
            ("CLAUDE.md", "# Rules\n"),
            (".env", "TOKEN=1\n"),
        ])
    }

    fn composed(root: &Path, input: QuizGenerationInput, resume: Option<String>) -> Composed {
        let (profile, walk) = build(root, &[], &AtomicBool::new(false));
        compose(
            root,
            &profile,
            &walk,
            &[],
            input,
            None,
            Some("m".into()),
            resume,
        )
        .unwrap()
    }

    fn question(id: &str, path: &str, first: u32, last: u32, text: &str) -> Value {
        json!({
            "id": id, "kind": "multipleChoice", "question": text,
            "choices": ["DEBOUNCE_MS", "POLL_MS", "DELAY"], "answer": 0,
            "hint": "Top of the watcher.", "explanation": "DEBOUNCE_MS in src/index/watcher.rs is 200.",
            "sources": [{ "path": path, "firstLine": first, "lastLine": last }],
            "difficulty": 2, "selfCheck": { "projectSpecific": true, "reason": "r" }
        })
    }

    #[test]
    fn a_quiz_request_is_read_only_with_the_app_schema_and_prompt() {
        let dir = project();
        let c = composed(
            dir.path(),
            QuizGenerationInput {
                count: 4,
                ..QuizGenerationInput::default()
            },
            None,
        );
        assert_eq!(c.request.policy, AiPolicy::ReadOnly);
        assert_eq!(c.request.output_schema, Some(schema()));
        assert_eq!(c.request.model.as_deref(), Some("m"));
        assert!(c.request.context.is_empty() && c.request.images.is_empty());
        assert!(c.request.capture.is_none());
        assert!(
            c.request
                .prompt
                .contains("Write 4 questions about orbit as a whole")
        );
        assert!(c.request.prompt.contains("## README.md (3 lines)"));
        assert!(
            c.request.prompt.contains("## CLAUDE.md"),
            "agent file as context"
        );
        assert!(!c.request.prompt.contains("TOKEN=1"), "never a secret");
        assert!(c.inlined.iter().any(|i| i.agent && i.path == "CLAUDE.md"));
        assert_eq!(c.prompt_bytes, c.request.prompt.len() as u64);
    }

    #[test]
    fn a_continued_round_sends_the_short_prompt() {
        let dir = project();
        let c = composed(
            dir.path(),
            QuizGenerationInput {
                count: 5,
                round: Some(super::super::QuizRound {
                    number: 2,
                    of: 2,
                    asked: 5,
                    right: 4,
                    level: 3,
                }),
                ..QuizGenerationInput::default()
            },
            Some("s-1".into()),
        );
        assert_eq!(c.request.resume_id.as_deref(), Some("s-1"));
        assert!(c.request.prompt.starts_with("This is round 2 of 2"));
        assert!(!c.request.prompt.contains("# Corpus"));
        assert!(c.inlined.is_empty());
    }

    #[test]
    fn a_quiz_on_a_tutorial_is_limited_to_its_cited_files_and_tests_understanding() {
        let dir = project();
        let (profile, walk) = build(dir.path(), &[], &AtomicBool::new(false));
        let mut t = crate::learning::tutorial::markdown::tests::sample();
        // The sample cites src/index/watcher.rs only.
        t.title = "Orbit's watcher".into();
        let c = compose(
            dir.path(),
            &profile,
            &walk,
            &[],
            QuizGenerationInput {
                subject_id: Some("concept:security".into()),
                ..QuizGenerationInput::default()
            },
            Some(&t),
            None,
            None,
        )
        .unwrap();
        let p = &c.request.prompt;
        assert!(p.contains("the tutorial \"Orbit's watcher\" about"));
        assert!(
            p.contains("Sources are limited to these files; cite them only: src/index/watcher.rs.")
        );
        assert!(p.contains("Question style: test understanding, not memory."));
        assert!(!p.contains("Question style: a code check."));
        assert!(p.contains("- The watcher: Explain how src/index/watcher.rs debounces."));
        assert!(p.contains("a quiz on a tutorial they took"));
        // A tutorial without a written chapter has nothing to quiz on.
        let mut empty = t.clone();
        for c in &mut empty.chapters {
            c.steps.clear();
        }
        assert!(matches!(
            compose(
                dir.path(),
                &profile,
                &walk,
                &[],
                QuizGenerationInput::default(),
                Some(&empty),
                None,
                None
            ),
            Err(AppError::ChapterNotWritten(_))
        ));
    }

    #[test]
    fn an_unknown_subject_is_refused() {
        let dir = project();
        let (profile, walk) = build(dir.path(), &[], &AtomicBool::new(false));
        let err = compose(
            dir.path(),
            &profile,
            &walk,
            &[],
            QuizGenerationInput {
                subject_id: Some("module:gone".into()),
                ..QuizGenerationInput::default()
            },
            None,
            None,
            None,
        );
        assert!(matches!(err, Err(AppError::Ai(_))));
    }

    #[test]
    fn the_validator_accepts_repairs_and_gives_up() {
        let dir = project();
        let mut c = composed(
            dir.path(),
            QuizGenerationInput {
                count: 3,
                ..QuizGenerationInput::default()
            },
            None,
        );
        let v = &mut c.validator;
        // One good, one citing an agent file: retry with the reason.
        let answer = json!({ "insufficientMaterial": false, "questions": [
            question("q1", "src/index/watcher.rs", 2, 2, "Which constant sets Orbit's debounce?"),
            question("q2", "CLAUDE.md", 1, 1, "Which rule does Orbit follow?"),
        ]});
        match v.check(1, &answer) {
            Verdict::Retry {
                repair_prompt,
                reason,
            } => {
                assert_eq!(reason, "1 rejected: 1 cited an agent file");
                assert!(repair_prompt.contains("- q2: cites CLAUDE.md"));
            }
            other => panic!("{other:?}"),
        }
        // Not JSON at all: retry asking for the JSON.
        assert!(matches!(v.check(2, &Value::Null), Verdict::Retry { .. }));
        // Exhausted with one verified question of two: enough(2) is 1, so it is kept.
        match v.on_exhausted() {
            Verdict::Accept(value) => {
                let r: QuizResult = serde_json::from_value(value).unwrap();
                assert_eq!(r.questions.len(), 1);
                assert_eq!(r.rejected_count, 1);
                assert!(
                    r.material_note
                        .unwrap()
                        .starts_with("Hoot could verify 1 of the 3")
                );
            }
            other => panic!("{other:?}"),
        }
        // Two good questions: accepted.
        let good = json!({ "insufficientMaterial": false, "questions": [
            question("q1", "src/index/watcher.rs", 2, 2, "Which constant sets Orbit's debounce?"),
            question("q2", "src/index/watcher.rs", 4, 6, "Which struct of Orbit keeps the generation?"),
            question("q3", "README.md", 3, 3, "What does Orbit keep live, according to its README?"),
        ]});
        let mut c = composed(
            dir.path(),
            QuizGenerationInput {
                count: 3,
                ..QuizGenerationInput::default()
            },
            None,
        );
        match c.validator.check(1, &good) {
            Verdict::Accept(value) => {
                let r: QuizResult = serde_json::from_value(value).unwrap();
                assert_eq!(r.questions.len(), 3);
                assert_eq!(
                    r.questions[0].sources[0].kind,
                    super::super::schema::QuizSourceKind::Code
                );
            }
            other => panic!("{other:?}"),
        }
        // Nothing verified after the cap: a failure that says why.
        let mut c = composed(
            dir.path(),
            QuizGenerationInput {
                count: 4,
                ..QuizGenerationInput::default()
            },
            None,
        );
        assert!(matches!(
            c.validator.check(1, &Value::Null),
            Verdict::Retry { .. }
        ));
        assert!(matches!(c.validator.on_exhausted(), Verdict::Fail { .. }));
        assert_eq!(enough(10), 3);
        assert_eq!(enough(3), 1);
    }

    /// A real generation with the user's installed provider (it spends tokens): the folder of
    /// `IGRASP_QUIZ_ROOT` (default: this repository), `IGRASP_QUIZ_COUNT` questions (5),
    /// `IGRASP_QUIZ_MODEL` (sonnet), `IGRASP_QUIZ_SUBJECT` (a subject id; none by default),
    /// `IGRASP_QUIZ_SCOPE=docs` for documentation only, `IGRASP_QUIZ_CUSTOM` (a typed subject),
    /// `IGRASP_QUIZ_PATHS` (comma-separated files or folders: a code check), `IGRASP_QUIZ_ROLE`
    /// (who takes the quiz). Prints the subjects, the activity and
    /// the accepted questions. Run with
    /// `cargo test --manifest-path src-tauri/Cargo.toml real_quiz -- --ignored --nocapture`.
    #[test]
    #[ignore = "uses the real AI provider and spends tokens"]
    fn real_quiz() {
        use crate::ai::gateway::AiGateway;
        use crate::ai::types::{AiEvent, AiOutcome, AiUserAction};
        use crate::appdata::settings::{AiPermissionSettings, Settings};

        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let root = var("IGRASP_QUIZ_ROOT").map_or_else(
            || Path::new(env!("CARGO_MANIFEST_DIR")).join(".."),
            PathBuf::from,
        );
        let root = dunce::canonicalize(root).unwrap();
        let gateway = AiGateway::from_settings(&Settings::default());
        let names = gateway.capabilities().context_file_names;
        let (profile, walk) = build(&root, &[], &AtomicBool::new(false));
        println!("PROFILE {}", profile.summary);
        let whole = Corpus::build(&root, &walk, &SourceScope::WholeProject, &names);
        for s in propose(&profile, &whole) {
            println!("SUBJECT {} | {}", s.id, s.title);
        }
        let input = QuizGenerationInput {
            count: var("IGRASP_QUIZ_COUNT")
                .and_then(|c| c.parse().ok())
                .unwrap_or(5),
            subject_id: var("IGRASP_QUIZ_SUBJECT"),
            custom_subject: var("IGRASP_QUIZ_CUSTOM"),
            role: var("IGRASP_QUIZ_ROLE"),
            scope: if let Some(paths) = var("IGRASP_QUIZ_PATHS") {
                SourceScope::Paths {
                    paths: paths.split(',').map(str::to_owned).collect(),
                }
            } else if var("IGRASP_QUIZ_SCOPE").as_deref() == Some("docs") {
                SourceScope::DocumentationOnly
            } else {
                SourceScope::WholeProject
            },
            ..QuizGenerationInput::default()
        };
        let model = var("IGRASP_QUIZ_MODEL").unwrap_or_else(|| "sonnet".into());
        let composed = compose(
            &root,
            &profile,
            &walk,
            &names,
            input,
            None,
            Some(model),
            None,
        )
        .unwrap();
        println!(
            "PROMPT {} bytes, inlined {:?}",
            composed.prompt_bytes,
            composed.inlined.iter().map(|i| &i.path).collect::<Vec<_>>()
        );
        let (tx, rx) = std::sync::mpsc::channel();
        gateway
            .start(
                AiUserAction::QuizGeneration,
                composed.request,
                &root,
                AiPermissionSettings::default(),
                Some(crate::ai::run::RunPlan::Validated(Box::new(
                    composed.validator,
                ))),
                Box::new(move |_, e| {
                    let _ = tx.send(e);
                }),
            )
            .unwrap();
        let mut outcome = None;
        while let Ok(e) = rx.recv_timeout(std::time::Duration::from_secs(900)) {
            match e {
                AiEvent::ToolUse { summary, .. } => println!("TOOL {summary}"),
                AiEvent::PermissionDecided { tool, reason, .. } => {
                    println!("DECIDED {tool}: {reason}");
                }
                AiEvent::Attempt { number, of, reason } => {
                    println!("ATTEMPT {number}/{of}: {reason}");
                }
                AiEvent::Usage {
                    input_tokens,
                    output_tokens,
                    cost_usd,
                    duration_ms,
                } => println!(
                    "USAGE {input_tokens} in, {output_tokens} out, {cost_usd:?} USD, {duration_ms} ms"
                ),
                AiEvent::Error { message } => println!("ERROR {message}"),
                AiEvent::StructuredOutput { value } => {
                    println!("RESULT\n{}", serde_json::to_string_pretty(&value).unwrap());
                }
                AiEvent::Done { outcome: o, detail } => {
                    println!("DONE {o:?} {detail:?}");
                    outcome = Some(o);
                    break;
                }
                _ => {}
            }
        }
        assert_eq!(outcome, Some(AiOutcome::Completed));
    }
}
