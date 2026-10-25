//! The tutorial schema: what the model writes (an outline, then one chapter at a time, each
//! checked by the validator) and what the app keeps (a `Tutorial` with its chapters, every step
//! type and every citation with a file and a line range). As for the quiz, the typed structs with
//! `deny_unknown_fields` are the schema check, and tests keep the JSON schemas in step with them.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

pub use crate::learning::quiz::schema::MAX_RANGE_LINES;
use crate::learning::quiz::schema::QuestionKind;

/// Chapters in an outline at most.
pub const MAX_CHAPTERS: usize = 8;
/// Steps in a chapter at most.
pub const MAX_STEPS: usize = 12;

fn is_none<T>(o: &Option<T>) -> bool {
    o.is_none()
}

fn is_empty<T>(v: &[T]) -> bool {
    v.is_empty()
}

/// A project source a step points at: a text file with the lines that hold the fact, or a
/// binary asset by name (never alone).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct Citation {
    /// Root-relative with `/`.
    pub path: String,
    #[serde(default, skip_serializing_if = "is_none")]
    pub first_line: Option<u32>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub last_line: Option<u32>,
    /// What the reader finds there, in a few words.
    #[serde(default, skip_serializing_if = "is_none")]
    pub why: Option<String>,
}

impl Citation {
    pub fn new(path: &str, first: u32, last: u32) -> Self {
        Self {
            path: path.to_owned(),
            first_line: Some(first),
            last_line: Some(last),
            why: None,
        }
    }

    /// `"12-30"`, `"7"`, or `None` for a whole file.
    pub fn lines(&self) -> Option<String> {
        match (self.first_line, self.last_line) {
            (Some(a), Some(b)) if a == b => Some(a.to_string()),
            (Some(a), Some(b)) => Some(format!("{a}-{b}")),
            (Some(a), None) | (None, Some(a)) => Some(a.to_string()),
            (None, None) => None,
        }
    }
}

/// The model's own verdict on an item: is it about this project?
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct SelfCheck {
    pub project_specific: bool,
    pub reason: String,
}

// ---------------------------------------------------------------------------------------------
// The outline, as the model writes it.

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawOutlineChapter {
    pub id: String,
    pub title: String,
    /// What the reader can do or explain after this chapter, about this project.
    pub goal: String,
    pub minutes: u32,
    /// The files the chapter will be built on (opened while planning).
    pub key_sources: Vec<String>,
    pub self_check: SelfCheck,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutlineOutput {
    pub insufficient_material: bool,
    #[serde(default)]
    pub material_note: Option<String>,
    /// What the documentation lacks for this subject and this reader, if anything.
    #[serde(default)]
    pub docs_note: Option<String>,
    #[serde(default)]
    pub suggested_subjects: Vec<String>,
    pub title: String,
    /// Two or three sentences: what the reader will be able to do, in this project's terms.
    pub intro: String,
    pub chapters: Vec<RawOutlineChapter>,
}

// ---------------------------------------------------------------------------------------------
// A chapter and its steps (what the model writes, and what the app keeps once validated).

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct ExplainStep {
    pub title: String,
    /// Markdown: how this project does something.
    pub body: String,
    pub sources: Vec<Citation>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub self_check: Option<SelfCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct ConceptBridgeStep {
    pub title: String,
    /// The concept in one or two sentences.
    pub concept: String,
    /// Markdown: the concept applied to the cited code of this project.
    pub applied: String,
    /// The official documentation of the concept, for the generic details.
    #[serde(default, skip_serializing_if = "is_none")]
    pub docs_url: Option<String>,
    pub sources: Vec<Citation>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub self_check: Option<SelfCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct TourStop {
    pub path: String,
    pub first_line: u32,
    pub last_line: u32,
    /// Markdown shown next to the highlighted lines.
    pub annotation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct CodeTourStep {
    pub title: String,
    pub stops: Vec<TourStop>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub self_check: Option<SelfCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct DiagramStep {
    pub title: String,
    /// Mermaid source (flowchart, sequence, class, state).
    pub mermaid: String,
    #[serde(default, skip_serializing_if = "is_none")]
    pub caption: Option<String>,
    pub sources: Vec<Citation>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub self_check: Option<SelfCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct PutInOrderStep {
    pub title: String,
    pub prompt: String,
    /// In the right order; the app shuffles them.
    pub items: Vec<String>,
    pub explanation: String,
    pub sources: Vec<Citation>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub self_check: Option<SelfCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct MatchPair {
    pub left: String,
    pub right: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct MatchStep {
    pub title: String,
    pub prompt: String,
    pub pairs: Vec<MatchPair>,
    pub explanation: String,
    pub sources: Vec<Citation>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub self_check: Option<SelfCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct SpotItStep {
    pub title: String,
    /// "Click the line that …".
    pub prompt: String,
    /// The snippet shown.
    pub path: String,
    pub first_line: u32,
    pub last_line: u32,
    /// The line to click, absolute in the file, inside the snippet.
    pub answer_line: u32,
    pub explanation: String,
    #[serde(default, skip_serializing_if = "is_none")]
    pub self_check: Option<SelfCheck>,
}

/// A quiz question (the quiz's cards, hint and explanation).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct QuickCheckStep {
    pub kind: QuestionKind,
    pub question: String,
    pub choices: Vec<String>,
    pub answer: u32,
    pub hint: String,
    pub explanation: String,
    pub sources: Vec<Citation>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub self_check: Option<SelfCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct TryItStep {
    pub title: String,
    /// Markdown: what to do and what to look at.
    pub instruction: String,
    /// A command to copy, when there is one. The app never runs it.
    #[serde(default, skip_serializing_if = "is_none")]
    pub command: Option<String>,
    /// Where: `terminal`, `ide`, `engine`, `browser`, `device`.
    #[serde(default, rename = "where", skip_serializing_if = "is_none")]
    pub where_: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub expected: Option<String>,
    pub sources: Vec<Citation>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub self_check: Option<SelfCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, optional_fields)]
pub struct RecapStep {
    /// Three key takeaways.
    pub takeaways: Vec<String>,
    #[serde(default, skip_serializing_if = "is_empty")]
    pub sources: Vec<Citation>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub self_check: Option<SelfCheck>,
}

/// Every step type, tagged by `type`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum Step {
    Explain(ExplainStep),
    ConceptBridge(ConceptBridgeStep),
    CodeTour(CodeTourStep),
    Diagram(DiagramStep),
    PutInOrder(PutInOrderStep),
    Match(MatchStep),
    SpotIt(SpotItStep),
    QuickCheck(QuickCheckStep),
    TryIt(TryItStep),
    Recap(RecapStep),
}

impl Step {
    pub fn type_name(&self) -> &'static str {
        match self {
            Self::Explain(_) => "explain",
            Self::ConceptBridge(_) => "conceptBridge",
            Self::CodeTour(_) => "codeTour",
            Self::Diagram(_) => "diagram",
            Self::PutInOrder(_) => "putInOrder",
            Self::Match(_) => "match",
            Self::SpotIt(_) => "spotIt",
            Self::QuickCheck(_) => "quickCheck",
            Self::TryIt(_) => "tryIt",
            Self::Recap(_) => "recap",
        }
    }

    /// The heading of the step in the markdown and the UI.
    pub fn title(&self) -> String {
        match self {
            Self::Explain(s) => s.title.clone(),
            Self::ConceptBridge(s) => s.title.clone(),
            Self::CodeTour(s) => s.title.clone(),
            Self::Diagram(s) => s.title.clone(),
            Self::PutInOrder(s) => s.title.clone(),
            Self::Match(s) => s.title.clone(),
            Self::SpotIt(s) => s.title.clone(),
            Self::QuickCheck(s) => s.question.clone(),
            Self::TryIt(s) => s.title.clone(),
            Self::Recap(_) => "Recap".to_owned(),
        }
    }

    /// Every citation of the step (a tour's stops and a spot-it's snippet included).
    pub fn citations(&self) -> Vec<Citation> {
        match self {
            Self::Explain(s) => s.sources.clone(),
            Self::ConceptBridge(s) => s.sources.clone(),
            Self::CodeTour(s) => s
                .stops
                .iter()
                .map(|t| Citation::new(&t.path, t.first_line, t.last_line))
                .collect(),
            Self::Diagram(s) => s.sources.clone(),
            Self::PutInOrder(s) => s.sources.clone(),
            Self::Match(s) => s.sources.clone(),
            Self::SpotIt(s) => vec![Citation::new(&s.path, s.first_line, s.last_line)],
            Self::QuickCheck(s) => s.sources.clone(),
            Self::TryIt(s) => s.sources.clone(),
            Self::Recap(s) => s.sources.clone(),
        }
    }

    /// Moves every citation of `path` at `from` lines to `to` lines (a relocation).
    pub fn relocate(&mut self, path: &str, from: (u32, u32), to: (u32, u32)) {
        let fix = |c: &mut Citation| {
            if c.path == path && c.first_line == Some(from.0) && c.last_line == Some(from.1) {
                c.first_line = Some(to.0);
                c.last_line = Some(to.1);
            }
        };
        match self {
            Self::Explain(s) => s.sources.iter_mut().for_each(fix),
            Self::ConceptBridge(s) => s.sources.iter_mut().for_each(fix),
            Self::CodeTour(s) => {
                for t in &mut s.stops {
                    if t.path == path && (t.first_line, t.last_line) == from {
                        (t.first_line, t.last_line) = to;
                    }
                }
            }
            Self::Diagram(s) => s.sources.iter_mut().for_each(fix),
            Self::PutInOrder(s) => s.sources.iter_mut().for_each(fix),
            Self::Match(s) => s.sources.iter_mut().for_each(fix),
            Self::SpotIt(s) => {
                if s.path == path && (s.first_line, s.last_line) == from {
                    s.answer_line = s.answer_line - from.0 + to.0;
                    (s.first_line, s.last_line) = to;
                }
            }
            Self::QuickCheck(s) => s.sources.iter_mut().for_each(fix),
            Self::TryIt(s) => s.sources.iter_mut().for_each(fix),
            Self::Recap(s) => s.sources.iter_mut().for_each(fix),
        }
    }

    pub fn self_check(&self) -> Option<&SelfCheck> {
        match self {
            Self::Explain(s) => s.self_check.as_ref(),
            Self::ConceptBridge(s) => s.self_check.as_ref(),
            Self::CodeTour(s) => s.self_check.as_ref(),
            Self::Diagram(s) => s.self_check.as_ref(),
            Self::PutInOrder(s) => s.self_check.as_ref(),
            Self::Match(s) => s.self_check.as_ref(),
            Self::SpotIt(s) => s.self_check.as_ref(),
            Self::QuickCheck(s) => s.self_check.as_ref(),
            Self::TryIt(s) => s.self_check.as_ref(),
            Self::Recap(s) => s.self_check.as_ref(),
        }
    }

    /// The self-check is a generation artefact: dropped once validated.
    pub fn strip_self_check(&mut self) {
        match self {
            Self::Explain(s) => s.self_check = None,
            Self::ConceptBridge(s) => s.self_check = None,
            Self::CodeTour(s) => s.self_check = None,
            Self::Diagram(s) => s.self_check = None,
            Self::PutInOrder(s) => s.self_check = None,
            Self::Match(s) => s.self_check = None,
            Self::SpotIt(s) => s.self_check = None,
            Self::QuickCheck(s) => s.self_check = None,
            Self::TryIt(s) => s.self_check = None,
            Self::Recap(s) => s.self_check = None,
        }
    }
}

/// A chapter as the model writes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChapterOutput {
    pub id: String,
    pub title: String,
    /// Hoot's one-line introduction.
    pub hoot_intro: String,
    pub steps: Vec<Step>,
    /// What the documentation lacks for this chapter's subject, if anything.
    #[serde(default)]
    pub docs_note: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// What the app keeps: a tutorial.

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct Chapter {
    /// `c1`, `c2`, … (positional).
    pub id: String,
    pub title: String,
    pub goal: String,
    pub minutes: u32,
    #[serde(default, skip_serializing_if = "is_none")]
    pub hoot_intro: Option<String>,
    /// Empty until the chapter is generated.
    #[serde(default)]
    pub steps: Vec<Step>,
}

impl Chapter {
    pub fn is_written(&self) -> bool {
        !self.steps.is_empty()
    }
}

/// A cited range with the SHA-256 of its lines when the tutorial was written (`\n`-joined, `\r`
/// removed); no hash for a binary asset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct SourceHash {
    pub path: String,
    #[serde(default, skip_serializing_if = "is_none")]
    pub lines: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct Verification {
    pub date: String,
    #[serde(default, skip_serializing_if = "is_none")]
    pub commit: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub by: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct Tutorial {
    pub id: String,
    pub title: String,
    pub intro: String,
    pub project: String,
    pub subject: String,
    pub familiarity: super::Familiarity,
    #[serde(default, skip_serializing_if = "is_none")]
    pub domain_gap: Option<String>,
    pub length: super::Length,
    #[serde(default, skip_serializing_if = "is_none")]
    pub role: Option<String>,
    /// RFC 3339.
    pub generated: String,
    pub provider: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "is_none")]
    pub generation_commit: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub verified: Option<Verification>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub material_note: Option<String>,
    #[serde(default, skip_serializing_if = "is_none")]
    pub docs_note: Option<String>,
    pub chapters: Vec<Chapter>,
    /// Every cited range, hashed (the freshness check).
    #[serde(default)]
    pub sources: Vec<SourceHash>,
}

impl Tutorial {
    /// Every distinct citation of every written chapter, in order of appearance.
    pub fn citations(&self) -> Vec<Citation> {
        let mut seen = std::collections::BTreeSet::new();
        let mut out = Vec::new();
        for c in &self.chapters {
            for s in &c.steps {
                for cit in s.citations() {
                    if seen.insert((cit.path.clone(), cit.first_line, cit.last_line)) {
                        out.push(Citation { why: None, ..cit });
                    }
                }
            }
        }
        out
    }
}

// ---------------------------------------------------------------------------------------------
// The JSON schemas sent as `AiRequest::output_schema`.

fn self_check_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["projectSpecific", "reason"],
        "properties": {
            "projectSpecific": { "type": "boolean", "description": "false if the item would still be true and useful in an unrelated project." },
            "reason": { "type": "string", "maxLength": 200 }
        }
    })
}

fn citations_schema(min: usize) -> Value {
    json!({
        "type": "array",
        "minItems": min,
        "maxItems": 4,
        "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["path", "firstLine", "lastLine"],
            "properties": {
                "path": { "type": "string", "description": "Root-relative with / separators, as listed in the corpus map." },
                "firstLine": { "type": "integer", "minimum": 0 },
                "lastLine": { "type": "integer", "minimum": 0 },
                "why": { "type": "string", "maxLength": 160 }
            }
        },
        "description": "The first source is the 'Read more' link. Text files carry the line range that holds the fact (at most 120 lines, inside the file you read). A binary asset is listed by path with firstLine and lastLine 0, never alone."
    })
}

/// The JSON schema of [`OutlineOutput`].
pub fn outline_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["insufficientMaterial", "title", "intro", "chapters"],
        "properties": {
            "insufficientMaterial": { "type": "boolean", "description": "true when the project has too little material for this subject; then chapters may be few and suggestedSubjects says what to learn instead." },
            "materialNote": { "type": "string", "maxLength": 400 },
            "docsNote": { "type": "string", "maxLength": 400, "description": "Only when the project's documentation is missing, thin or out of date for this subject and this reader: what is not documented and where a page would help." },
            "suggestedSubjects": { "type": "array", "maxItems": 5, "items": { "type": "string", "maxLength": 120 } },
            "title": { "type": "string", "minLength": 4, "maxLength": 100, "description": "Names the project or one of its parts." },
            "intro": { "type": "string", "minLength": 20, "maxLength": 600, "description": "Two or three sentences: what the reader will be able to do after the tutorial, in this project's terms." },
            "chapters": {
                "type": "array",
                "minItems": 1,
                "maxItems": MAX_CHAPTERS,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["id", "title", "goal", "minutes", "keySources", "selfCheck"],
                    "properties": {
                        "id": { "type": "string", "pattern": "^c[0-9]{1,2}$" },
                        "title": { "type": "string", "minLength": 4, "maxLength": 80 },
                        "goal": { "type": "string", "minLength": 20, "maxLength": 300, "description": "What the reader can do or explain afterwards, about this project; names its files or identifiers." },
                        "minutes": { "type": "integer", "minimum": 2, "maximum": 15 },
                        "keySources": { "type": "array", "minItems": 1, "maxItems": 8, "items": { "type": "string" }, "description": "Root-relative paths of the files the chapter is built on, that you opened." },
                        "selfCheck": self_check_schema()
                    }
                }
            }
        }
    })
}

fn step_schema(kind: &str, required: &[&str], properties: Value) -> Value {
    let mut props = properties;
    props["type"] = json!({ "enum": [kind] });
    props["selfCheck"] = self_check_schema();
    let mut required: Vec<&str> = required.to_vec();
    required.insert(0, "type");
    required.push("selfCheck");
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": required,
        "properties": props
    })
}

/// The schema of each step type (a chapter's steps, a review's replacements).
pub fn step_schemas() -> Vec<Value> {
    let title = json!({ "type": "string", "minLength": 4, "maxLength": 80 });
    vec![
        step_schema(
            "explain",
            &["title", "body", "sources"],
            json!({
                "title": title,
                "body": { "type": "string", "minLength": 40, "maxLength": 1500, "description": "Markdown, 2 to 6 sentences: how THIS project does it, naming files and identifiers; the why when the project shows it." },
                "sources": citations_schema(1)
            }),
        ),
        step_schema(
            "conceptBridge",
            &["title", "concept", "applied", "sources"],
            json!({
                "title": title,
                "concept": { "type": "string", "minLength": 20, "maxLength": 400, "description": "The concept in one or two sentences, no more." },
                "applied": { "type": "string", "minLength": 40, "maxLength": 1200, "description": "Markdown: the concept applied to the cited lines of this project, right away." },
                "docsUrl": { "type": "string", "maxLength": 300, "description": "The official documentation of the concept (https)." },
                "sources": citations_schema(1)
            }),
        ),
        step_schema(
            "codeTour",
            &["title", "stops"],
            json!({
                "title": title,
                "stops": {
                    "type": "array", "minItems": 2, "maxItems": 6,
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["path", "firstLine", "lastLine", "annotation"],
                        "properties": {
                            "path": { "type": "string" },
                            "firstLine": { "type": "integer", "minimum": 1 },
                            "lastLine": { "type": "integer", "minimum": 1 },
                            "annotation": { "type": "string", "minLength": 20, "maxLength": 500, "description": "Markdown shown next to the highlighted lines: what they do here and why." }
                        }
                    },
                    "description": "Real files opened in the code viewer, in reading order; at most 40 lines per stop."
                }
            }),
        ),
        step_schema(
            "diagram",
            &["title", "mermaid", "sources"],
            json!({
                "title": title,
                "mermaid": { "type": "string", "minLength": 20, "maxLength": 2500, "description": "Mermaid source (flowchart, sequenceDiagram, classDiagram, stateDiagram-v2) whose nodes are this project's modules, files, types or messages. No markdown fence." },
                "caption": { "type": "string", "maxLength": 300 },
                "sources": citations_schema(1)
            }),
        ),
        step_schema(
            "putInOrder",
            &["title", "prompt", "items", "explanation", "sources"],
            json!({
                "title": title,
                "prompt": { "type": "string", "minLength": 12, "maxLength": 300 },
                "items": { "type": "array", "minItems": 3, "maxItems": 7, "items": { "type": "string", "minLength": 4, "maxLength": 160 }, "description": "The steps of a flow of this project, in the right order (the app shuffles them)." },
                "explanation": { "type": "string", "minLength": 20, "maxLength": 900 },
                "sources": citations_schema(1)
            }),
        ),
        step_schema(
            "match",
            &["title", "prompt", "pairs", "explanation", "sources"],
            json!({
                "title": title,
                "prompt": { "type": "string", "minLength": 12, "maxLength": 300 },
                "pairs": {
                    "type": "array", "minItems": 3, "maxItems": 6,
                    "items": { "type": "object", "additionalProperties": false, "required": ["left", "right"], "properties": {
                        "left": { "type": "string", "minLength": 1, "maxLength": 120 },
                        "right": { "type": "string", "minLength": 1, "maxLength": 160 }
                    } },
                    "description": "Modules of this project and their responsibilities, or its terms and their meanings here."
                },
                "explanation": { "type": "string", "minLength": 20, "maxLength": 900 },
                "sources": citations_schema(1)
            }),
        ),
        step_schema(
            "spotIt",
            &[
                "title",
                "prompt",
                "path",
                "firstLine",
                "lastLine",
                "answerLine",
                "explanation",
            ],
            json!({
                "title": title,
                "prompt": { "type": "string", "minLength": 12, "maxLength": 300, "description": "\"Click the line that …\"" },
                "path": { "type": "string" },
                "firstLine": { "type": "integer", "minimum": 1 },
                "lastLine": { "type": "integer", "minimum": 1, "description": "At most 40 lines after firstLine." },
                "answerLine": { "type": "integer", "minimum": 1, "description": "Absolute line number of the answer, inside the snippet." },
                "explanation": { "type": "string", "minLength": 20, "maxLength": 900 }
            }),
        ),
        step_schema(
            "quickCheck",
            &[
                "kind",
                "question",
                "choices",
                "answer",
                "hint",
                "explanation",
                "sources",
            ],
            json!({
                "kind": { "enum": ["multipleChoice", "trueFalse"] },
                "question": { "type": "string", "minLength": 12, "maxLength": 400 },
                "choices": { "type": "array", "minItems": 2, "maxItems": 5, "items": { "type": "string", "minLength": 1, "maxLength": 200 }, "description": "Exactly [\"True\", \"False\"] for trueFalse; 3 to 5 distinct answers alike in length and tone for multipleChoice." },
                "answer": { "type": "integer", "minimum": 0, "maximum": 4 },
                "hint": { "type": "string", "minLength": 1, "maxLength": 300 },
                "explanation": { "type": "string", "minLength": 20, "maxLength": 900 },
                "sources": citations_schema(1)
            }),
        ),
        step_schema(
            "tryIt",
            &["title", "instruction", "sources"],
            json!({
                "title": title,
                "instruction": { "type": "string", "minLength": 20, "maxLength": 900, "description": "Markdown: what to do in this project and what to look at. The app never runs anything." },
                "command": { "type": "string", "maxLength": 300, "description": "A command to copy, from this project's scripts or tooling, when there is one." },
                "where": { "enum": ["terminal", "ide", "engine", "browser", "device"] },
                "expected": { "type": "string", "maxLength": 400 },
                "sources": citations_schema(1)
            }),
        ),
        step_schema(
            "recap",
            &["takeaways"],
            json!({
                "takeaways": { "type": "array", "minItems": 3, "maxItems": 3, "items": { "type": "string", "minLength": 12, "maxLength": 240 }, "description": "Three key takeaways of the chapter, each naming something of this project." },
                "sources": citations_schema(0)
            }),
        ),
    ]
}

/// The JSON schema of [`ChapterOutput`].
pub fn chapter_schema() -> Value {
    let steps = step_schemas();
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "title", "hootIntro", "steps"],
        "properties": {
            "id": { "type": "string", "pattern": "^c[0-9]{1,2}$", "description": "The chapter's id from the outline." },
            "title": { "type": "string", "minLength": 4, "maxLength": 80 },
            "hootIntro": { "type": "string", "minLength": 10, "maxLength": 240, "description": "Hoot introduces the chapter in one sentence, in this project's terms." },
            "docsNote": { "type": "string", "maxLength": 400, "description": "Only when the project's documentation is missing, thin or out of date for this chapter: what is not documented and where a page would help." },
            "steps": {
                "type": "array",
                "minItems": 3,
                "maxItems": MAX_STEPS,
                "items": { "anyOf": steps },
                "description": "The chapter's steps in order; the last one is the recap."
            }
        }
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::BTreeSet;

    use super::*;

    fn check() -> Option<SelfCheck> {
        Some(SelfCheck {
            project_specific: true,
            reason: "names the watcher".into(),
        })
    }

    fn cite() -> Vec<Citation> {
        vec![Citation {
            path: "src/index/watcher.rs".into(),
            first_line: Some(2),
            last_line: Some(6),
            why: Some("the debounce".into()),
        }]
    }

    /// One step of every type (shared with the markdown and freshness tests).
    pub(crate) fn every_step() -> Vec<Step> {
        vec![
            Step::Explain(ExplainStep {
                title: "The watcher debounces".into(),
                body: "The watcher of Orbit waits `DEBOUNCE_MS` before it re-walks.\n\nThen it classifies.".into(),
                sources: cite(),
                self_check: check(),
            }),
            Step::ConceptBridge(ConceptBridgeStep {
                title: "Debouncing".into(),
                concept: "Debouncing merges a burst of events into one.".into(),
                applied: "Here `WatchContext` keeps the generation so a late batch is dropped.".into(),
                docs_url: Some("https://docs.rs/notify-debouncer-full".into()),
                sources: cite(),
                self_check: check(),
            }),
            Step::CodeTour(CodeTourStep {
                title: "From event to batch".into(),
                stops: vec![
                    TourStop {
                        path: "src/index/watcher.rs".into(),
                        first_line: 2,
                        last_line: 2,
                        annotation: "The debounce constant.".into(),
                    },
                    TourStop {
                        path: "src/index/watcher.rs".into(),
                        first_line: 4,
                        last_line: 6,
                        annotation: "The context carries the generation.".into(),
                    },
                ],
                self_check: check(),
            }),
            Step::Diagram(DiagramStep {
                title: "The flow".into(),
                mermaid: "flowchart LR\n  W[watcher.rs] --> G[graph]".into(),
                caption: Some("Events reach the graph after the index.".into()),
                sources: cite(),
                self_check: check(),
            }),
            Step::PutInOrder(PutInOrderStep {
                title: "A file changes".into(),
                prompt: "Put the watcher's steps in order.".into(),
                items: vec!["debounce".into(), "classify".into(), "re-walk".into()],
                explanation: "watcher.rs debounces, classifies, then re-walks.".into(),
                sources: cite(),
                self_check: check(),
            }),
            Step::Match(MatchStep {
                title: "Who does what".into(),
                prompt: "Match each module to its job.".into(),
                pairs: vec![
                    MatchPair {
                        left: "watcher.rs".into(),
                        right: "debounces events".into(),
                    },
                    MatchPair {
                        left: "model.rs".into(),
                        right: "keeps the index".into(),
                    },
                    MatchPair {
                        left: "scanner.rs".into(),
                        right: "walks the folder".into(),
                    },
                ],
                explanation: "Each file of src/index has one job.".into(),
                sources: cite(),
                self_check: check(),
            }),
            Step::SpotIt(SpotItStep {
                title: "Find the debounce".into(),
                prompt: "Click the line that sets the debounce.".into(),
                path: "src/index/watcher.rs".into(),
                first_line: 1,
                last_line: 6,
                answer_line: 2,
                explanation: "DEBOUNCE_MS on line 2 of watcher.rs.".into(),
                self_check: check(),
            }),
            Step::QuickCheck(QuickCheckStep {
                kind: QuestionKind::MultipleChoice,
                question: "Which constant sets Orbit's debounce?".into(),
                choices: vec!["DEBOUNCE_MS".into(), "POLL_MS".into(), "DELAY".into()],
                answer: 0,
                hint: "Top of the watcher.".into(),
                explanation: "DEBOUNCE_MS in src/index/watcher.rs is 200.".into(),
                sources: cite(),
                self_check: check(),
            }),
            Step::TryIt(TryItStep {
                title: "Watch it happen".into(),
                instruction: "Open the folder in Orbit, then touch a file and watch the toast.".into(),
                command: Some("touch README.md".into()),
                where_: Some("terminal".into()),
                expected: Some("One toast, after 200 ms.".into()),
                sources: cite(),
                self_check: check(),
            }),
            Step::Recap(RecapStep {
                takeaways: vec![
                    "watcher.rs debounces for 200 ms.".into(),
                    "WatchContext carries the generation.".into(),
                    "Late batches are dropped.".into(),
                ],
                sources: Vec::new(),
                self_check: check(),
            }),
        ]
    }

    fn keys(v: &Value) -> BTreeSet<String> {
        v.as_object().unwrap().keys().cloned().collect()
    }

    fn strings(v: &Value) -> BTreeSet<String> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn every_step_round_trips_through_json_with_its_type_tag() {
        for step in every_step() {
            let v = serde_json::to_value(&step).unwrap();
            assert_eq!(v["type"], json!(step.type_name()));
            let back: Step = serde_json::from_value(v.clone()).unwrap();
            assert_eq!(back, step);
            let mut extra = v.clone();
            extra["extra"] = json!(1);
            assert!(
                serde_json::from_value::<Step>(extra).is_err(),
                "{}: unknown fields are refused",
                step.type_name()
            );
        }
        assert!(serde_json::from_value::<Step>(json!({ "type": "poem", "title": "x" })).is_err());
    }

    /// Every property of each step's schema is a field of its struct and the reverse (the
    /// optional ones may be absent from the sample).
    #[test]
    fn the_chapter_schema_matches_the_structs() {
        let schema = chapter_schema();
        let variants = schema["properties"]["steps"]["items"]["anyOf"]
            .as_array()
            .unwrap();
        let steps = every_step();
        assert_eq!(variants.len(), steps.len());
        for (variant, step) in variants.iter().zip(&steps) {
            let sample = serde_json::to_value(step).unwrap();
            assert_eq!(
                variant["properties"]["type"]["enum"][0],
                json!(step.type_name())
            );
            let props = keys(&variant["properties"]);
            let fields = keys(&sample);
            assert!(
                fields.is_subset(&props),
                "{}: {:?} not in schema",
                step.type_name(),
                fields.difference(&props).collect::<Vec<_>>()
            );
            let required = strings(&variant["required"]);
            assert!(
                required.is_subset(&fields),
                "{}: required {:?} missing from the sample",
                step.type_name(),
                required.difference(&fields).collect::<Vec<_>>()
            );
            assert!(required.contains("selfCheck") && required.contains("type"));
        }
        let chapter = ChapterOutput {
            id: "c1".into(),
            title: "The watcher".into(),
            hoot_intro: "Let us follow a file change.".into(),
            steps,
            docs_note: None,
        };
        let v = serde_json::to_value(&chapter).unwrap();
        assert_eq!(keys(&schema["properties"]), keys(&v));
        assert!(schema.get("$schema").is_none());
    }

    #[test]
    fn the_outline_schema_matches_the_structs() {
        let s = outline_schema();
        let sample = OutlineOutput {
            insufficient_material: false,
            material_note: Some("n".into()),
            docs_note: Some("d".into()),
            suggested_subjects: vec!["s".into()],
            title: "Orbit's index".into(),
            intro: "You will follow a file change.".into(),
            chapters: vec![RawOutlineChapter {
                id: "c1".into(),
                title: "The watcher".into(),
                goal: "Explain the debounce.".into(),
                minutes: 5,
                key_sources: vec!["src/index/watcher.rs".into()],
                self_check: SelfCheck {
                    project_specific: true,
                    reason: "r".into(),
                },
            }],
        };
        let v = serde_json::to_value(&sample).unwrap();
        assert_eq!(keys(&s["properties"]), keys(&v));
        let c = &s["properties"]["chapters"]["items"];
        assert_eq!(keys(&c["properties"]), keys(&v["chapters"][0]));
        assert_eq!(strings(&c["required"]), keys(&v["chapters"][0]));
    }

    #[test]
    fn citations_lines_and_relocation() {
        assert_eq!(Citation::new("a", 3, 9).lines().as_deref(), Some("3-9"));
        assert_eq!(Citation::new("a", 3, 3).lines().as_deref(), Some("3"));
        let mut spot = every_step().remove(6);
        spot.relocate("src/index/watcher.rs", (1, 6), (11, 16));
        let Step::SpotIt(s) = &spot else { panic!() };
        assert_eq!((s.first_line, s.last_line, s.answer_line), (11, 16, 12));
        let mut tour = every_step().remove(2);
        tour.relocate("src/index/watcher.rs", (4, 6), (40, 42));
        let Step::CodeTour(t) = &tour else { panic!() };
        assert_eq!((t.stops[1].first_line, t.stops[1].last_line), (40, 42));
        assert_eq!((t.stops[0].first_line, t.stops[0].last_line), (2, 2));
    }
}
