//! Composing a tutorial generation: the outline request (the first attempt of a conversation),
//! then one chapter request at a time (a continuation of that conversation, or a fresh prompt),
//! each a read-only `AiRequest` with the app's prompt and schema and a validator for the
//! gateway's validated runs (`ai::run`). The frontend would send a `TutorialInput`; it never
//! writes a prompt for a tutorial. The ignored tests at the end run real generations and the
//! freshness check on real projects (the proof of concept).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use super::TutorialInput;
use super::prompt::{
    PromptInput, chapter_prompt, chapter_prompt_fresh, chapter_repair_prompt, outline_prompt,
    outline_repair_prompt,
};
use super::schema::{Chapter, MAX_CHAPTERS, Step, Tutorial, chapter_schema, outline_schema};
use super::validate::{
    Context, ValidatedChapter, ValidatedOutline, enough, validate_chapter, validate_outline,
};
use crate::ai::run::{MAX_RETRIES, MAX_STAGES, OutputValidator, StageBuilder, Verdict};
use crate::ai::types::{AiPolicy, AiRequest};
use crate::error::{AppError, AppResult};
use crate::learning::corpus::{Corpus, Inlined, SourceScope, read_text};
use crate::learning::subjects::custom_anchors;
use crate::learning::tutorial::families::TutorialSubject;
use crate::profile::ProjectProfile;
use crate::profile::walk::Walk;

/// A composed request: what the gateway starts, its validator, and what the prompt inlines.
pub struct Composed<V> {
    pub request: AiRequest,
    pub validator: V,
    pub inlined: Vec<Inlined>,
    pub prompt_bytes: u64,
}

/// The accepted answer of an outline generation (the `structuredOutput` of the operation).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OutlineResult {
    pub title: String,
    pub intro: String,
    pub insufficient_material: bool,
    pub material_note: Option<String>,
    pub docs_note: Option<String>,
    pub suggested_subjects: Vec<String>,
    pub chapters: Vec<Chapter>,
    pub rejected_count: u32,
}

/// The accepted answer of a chapter generation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChapterResult {
    pub chapter: Chapter,
    pub docs_note: Option<String>,
    pub rejected_count: u32,
}

/// What both validators know about the project.
pub(crate) struct Shared {
    pub(crate) root: PathBuf,
    pub(crate) corpus: Corpus,
    pub(crate) agent_names: Vec<String>,
    pub(crate) project_name: String,
    pub(crate) modules: Vec<String>,
    pub(crate) input: TutorialInput,
    pub(crate) cache: HashMap<String, Arc<Vec<String>>>,
}

impl Shared {
    pub(crate) fn with_context<T>(&mut self, f: impl FnOnce(&mut Context<'_>) -> T) -> T {
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
            input: &self.input,
        };
        f(&mut ctx)
    }
}

/// The anchors of a subject: the files its words point at, then the README, the architecture
/// page and the main manifest.
fn anchors(profile: &ProjectProfile, corpus: &Corpus, subject: &str) -> Vec<String> {
    let mut out = custom_anchors(corpus, subject);
    out.extend(profile.docs.readme.clone());
    out.extend(profile.docs.architecture.clone());
    for m in [
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "go.mod",
        "project.godot",
        "pubspec.yaml",
    ] {
        if corpus.files.contains_key(m) {
            out.push(m.to_owned());
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    out.retain(|a| corpus.files.contains_key(a) && seen.insert(a.clone()));
    out
}

#[allow(clippy::type_complexity)] // What both requests are made of.
fn shared(
    root: &Path,
    profile: &ProjectProfile,
    walk: &Walk,
    agent_names: &[String],
    input: TutorialInput,
    first: &[String],
) -> (Shared, String, String, Vec<Inlined>, String, Vec<Inlined>) {
    let corpus = Corpus::build(root, walk, &SourceScope::WholeProject, agent_names);
    // The card's (or the chapter's) own files first, then the subject's.
    let mut anchors: Vec<String> = first
        .iter()
        .filter(|a| corpus.files.get(*a).is_some_and(|f| !f.binary))
        .cloned()
        .collect();
    for a in self::anchors(profile, &corpus, &input.subject) {
        if !anchors.contains(&a) {
            anchors.push(a);
        }
    }
    anchors.truncate(8);
    let (anchor_text, inlined) = corpus.anchors_text(root, &anchors);
    let (agent_text, agent_inlined) = corpus.agent_text(root);
    let map = corpus.map();
    let s = Shared {
        root: root.to_path_buf(),
        corpus,
        agent_names: agent_names.to_vec(),
        project_name: profile.name.clone(),
        modules: profile.modules.iter().map(|m| m.path.clone()).collect(),
        input,
        cache: HashMap::new(),
    };
    (s, map, anchor_text, inlined, agent_text, agent_inlined)
}

/// What a subject card asks of the outline: its family's focus and the user's picks.
pub fn card_focus(card: &TutorialSubject, picks: &[String]) -> String {
    let mut focus = card.focus.trim().to_owned();
    if let Some(gap) = &card.domain {
        focus.push_str(&format!(" (the domain this card teaches: {gap})"));
    }
    if !picks.is_empty() {
        focus.push_str(&format!(" The reader picked: {}.", picks.join("; ")));
    }
    focus
}

/// Composes the outline request of `input` in the folder of `root`. `card` is the subject
/// card it came from (its anchors are inlined first and its family's focus is asked for).
#[allow(clippy::too_many_arguments)] // What an outline request is made of.
pub fn compose_outline(
    root: &Path,
    profile: &ProjectProfile,
    walk: &Walk,
    agent_names: &[String],
    input: TutorialInput,
    card: Option<&TutorialSubject>,
    model: Option<String>,
) -> AppResult<Composed<OutlineValidator>> {
    let input = input.normalized();
    let mut first: Vec<String> = Vec::new();
    if let Some(c) = card {
        // The anchors of the picks the user chose, then the card's.
        for p in &c.picks {
            if input.picks.contains(&p.title) {
                first.extend(p.anchors.iter().cloned());
            }
        }
        first.extend(c.anchors.iter().cloned());
    }
    let focus = card.map(|c| card_focus(c, &input.picks));
    let (s, map, anchor_text, mut inlined, agent_text, agent_inlined) =
        shared(root, profile, walk, agent_names, input.clone(), &first);
    if s.corpus.files.values().all(|f| f.binary) {
        return Err(AppError::Ai(
            "This folder holds no text files a tutorial could be built on.".to_owned(),
        ));
    }
    let prompt = outline_prompt(&PromptInput {
        profile,
        input: &input,
        corpus_map: &map,
        anchor_files: &anchor_text,
        agent_files: &agent_text,
        focus: focus.as_deref(),
    });
    inlined.extend(agent_inlined);
    Ok(Composed {
        prompt_bytes: prompt.len() as u64,
        request: AiRequest {
            prompt,
            model,
            resume_id: None,
            policy: AiPolicy::ReadOnly,
            output_schema: Some(outline_schema()),
            ..AiRequest::default()
        },
        validator: OutlineValidator {
            shared: s,
            best: None,
            rejected_total: 0,
            last_reason: String::new(),
        },
        inlined,
    })
}

/// Composes the request of chapter `index` of `chapters` (the accepted outline): a continuation
/// of the outline's conversation when `resume_id` is given, else a fresh prompt with the recaps
/// of the chapters already written (`recaps`: title and takeaways), so it does not repeat them.
#[allow(clippy::too_many_arguments)] // What a chapter request is made of.
pub fn compose_chapter(
    root: &Path,
    profile: &ProjectProfile,
    walk: &Walk,
    agent_names: &[String],
    input: TutorialInput,
    chapters: &[Chapter],
    index: usize,
    recaps: &[(String, Vec<String>)],
    model: Option<String>,
    resume_id: Option<String>,
) -> AppResult<Composed<ChapterValidator>> {
    let input = input.normalized();
    let chapter = chapters
        .get(index)
        .ok_or_else(|| AppError::Ai(format!("The outline has no chapter {}.", index + 1)))?;
    let (s, map, anchor_text, mut inlined, agent_text, agent_inlined) =
        shared(root, profile, walk, agent_names, input.clone(), &[]);
    let prompt = if resume_id.is_some() {
        inlined.clear();
        chapter_prompt(chapter, index + 1, chapters.len(), &input)
    } else {
        inlined.extend(agent_inlined);
        chapter_prompt_fresh(
            &PromptInput {
                profile,
                input: &input,
                corpus_map: &map,
                anchor_files: &anchor_text,
                agent_files: &agent_text,
                focus: None,
            },
            chapters,
            chapter,
            index + 1,
            recaps,
        )
    };
    Ok(Composed {
        prompt_bytes: prompt.len() as u64,
        request: AiRequest {
            prompt,
            model,
            resume_id,
            policy: AiPolicy::ReadOnly,
            output_schema: Some(chapter_schema()),
            ..AiRequest::default()
        },
        validator: ChapterValidator {
            shared: s,
            chapter: chapter.clone(),
            best: None,
            rejected_total: 0,
            last_reason: String::new(),
        },
        inlined,
    })
}

// ---------------------------------------------------------------------------------------------
// The validators.

/// Accepts, repairs or gives up on the answers of an outline generation.
pub struct OutlineValidator {
    shared: Shared,
    best: Option<ValidatedOutline>,
    rejected_total: u32,
    last_reason: String,
}

impl OutlineValidator {
    fn result(&self, v: &ValidatedOutline, note: Option<String>) -> Value {
        let r = OutlineResult {
            title: v.title.clone(),
            intro: v.intro.clone(),
            insufficient_material: v.insufficient_material,
            material_note: note.or_else(|| v.material_note.clone()),
            docs_note: v.docs_note.clone(),
            suggested_subjects: v.suggested_subjects.clone(),
            chapters: v.accepted.clone(),
            rejected_count: self.rejected_total,
        };
        serde_json::to_value(r).unwrap_or(Value::Null)
    }
}

impl OutputValidator for OutlineValidator {
    fn check(&mut self, attempt: u32, output: &Value) -> Verdict {
        let validated = match self
            .shared
            .with_context(|ctx| validate_outline(output, ctx))
        {
            Ok(v) => v,
            Err(shape) => {
                log::info!("outline attempt {attempt}: not outline JSON ({shape})");
                self.last_reason = "the answer was not valid outline JSON".to_owned();
                return Verdict::Retry {
                    repair_prompt: outline_repair_prompt(&[], Some(&shape)),
                    reason: self.last_reason.clone(),
                };
            }
        };
        self.rejected_total += u32::try_from(validated.rejected.len()).unwrap_or(u32::MAX);
        let (min, _) = self.shared.input.length.chapters();
        let accepted = validated.accepted.len();
        log::info!(
            "outline attempt {attempt}: {accepted} chapters accepted, rejected [{}]",
            validated
                .rejected
                .iter()
                .map(|(id, r, _)| format!("{id}={}", r.code()))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let enough_chapters = accepted >= min || (validated.insufficient_material && accepted >= 1);
        if validated.rejected.is_empty() && enough_chapters {
            return Verdict::Accept(self.result(&validated, None));
        }
        let reason = if validated.rejected.is_empty() {
            format!("only {accepted} chapters; {min} needed")
        } else {
            format!(
                "{} chapters rejected: {}",
                validated.rejected.len(),
                validated
                    .rejected
                    .iter()
                    .map(|(_, r, _)| r.plain())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        let rejected: Vec<(String, String)> = validated
            .rejected
            .iter()
            .map(|(id, _, m)| (id.clone(), m.clone()))
            .collect();
        let mut repair = outline_repair_prompt(&rejected, None);
        if accepted < min {
            repair.push_str(&format!(
                "\nThe outline needs at least {min} chapters ({accepted} were accepted)."
            ));
        }
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
            Some(best) if !best.accepted.is_empty() => {
                let note = format!(
                    "Hoot could verify {} chapters after {attempts} attempts.",
                    best.accepted.len()
                );
                Verdict::Accept(self.result(&best, Some(note)))
            }
            _ => Verdict::Fail {
                message: format!(
                    "Hoot could not plan a grounded tutorial after {attempts} attempts ({}). Try another subject.",
                    self.last_reason
                ),
            },
        }
    }
}

/// Accepts, repairs or gives up on the answers of a chapter generation.
pub struct ChapterValidator {
    shared: Shared,
    chapter: Chapter,
    best: Option<ValidatedChapter>,
    rejected_total: u32,
    last_reason: String,
}

impl ChapterValidator {
    fn result(&self, v: &ValidatedChapter) -> Value {
        let r = ChapterResult {
            chapter: Chapter {
                id: self.chapter.id.clone(),
                title: if v.title.is_empty() {
                    self.chapter.title.clone()
                } else {
                    v.title.clone()
                },
                goal: self.chapter.goal.clone(),
                minutes: self.chapter.minutes,
                hoot_intro: Some(v.hoot_intro.clone()).filter(|h| !h.is_empty()),
                steps: v.accepted.clone(),
            },
            docs_note: v.docs_note.clone(),
            rejected_count: self.rejected_total,
        };
        serde_json::to_value(r).unwrap_or(Value::Null)
    }
}

impl OutputValidator for ChapterValidator {
    fn check(&mut self, attempt: u32, output: &Value) -> Verdict {
        let validated = match self
            .shared
            .with_context(|ctx| validate_chapter(output, ctx))
        {
            Ok(v) => v,
            Err(shape) => {
                log::info!("chapter attempt {attempt}: not chapter JSON ({shape})");
                self.last_reason = "the answer was not valid chapter JSON".to_owned();
                return Verdict::Retry {
                    repair_prompt: chapter_repair_prompt(0, &[], 0, Some(&shape)),
                    reason: self.last_reason.clone(),
                };
            }
        };
        self.rejected_total += u32::try_from(validated.rejected.len()).unwrap_or(u32::MAX);
        let (min, _) = self.shared.input.length.steps();
        let accepted = validated.accepted.len();
        log::info!(
            "chapter attempt {attempt}: {accepted} steps accepted, rejected [{}]",
            validated
                .rejected
                .iter()
                .map(|(id, r, _)| format!("{id}={}", r.code()))
                .collect::<Vec<_>>()
                .join(", ")
        );
        if validated.rejected.is_empty() && accepted >= min {
            return Verdict::Accept(self.result(&validated));
        }
        let short_by = min.saturating_sub(accepted);
        let reason = if validated.rejected.is_empty() {
            format!("{short_by} steps missing")
        } else {
            validated.summary()
        };
        let rejected: Vec<(String, String)> = validated
            .rejected
            .iter()
            .map(|(id, _, m)| (id.clone(), m.clone()))
            .collect();
        let repair = chapter_repair_prompt(
            accepted,
            &rejected,
            if rejected.is_empty() { short_by } else { 0 },
            None,
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
            Some(best) if best.accepted.len() >= enough(self.shared.input.length) => {
                Verdict::Accept(self.result(&best))
            }
            _ => Verdict::Fail {
                message: format!(
                    "Hoot could not verify enough steps of \"{}\" after {attempts} attempts ({}).",
                    self.chapter.title, self.last_reason
                ),
            },
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The chapters of a tutorial as a staged run (ADR 0026): one validated run per chapter the user
// ticked, each a fresh prompt with the accepted outline and the recaps of the chapters written so
// far (in the tutorial or accepted earlier in the same run).

/// What a tutorial was asked with (its chapters are written with the same options).
pub fn input_of(t: &Tutorial) -> TutorialInput {
    TutorialInput {
        subject: t.subject.clone(),
        subject_id: None,
        picks: Vec::new(),
        familiarity: t.familiarity,
        domain_gap: t.domain_gap.clone(),
        length: t.length,
        role: t.role.clone(),
    }
}

/// The title and takeaways of a written chapter.
fn recap_of(c: &Chapter) -> Option<(String, Vec<String>)> {
    c.steps.iter().rev().find_map(|s| match s {
        Step::Recap(r) => Some((c.title.clone(), r.takeaways.clone())),
        _ => None,
    })
}

/// Builds the stages of a "write chapters" operation.
pub struct ChapterStages {
    root: PathBuf,
    profile: ProjectProfile,
    walk: Arc<Walk>,
    agent_names: Vec<String>,
    input: TutorialInput,
    /// The outline (the chapters already written included).
    chapters: Vec<Chapter>,
    /// The chapters to write, in this order (indices in `chapters`).
    indices: Vec<usize>,
    model: Option<String>,
}

impl ChapterStages {
    /// The stages writing `indices` of `tutorial`. `goal` adds a chapter for a missing topic
    /// (its index is then the outline's length). Refuses an index outside the outline, a repeat,
    /// and more stages than a run may have.
    #[allow(clippy::too_many_arguments)] // What a staged run is made of.
    pub fn new(
        root: &Path,
        profile: ProjectProfile,
        walk: Arc<Walk>,
        agent_names: &[String],
        tutorial: &Tutorial,
        indices: &[u32],
        goal: Option<String>,
        model: Option<String>,
    ) -> AppResult<Self> {
        let mut chapters = tutorial.chapters.clone();
        let indices: Vec<usize> = match goal.map(|g| g.trim().to_owned()).filter(|g| !g.is_empty())
        {
            Some(goal) => {
                if chapters.len() >= MAX_CHAPTERS {
                    return Err(AppError::Ai(format!(
                        "A tutorial has at most {MAX_CHAPTERS} chapters."
                    )));
                }
                let n = chapters.len() + 1;
                chapters.push(Chapter {
                    id: format!("c{n}"),
                    title: goal.chars().take(80).collect(),
                    goal: goal.chars().take(300).collect(),
                    minutes: tutorial.length.minutes() / 3,
                    hoot_intro: None,
                    steps: Vec::new(),
                });
                vec![n - 1]
            }
            None => indices.iter().map(|i| *i as usize).collect(),
        };
        let mut seen = std::collections::BTreeSet::new();
        if indices.is_empty()
            || indices.len() > MAX_STAGES as usize
            || indices
                .iter()
                .any(|i| *i >= chapters.len() || !seen.insert(*i))
        {
            return Err(AppError::Ai(format!(
                "Choose between 1 and {MAX_STAGES} chapters of the outline to write."
            )));
        }
        Ok(Self {
            root: root.to_path_buf(),
            profile,
            walk,
            agent_names: agent_names.to_vec(),
            input: input_of(tutorial),
            chapters,
            indices,
            model,
        })
    }

    /// The composed request of the first stage (for the estimate).
    pub fn first(&self) -> AppResult<Composed<ChapterValidator>> {
        self.compose(0, &[])
    }

    fn compose(&self, stage: usize, accepted: &[Value]) -> AppResult<Composed<ChapterValidator>> {
        let index = self.indices[stage];
        let mut recaps: Vec<(String, Vec<String>)> = self
            .chapters
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != index)
            .filter_map(|(_, c)| recap_of(c))
            .collect();
        for v in accepted {
            if let Ok(r) = serde_json::from_value::<ChapterResult>(v.clone())
                && let Some(recap) = recap_of(&r.chapter)
                && !recaps.iter().any(|(t, _)| *t == recap.0)
            {
                recaps.push(recap);
            }
        }
        compose_chapter(
            &self.root,
            &self.profile,
            &self.walk,
            &self.agent_names,
            self.input.clone(),
            &self.chapters,
            index,
            &recaps,
            self.model.clone(),
            None,
        )
    }
}

impl StageBuilder for ChapterStages {
    fn stages(&self) -> u32 {
        u32::try_from(self.indices.len()).unwrap_or(u32::MAX)
    }

    fn next(
        &mut self,
        n: u32,
        accepted: &[Value],
    ) -> AppResult<(AiRequest, Box<dyn OutputValidator>, String)> {
        let stage = (n as usize).saturating_sub(1);
        let composed = self.compose(stage, accepted)?;
        let label = self.chapters[self.indices[stage]].title.clone();
        Ok((composed.request, Box::new(composed.validator), label))
    }
}

/// Now as RFC 3339 in UTC (no time crate in the app).
pub fn rfc3339_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let days = secs / 86_400;
    let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
    // Civil from days (Howard Hinnant).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use serde_json::json;

    use super::super::schema::tests::every_step;
    use super::super::{Familiarity, Length};
    use super::*;
    use crate::profile::{build, tests::tree};

    const WATCHER: &str = "//! Watches the folder.\npub const DEBOUNCE_MS: u64 = 200;\n\npub struct WatchContext {\n    pub generation: u64,\n}\n";

    fn project() -> tempfile::TempDir {
        tree(&[
            (
                "README.md",
                "# Orbit\n\nOrbit keeps a live index of markdown files.\n",
            ),
            ("package.json", r#"{"name":"orbit","main":"index.js"}"#),
            ("src/index/watcher.rs", WATCHER),
            ("CLAUDE.md", "# Rules\n"),
            (".env", "TOKEN=1\n"),
        ])
    }

    fn input() -> TutorialInput {
        TutorialInput {
            subject: "How the watcher works".into(),
            familiarity: Familiarity::NewHere,
            domain_gap: None,
            length: Length::Quick,
            role: None,
            ..TutorialInput::default()
        }
    }

    fn outline_json(chapters: Value) -> Value {
        json!({ "insufficientMaterial": false, "title": "Orbit's watcher", "intro": "Follow a change through Orbit.", "chapters": chapters })
    }

    fn chapter_json(id: &str, title: &str, sources: Vec<&str>) -> Value {
        json!({ "id": id, "title": title, "goal": format!("Explain {title} of Orbit."), "minutes": 4, "keySources": sources,
            "selfCheck": { "projectSpecific": true, "reason": "r" } })
    }

    #[test]
    fn the_outline_request_is_read_only_with_the_schema_and_the_anchors() {
        let dir = project();
        let (profile, walk) = build(dir.path(), &[], &AtomicBool::new(false));
        let agent = vec!["CLAUDE.md".to_owned()];
        let c = compose_outline(
            dir.path(),
            &profile,
            &walk,
            &agent,
            input(),
            None,
            Some("m".into()),
        )
        .unwrap();
        assert_eq!(c.request.policy, AiPolicy::ReadOnly);
        assert_eq!(c.request.output_schema, Some(outline_schema()));
        assert_eq!(c.request.model.as_deref(), Some("m"));
        assert!(c.request.resume_id.is_none());
        assert!(
            c.request
                .prompt
                .contains("Plan a tutorial about \"How the watcher works\" in orbit")
        );
        assert!(
            c.request
                .prompt
                .contains("## src/index/watcher.rs (6 lines)"),
            "the subject's words anchor the watcher"
        );
        assert!(c.request.prompt.contains("## README.md (3 lines)"));
        assert!(
            c.request.prompt.contains("## CLAUDE.md"),
            "agent file as context"
        );
        assert!(!c.request.prompt.contains("TOKEN=1"));
        assert!(c.inlined.iter().any(|i| i.agent && i.path == "CLAUDE.md"));
        assert_eq!(c.prompt_bytes, c.request.prompt.len() as u64);
    }

    #[test]
    fn the_outline_validator_accepts_repairs_and_gives_up() {
        let dir = project();
        let (profile, walk) = build(dir.path(), &[], &AtomicBool::new(false));
        let agent = vec!["CLAUDE.md".to_owned()];
        let mut c =
            compose_outline(dir.path(), &profile, &walk, &agent, input(), None, None).unwrap();
        // One chapter on an agent file: retry with the reason; quick needs 2 chapters.
        let v = c.validator.check(
            1,
            &outline_json(json!([
                chapter_json("c1", "The watcher", vec!["src/index/watcher.rs"]),
                chapter_json("c2", "The rules", vec!["CLAUDE.md"]),
            ])),
        );
        match v {
            Verdict::Retry {
                repair_prompt,
                reason,
            } => {
                assert_eq!(reason, "1 chapters rejected: cited an agent file");
                assert!(repair_prompt.contains("- c2: is built on CLAUDE.md"));
                assert!(repair_prompt.contains("needs at least 2 chapters (1 were accepted)"));
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            c.validator.check(2, &Value::Null),
            Verdict::Retry { .. }
        ));
        match c.validator.on_exhausted() {
            Verdict::Accept(v) => {
                let r: OutlineResult = serde_json::from_value(v).unwrap();
                assert_eq!(r.chapters.len(), 1);
                assert_eq!(r.chapters[0].id, "c1");
                assert_eq!(r.rejected_count, 1);
                assert!(
                    r.material_note
                        .unwrap()
                        .starts_with("Hoot could verify 1 chapters")
                );
            }
            other => panic!("{other:?}"),
        }
        // Two good chapters: accepted, with positional ids.
        let mut c =
            compose_outline(dir.path(), &profile, &walk, &agent, input(), None, None).unwrap();
        match c.validator.check(
            1,
            &outline_json(json!([
                chapter_json("c3", "The watcher", vec!["src/index/watcher.rs"]),
                chapter_json("c7", "The index", vec!["README.md", "package.json"]),
            ])),
        ) {
            Verdict::Accept(v) => {
                let r: OutlineResult = serde_json::from_value(v).unwrap();
                assert_eq!(
                    r.chapters.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
                    vec!["c1", "c2"]
                );
            }
            other => panic!("{other:?}"),
        }
        // Nothing verified: a failure that says why.
        let mut c =
            compose_outline(dir.path(), &profile, &walk, &agent, input(), None, None).unwrap();
        assert!(matches!(
            c.validator.check(1, &Value::Null),
            Verdict::Retry { .. }
        ));
        assert!(matches!(c.validator.on_exhausted(), Verdict::Fail { .. }));
    }

    #[test]
    fn a_chapter_request_continues_the_outline_or_starts_fresh() {
        let dir = project();
        let (profile, walk) = build(dir.path(), &[], &AtomicBool::new(false));
        let chapters = vec![Chapter {
            id: "c1".into(),
            title: "The watcher".into(),
            goal: "Explain how src/index/watcher.rs debounces.".into(),
            minutes: 4,
            hoot_intro: None,
            steps: Vec::new(),
        }];
        let c = compose_chapter(
            dir.path(),
            &profile,
            &walk,
            &[],
            input(),
            &chapters,
            0,
            &[],
            None,
            Some("s-1".into()),
        )
        .unwrap();
        assert_eq!(c.request.resume_id.as_deref(), Some("s-1"));
        assert!(
            c.request
                .prompt
                .starts_with("Thank you, the outline is accepted. Now write chapter 1 of 1")
        );
        assert!(!c.request.prompt.contains("# Corpus"));
        assert!(c.inlined.is_empty());
        assert_eq!(c.request.output_schema, Some(chapter_schema()));
        let fresh = compose_chapter(
            dir.path(),
            &profile,
            &walk,
            &[],
            input(),
            &chapters,
            0,
            &[],
            None,
            None,
        )
        .unwrap();
        assert!(fresh.request.prompt.contains("# Corpus"));
        assert!(
            fresh
                .request
                .prompt
                .contains("has this outline (already accepted)")
        );
        assert!(
            compose_chapter(
                dir.path(),
                &profile,
                &walk,
                &[],
                input(),
                &chapters,
                3,
                &[],
                None,
                None
            )
            .is_err()
        );

        // The validator: every sample step passes; a chapter without enough steps is retried,
        // and kept when exhausted if enough passed.
        let mut c = compose_chapter(
            dir.path(),
            &profile,
            &walk,
            &[],
            input(),
            &chapters,
            0,
            &[],
            None,
            None,
        )
        .unwrap();
        let steps = every_step();
        let good = json!({ "id": "c1", "title": "The watcher", "hootIntro": "Follow a change.", "steps": steps });
        match c.validator.check(1, &good) {
            Verdict::Accept(v) => {
                let r: ChapterResult = serde_json::from_value(v).unwrap();
                assert_eq!(r.chapter.id, "c1");
                assert_eq!(r.chapter.steps.len(), 6, "quick keeps 6 steps");
                assert_eq!(r.chapter.hoot_intro.as_deref(), Some("Follow a change."));
                assert_eq!(r.rejected_count, 0);
            }
            other => panic!("{other:?}"),
        }
        let mut c = compose_chapter(
            dir.path(),
            &profile,
            &walk,
            &[],
            input(),
            &chapters,
            0,
            &[],
            None,
            None,
        )
        .unwrap();
        let few = json!({ "id": "c1", "title": "The watcher", "hootIntro": "Follow a change.", "steps": [steps[0], steps[9]] });
        match c.validator.check(1, &few) {
            Verdict::Retry {
                reason,
                repair_prompt,
            } => {
                assert_eq!(reason, "2 steps missing");
                assert!(repair_prompt.contains("Add 2 new steps"));
            }
            other => panic!("{other:?}"),
        }
        match c.validator.on_exhausted() {
            Verdict::Accept(v) => {
                let r: ChapterResult = serde_json::from_value(v).unwrap();
                assert_eq!(r.chapter.steps.len(), 2);
            }
            other => panic!("{other:?}"),
        }
        let mut c = compose_chapter(
            dir.path(),
            &profile,
            &walk,
            &[],
            input(),
            &chapters,
            0,
            &[],
            None,
            None,
        )
        .unwrap();
        assert!(matches!(
            c.validator.check(1, &Value::Null),
            Verdict::Retry { .. }
        ));
        assert!(matches!(c.validator.on_exhausted(), Verdict::Fail { .. }));
    }

    #[test]
    fn now_is_rfc3339() {
        let now = rfc3339_now();
        assert_eq!(now.len(), 20);
        assert!(now.starts_with("20") && now.ends_with('Z'));
        assert_eq!(&now[4..5], "-");
        assert_eq!(&now[10..11], "T");
    }
}

/// The proof of concept on real projects: `real_tutorial` generates an outline and one chapter
/// with the installed provider and writes the tutorial (markdown, JSON, the run's tokens and
/// events) to a folder; `real_freshness` checks a written tutorial against a modified copy of
/// its project. Both spend nothing but `real_tutorial`'s two calls.
#[cfg(test)]
mod poc {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicBool;
    use std::time::Instant;

    use serde::Serialize;
    use serde_json::Value;

    use super::super::freshness::{self, Badge, SourceState};
    use super::super::markdown::{self, TutorialFile, slug};
    use super::super::schema::{Chapter, Tutorial};
    use super::super::{Familiarity, Length};
    use super::*;
    use crate::ai::gateway::AiGateway;
    use crate::ai::run::OutputValidator;
    use crate::ai::types::{AiEvent, AiOutcome, AiUserAction};
    use crate::appdata::settings::{AiPermissionSettings, Settings};
    use crate::profile::build;

    fn var(k: &str) -> Option<String> {
        std::env::var(k).ok().filter(|v| !v.is_empty())
    }

    /// What one operation cost and did.
    #[derive(Debug, Default, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RunSummary {
        prompt_bytes: u64,
        attempts: u32,
        attempt_reasons: Vec<String>,
        tool_uses: u32,
        tools: std::collections::BTreeMap<String, u32>,
        input_tokens: u64,
        output_tokens: u64,
        /// This operation alone (the session's total minus what came before it).
        cost_usd: Option<f64>,
        /// As the provider reports it: the session so far.
        session_cost_usd: Option<f64>,
        provider_duration_ms: u64,
        wall_ms: u64,
        rejected_count: u32,
        outcome: String,
        error: Option<String>,
    }

    /// Runs one validated operation through the gateway; returns the summary, the accepted
    /// structured output and the resume id.
    fn run(
        gateway: &AiGateway,
        root: &Path,
        request: AiRequest,
        prompt_bytes: u64,
        validator: Box<dyn OutputValidator>,
        log: &mut String,
    ) -> (RunSummary, Option<Value>, Option<String>) {
        let started = Instant::now();
        let (tx, rx) = std::sync::mpsc::channel();
        gateway
            .start(
                AiUserAction::TutorialGeneration,
                request,
                root,
                AiPermissionSettings::default(),
                Some(crate::ai::run::RunPlan::Validated(validator)),
                Box::new(move |_, e| {
                    let _ = tx.send(e);
                }),
            )
            .unwrap();
        let mut s = RunSummary {
            prompt_bytes,
            attempts: 1,
            ..RunSummary::default()
        };
        let mut output = None;
        let mut resume = None;
        while let Ok(e) = rx.recv_timeout(std::time::Duration::from_secs(1500)) {
            match e {
                AiEvent::Session { resume_id, model } => {
                    log.push_str(&format!("SESSION {resume_id} ({model})\n"));
                    resume = Some(resume_id);
                }
                AiEvent::ToolUse { tool, summary, .. } => {
                    s.tool_uses += 1;
                    *s.tools.entry(tool).or_default() += 1;
                    log.push_str(&format!("TOOL {summary}\n"));
                }
                AiEvent::PermissionDecided { tool, reason, .. } => {
                    log.push_str(&format!("DECIDED {tool}: {reason}\n"));
                }
                AiEvent::Attempt { number, of, reason } => {
                    s.attempts = number;
                    s.attempt_reasons.push(reason.clone());
                    log.push_str(&format!("ATTEMPT {number}/{of}: {reason}\n"));
                }
                AiEvent::Usage {
                    input_tokens,
                    output_tokens,
                    cost_usd,
                    duration_ms,
                } => {
                    s.input_tokens += input_tokens;
                    s.output_tokens += output_tokens;
                    // The provider reports the cost of the whole session so far (cumulative
                    // across attempts and resumed operations): keep the last value, the caller
                    // takes the difference with the previous operation of the session.
                    s.session_cost_usd = cost_usd.or(s.session_cost_usd);
                    s.cost_usd = s.session_cost_usd;
                    s.provider_duration_ms += duration_ms;
                    log.push_str(&format!(
                        "USAGE {input_tokens} in, {output_tokens} out, {cost_usd:?} USD, {duration_ms} ms\n"
                    ));
                }
                AiEvent::Error { message } => {
                    s.error = Some(message.clone());
                    log.push_str(&format!("ERROR {message}\n"));
                }
                AiEvent::StructuredOutput { value } => {
                    s.rejected_count = value["rejectedCount"].as_u64().unwrap_or(0) as u32;
                    output = Some(value);
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
        s.wall_ms = started.elapsed().as_millis() as u64;
        (s, output, resume)
    }

    fn write_files(dir: &Path, files: &[TutorialFile]) {
        std::fs::create_dir_all(dir).unwrap();
        for f in files {
            std::fs::write(dir.join(&f.name), &f.text).unwrap();
        }
    }

    fn head_commit(root: &Path) -> Option<String> {
        let out = std::process::Command::new("git")
            .args([
                "-C",
                &root.display().to_string(),
                "rev-parse",
                "--short",
                "HEAD",
            ])
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
            .filter(|s| !s.is_empty())
    }

    /// A real generation with the installed provider (it spends tokens, two calls): the folder of
    /// `IGRASP_TUTORIAL_ROOT` (default: this repository), `IGRASP_TUTORIAL_SUBJECT`,
    /// `IGRASP_TUTORIAL_FAMILIARITY` (new | contributing | maintainer), `IGRASP_TUTORIAL_GAP`
    /// ("I'm new to …"), `IGRASP_TUTORIAL_LENGTH` (quick | standard | deep),
    /// `IGRASP_TUTORIAL_ROLE`, `IGRASP_TUTORIAL_MODEL` (sonnet), `IGRASP_TUTORIAL_CHAPTER` (the
    /// chapter to write, 1-based, default 1; 0 writes none), `IGRASP_TUTORIAL_FRESH=1` (write the
    /// chapter with a fresh prompt instead of continuing the outline's conversation),
    /// `IGRASP_TUTORIAL_OUT` (the folder written: README.md and the chapter, `tutorial.json`,
    /// `run.json`, `events.log`; default `docs/plan/poc-tutorials/<folder name>`). Run with
    /// `cargo test --manifest-path src-tauri/Cargo.toml real_tutorial -- --ignored --nocapture`.
    #[test]
    #[ignore = "uses the real AI provider and spends tokens"]
    fn real_tutorial() {
        let root = var("IGRASP_TUTORIAL_ROOT").map_or_else(
            || Path::new(env!("CARGO_MANIFEST_DIR")).join(".."),
            PathBuf::from,
        );
        let root = dunce::canonicalize(root).unwrap();
        let name = root
            .file_name()
            .map_or("project".to_owned(), |n| n.to_string_lossy().into_owned());
        let out = var("IGRASP_TUTORIAL_OUT").map_or_else(
            || {
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../docs/plan/poc-tutorials")
                    .join(&name)
            },
            PathBuf::from,
        );
        let input = TutorialInput {
            subject: var("IGRASP_TUTORIAL_SUBJECT").unwrap_or_else(|| "The big picture".into()),
            familiarity: var("IGRASP_TUTORIAL_FAMILIARITY")
                .and_then(|f| Familiarity::parse(&f))
                .unwrap_or_default(),
            domain_gap: var("IGRASP_TUTORIAL_GAP"),
            length: var("IGRASP_TUTORIAL_LENGTH")
                .and_then(|l| Length::parse(&l))
                .unwrap_or_default(),
            role: var("IGRASP_TUTORIAL_ROLE"),
            ..TutorialInput::default()
        };
        let model = var("IGRASP_TUTORIAL_MODEL").unwrap_or_else(|| "sonnet".into());
        let chapter_index: usize = var("IGRASP_TUTORIAL_CHAPTER")
            .and_then(|c| c.parse().ok())
            .unwrap_or(1);
        let fresh = var("IGRASP_TUTORIAL_FRESH").is_some();

        let settings = Settings::default();
        let gateway = AiGateway::from_settings(&settings);
        let names = gateway.capabilities().context_file_names;
        let (profile, walk) = build(&root, &[], &AtomicBool::new(false));
        println!("PROFILE {}", profile.summary);
        let mut log = String::new();
        log.push_str(&format!(
            "ROOT {}\nPROFILE {}\nINPUT {input:?}\nMODEL {model}\n\n# Outline\n",
            root.display(),
            profile.summary
        ));

        let composed = compose_outline(
            &root,
            &profile,
            &walk,
            &names,
            input.clone(),
            None,
            Some(model.clone()),
        )
        .unwrap();
        println!(
            "OUTLINE PROMPT {} bytes, inlined {:?}",
            composed.prompt_bytes,
            composed.inlined.iter().map(|i| &i.path).collect::<Vec<_>>()
        );
        let (outline_run, outline_value, resume) = run(
            &gateway,
            &root,
            composed.request,
            composed.prompt_bytes,
            Box::new(composed.validator),
            &mut log,
        );
        println!(
            "OUTLINE RUN {}",
            serde_json::to_string_pretty(&outline_run).unwrap()
        );
        std::fs::create_dir_all(&out).unwrap();
        let outline: Option<OutlineResult> = outline_value
            .as_ref()
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        if let Some(o) = &outline {
            println!("OUTLINE\n{}", serde_json::to_string_pretty(o).unwrap());
        }

        let mut chapter_run = None;
        let mut chapter_result: Option<ChapterResult> = None;
        if let Some(o) = &outline
            && chapter_index >= 1
            && chapter_index <= o.chapters.len()
        {
            log.push_str("\n# Chapter\n");
            let composed = compose_chapter(
                &root,
                &profile,
                &walk,
                &names,
                input.clone(),
                &o.chapters,
                chapter_index - 1,
                &[],
                Some(model.clone()),
                if fresh { None } else { resume.clone() },
            )
            .unwrap();
            println!("CHAPTER PROMPT {} bytes", composed.prompt_bytes);
            let (mut r, value, _) = run(
                &gateway,
                &root,
                composed.request,
                composed.prompt_bytes,
                Box::new(composed.validator),
                &mut log,
            );
            if !fresh
                && let (Some(now), Some(before)) =
                    (r.session_cost_usd, outline_run.session_cost_usd)
            {
                r.cost_usd = Some(now - before);
            }
            println!("CHAPTER RUN {}", serde_json::to_string_pretty(&r).unwrap());
            chapter_result = value.and_then(|v| serde_json::from_value(v).ok());
            chapter_run = Some(r);
        }

        // The tutorial, written and read back.
        let mut round_trip = None;
        if let Some(o) = &outline {
            let mut chapters: Vec<Chapter> = o.chapters.clone();
            if let Some(r) = &chapter_result
                && let Some(slot) = chapters.get_mut(chapter_index - 1)
            {
                *slot = r.chapter.clone();
            }
            let generated = rfc3339_now();
            let mut tutorial = Tutorial {
                id: format!(
                    "{}-{}-{}",
                    slug(&profile.name),
                    slug(&input.subject),
                    &generated[..10]
                ),
                title: o.title.clone(),
                intro: o.intro.clone(),
                project: profile.name.clone(),
                subject: input.subject.clone(),
                familiarity: input.familiarity,
                domain_gap: input.domain_gap.clone(),
                length: input.length,
                role: input.role.clone(),
                generated,
                provider: settings.ai.provider.clone(),
                model: model.clone(),
                generation_commit: head_commit(&root),
                verified: None,
                material_note: o.material_note.clone(),
                docs_note: chapter_result
                    .as_ref()
                    .and_then(|r| r.docs_note.clone())
                    .or_else(|| o.docs_note.clone()),
                chapters,
                sources: Vec::new(),
            };
            markdown::normalize(&mut tutorial);
            tutorial.sources = freshness::source_hashes(&root, &tutorial);
            let files = markdown::write(&tutorial, "docs/tutorials/poc");
            write_files(&out, &files);
            std::fs::write(
                out.join("tutorial.json"),
                serde_json::to_string_pretty(&tutorial).unwrap(),
            )
            .unwrap();
            let (back, skipped) = markdown::read(&files).unwrap();
            let same = back == tutorial && skipped.is_empty();
            println!("ROUND TRIP {}", if same { "lossless" } else { "DIFFERS" });
            if !same {
                std::fs::write(
                    out.join("tutorial.readback.json"),
                    serde_json::to_string_pretty(&back).unwrap(),
                )
                .unwrap();
            }
            round_trip = Some(same);
            let report = freshness::check(&root, &tutorial);
            println!(
                "FRESHNESS {:?} ({} sources)",
                report.badge,
                report.checks.len()
            );
            assert_eq!(report.badge, Badge::UpToDate);
        }
        let summary = serde_json::json!({
            "root": root.display().to_string(),
            "profile": profile.summary,
            "input": input,
            "model": model,
            "outline": outline_run,
            "chapter": chapter_run,
            "chapterIndex": chapter_index,
            "freshPrompt": fresh,
            "roundTripLossless": round_trip,
            "outlineChapters": outline.as_ref().map(|o| o.chapters.len()),
            "insufficientMaterial": outline.as_ref().map(|o| o.insufficient_material),
            "suggestedSubjects": outline.as_ref().map(|o| o.suggested_subjects.clone()),
            "chapterSteps": chapter_result.as_ref().map(|r| r.chapter.steps.iter().map(|s| s.type_name()).collect::<Vec<_>>()),
        });
        std::fs::write(
            out.join("run.json"),
            serde_json::to_string_pretty(&summary).unwrap(),
        )
        .unwrap();
        std::fs::write(out.join("events.log"), &log).unwrap();
        println!("WRITTEN {}", out.display());
        assert!(
            outline.is_some(),
            "the outline failed: {:?}",
            outline_run.error
        );
        if chapter_index >= 1 {
            assert!(
                chapter_result.is_some(),
                "the chapter failed: {:?}",
                chapter_run.and_then(|r| r.error)
            );
        }
        assert_eq!(round_trip, Some(true));
    }

    /// The freshness check on a real tutorial (no AI): copies the cited files of
    /// `IGRASP_TUTORIAL_ROOT` to a temporary folder, then inserts lines above the first cited
    /// range of one file (moved), changes a cited line of another (changed) and deletes a third
    /// (missing); prints the report and the relocations, and writes the relocated tutorial next to
    /// the original as `README.relocated.md`. `IGRASP_TUTORIAL_DIR` is the folder written by
    /// `real_tutorial`.
    #[test]
    #[ignore = "needs a tutorial written by real_tutorial"]
    fn real_freshness() {
        let root = var("IGRASP_TUTORIAL_ROOT").map_or_else(
            || Path::new(env!("CARGO_MANIFEST_DIR")).join(".."),
            PathBuf::from,
        );
        let root = dunce::canonicalize(root).unwrap();
        let dir = PathBuf::from(var("IGRASP_TUTORIAL_DIR").expect("IGRASP_TUTORIAL_DIR"));
        let mut files = Vec::new();
        for entry in std::fs::read_dir(&dir).unwrap() {
            let p = entry.unwrap().path();
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            if name.ends_with(".md") && !name.contains(".relocated") {
                files.push(TutorialFile {
                    name,
                    text: std::fs::read_to_string(&p).unwrap(),
                });
            }
        }
        let (mut tutorial, skipped) = markdown::read(&files).unwrap();
        assert!(skipped.is_empty(), "{skipped:?}");
        let paths: Vec<String> = {
            let mut p: Vec<String> = tutorial.sources.iter().map(|s| s.path.clone()).collect();
            p.sort();
            p.dedup();
            p
        };
        assert!(!paths.is_empty(), "the tutorial cites nothing");
        // A modified copy with only the cited files.
        let copy = tempfile::tempdir().unwrap();
        for p in &paths {
            let to = copy.path().join(p);
            std::fs::create_dir_all(to.parent().unwrap()).unwrap();
            std::fs::copy(root.join(p), &to).unwrap();
        }
        assert_eq!(
            freshness::check(copy.path(), &tutorial).badge,
            Badge::UpToDate
        );
        // With fewer than three cited files, the moved and the changed file are the same (the
        // changed range is then reported as changed, the others as moved) and nothing is deleted.
        let moved_file = &paths[0];
        let changed_file = &paths[1 % paths.len()];
        let missing_file = paths.get(2);
        let shift = if changed_file == moved_file { 5 } else { 0 };
        // Moved: five lines inserted at the top.
        let text = std::fs::read_to_string(copy.path().join(moved_file)).unwrap();
        std::fs::write(
            copy.path().join(moved_file),
            format!("// 1\n// 2\n// 3\n// 4\n// 5\n{text}"),
        )
        .unwrap();
        // Changed: the first cited line of the file gets a suffix.
        let first_line = tutorial
            .sources
            .iter()
            .find(|s| &s.path == changed_file)
            .and_then(|s| s.lines.as_deref())
            .and_then(|l| l.split('-').next()?.parse::<usize>().ok())
            .unwrap();
        let text = std::fs::read_to_string(copy.path().join(changed_file)).unwrap();
        let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
        lines[first_line - 1 + shift].push_str(" // changed");
        std::fs::write(copy.path().join(changed_file), lines.join("\n")).unwrap();
        // Missing.
        if let Some(m) = missing_file {
            std::fs::remove_file(copy.path().join(m)).unwrap();
        }

        let report = freshness::check(copy.path(), &tutorial);
        println!("MODIFIED moved={moved_file} changed={changed_file} missing={missing_file:?}");
        println!("REPORT {}", serde_json::to_string_pretty(&report).unwrap());
        let affected = freshness::affected_steps(&tutorial, &report);
        println!("AFFECTED STEPS {affected:?}");
        let moved = freshness::relocate(&mut tutorial, &report);
        println!("RELOCATED {moved} citations");
        let again = freshness::check(copy.path(), &tutorial);
        println!("AFTER RELOCATION {:?}, moved {}", again.badge, again.moved);
        assert!(
            report
                .checks
                .iter()
                .filter(|c| &c.path == moved_file)
                .all(|c| matches!(c.state, SourceState::Moved { .. })
                    || (shift > 0 && c.state == SourceState::Changed))
        );
        if let Some(m) = missing_file {
            assert!(
                report
                    .checks
                    .iter()
                    .filter(|c| &c.path == m)
                    .all(|c| c.state == SourceState::Missing)
            );
        }
        assert!(
            report
                .checks
                .iter()
                .any(|c| &c.path == changed_file && c.state == SourceState::Changed)
        );
        assert_eq!(again.moved, 0);
        assert!(moved >= 1);
        let files = markdown::write(&tutorial, "docs/tutorials/poc");
        std::fs::write(dir.join("README.relocated.md"), &files[0].text).unwrap();
        std::fs::write(
            dir.join("freshness.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "modified": { "moved": moved_file, "changed": changed_file, "missing": missing_file },
                "report": report,
                "affectedSteps": affected,
                "relocatedCitations": moved,
                "afterRelocation": again.badge,
            }))
            .unwrap(),
        )
        .unwrap();
    }
}
