//! The tutorial validator: the grounding rules enforced on an outline and on a chapter. Pure,
//! given the answer, the corpus and a reader of cited files. A chapter of the outline is accepted
//! when its key sources are citable files of the project, its self-check says it is specific and
//! its goal names something of this project. A step is accepted when every citation is a citable
//! file with lines that exist (at most 120, or 40 for a tour stop and a spot-it snippet), its
//! self-check says it is specific, its text names something of this project (the quiz's
//! generic-content check) and its own type's rules hold (distinct items, a clickable answer line
//! inside the snippet, a Mermaid diagram, a quiz question that the quiz validator accepts, …).

use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::{Value, json};

use super::schema::{
    Chapter, ChapterOutput, Citation, MAX_CHAPTERS, MAX_RANGE_LINES, MAX_STEPS, OutlineOutput, Step,
};
use super::{Length, TutorialInput};
use crate::learning::corpus::{Corpus, PathStatus};
use crate::learning::quiz::validate::{Context as QuizContext, LineReader, names_project, words};

/// Lines of a code tour stop or a spot-it snippet at most.
pub const MAX_SNIPPET_LINES: u32 = 40;
/// Lines of a key source read for the outline's generic check, at most.
pub const KEY_SOURCE_LINES: usize = 3000;

/// Why a chapter of the outline or a step was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Rejection {
    NoSource,
    UnknownPath,
    AgentFile,
    SecretFile,
    MissingRange,
    BadRange,
    RangeTooLong,
    BeyondEnd,
    BinaryRange,
    BinaryOnly,
    SelfCheck,
    Generic,
    /// A quick check the quiz validator rejected (its own reason in the message).
    QuickCheck,
    /// Items, pairs or takeaways that are too few, too many or not distinct.
    Items,
    /// A spot-it answer line outside its snippet.
    AnswerLine,
    DocsUrl,
    Mermaid,
    Duplicate,
    /// The chapter has no recap.
    Recap,
}

impl Rejection {
    pub fn code(self) -> &'static str {
        match self {
            Self::NoSource => "noSource",
            Self::UnknownPath => "unknownPath",
            Self::AgentFile => "agentFile",
            Self::SecretFile => "secretFile",
            Self::MissingRange => "missingRange",
            Self::BadRange => "badRange",
            Self::RangeTooLong => "rangeTooLong",
            Self::BeyondEnd => "beyondEnd",
            Self::BinaryRange => "binaryRange",
            Self::BinaryOnly => "binaryOnly",
            Self::SelfCheck => "selfCheck",
            Self::Generic => "generic",
            Self::QuickCheck => "quickCheck",
            Self::Items => "items",
            Self::AnswerLine => "answerLine",
            Self::DocsUrl => "docsUrl",
            Self::Mermaid => "mermaid",
            Self::Duplicate => "duplicate",
            Self::Recap => "recap",
        }
    }

    /// For the progress screen.
    pub fn plain(self) -> &'static str {
        match self {
            Self::NoSource => "cited nothing",
            Self::UnknownPath => "cited a file that does not exist",
            Self::AgentFile => "cited an agent file",
            Self::SecretFile => "cited a secret file",
            Self::MissingRange
            | Self::BadRange
            | Self::RangeTooLong
            | Self::BeyondEnd
            | Self::BinaryRange => "cited lines that do not check out",
            Self::BinaryOnly => "cited only binary files",
            Self::SelfCheck | Self::Generic => "was generic",
            Self::QuickCheck => "had an unusable quiz question",
            Self::Items => "had unusable items",
            Self::AnswerLine => "pointed outside its snippet",
            Self::DocsUrl => "linked a bad documentation URL",
            Self::Mermaid => "had an unusable diagram",
            Self::Duplicate => "was a repeat",
            Self::Recap => "lacked a recap",
        }
    }
}

/// What the validator knows besides the answer.
pub struct Context<'a> {
    pub corpus: &'a Corpus,
    pub agent_names: &'a [String],
    pub read: &'a mut LineReader<'a>,
    pub project_name: &'a str,
    pub modules: &'a [String],
    pub input: &'a TutorialInput,
}

type Verdict<T> = Result<T, (Rejection, String)>;

/// Checks one citation: a citable path, lines that exist (at most `max_lines` for text files);
/// returns the normalized citation and the words of the cited lines (none for a binary asset).
pub fn check_citation(
    c: &Citation,
    max_lines: u32,
    ctx: &mut Context<'_>,
) -> Verdict<(Citation, BTreeSet<String>, bool)> {
    let path = c.path.trim().trim_start_matches("./").replace('\\', "/");
    let file = match ctx.corpus.status(&path, ctx.agent_names) {
        PathStatus::Citable(f) => f.clone(),
        PathStatus::Agent => {
            return Err((
                Rejection::AgentFile,
                format!("cites {path}, an agent instruction file (context only, never a source)"),
            ));
        }
        PathStatus::Secret => {
            return Err((
                Rejection::SecretFile,
                format!("cites {path}, a file that may hold secrets"),
            ));
        }
        PathStatus::OutOfScope | PathStatus::Unknown => {
            return Err((
                Rejection::UnknownPath,
                format!(
                    "cites {path}, which is not a file of this project (use the paths of the corpus map)"
                ),
            ));
        }
    };
    let zero = |l: Option<u32>| l.filter(|n| *n > 0);
    let (first, last) = match (zero(c.first_line), zero(c.last_line)) {
        (Some(a), Some(b)) => (Some(a), Some(b)),
        (Some(a), None) | (None, Some(a)) => (Some(a), Some(a)),
        (None, None) => (None, None),
    };
    if file.binary {
        if first.is_some() {
            return Err((
                Rejection::BinaryRange,
                format!("cites lines of {path}, a binary file that cannot be read"),
            ));
        }
        return Ok((
            Citation {
                path,
                first_line: None,
                last_line: None,
                why: c.why.clone(),
            },
            BTreeSet::new(),
            true,
        ));
    }
    let (Some(a), Some(b)) = (first, last) else {
        return Err((
            Rejection::MissingRange,
            format!("cites {path} without the line range that holds the fact"),
        ));
    };
    if a > b {
        return Err((
            Rejection::BadRange,
            format!("cites lines {a}-{b} of {path}, which is not a range"),
        ));
    }
    if b - a + 1 > max_lines {
        return Err((
            Rejection::RangeTooLong,
            format!(
                "cites {} lines of {path}; cite at most {max_lines}, the ones that hold the fact",
                b - a + 1
            ),
        ));
    }
    let Some(lines) = (ctx.read)(&path) else {
        return Err((
            Rejection::UnknownPath,
            format!("cites {path}, which cannot be read"),
        ));
    };
    let count = u32::try_from(lines.len()).unwrap_or(u32::MAX);
    if b > count {
        return Err((
            Rejection::BeyondEnd,
            format!("{path} has {count} lines; lines {a}-{b} do not exist"),
        ));
    }
    let mut cited = BTreeSet::new();
    for line in &lines[(a - 1) as usize..b as usize] {
        cited.extend(words(line));
    }
    Ok((
        Citation {
            path,
            first_line: Some(a),
            last_line: Some(b),
            why: c.why.clone(),
        },
        cited,
        false,
    ))
}

// ---------------------------------------------------------------------------------------------
// The outline.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedOutline {
    pub title: String,
    pub intro: String,
    pub insufficient_material: bool,
    pub material_note: Option<String>,
    pub docs_note: Option<String>,
    pub suggested_subjects: Vec<String>,
    /// In the answer's order, with positional ids.
    pub accepted: Vec<Chapter>,
    /// `(id, rejection, message for the model)`.
    pub rejected: Vec<(String, Rejection, String)>,
    /// Chapters beyond the length's maximum, dropped (not rejected).
    pub dropped: usize,
}

/// Validates an outline. `Err` is a shape error: the whole answer is rejected, with the reason.
pub fn validate_outline(output: &Value, ctx: &mut Context<'_>) -> Result<ValidatedOutline, String> {
    if output.is_null() {
        return Err("no JSON answer was given".to_owned());
    }
    let parsed: OutlineOutput =
        serde_json::from_value(output.clone()).map_err(|e| e.to_string())?;
    let (_, max) = ctx.input.length.chapters();
    let mut v = ValidatedOutline {
        title: parsed.title.trim().to_owned(),
        intro: parsed.intro.trim().to_owned(),
        insufficient_material: parsed.insufficient_material,
        material_note: parsed.material_note.filter(|n| !n.trim().is_empty()),
        docs_note: parsed.docs_note.filter(|n| !n.trim().is_empty()),
        suggested_subjects: parsed.suggested_subjects,
        accepted: Vec::new(),
        rejected: Vec::new(),
        dropped: 0,
    };
    let mut titles = BTreeSet::new();
    for raw in &parsed.chapters {
        let verdict = (|| -> Verdict<Chapter> {
            if raw.key_sources.is_empty() {
                return Err((Rejection::NoSource, "names no key source".to_owned()));
            }
            let mut citable = 0;
            // The identifiers of the key sources count as the project's words: a goal that
            // names `URogueActionComponent` is specific even without its file name.
            let mut cited: BTreeSet<String> = BTreeSet::new();
            for s in &raw.key_sources {
                let path = s.trim().trim_start_matches("./").replace('\\', "/");
                match ctx.corpus.status(&path, ctx.agent_names) {
                    PathStatus::Citable(f) => {
                        citable += 1;
                        if !f.binary
                            && !f.large
                            && let Some(lines) = (ctx.read)(&path)
                        {
                            for line in lines.iter().take(KEY_SOURCE_LINES) {
                                cited.extend(words(line));
                            }
                        }
                    }
                    PathStatus::Agent => {
                        return Err((
                            Rejection::AgentFile,
                            format!(
                                "is built on {path}, an agent instruction file (context only, never a source)"
                            ),
                        ));
                    }
                    PathStatus::Secret => {
                        return Err((
                            Rejection::SecretFile,
                            format!("is built on {path}, a file that may hold secrets"),
                        ));
                    }
                    PathStatus::OutOfScope | PathStatus::Unknown => {}
                }
            }
            if citable == 0 {
                return Err((
                    Rejection::UnknownPath,
                    format!(
                        "names no key source that is a file of this project ({})",
                        raw.key_sources.join(", ")
                    ),
                ));
            }
            if !raw.self_check.project_specific {
                return Err((
                    Rejection::SelfCheck,
                    "your own self-check says it is not specific to this project".to_owned(),
                ));
            }
            let text = format!("{} {}", raw.title, raw.goal);
            if !names_project(&text, &cited, ctx.corpus, ctx.project_name, ctx.modules) {
                return Err((
                    Rejection::Generic,
                    "generic: the title and the goal name nothing of this project (a file, a module, an identifier)".to_owned(),
                ));
            }
            let key = raw.title.trim().to_lowercase();
            if !titles.insert(key) {
                return Err((
                    Rejection::Duplicate,
                    "repeats another chapter's title".to_owned(),
                ));
            }
            Ok(Chapter {
                id: String::new(),
                title: raw.title.trim().to_owned(),
                goal: raw.goal.trim().to_owned(),
                minutes: raw.minutes.clamp(2, 15),
                hoot_intro: None,
                steps: Vec::new(),
            })
        })();
        match verdict {
            Ok(c) if v.accepted.len() < max.min(MAX_CHAPTERS) => v.accepted.push(c),
            Ok(_) => v.dropped += 1,
            Err((r, m)) => v.rejected.push((raw.id.clone(), r, m)),
        }
    }
    for (i, c) in v.accepted.iter_mut().enumerate() {
        c.id = format!("c{}", i + 1);
    }
    Ok(v)
}

// ---------------------------------------------------------------------------------------------
// A chapter.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedChapter {
    pub title: String,
    pub hoot_intro: String,
    pub docs_note: Option<String>,
    /// In the answer's order, the recap last, self-checks stripped, citations normalized.
    pub accepted: Vec<Step>,
    /// `("step n", rejection, message for the model)`.
    pub rejected: Vec<(String, Rejection, String)>,
    pub dropped: usize,
}

impl ValidatedChapter {
    /// "2 rejected: 1 cited lines that do not check out, 1 was generic".
    pub fn summary(&self) -> String {
        let mut parts: Vec<(String, usize)> = Vec::new();
        for (_, r, _) in &self.rejected {
            match parts.iter_mut().find(|(p, _)| p == r.plain()) {
                Some((_, n)) => *n += 1,
                None => parts.push((r.plain().to_owned(), 1)),
            }
        }
        let list: Vec<String> = parts.iter().map(|(p, n)| format!("{n} {p}")).collect();
        format!("{} rejected: {}", self.rejected.len(), list.join(", "))
    }
}

/// The text of a step that must name the project (a concept bridge's concept is left out on
/// purpose: it is the generic part).
fn specific_text(step: &Step) -> String {
    match step {
        Step::Explain(s) => format!("{} {}", s.title, s.body),
        Step::ConceptBridge(s) => format!("{} {}", s.title, s.applied),
        Step::CodeTour(s) => {
            let notes: Vec<&str> = s.stops.iter().map(|t| t.annotation.as_str()).collect();
            format!("{} {}", s.title, notes.join(" "))
        }
        Step::Diagram(s) => format!(
            "{} {} {}",
            s.title,
            s.mermaid,
            s.caption.as_deref().unwrap_or("")
        ),
        Step::PutInOrder(s) => format!("{} {} {}", s.prompt, s.items.join(" "), s.explanation),
        Step::Match(s) => {
            let pairs: Vec<String> = s
                .pairs
                .iter()
                .map(|p| format!("{} {}", p.left, p.right))
                .collect();
            format!("{} {} {}", s.prompt, pairs.join(" "), s.explanation)
        }
        Step::SpotIt(s) => format!("{} {} {}", s.title, s.prompt, s.explanation),
        Step::QuickCheck(s) => format!("{} {} {}", s.question, s.explanation, s.choices.join(" ")),
        Step::TryIt(s) => format!(
            "{} {} {}",
            s.title,
            s.instruction,
            s.command.as_deref().unwrap_or("")
        ),
        Step::Recap(s) => s.takeaways.join(" "),
    }
}

fn distinct(items: &[String]) -> bool {
    let mut seen = BTreeSet::new();
    items.iter().all(|i| {
        let n: String = i
            .chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect();
        !n.is_empty() && seen.insert(n)
    })
}

/// A Mermaid source without a fence, starting with a diagram keyword.
fn mermaid_source(text: &str) -> Option<String> {
    let mut t = text.trim();
    if t.starts_with("```") {
        t = t.trim_start_matches('`');
        t = t.strip_prefix("mermaid").unwrap_or(t).trim();
        t = t.trim_end_matches('`').trim_end();
    }
    let first = t.lines().next()?.trim();
    let ok = [
        "flowchart",
        "graph",
        "sequenceDiagram",
        "classDiagram",
        "stateDiagram",
        "erDiagram",
    ]
    .iter()
    .any(|k| first.starts_with(k));
    ok.then(|| t.to_owned())
}

/// Checks a quick check with the quiz validator (its choices, hint and generic rules).
fn check_quick(step: &super::schema::QuickCheckStep, ctx: &mut Context<'_>) -> Verdict<()> {
    let sources: Vec<Value> = step
        .sources
        .iter()
        .map(|c| {
            json!({
                "path": c.path,
                "firstLine": c.first_line.filter(|n| *n > 0),
                "lastLine": c.last_line.filter(|n| *n > 0),
                "why": c.why,
            })
        })
        .collect();
    let quiz = json!({
        "insufficientMaterial": false,
        "questions": [{
            "id": "q1",
            "kind": step.kind,
            "question": step.question,
            "choices": step.choices,
            "answer": step.answer,
            "hint": step.hint,
            "explanation": step.explanation,
            "sources": sources,
            "difficulty": 2,
            "selfCheck": step.self_check.clone().map_or_else(
                || json!({ "projectSpecific": false, "reason": "" }),
                |c| json!({ "projectSpecific": c.project_specific, "reason": c.reason })
            ),
        }]
    });
    let mut qctx = QuizContext {
        corpus: ctx.corpus,
        agent_names: ctx.agent_names,
        read: &mut *ctx.read,
        project_name: ctx.project_name,
        modules: ctx.modules,
        exclude: &[],
        count: 1,
    };
    let v = crate::learning::quiz::validate::validate(&quiz, &mut qctx)
        .map_err(|e| (Rejection::QuickCheck, format!("quick check: {e}")))?;
    match v.rejected.first() {
        Some((_, _, message)) => Err((Rejection::QuickCheck, format!("quick check: {message}"))),
        None if v.accepted.is_empty() => Err((
            Rejection::QuickCheck,
            "quick check: not accepted".to_owned(),
        )),
        None => Ok(()),
    }
}

/// Checks one step; returns it normalized (citations cleaned, self-check stripped).
fn check_step(step: &Step, ctx: &mut Context<'_>) -> Verdict<Step> {
    let mut out = step.clone();
    let specific = step.self_check().is_some_and(|c| c.project_specific);
    // Citations, with the words of the cited lines for the generic check.
    let mut cited: BTreeSet<String> = BTreeSet::new();
    let max_lines = match step {
        Step::CodeTour(_) | Step::SpotIt(_) => MAX_SNIPPET_LINES,
        _ => MAX_RANGE_LINES,
    };
    let citations = step.citations();
    if citations.is_empty() && !matches!(step, Step::Recap(_)) {
        return Err((Rejection::NoSource, "cites no source".to_owned()));
    }
    let mut text_sources = 0;
    let mut checked: Vec<Citation> = Vec::new();
    for c in &citations {
        let (n, w, binary) = check_citation(c, max_lines, ctx)?;
        if !binary {
            text_sources += 1;
        }
        cited.extend(w);
        checked.push(n);
    }
    if !citations.is_empty() && text_sources == 0 {
        return Err((
            Rejection::BinaryOnly,
            "cites only binary files, whose content cannot be read; cite the text that uses them"
                .to_owned(),
        ));
    }
    // Type rules, and the normalized citations written back.
    match &mut out {
        Step::Explain(s) => s.sources = checked,
        Step::ConceptBridge(s) => {
            if let Some(u) = s.docs_url.as_deref()
                && !(u.starts_with("https://") || u.starts_with("http://"))
            {
                return Err((
                    Rejection::DocsUrl,
                    format!("docsUrl \"{u}\" is not an http(s) link to the official documentation"),
                ));
            }
            s.sources = checked;
        }
        Step::CodeTour(s) => {
            if !(2..=6).contains(&s.stops.len()) {
                return Err((
                    Rejection::Items,
                    format!("has {} stops; a code tour has 2 to 6", s.stops.len()),
                ));
            }
            for (t, c) in s.stops.iter_mut().zip(&checked) {
                t.path = c.path.clone();
            }
        }
        Step::Diagram(s) => {
            let Some(src) = mermaid_source(&s.mermaid) else {
                return Err((
                    Rejection::Mermaid,
                    "its mermaid is not a diagram (start with flowchart, sequenceDiagram, classDiagram or stateDiagram-v2, no fence)".to_owned(),
                ));
            };
            s.mermaid = src;
            s.sources = checked;
        }
        Step::PutInOrder(s) => {
            if !(3..=7).contains(&s.items.len()) || !distinct(&s.items) {
                return Err((
                    Rejection::Items,
                    format!(
                        "has {} items; put-in-order needs 3 to 7 distinct steps",
                        s.items.len()
                    ),
                ));
            }
            s.sources = checked;
        }
        Step::Match(s) => {
            let lefts: Vec<String> = s.pairs.iter().map(|p| p.left.clone()).collect();
            let rights: Vec<String> = s.pairs.iter().map(|p| p.right.clone()).collect();
            if !(3..=6).contains(&s.pairs.len()) || !distinct(&lefts) || !distinct(&rights) {
                return Err((
                    Rejection::Items,
                    format!(
                        "has {} pairs; match needs 3 to 6 pairs with distinct sides",
                        s.pairs.len()
                    ),
                ));
            }
            s.sources = checked;
        }
        Step::SpotIt(s) => {
            let c = &checked[0];
            s.path = c.path.clone();
            if !(s.first_line..=s.last_line).contains(&s.answer_line) {
                return Err((
                    Rejection::AnswerLine,
                    format!(
                        "its answerLine {} is outside the snippet {}-{} of {}",
                        s.answer_line, s.first_line, s.last_line, s.path
                    ),
                ));
            }
        }
        Step::QuickCheck(s) => {
            check_quick(s, ctx)?;
            s.sources = checked;
        }
        Step::TryIt(s) => s.sources = checked,
        Step::Recap(s) => {
            if s.takeaways.len() != 3 || !distinct(&s.takeaways) {
                return Err((
                    Rejection::Items,
                    format!(
                        "has {} takeaways; a recap has exactly 3 distinct ones",
                        s.takeaways.len()
                    ),
                ));
            }
            s.sources = checked;
        }
    }
    if !specific {
        return Err((
            Rejection::SelfCheck,
            "your own self-check says it is not specific to this project (or is missing)"
                .to_owned(),
        ));
    }
    if !names_project(
        &specific_text(step),
        &cited,
        ctx.corpus,
        ctx.project_name,
        ctx.modules,
    ) {
        return Err((
            Rejection::Generic,
            "generic: its text names nothing of this project (a file, an identifier of the cited lines, a module)".to_owned(),
        ));
    }
    out.strip_self_check();
    Ok(out)
}

/// Validates a chapter. `Err` is a shape error: the whole answer is rejected, with the reason.
pub fn validate_chapter(output: &Value, ctx: &mut Context<'_>) -> Result<ValidatedChapter, String> {
    if output.is_null() {
        return Err("no JSON answer was given".to_owned());
    }
    let parsed: ChapterOutput =
        serde_json::from_value(output.clone()).map_err(|e| e.to_string())?;
    let (_, max) = ctx.input.length.steps();
    let max = max.min(MAX_STEPS);
    let mut v = ValidatedChapter {
        title: parsed.title.trim().to_owned(),
        hoot_intro: parsed.hoot_intro.trim().to_owned(),
        docs_note: parsed.docs_note.filter(|n| !n.trim().is_empty()),
        accepted: Vec::new(),
        rejected: Vec::new(),
        dropped: 0,
    };
    let mut titles = BTreeSet::new();
    let mut recap: Option<Step> = None;
    for (i, step) in parsed.steps.iter().enumerate() {
        let label = format!("step {} ({}: {})", i + 1, step.type_name(), step.title());
        let verdict = (|| -> Verdict<Step> {
            let key = step.title().trim().to_lowercase();
            if !matches!(step, Step::Recap(_)) && !titles.insert(key) {
                return Err((
                    Rejection::Duplicate,
                    "repeats another step's title".to_owned(),
                ));
            }
            check_step(step, ctx)
        })();
        match verdict {
            Ok(s @ Step::Recap(_)) => {
                if recap.is_none() {
                    recap = Some(s);
                } else {
                    v.dropped += 1;
                }
            }
            Ok(s) if v.accepted.len() + 1 < max => v.accepted.push(s),
            Ok(_) => v.dropped += 1,
            Err((r, m)) => v.rejected.push((label, r, m)),
        }
    }
    match recap {
        Some(r) => v.accepted.push(r),
        None => v.rejected.push((
            "recap".to_owned(),
            Rejection::Recap,
            "the chapter has no recap step (exactly three takeaways, last)".to_owned(),
        )),
    }
    Ok(v)
}

/// Verified steps that are enough to keep a chapter when the retries are exhausted.
pub fn enough(length: Length) -> usize {
    length.steps().0.div_ceil(2)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;

    use super::super::schema::tests::every_step;
    use super::*;
    use crate::learning::corpus::{SourceScope, read_text};
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
            ("logo.png", "\u{0}\u{1}binary"),
        ])
    }

    /// Runs `f` with a validator context on the project.
    fn with_ctx<T>(root: &std::path::Path, f: impl FnOnce(&mut Context<'_>) -> T) -> T {
        let (profile, walk) = build(root, &[], &AtomicBool::new(false));
        let agent = vec!["CLAUDE.md".to_owned()];
        let corpus = Corpus::build(root, &walk, &SourceScope::WholeProject, &agent);
        let mut cache: HashMap<String, Arc<Vec<String>>> = HashMap::new();
        let mut read = |path: &str| {
            if let Some(l) = cache.get(path) {
                return Some(l.clone());
            }
            let text = read_text(root, path)?;
            let lines = Arc::new(text.lines().map(str::to_owned).collect::<Vec<_>>());
            cache.insert(path.to_owned(), lines.clone());
            Some(lines)
        };
        let modules: Vec<String> = profile.modules.iter().map(|m| m.path.clone()).collect();
        let input = TutorialInput::default();
        let mut ctx = Context {
            corpus: &corpus,
            agent_names: &agent,
            read: &mut read,
            project_name: &profile.name,
            modules: &modules,
            input: &input,
        };
        f(&mut ctx)
    }

    fn chapter_json(steps: &[Step]) -> Value {
        json!({ "id": "c1", "title": "The watcher", "hootIntro": "Follow a change.", "steps": steps })
    }

    #[test]
    fn every_sample_step_is_accepted_and_normalized() {
        let dir = project();
        with_ctx(dir.path(), |ctx| {
            let v = validate_chapter(&chapter_json(&every_step()), ctx).unwrap();
            assert_eq!(v.rejected, vec![], "{}", v.summary());
            assert_eq!(
                v.accepted.len(),
                8,
                "the standard length keeps 8 steps, the recap last"
            );
            assert!(matches!(v.accepted.last(), Some(Step::Recap(_))));
            assert_eq!(v.dropped, 2);
            assert!(v.accepted.iter().all(|s| s.self_check().is_none()));
        });
    }

    #[test]
    fn citations_are_checked_like_the_quiz() {
        let dir = project();
        with_ctx(dir.path(), |ctx| {
            let err = |c: Citation, max: u32, ctx: &mut Context<'_>| {
                check_citation(&c, max, ctx).unwrap_err().0
            };
            assert_eq!(
                err(Citation::new("CLAUDE.md", 1, 1), 120, ctx),
                Rejection::AgentFile
            );
            assert_eq!(
                err(Citation::new(".env", 1, 1), 120, ctx),
                Rejection::SecretFile
            );
            assert_eq!(
                err(Citation::new("nope.rs", 1, 1), 120, ctx),
                Rejection::UnknownPath
            );
            assert_eq!(
                err(Citation::new("src/index/watcher.rs", 2, 40), 120, ctx),
                Rejection::BeyondEnd
            );
            assert_eq!(
                err(Citation::new("src/index/watcher.rs", 1, 6), 4, ctx),
                Rejection::RangeTooLong
            );
            assert_eq!(
                err(Citation::new("src/index/watcher.rs", 4, 2), 120, ctx),
                Rejection::BadRange
            );
            assert_eq!(
                err(Citation::new("logo.png", 1, 1), 120, ctx),
                Rejection::BinaryRange
            );
            let whole = Citation {
                path: "src/index/watcher.rs".into(),
                first_line: None,
                last_line: None,
                why: None,
            };
            assert_eq!(err(whole, 120, ctx), Rejection::MissingRange);
            // A binary asset by name (0 lines), and a backslash path, are normalized.
            let (c, w, binary) =
                check_citation(&Citation::new("logo.png", 0, 0), 120, ctx).unwrap();
            assert!(binary && c.first_line.is_none() && w.is_empty());
            let (c, w, _) =
                check_citation(&Citation::new("src\\index\\watcher.rs", 2, 2), 120, ctx).unwrap();
            assert_eq!(c.path, "src/index/watcher.rs");
            assert!(w.contains("debounce_ms"));
        });
    }

    #[test]
    fn steps_are_rejected_for_their_own_reasons() {
        let dir = project();
        with_ctx(dir.path(), |ctx| {
            let mut steps = every_step();
            // Generic explain (names nothing of the project).
            if let Step::Explain(s) = &mut steps[0] {
                s.title = "Events".into();
                s.body = "A burst of events becomes one batch after a short wait.".into();
            }
            // Spot-it answer outside the snippet.
            if let Step::SpotIt(s) = &mut steps[6] {
                s.answer_line = 9;
            }
            // Put-in-order with a duplicate.
            if let Step::PutInOrder(s) = &mut steps[4] {
                s.items = vec!["debounce".into(), "Debounce".into(), "walk".into()];
            }
            // Only a binary source.
            if let Step::TryIt(s) = &mut steps[8] {
                s.sources = vec![Citation::new("logo.png", 0, 0)];
            }
            // Self-check false.
            if let Step::Match(s) = &mut steps[5] {
                s.self_check.as_mut().unwrap().project_specific = false;
            }
            // Quick check with a hint that gives the answer away.
            if let Step::QuickCheck(s) = &mut steps[7] {
                s.hint = "It is DEBOUNCE_MS.".into();
            }
            // A fenced diagram is tolerated; a non-diagram is not.
            if let Step::Diagram(s) = &mut steps[3] {
                s.mermaid = "```mermaid\nflowchart LR\n  W[watcher.rs] --> G[graph]\n```".into();
            }
            // Two recaps: the second is dropped.
            steps.push(steps[9].clone());
            let v = validate_chapter(&chapter_json(&steps), ctx).unwrap();
            let codes: Vec<(String, Rejection)> = v
                .rejected
                .iter()
                .map(|(id, r, _)| (id.clone(), *r))
                .collect();
            assert_eq!(
                codes,
                vec![
                    ("step 1 (explain: Events)".to_owned(), Rejection::Generic),
                    (
                        "step 5 (putInOrder: A file changes)".to_owned(),
                        Rejection::Items
                    ),
                    (
                        "step 6 (match: Who does what)".to_owned(),
                        Rejection::SelfCheck
                    ),
                    (
                        "step 7 (spotIt: Find the debounce)".to_owned(),
                        Rejection::AnswerLine
                    ),
                    (
                        "step 8 (quickCheck: Which constant sets Orbit's debounce?)".to_owned(),
                        Rejection::QuickCheck
                    ),
                    (
                        "step 9 (tryIt: Watch it happen)".to_owned(),
                        Rejection::BinaryOnly
                    ),
                ]
            );
            assert!(v.rejected[4].2.contains("hint"));
            let Some(Step::Diagram(d)) = v.accepted.iter().find(|s| matches!(s, Step::Diagram(_)))
            else {
                panic!("diagram kept")
            };
            assert_eq!(d.mermaid, "flowchart LR\n  W[watcher.rs] --> G[graph]");
            assert_eq!(v.dropped, 1);
            assert_eq!(
                v.summary(),
                "6 rejected: 2 was generic, 1 had unusable items, 1 pointed outside its snippet, 1 had an unusable quiz question, 1 cited only binary files"
            );
            // No recap at all.
            let v = validate_chapter(&chapter_json(&every_step()[..3]), ctx).unwrap();
            assert_eq!(v.rejected.last().unwrap().1, Rejection::Recap);
            // Not chapter JSON.
            assert!(validate_chapter(&json!({ "steps": 1 }), ctx).is_err());
            assert!(validate_chapter(&Value::Null, ctx).is_err());
        });
    }

    #[test]
    fn the_outline_is_checked_chapter_by_chapter() {
        let dir = project();
        with_ctx(dir.path(), |ctx| {
            let chapter = |id: &str,
                           title: &str,
                           goal: &str,
                           sources: Vec<&str>,
                           specific: bool| {
                json!({ "id": id, "title": title, "goal": goal, "minutes": 5, "keySources": sources,
                    "selfCheck": { "projectSpecific": specific, "reason": "r" } })
            };
            let outline = json!({
                "insufficientMaterial": false,
                "title": "Orbit's index",
                "intro": "You will follow a file change through Orbit.",
                "chapters": [
                    chapter("c1", "The watcher", "Explain how src/index/watcher.rs debounces.", vec!["src/index/watcher.rs"], true),
                    chapter("c2", "Rules", "Explain the rules.", vec!["CLAUDE.md"], true),
                    chapter("c3", "Events", "Explain how events become batches.", vec!["src/index/watcher.rs"], true),
                    chapter("c4", "The README", "What the README of Orbit says.", vec!["README.md"], false),
                    chapter("c5", "Nowhere", "Explain Orbit's watcher.", vec!["src/gone.rs"], true),
                    chapter("c6", "The watcher", "Explain Orbit's watcher again.", vec!["README.md"], true),
                ]
            });
            let v = validate_outline(&outline, ctx).unwrap();
            assert_eq!(v.title, "Orbit's index");
            assert_eq!(v.accepted.len(), 1);
            assert_eq!(v.accepted[0].id, "c1");
            let codes: Vec<(&str, Rejection)> = v
                .rejected
                .iter()
                .map(|(id, r, _)| (id.as_str(), *r))
                .collect();
            assert_eq!(
                codes,
                vec![
                    ("c2", Rejection::AgentFile),
                    ("c3", Rejection::Generic),
                    ("c4", Rejection::SelfCheck),
                    ("c5", Rejection::UnknownPath),
                    ("c6", Rejection::Duplicate),
                ]
            );
            assert!(validate_outline(&Value::Null, ctx).is_err());
        });
        assert_eq!(enough(Length::Quick), 2);
        assert_eq!(enough(Length::Standard), 3);
        assert_eq!(enough(Length::Deep), 4);
    }
}
