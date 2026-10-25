//! "Check with Claude" (uses tokens, with consent): the AI rereads a tutorial against the
//! project as it is now and says, per written chapter, whether it is still correct or outdated
//! (with the reason and the change it saw), proposes a replacement for each outdated step (a
//! valid step of the same type, checked like a written chapter's), and names topics the
//! tutorial misses. One validated read-only run; nothing is applied: the user accepts or rejects
//! each proposal, and the result is saved (private) or written after a confirmation (shared).

use std::collections::{BTreeSet, HashMap};
use std::mem::discriminant;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use super::compose::{Composed, Shared, input_of};
use super::freshness::{self, SourceState};
use super::markdown;
use super::prompt::{PromptInput, preamble};
use super::schema::{Step, Tutorial, step_schemas};
use super::validate::check_step;
use crate::ai::run::{MAX_RETRIES, OutputValidator, Verdict};
use crate::ai::types::{AiPolicy, AiRequest};
use crate::error::{AppError, AppResult};
use crate::learning::corpus::{Corpus, SourceScope};
use crate::profile::ProjectProfile;
use crate::profile::walk::Walk;

/// Missing topics kept at most.
pub const MAX_MISSING_TOPICS: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ChapterVerdict {
    Correct,
    Outdated,
}

/// A replacement for one step of a chapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StepProposal {
    /// The step's index in its chapter.
    pub step: u32,
    /// Why the step is outdated.
    pub reason: String,
    /// The change in the project it saw (a file, a line, a renamed identifier).
    pub change: String,
    pub replacement: Step,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChapterReview {
    pub id: String,
    /// The chapter's index in the tutorial.
    pub index: u32,
    pub verdict: ChapterVerdict,
    pub reason: String,
    pub proposals: Vec<StepProposal>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MissingTopic {
    pub title: String,
    pub goal: String,
    pub reason: String,
}

/// The accepted answer of a review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TutorialReview {
    pub tutorial_id: String,
    pub chapters: Vec<ChapterReview>,
    pub missing_topics: Vec<MissingTopic>,
    pub rejected_count: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawProposal {
    step: u32,
    reason: String,
    change: String,
    replacement: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawChapter {
    id: String,
    verdict: ChapterVerdict,
    reason: String,
    #[serde(default)]
    proposals: Vec<RawProposal>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawReview {
    chapters: Vec<RawChapter>,
    #[serde(default)]
    missing_topics: Vec<MissingTopic>,
}

pub fn review_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["chapters", "missingTopics"],
        "properties": {
            "chapters": {
                "type": "array",
                "description": "One entry per written chapter, in order.",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["id", "verdict", "reason", "proposals"],
                    "properties": {
                        "id": { "type": "string", "pattern": "^c[0-9]{1,2}$" },
                        "verdict": { "enum": ["correct", "outdated"] },
                        "reason": { "type": "string", "minLength": 10, "maxLength": 500, "description": "Why it is still correct, or what is now wrong, naming the files or identifiers." },
                        "proposals": {
                            "type": "array",
                            "maxItems": 12,
                            "description": "For an outdated chapter: a replacement for each outdated step. Empty when correct.",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["step", "reason", "change", "replacement"],
                                "properties": {
                                    "step": { "type": "integer", "minimum": 0, "description": "The step's index in the chapter, from 0." },
                                    "reason": { "type": "string", "minLength": 10, "maxLength": 400 },
                                    "change": { "type": "string", "minLength": 6, "maxLength": 300, "description": "The change in the project that makes it outdated: the file and what changed." },
                                    "replacement": { "anyOf": step_schemas(), "description": "The whole step rewritten for the project as it is now: the same type, real citations." }
                                }
                            }
                        }
                    }
                }
            },
            "missingTopics": {
                "type": "array",
                "maxItems": MAX_MISSING_TOPICS,
                "description": "Something important of this subject the tutorial does not cover (new since it was written, or missed). Empty when nothing is missing.",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["title", "goal", "reason"],
                    "properties": {
                        "title": { "type": "string", "minLength": 4, "maxLength": 80 },
                        "goal": { "type": "string", "minLength": 10, "maxLength": 300, "description": "What a chapter on it would teach, in this project's terms." },
                        "reason": { "type": "string", "minLength": 10, "maxLength": 300 }
                    }
                }
            }
        }
    })
}

/// The local check's findings, for the prompt.
fn findings(root: &Path, t: &Tutorial) -> String {
    let report = freshness::check(root, t);
    let lines: Vec<String> = report
        .checks
        .iter()
        .filter_map(|c| {
            let at = match &c.lines {
                Some(l) => format!("{}:{l}", c.path),
                None => c.path.clone(),
            };
            match c.state {
                SourceState::Changed => Some(format!("- {at}: the cited lines changed")),
                SourceState::Missing => Some(format!("- {at}: the file is gone")),
                SourceState::Moved {
                    first_line,
                    last_line,
                } => Some(format!(
                    "- {at}: the same lines moved to {first_line}-{last_line}"
                )),
                _ => None,
            }
        })
        .collect();
    if lines.is_empty() {
        "Every cited range still has the lines it had when the tutorial was written (the files around them may still have changed).".to_owned()
    } else {
        format!(
            "Cited ranges that differ from when the tutorial was written:\n{}",
            lines.join("\n")
        )
    }
}

fn review_task(name: &str, t: &Tutorial, root: &Path) -> String {
    let files = markdown::write(t, "");
    let text: Vec<String> = files
        .iter()
        .map(|f| format!("=== {} ===\n{}", f.name, f.text))
        .collect();
    format!(
        "Check this tutorial about {name} against the project as it is now. Open the files it cites (and the files around them) before you judge.
For each written chapter, in order: \"correct\" when every step still teaches what the project does, else \"outdated\" with the reason naming what changed. For each outdated step, propose a replacement: the whole step rewritten for the project as it is now, of the same type, citing real lines you opened (as when the chapter was written), with the change you saw. Do not rewrite a step that is still correct, and do not change the style or the order of the chapter.
Then name at most {MAX_MISSING_TOPICS} topics of this subject the tutorial misses (new since it was written, or important and absent), each with the goal of a chapter on it. Nothing generic: every reason, change and goal names files or identifiers of {name}.

{}

The tutorial (its shared markdown: a README with the outline, then one file per written chapter; steps are numbered from 1 there, from 0 in your answer):
{}",
        findings(root, t),
        text.join("\n\n")
    )
}

/// Composes the review of `t` in the folder of `root`.
pub fn compose_review(
    root: &Path,
    profile: &ProjectProfile,
    walk: &Walk,
    agent_names: &[String],
    t: &Tutorial,
    model: Option<String>,
) -> AppResult<Composed<ReviewValidator>> {
    if !t.chapters.iter().any(|c| c.is_written()) {
        return Err(AppError::ChapterNotWritten(
            "this tutorial has no written chapter to check".to_owned(),
        ));
    }
    let corpus = Corpus::build(root, walk, &SourceScope::WholeProject, agent_names);
    let (agent_text, inlined) = corpus.agent_text(root);
    let map = corpus.map();
    let input = input_of(t);
    let prompt = preamble(
        &PromptInput {
            profile,
            input: &input,
            corpus_map: &map,
            anchor_files: "",
            agent_files: &agent_text,
            focus: None,
        },
        &review_task(&profile.name, t, root),
    );
    Ok(Composed {
        prompt_bytes: prompt.len() as u64,
        request: AiRequest {
            prompt,
            model,
            policy: AiPolicy::ReadOnly,
            output_schema: Some(review_schema()),
            ..AiRequest::default()
        },
        validator: ReviewValidator {
            shared: Shared {
                root: root.to_path_buf(),
                corpus,
                agent_names: agent_names.to_vec(),
                project_name: profile.name.clone(),
                modules: profile.modules.iter().map(|m| m.path.clone()).collect(),
                input,
                cache: HashMap::new(),
            },
            tutorial: t.clone(),
            best: None,
            rejected_total: 0,
            last_reason: String::new(),
        },
        inlined,
    })
}

/// Accepts, repairs or gives up on a review.
pub struct ReviewValidator {
    shared: Shared,
    tutorial: Tutorial,
    best: Option<TutorialReview>,
    rejected_total: u32,
    last_reason: String,
}

impl ReviewValidator {
    /// The accepted review and what was rejected (where, why).
    fn validate(&mut self, raw: &RawReview) -> (TutorialReview, Vec<String>) {
        let t = &self.tutorial;
        let mut rejected = Vec::new();
        let mut chapters = Vec::new();
        let mut seen = BTreeSet::new();
        for rc in &raw.chapters {
            let Some(index) = t.chapters.iter().position(|c| c.id == rc.id) else {
                rejected.push(format!("chapter {}: there is no such chapter", rc.id));
                continue;
            };
            let chapter = &t.chapters[index];
            if !chapter.is_written() || !seen.insert(rc.id.clone()) {
                continue;
            }
            let mut proposals: Vec<StepProposal> = Vec::new();
            for p in &rc.proposals {
                let at = format!("chapter {} step {}", rc.id, p.step);
                let Some(original) = chapter.steps.get(p.step as usize) else {
                    rejected.push(format!("{at}: the chapter has no such step"));
                    continue;
                };
                if proposals.iter().any(|q| q.step == p.step) {
                    continue;
                }
                let step: Step = match serde_json::from_value(p.replacement.clone()) {
                    Ok(s) => s,
                    Err(e) => {
                        rejected.push(format!("{at}: the replacement is not a step ({e})"));
                        continue;
                    }
                };
                if discriminant(&step) != discriminant(original) {
                    rejected.push(format!("{at}: the replacement must keep the step's type"));
                    continue;
                }
                match self.shared.with_context(|ctx| check_step(&step, ctx)) {
                    Ok(step) => proposals.push(StepProposal {
                        step: p.step,
                        reason: p.reason.trim().to_owned(),
                        change: p.change.trim().to_owned(),
                        replacement: step,
                    }),
                    Err((_, why)) => rejected.push(format!("{at}: {why}")),
                }
            }
            let verdict = if proposals.is_empty() {
                rc.verdict
            } else {
                ChapterVerdict::Outdated
            };
            chapters.push(ChapterReview {
                id: rc.id.clone(),
                index: u32::try_from(index).unwrap_or(u32::MAX),
                verdict,
                reason: rc.reason.trim().to_owned(),
                proposals,
            });
        }
        for c in t.chapters.iter().filter(|c| c.is_written()) {
            if !seen.contains(&c.id) {
                rejected.push(format!("chapter {}: not reviewed", c.id));
            }
        }
        chapters.sort_by_key(|c| c.index);
        let missing_topics = raw
            .missing_topics
            .iter()
            .filter(|m| !m.title.trim().is_empty() && !m.goal.trim().is_empty())
            .take(MAX_MISSING_TOPICS)
            .map(|m| MissingTopic {
                title: m.title.split_whitespace().collect::<Vec<_>>().join(" "),
                goal: m.goal.trim().to_owned(),
                reason: m.reason.trim().to_owned(),
            })
            .collect();
        (
            TutorialReview {
                tutorial_id: t.id.clone(),
                chapters,
                missing_topics,
                rejected_count: 0,
            },
            rejected,
        )
    }

    fn result(&self, mut review: TutorialReview) -> Value {
        review.rejected_count = self.rejected_total;
        serde_json::to_value(review).unwrap_or(Value::Null)
    }
}

impl OutputValidator for ReviewValidator {
    fn check(&mut self, _attempt: u32, output: &Value) -> Verdict {
        let parsed: RawReview = match serde_json::from_value(output.clone()) {
            Ok(p) if !output.is_null() => p,
            Ok(_) | Err(_) => {
                self.last_reason = "the answer was not valid JSON".to_owned();
                return Verdict::Retry {
                    repair_prompt: "Your answer could not be read as the review JSON. Return it again, following the schema. JSON only.".to_owned(),
                    reason: self.last_reason.clone(),
                };
            }
        };
        let (review, rejected) = self.validate(&parsed);
        self.rejected_total += u32::try_from(rejected.len()).unwrap_or(u32::MAX);
        let better = self
            .best
            .as_ref()
            .is_none_or(|b| review.chapters.len() >= b.chapters.len());
        if better {
            self.best = Some(review.clone());
        }
        if rejected.is_empty() {
            return Verdict::Accept(self.result(review));
        }
        self.last_reason = format!("{} problems", rejected.len());
        let mut lines = vec![
            "Thank you. IGrasp checked your review against the tutorial and the project. Fix these, keep the rest, and return the complete JSON again:".to_owned(),
        ];
        lines.extend(rejected.iter().map(|r| format!("- {r}")));
        Verdict::Retry {
            repair_prompt: lines.join("\n"),
            reason: self.last_reason.clone(),
        }
    }

    fn on_exhausted(&mut self) -> Verdict {
        match self.best.take() {
            Some(best) if !best.chapters.is_empty() => Verdict::Accept(self.result(best)),
            _ => Verdict::Fail {
                message: format!(
                    "Hoot could not check this tutorial after {} attempts ({}).",
                    1 + MAX_RETRIES,
                    self.last_reason
                ),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::learning::tutorial::markdown::tests::sample;
    use crate::profile::{build, tests::tree};

    const WATCHER: &str = "//! Watches the folder.\npub const DEBOUNCE_MS: u64 = 200;\n\npub struct WatchContext {\n    pub generation: u64,\n}\n";

    fn composed() -> (tempfile::TempDir, Composed<ReviewValidator>, Tutorial) {
        let dir = tree(&[
            (
                "README.md",
                "# Orbit\n\nOrbit keeps a live index of markdown files.\n",
            ),
            ("package.json", r#"{"name":"orbit","main":"index.js"}"#),
            ("src/index/watcher.rs", WATCHER),
        ]);
        let (profile, walk) = build(dir.path(), &[], &std::sync::atomic::AtomicBool::new(false));
        let t = sample();
        let c = compose_review(dir.path(), &profile, &walk, &[], &t, None).unwrap();
        (dir, c, t)
    }

    #[test]
    fn the_prompt_holds_the_tutorial_and_the_local_findings() {
        let (_dir, c, t) = composed();
        assert!(c.request.prompt.contains("=== README.md ==="));
        assert!(c.request.prompt.contains(&t.chapters[0].title));
        assert!(c.request.prompt.contains("src/index/watcher.rs:2-6"));
        assert_eq!(c.request.policy, AiPolicy::ReadOnly);
        assert!(c.request.output_schema.is_some());
    }

    #[test]
    fn replacements_are_checked_and_every_written_chapter_reviewed() {
        let (_dir, mut c, t) = composed();
        let chapter = &t.chapters[0];
        let original = serde_json::to_value(&chapter.steps[0]).unwrap();
        let mut replacement = original.clone();
        replacement["body"] = json!(
            "The watcher of Orbit now waits `DEBOUNCE_MS` (200 ms in src/index/watcher.rs) before it walks again, then classifies the batch."
        );
        replacement["selfCheck"] = json!({ "projectSpecific": true, "reason": "names watcher.rs" });
        // A replacement of another type, a step that does not exist: rejected, retried.
        let bad = json!({
            "chapters": [{ "id": chapter.id, "verdict": "outdated", "reason": "The debounce changed in watcher.rs.", "proposals": [
                { "step": 0, "reason": "the delay changed", "change": "src/index/watcher.rs line 2", "replacement": { "type": "recap", "takeaways": ["a b c d e f g h i j k l", "a b c d e f g h i j k l", "a b c d e f g h i j k l"], "selfCheck": { "projectSpecific": true, "reason": "x" } } },
                { "step": 99, "reason": "the delay changed", "change": "src/index/watcher.rs line 2", "replacement": replacement }
            ] }],
            "missingTopics": []
        });
        assert!(matches!(c.validator.check(0, &bad), Verdict::Retry { .. }));
        let good = json!({
            "chapters": [{ "id": chapter.id, "verdict": "outdated", "reason": "The debounce changed in watcher.rs.", "proposals": [
                { "step": 0, "reason": "the delay changed", "change": "src/index/watcher.rs line 2", "replacement": replacement }
            ] }],
            "missingTopics": [{ "title": "The classifier", "goal": "Follow how Orbit classifies a batch in watcher.rs.", "reason": "Not covered." }]
        });
        let Verdict::Accept(value) = c.validator.check(1, &good) else {
            panic!("not accepted");
        };
        let review: TutorialReview = serde_json::from_value(value).unwrap();
        assert_eq!(review.chapters.len(), 1);
        assert_eq!(review.chapters[0].proposals[0].step, 0);
        assert_eq!(review.missing_topics.len(), 1);
        assert_eq!(review.rejected_count, 2);
    }
}
