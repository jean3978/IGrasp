//! "Suggest more subjects" (uses tokens, with consent): the AI proposes subjects the local cards
//! did not offer, each phrased about this project and anchored on files it opened. One validated
//! read-only run; the accepted subjects become cards of the "Suggested" family, kept with the
//! folder by the frontend (`save_suggested_subjects`).

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use super::compose::Composed;
use super::families::{FamilyKind, TutorialSubject};
use super::markdown::slug;
use super::prompt::{PromptInput, preamble};
use super::schema::SelfCheck;
use super::{TutorialInput, validate::KEY_SOURCE_LINES};
use crate::ai::run::{MAX_RETRIES, OutputValidator, Verdict};
use crate::ai::types::{AiPolicy, AiRequest};
use crate::error::AppResult;
use crate::learning::corpus::{Corpus, PathStatus, SourceScope, read_text};
use crate::learning::quiz::validate::{names_project, words};
use crate::learning::role::{RoleFamily, family, focus};
use crate::learning::subjects::Material;
use crate::profile::ProjectProfile;
use crate::profile::walk::Walk;

/// Subjects asked for at least and at most.
pub const MIN_SUGGESTIONS: usize = 5;
pub const MAX_SUGGESTIONS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawSuggestion {
    pub title: String,
    pub blurb: String,
    pub anchors: Vec<String>,
    pub self_check: SelfCheck,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuggestOutput {
    pub subjects: Vec<RawSuggestion>,
}

/// The accepted answer of a suggestion run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SuggestResult {
    pub subjects: Vec<TutorialSubject>,
    pub rejected_count: u32,
}

pub fn suggest_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["subjects"],
        "properties": {
            "subjects": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_SUGGESTIONS,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["title", "blurb", "anchors", "selfCheck"],
                    "properties": {
                        "title": { "type": "string", "minLength": 8, "maxLength": 90, "description": "Phrased about this project: \"How <project> retries a failed upload\", never a bare topic." },
                        "blurb": { "type": "string", "minLength": 12, "maxLength": 200, "description": "One line: what the tutorial would follow here, naming files or identifiers." },
                        "anchors": { "type": "array", "minItems": 1, "maxItems": 5, "items": { "type": "string" }, "description": "Root-relative paths of the files the tutorial would start from, that you opened." },
                        "selfCheck": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["projectSpecific", "reason"],
                            "properties": {
                                "projectSpecific": { "type": "boolean" },
                                "reason": { "type": "string", "maxLength": 200 }
                            }
                        }
                    }
                }
            }
        }
    })
}

/// Who the subjects are for: developers by default, else a role and what its craft touches here.
fn suggest_reader(role: Option<&str>) -> String {
    let Some(r) = role else {
        return "that a developer joining it would want to learn".to_owned();
    };
    let fam = family(r);
    if fam == RoleFamily::Developer {
        return format!(
            "that {} {r} on this project would want to learn",
            article(r)
        );
    }
    let craft = focus(fam).map_or_else(String::new, |f| format!(" Their craft here is {f}."));
    format!(
        "for {} {r} on this project, deeply tied to their own work: what they make, touch, tune or decide in this project, and how it reaches the rest of it.{craft} Every subject must make sense to a {r} reading its title; leave out the code internals they never meet (dependencies, build plumbing, data structures) unless their work depends on them",
        article(r)
    )
}

fn suggest_task(name: &str, offered: &[TutorialSubject], role: Option<&str>) -> String {
    let list: Vec<String> = offered.iter().map(|c| format!("- {}", c.title)).collect();
    format!(
        "Suggest {MIN_SUGGESTIONS} to {MAX_SUGGESTIONS} more tutorial subjects about {name} {}, and that the subject cards below do not already offer. Open the files first: each subject follows something this project really does (a flow, a mechanism, a convention, a tricky part), with a title phrased about this project, a one-line blurb naming its files or identifiers, the anchor files it would start from (root-relative paths you opened), and a selfCheck. Never a generic topic (\"Learn Rust\", \"What is REST\").
Already offered:
{}",
        suggest_reader(role),
        if list.is_empty() {
            "(none)".to_owned()
        } else {
            list.join("\n")
        }
    )
}

/// "an" before a vowel, else "a".
fn article(word: &str) -> &'static str {
    if word.starts_with(['A', 'E', 'I', 'O', 'U', 'a', 'e', 'i', 'o', 'u']) {
        "an"
    } else {
        "a"
    }
}

/// Composes the suggestion request in the folder of `root`.
pub fn compose_suggest(
    root: &Path,
    profile: &ProjectProfile,
    walk: &Walk,
    agent_names: &[String],
    offered: &[TutorialSubject],
    role: Option<&str>,
    model: Option<String>,
) -> AppResult<Composed<SuggestValidator>> {
    let role = role
        .map(|r| r.trim().chars().take(80).collect::<String>())
        .filter(|r| !r.is_empty());
    let corpus = Corpus::build(root, walk, &SourceScope::WholeProject, agent_names);
    let mut anchors: Vec<String> = Vec::new();
    anchors.extend(profile.docs.readme.clone());
    anchors.extend(profile.docs.architecture.clone());
    anchors.retain(|a| corpus.files.contains_key(a));
    let (anchor_text, mut inlined) = corpus.anchors_text(root, &anchors);
    let (agent_text, agent_inlined) = corpus.agent_text(root);
    inlined.extend(agent_inlined);
    let map = corpus.map();
    let input = TutorialInput {
        subject: "more subjects to learn".to_owned(),
        role: role.clone(),
        ..TutorialInput::default()
    };
    let prompt = preamble(
        &PromptInput {
            profile,
            input: &input,
            corpus_map: &map,
            anchor_files: &anchor_text,
            agent_files: &agent_text,
            focus: None,
        },
        &suggest_task(&profile.name, offered, role.as_deref()),
    );
    let taken: BTreeSet<String> = offered.iter().map(|c| c.title.to_lowercase()).collect();
    Ok(Composed {
        prompt_bytes: prompt.len() as u64,
        request: AiRequest {
            prompt,
            model,
            policy: AiPolicy::ReadOnly,
            output_schema: Some(suggest_schema()),
            ..AiRequest::default()
        },
        validator: SuggestValidator {
            root: root.to_path_buf(),
            corpus,
            agent_names: agent_names.to_vec(),
            project_name: profile.name.clone(),
            modules: profile.modules.iter().map(|m| m.path.clone()).collect(),
            taken,
            role,
            cache: HashMap::new(),
            best: Vec::new(),
            rejected_total: 0,
            last_reason: String::new(),
        },
        inlined,
    })
}

/// Accepts, repairs or gives up on suggestions.
pub struct SuggestValidator {
    root: PathBuf,
    corpus: Corpus,
    agent_names: Vec<String>,
    project_name: String,
    modules: Vec<String>,
    /// Titles already offered (lower case).
    taken: BTreeSet<String>,
    /// The role the subjects are for, stamped on each accepted card.
    role: Option<String>,
    cache: HashMap<String, Arc<Vec<String>>>,
    best: Vec<TutorialSubject>,
    rejected_total: u32,
    last_reason: String,
}

impl SuggestValidator {
    fn lines(&mut self, path: &str) -> Option<Arc<Vec<String>>> {
        if let Some(l) = self.cache.get(path) {
            return Some(l.clone());
        }
        let text = read_text(&self.root, path)?;
        let lines = Arc::new(text.lines().map(str::to_owned).collect::<Vec<_>>());
        self.cache.insert(path.to_owned(), lines.clone());
        Some(lines)
    }

    /// The accepted subjects and the rejected ones (title, reason).
    pub fn validate(
        &mut self,
        raw: &[RawSuggestion],
    ) -> (Vec<TutorialSubject>, Vec<(String, String)>) {
        let mut accepted: Vec<TutorialSubject> = Vec::new();
        let mut rejected = Vec::new();
        for s in raw.iter().take(MAX_SUGGESTIONS) {
            let title = s.title.split_whitespace().collect::<Vec<_>>().join(" ");
            let key = title.to_lowercase();
            let verdict = (|| -> Result<TutorialSubject, String> {
                if self.taken.contains(&key)
                    || accepted.iter().any(|a| a.title.to_lowercase() == key)
                {
                    return Err("is already offered".to_owned());
                }
                let mut anchors = Vec::new();
                let mut cited = BTreeSet::new();
                for a in &s.anchors {
                    let path = a.trim().trim_start_matches("./").replace('\\', "/");
                    match self.corpus.status(&path, &self.agent_names) {
                        PathStatus::Citable(f) => {
                            let binary = f.binary;
                            if !binary && let Some(lines) = self.lines(&path) {
                                for l in lines.iter().take(KEY_SOURCE_LINES) {
                                    cited.extend(words(l));
                                }
                                anchors.push(path);
                            }
                        }
                        PathStatus::Agent => {
                            return Err(format!("starts from {path}, an agent instruction file"));
                        }
                        PathStatus::Secret => {
                            return Err(format!(
                                "starts from {path}, a file that may hold secrets"
                            ));
                        }
                        _ => {}
                    }
                }
                if anchors.is_empty() {
                    return Err("names no text file of this project as an anchor".to_owned());
                }
                if !s.self_check.project_specific {
                    return Err("your own self-check says it is not specific".to_owned());
                }
                let text = format!("{} {}", s.title, s.blurb);
                if !names_project(
                    &text,
                    &cited,
                    &self.corpus,
                    &self.project_name,
                    &self.modules,
                ) {
                    return Err(
                        "generic: the title and the blurb name nothing of this project".to_owned(),
                    );
                }
                Ok(TutorialSubject {
                    id: format!("suggested:{}", slug(&title)),
                    kind: FamilyKind::Suggested,
                    family: "Suggested".to_owned(),
                    title: title.clone(),
                    blurb: s.blurb.trim().to_owned(),
                    focus: format!("{title}: {}", s.blurb.trim()),
                    anchors,
                    material: Material::Some,
                    picks: Vec::new(),
                    domain: None,
                    for_role: self.role.clone(),
                })
            })();
            match verdict {
                Ok(subject) => accepted.push(subject),
                Err(reason) => rejected.push((title, reason)),
            }
        }
        (accepted, rejected)
    }

    fn result(&self, subjects: Vec<TutorialSubject>) -> Value {
        serde_json::to_value(SuggestResult {
            subjects,
            rejected_count: self.rejected_total,
        })
        .unwrap_or(Value::Null)
    }
}

impl OutputValidator for SuggestValidator {
    fn check(&mut self, _attempt: u32, output: &Value) -> Verdict {
        let parsed: SuggestOutput = match serde_json::from_value(output.clone()) {
            Ok(p) if !output.is_null() => p,
            Ok(_) | Err(_) => {
                self.last_reason = "the answer was not valid JSON".to_owned();
                return Verdict::Retry {
                    repair_prompt: "Your answer could not be read as the subjects JSON. Return it again, following the schema. JSON only.".to_owned(),
                    reason: self.last_reason.clone(),
                };
            }
        };
        let (accepted, rejected) = self.validate(&parsed.subjects);
        self.rejected_total += u32::try_from(rejected.len()).unwrap_or(u32::MAX);
        if accepted.len() > self.best.len() {
            self.best = accepted.clone();
        }
        if accepted.len() >= MIN_SUGGESTIONS.min(3) && rejected.is_empty() {
            return Verdict::Accept(self.result(accepted));
        }
        let reason = format!("{} subjects rejected", rejected.len());
        self.last_reason = reason.clone();
        let mut lines = vec![
            "Thank you. IGrasp checked your subjects against the project. Replace these, keep the others, and return the complete JSON again:".to_owned(),
        ];
        for (title, why) in &rejected {
            lines.push(format!("- {title}: {why}"));
        }
        Verdict::Retry {
            repair_prompt: lines.join("\n"),
            reason,
        }
    }

    fn on_exhausted(&mut self) -> Verdict {
        if self.best.is_empty() {
            Verdict::Fail {
                message: format!(
                    "Hoot could not find a new subject grounded in this project after {} attempts ({}).",
                    1 + MAX_RETRIES,
                    self.last_reason
                ),
            }
        } else {
            let best = std::mem::take(&mut self.best);
            Verdict::Accept(self.result(best))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::*;
    use crate::profile::{build, tests::tree};

    #[test]
    fn suggestions_are_grounded_new_and_phrased_about_the_project() {
        let dir = tree(&[
            ("README.md", "# Orbit\n\nOrbit keeps a live index.\n"),
            (
                "src/upload/retry.rs",
                "pub fn retry_upload(attempts: u32) -> bool {\n    attempts < 3\n}\n",
            ),
            ("CLAUDE.md", "# Rules\n"),
        ]);
        let (profile, walk) = build(dir.path(), &[], &AtomicBool::new(false));
        let offered = vec![TutorialSubject {
            id: "family:big-picture".into(),
            kind: FamilyKind::Universal,
            family: "The Big Picture".into(),
            title: "How orbit fits together, in 5 minutes".into(),
            blurb: String::new(),
            focus: String::new(),
            anchors: vec![],
            material: Material::Some,
            picks: vec![],
            domain: None,
            for_role: None,
        }];
        let mut c = compose_suggest(
            dir.path(),
            &profile,
            &walk,
            &["CLAUDE.md".to_owned()],
            &offered,
            None,
            None,
        )
        .unwrap();
        assert!(
            c.request
                .prompt
                .contains("that a developer joining it would want")
        );
        assert_eq!(c.request.policy, AiPolicy::ReadOnly);
        assert!(
            c.request
                .prompt
                .contains("Already offered:\n- How orbit fits together")
        );
        let s = |title: &str, anchors: &[&str], specific: bool| {
            json!({ "title": title, "blurb": "Follows retry_upload in src/upload/retry.rs.", "anchors": anchors,
                "selfCheck": { "projectSpecific": specific, "reason": "r" } })
        };
        let out = json!({ "subjects": [
            s("How Orbit retries a failed upload", &["src/upload/retry.rs"], true),
            s("How orbit fits together, in 5 minutes", &["README.md"], true),
            s("Agent rules of Orbit", &["CLAUDE.md"], true),
            s("Where Orbit retries uploads, nothing", &["nowhere.rs"], true),
            s("Orbit's retry budget", &["src/upload/retry.rs"], false),
        ]});
        match c.validator.check(1, &out) {
            Verdict::Retry { repair_prompt, .. } => {
                assert!(
                    repair_prompt
                        .contains("- How orbit fits together, in 5 minutes: is already offered")
                );
                assert!(repair_prompt.contains("CLAUDE.md, an agent instruction file"));
            }
            other => panic!("{other:?}"),
        }
        match c.validator.on_exhausted() {
            Verdict::Accept(v) => {
                let r: SuggestResult = serde_json::from_value(v).unwrap();
                assert_eq!(r.subjects.len(), 1);
                assert_eq!(
                    r.subjects[0].id,
                    "suggested:how-orbit-retries-a-failed-upload"
                );
                assert_eq!(r.subjects[0].kind, FamilyKind::Suggested);
                assert_eq!(r.subjects[0].anchors, vec!["src/upload/retry.rs"]);
                assert_eq!(r.rejected_count, 4);
                assert_eq!(r.subjects[0].for_role, None);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn suggestions_for_a_role_are_tied_to_its_craft_and_stamped_with_it() {
        let dir = tree(&[
            ("README.md", "# Orbit\n\nOrbit keeps a live index.\n"),
            (
                "levels/cave.tscn",
                "[node name=\"Cave\"]\nspawn_point = Vector2(4, 8)\n",
            ),
        ]);
        let (profile, walk) = build(dir.path(), &[], &AtomicBool::new(false));
        let mut c = compose_suggest(
            dir.path(),
            &profile,
            &walk,
            &[],
            &[],
            Some("  Level designer "),
            None,
        )
        .unwrap();
        let prompt = &c.request.prompt;
        assert!(
            prompt.contains("for a Level designer on this project, deeply tied to their own work")
        );
        // The craft of the level family, and the audience block of the tutorial prompts.
        assert!(prompt.contains("spawn points"));
        assert!(prompt.contains("A Level designer on this project"));
        let out = json!({ "subjects": [
            { "title": "How Orbit's cave level places its spawn_point", "blurb": "Follows spawn_point in levels/cave.tscn.",
              "anchors": ["levels/cave.tscn"], "selfCheck": { "projectSpecific": true, "reason": "r" } },
        ]});
        let _ = c.validator.check(1, &out);
        match c.validator.on_exhausted() {
            Verdict::Accept(v) => {
                let r: SuggestResult = serde_json::from_value(v).unwrap();
                assert_eq!(r.subjects[0].for_role.as_deref(), Some("Level designer"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_developer_role_keeps_the_developer_task() {
        let task = suggest_task("Orbit", &[], Some("Backend developer"));
        assert!(task.contains("that a Backend developer on this project would want to learn"));
        assert!(!task.contains("deeply tied"));
    }
}
