//! The quiz validator: the grounding rules enforced, not trusted from the prompt. Pure, given
//! the answer, the corpus, a reader of cited files and the generation's input. A question is
//! accepted only when its choices are sound, every source is a citable file of the project with
//! lines that exist, its text names something of this project, its self-check says it is
//! project-specific, its hint does not give the answer, and it repeats nothing. The same rules
//! run in the mock backend (`src/ipc/mock/mockQuizValidate.ts`), checked on the shared fixtures
//! of `src/test/fixtures/quiz/`.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::Value;

use super::QuizExclusion;
use super::schema::{
    MAX_RANGE_LINES, QuestionKind, QuizOutput, QuizQuestion, QuizSource, QuizSourceKind,
    RawQuestion,
};
use crate::learning::corpus::{Corpus, PathStatus, SourceScope};

/// A text source without a line range is accepted only for files this short.
pub const WHOLE_FILE_MAX_LINES: u32 = 40;
/// A hint containing the correct choice gives it away when the choice is this long.
pub const HINT_ANSWER_MIN_CHARS: usize = 6;
/// Project words are at least this long.
pub const MIN_WORD_CHARS: usize = 4;

/// Words that never make a question project-specific (English, and words of every codebase).
/// Kept identical to `STOP_WORDS` in the mock and to `src/test/fixtures/quiz/stopwords.json`.
pub const STOP_WORDS: &[&str] = &[
    "about", "above", "after", "again", "also", "always", "another", "answer", "async", "await",
    "based", "because", "before", "being", "below", "between", "both", "build", "call", "called",
    "calls", "case", "class", "code", "const", "could", "data", "default", "does", "done", "each",
    "else", "enum", "error", "every", "example", "export", "false", "file", "files", "first",
    "folder", "from", "function", "have", "here", "into", "just", "like", "line", "lines", "list",
    "make", "makes", "many", "more", "most", "must", "name", "need", "never", "none", "number",
    "object", "only", "other", "over", "part", "project", "public", "return", "returns", "same",
    "self", "should", "since", "some", "source", "start", "static", "still", "string", "struct",
    "such", "test", "tests", "than", "that", "their", "them", "then", "there", "these", "they",
    "thing", "this", "those", "through", "true", "type", "types", "under", "until", "used", "uses",
    "using", "value", "values", "very", "want", "what", "when", "where", "which", "while", "will",
    "with", "without", "would", "your",
];

/// Generic file stems that do not name anything of a project on their own.
const GENERIC_STEMS: &[&str] = &[
    "index",
    "main",
    "utils",
    "util",
    "helpers",
    "helper",
    "types",
    "config",
    "readme",
    "setup",
    "common",
    "constants",
    "license",
    "changelog",
    "package",
    "test",
    "tests",
    "spec",
    "style",
    "styles",
    "init",
    "build",
    "default",
    "settings",
];

/// Why a question was rejected. The codes are shared with the mock's validator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Rejection {
    Choices,
    TrueFalse,
    AllOfTheAbove,
    AnswerRange,
    /// The right choice is much longer than every wrong one: its length gives it away.
    LongestAnswer,
    NoSource,
    UnknownPath,
    AgentFile,
    SecretFile,
    OutOfScope,
    MissingRange,
    BadRange,
    RangeTooLong,
    BeyondEnd,
    BinaryRange,
    BinaryOnly,
    SelfCheck,
    Generic,
    HintGivesAnswer,
    Duplicate,
}

impl Rejection {
    pub fn code(self) -> &'static str {
        match self {
            Self::Choices => "choices",
            Self::TrueFalse => "trueFalse",
            Self::AllOfTheAbove => "allOfTheAbove",
            Self::AnswerRange => "answerRange",
            Self::LongestAnswer => "longestAnswer",
            Self::NoSource => "noSource",
            Self::UnknownPath => "unknownPath",
            Self::AgentFile => "agentFile",
            Self::SecretFile => "secretFile",
            Self::OutOfScope => "outOfScope",
            Self::MissingRange => "missingRange",
            Self::BadRange => "badRange",
            Self::RangeTooLong => "rangeTooLong",
            Self::BeyondEnd => "beyondEnd",
            Self::BinaryRange => "binaryRange",
            Self::BinaryOnly => "binaryOnly",
            Self::SelfCheck => "selfCheck",
            Self::Generic => "generic",
            Self::HintGivesAnswer => "hintGivesAnswer",
            Self::Duplicate => "duplicate",
        }
    }

    /// For the progress screen: "2 cited agent files, 1 was generic".
    pub fn plain(self, n: usize) -> String {
        let s = |one: &str, many: &str| {
            if n == 1 {
                one.to_owned()
            } else {
                many.to_owned()
            }
        };
        let what = match self {
            Self::Choices | Self::TrueFalse | Self::AllOfTheAbove | Self::AnswerRange => {
                s("had unusable choices", "had unusable choices")
            }
            Self::LongestAnswer => s(
                "gave its answer away by its length",
                "gave their answers away by their length",
            ),
            Self::NoSource => s("cited nothing", "cited nothing"),
            Self::UnknownPath => s(
                "cited a file that does not exist",
                "cited files that do not exist",
            ),
            Self::AgentFile => s("cited an agent file", "cited agent files"),
            Self::SecretFile => s("cited a secret file", "cited secret files"),
            Self::OutOfScope => s(
                "cited code outside the sources",
                "cited code outside the sources",
            ),
            Self::MissingRange
            | Self::BadRange
            | Self::RangeTooLong
            | Self::BeyondEnd
            | Self::BinaryRange => s(
                "cited lines that do not check out",
                "cited lines that do not check out",
            ),
            Self::BinaryOnly => s("cited only a binary file", "cited only binary files"),
            Self::SelfCheck | Self::Generic => s("was generic", "were generic"),
            Self::HintGivesAnswer => s(
                "had a hint giving the answer",
                "had hints giving the answer",
            ),
            Self::Duplicate => s("was a repeat", "were repeats"),
        };
        format!("{n} {what}")
    }
}

/// The lines of a text file of the project (the validator reads cited files through this).
pub type LineReader<'a> = dyn FnMut(&str) -> Option<std::sync::Arc<Vec<String>>> + 'a;

/// What the validator knows besides the answer.
pub struct Context<'a> {
    pub corpus: &'a Corpus,
    pub agent_names: &'a [String],
    pub read: &'a mut LineReader<'a>,
    /// The project's own names: its name and its module paths.
    pub project_name: &'a str,
    pub modules: &'a [String],
    /// Questions asked before (a later round or Keep going): not to be repeated.
    pub exclude: &'a [QuizExclusion],
    /// Questions wanted: accepted questions beyond this are dropped (not rejected).
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Validated {
    pub accepted: Vec<QuizQuestion>,
    /// `(id, rejection, message for the model)`, in the answer's order.
    pub rejected: Vec<(String, Rejection, String)>,
    pub insufficient_material: bool,
    pub material_note: Option<String>,
    pub docs_note: Option<String>,
    pub suggested_subjects: Vec<String>,
}

impl Validated {
    /// "3 rejected: 2 cited agent files, 1 was generic".
    pub fn summary(&self) -> String {
        let mut by: BTreeMap<String, usize> = BTreeMap::new();
        for (_, r, _) in &self.rejected {
            // Group by the plain text, so related codes add up.
            *by.entry(r.plain(1)[2..].to_owned()).or_default() += 1;
        }
        let mut parts: Vec<(usize, String)> = Vec::new();
        for (_, r, _) in &self.rejected {
            let key = r.plain(1)[2..].to_owned();
            if let Some(n) = by.remove(&key) {
                parts.push((n, r.plain(n)));
            }
        }
        let list: Vec<String> = parts.into_iter().map(|(_, t)| t).collect();
        format!("{} rejected: {}", self.rejected.len(), list.join(", "))
    }
}

/// Lower-case words of `text`: letters, digits and `_`, at least [`MIN_WORD_CHARS`] long, not a
/// stop word, not a number.
pub fn words(text: &str) -> BTreeSet<String> {
    text.split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .map(str::to_lowercase)
        .filter(|w| {
            w.chars().count() >= MIN_WORD_CHARS
                && !w.chars().all(|c| c.is_ascii_digit())
                && !STOP_WORDS.contains(&w.as_str())
        })
        .collect()
}

/// For duplicate detection: lower case, letters and digits only.
fn normalized(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn stem(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    match name.find('.') {
        Some(i) if i > 0 => name[..i].to_owned(),
        _ => name,
    }
}

/// Whether `text` names something of the project: a path or file name of the corpus, a module,
/// the project's name, a distinctive file stem, or a word of the cited lines.
fn names_the_project(text: &str, cited_words: &BTreeSet<String>, ctx: &Context<'_>) -> bool {
    names_project(text, cited_words, ctx.corpus, ctx.project_name, ctx.modules)
}

/// The generic-content check shared with the tutorials: whether `text` names something of the
/// project (see [`names_the_project`]).
pub fn names_project(
    text: &str,
    cited_words: &BTreeSet<String>,
    corpus: &Corpus,
    project_name: &str,
    modules: &[String],
) -> bool {
    let lower = text.to_lowercase();
    let text_words = words(text);
    let all_words: BTreeSet<String> = text
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .map(str::to_lowercase)
        .filter(|w| !w.is_empty())
        .collect();
    // A cited word, or a module or project name.
    if text_words.iter().any(|w| cited_words.contains(w)) {
        return true;
    }
    let name = project_name.to_lowercase();
    if name.chars().count() >= MIN_WORD_CHARS && all_words.contains(&name) {
        return true;
    }
    for m in modules {
        let last = m.rsplit('/').next().unwrap_or(m).to_lowercase();
        if last.chars().count() >= MIN_WORD_CHARS && all_words.contains(&last) {
            return true;
        }
    }
    // A path or a file name of the project (with its extension), or a distinctive stem.
    for path in corpus.files.keys().chain(corpus.outside_scope.iter()) {
        let p = path.to_lowercase();
        let file = p.rsplit('/').next().unwrap_or(&p);
        if (file.contains('.') && file.len() >= 4 && lower.contains(file)) || lower.contains(&p) {
            return true;
        }
        let s = stem(path);
        if s.chars().count() >= 5 && !GENERIC_STEMS.contains(&s.as_str()) && all_words.contains(&s)
        {
            return true;
        }
    }
    false
}

/// Checks the sources of a question; returns the validated sources and the words of the cited
/// lines, or the rejection with its message for the model.
fn check_sources(
    q: &RawQuestion,
    ctx: &mut Context<'_>,
) -> Result<(Vec<QuizSource>, BTreeSet<String>), (Rejection, String)> {
    if q.sources.is_empty() {
        return Err((Rejection::NoSource, "cites no source".to_owned()));
    }
    let mut out = Vec::new();
    let mut cited = BTreeSet::new();
    for s in &q.sources {
        let path = s.path.trim().trim_start_matches("./").replace('\\', "/");
        let file = match ctx.corpus.status(&path, ctx.agent_names) {
            PathStatus::Citable(f) => f.clone(),
            PathStatus::Agent => {
                return Err((
                    Rejection::AgentFile,
                    format!(
                        "cites {path}, an agent instruction file (context only, never a source)"
                    ),
                ));
            }
            PathStatus::Secret => {
                return Err((
                    Rejection::SecretFile,
                    format!("cites {path}, a file that may hold secrets"),
                ));
            }
            PathStatus::OutOfScope => {
                let what = match ctx.corpus.scope {
                    SourceScope::DocumentationOnly => "this quiz is limited to the documentation",
                    _ => "this quiz is limited to other files",
                };
                return Err((Rejection::OutOfScope, format!("cites {path}, but {what}")));
            }
            PathStatus::Unknown => {
                return Err((
                    Rejection::UnknownPath,
                    format!(
                        "cites {path}, which is not a file of this project (use the paths of the corpus map)"
                    ),
                ));
            }
        };
        let (first, last) = match (s.first_line, s.last_line) {
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
            out.push(QuizSource {
                path,
                first_line: None,
                last_line: None,
                why: s.why.clone(),
                kind: QuizSourceKind::Binary,
            });
            continue;
        }
        let Some(lines) = (ctx.read)(&path) else {
            return Err((
                Rejection::UnknownPath,
                format!("cites {path}, which cannot be read"),
            ));
        };
        let count = u32::try_from(lines.len()).unwrap_or(u32::MAX);
        match (first, last) {
            (None, None) => {
                if count > WHOLE_FILE_MAX_LINES {
                    return Err((
                        Rejection::MissingRange,
                        format!(
                            "cites {path} ({count} lines) without the line range that holds the fact"
                        ),
                    ));
                }
                for line in lines.iter() {
                    cited.extend(words(line));
                }
            }
            (Some(a), Some(b)) => {
                if a == 0 || a > b {
                    return Err((
                        Rejection::BadRange,
                        format!("cites lines {a}-{b} of {path}, which is not a range"),
                    ));
                }
                if b - a + 1 > MAX_RANGE_LINES {
                    return Err((
                        Rejection::RangeTooLong,
                        format!(
                            "cites {} lines of {path}; cite at most {MAX_RANGE_LINES}, the ones that hold the fact",
                            b - a + 1
                        ),
                    ));
                }
                if b > count {
                    return Err((
                        Rejection::BeyondEnd,
                        format!("{path} has {count} lines; lines {a}-{b} do not exist"),
                    ));
                }
                for line in &lines[(a - 1) as usize..b as usize] {
                    cited.extend(words(line));
                }
            }
            _ => unreachable!("normalized above"),
        }
        out.push(QuizSource {
            path,
            first_line: first,
            last_line: last,
            why: s.why.clone(),
            kind: if file.markdown {
                QuizSourceKind::Markdown
            } else {
                QuizSourceKind::Code
            },
        });
    }
    if out.iter().all(|s| s.kind == QuizSourceKind::Binary) {
        return Err((
            Rejection::BinaryOnly,
            "cites only binary files, whose content cannot be read; cite the text that uses them"
                .to_owned(),
        ));
    }
    Ok((out, cited))
}

fn check_choices(q: &RawQuestion) -> Result<(), (Rejection, String)> {
    let answer = q.answer as usize;
    match q.kind {
        QuestionKind::TrueFalse => {
            let ok = q.choices.len() == 2
                && q.choices[0].trim().eq_ignore_ascii_case("true")
                && q.choices[1].trim().eq_ignore_ascii_case("false");
            if !ok {
                return Err((
                    Rejection::TrueFalse,
                    "a true/false question needs exactly the choices [\"True\", \"False\"]"
                        .to_owned(),
                ));
            }
        }
        QuestionKind::MultipleChoice => {
            if !(3..=5).contains(&q.choices.len()) {
                return Err((
                    Rejection::Choices,
                    format!(
                        "has {} choices; a multiple choice question has 3 to 5",
                        q.choices.len()
                    ),
                ));
            }
            let mut seen = BTreeSet::new();
            for c in &q.choices {
                let n = normalized(c);
                if n.is_empty() || !seen.insert(n.clone()) {
                    return Err((
                        Rejection::Choices,
                        "has empty or duplicate choices".to_owned(),
                    ));
                }
                if n.contains("theabove") {
                    return Err((
                        Rejection::AllOfTheAbove,
                        "uses an \"all/none of the above\" choice".to_owned(),
                    ));
                }
            }
        }
    }
    if answer >= q.choices.len() {
        return Err((
            Rejection::AnswerRange,
            format!("its answer index {answer} is not one of its choices"),
        ));
    }
    if q.kind == QuestionKind::MultipleChoice {
        let len = |c: &String| c.trim().chars().count();
        let right = len(&q.choices[answer]);
        let longest_wrong = q
            .choices
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != answer)
            .map(|(_, c)| len(c))
            .max()
            .unwrap_or(0);
        if giveaway_length(right, longest_wrong) {
            return Err((
                Rejection::LongestAnswer,
                format!(
                    "its right choice is much longer than every wrong one ({right} characters, the wrong ones at most {longest_wrong}): its length gives it away. Write all the choices alike in length, detail and tone"
                ),
            ));
        }
    }
    Ok(())
}

/// Whether the right choice's length gives it away: half as long again as the longest wrong
/// one, and at least 20 characters longer (short names of different lengths are fine).
/// Kept identical to `giveawayLength` in the mock.
pub fn giveaway_length(right: usize, longest_wrong: usize) -> bool {
    right * 2 >= longest_wrong * 3 && right >= longest_wrong + 20
}

/// Validates an answer. `Err` is a shape error: the whole answer is rejected, with the reason.
pub fn validate(output: &Value, ctx: &mut Context<'_>) -> Result<Validated, String> {
    if output.is_null() {
        return Err("no JSON answer was given".to_owned());
    }
    let parsed: QuizOutput = serde_json::from_value(output.clone()).map_err(|e| e.to_string())?;
    if let Some(q) = parsed
        .questions
        .iter()
        .find(|q| !(1..=5).contains(&q.difficulty))
    {
        return Err(format!(
            "{}: difficulty {} is not between 1 and 5",
            q.id, q.difficulty
        ));
    }
    let mut v = Validated {
        accepted: Vec::new(),
        rejected: Vec::new(),
        insufficient_material: parsed.insufficient_material,
        material_note: parsed.material_note.filter(|n| !n.trim().is_empty()),
        docs_note: parsed.docs_note.filter(|n| !n.trim().is_empty()),
        suggested_subjects: parsed.suggested_subjects,
    };
    let mut ids = BTreeSet::new();
    let mut texts: BTreeSet<String> = ctx
        .exclude
        .iter()
        .map(|e| normalized(&e.question))
        .collect();
    let mut facts: BTreeSet<(String, Option<u32>, Option<u32>, String)> = BTreeSet::new();
    for q in &parsed.questions {
        let verdict = (|| {
            if !ids.insert(q.id.clone()) {
                return Err((Rejection::Duplicate, format!("repeats the id {}", q.id)));
            }
            check_choices(q)?;
            let (sources, cited) = check_sources(q, ctx)?;
            if !q.self_check.project_specific {
                return Err((
                    Rejection::SelfCheck,
                    "your own self-check says it is not specific to this project".to_owned(),
                ));
            }
            let text = format!("{} {} {}", q.question, q.explanation, q.choices.join(" "));
            if !names_the_project(&text, &cited, ctx) {
                return Err((
                    Rejection::Generic,
                    "generic: the question and its explanation name nothing of this project (a file, an identifier of the cited lines, a module)".to_owned(),
                ));
            }
            let correct = q.choices[q.answer as usize].trim();
            if (correct.chars().count() >= HINT_ANSWER_MIN_CHARS
                && q.hint.to_lowercase().contains(&correct.to_lowercase()))
                || normalized(&q.hint) == normalized(&q.explanation)
            {
                return Err((
                    Rejection::HintGivesAnswer,
                    "its hint gives the answer away; point to where to look instead".to_owned(),
                ));
            }
            let text_key = normalized(&q.question);
            let first = &sources[0];
            let fact = (
                first.path.clone(),
                first.first_line,
                first.last_line,
                normalized(correct),
            );
            if texts.contains(&text_key) || facts.contains(&fact) {
                return Err((
                    Rejection::Duplicate,
                    "repeats a question already asked".to_owned(),
                ));
            }
            texts.insert(text_key);
            facts.insert(fact);
            Ok(sources)
        })();
        match verdict {
            Ok(sources) => {
                if v.accepted.len() < ctx.count {
                    v.accepted.push(QuizQuestion {
                        id: q.id.clone(),
                        kind: q.kind,
                        question: q.question.trim().to_owned(),
                        choices: q.choices.iter().map(|c| c.trim().to_owned()).collect(),
                        answer: q.answer,
                        hint: q.hint.trim().to_owned(),
                        explanation: q.explanation.trim().to_owned(),
                        sources,
                        difficulty: u32::from(q.difficulty),
                    });
                }
            }
            Err((rejection, message)) => v.rejected.push((q.id.clone(), rejection, message)),
        }
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::Arc;

    use serde::Deserialize;

    use super::*;
    use crate::learning::corpus::CorpusFile;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FixtureFile {
        path: String,
        #[serde(default)]
        content: Option<String>,
        #[serde(default)]
        lines: Option<usize>,
        #[serde(default)]
        binary: bool,
        #[serde(default)]
        agent: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FixtureCorpus {
        name: String,
        modules: Vec<String>,
        agent_names: Vec<String>,
        files: Vec<FixtureFile>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Expected {
        #[serde(default)]
        shape_error: bool,
        #[serde(default)]
        accepted: Vec<String>,
        #[serde(default)]
        rejected: BTreeMap<String, String>,
        #[serde(default)]
        insufficient: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        description: String,
        #[serde(default)]
        scope: SourceScope,
        count: usize,
        #[serde(default)]
        exclude: Vec<QuizExclusion>,
        output: Value,
        expected: Expected,
    }

    fn fixtures() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/test/fixtures/quiz")
    }

    fn lines_of(f: &FixtureFile) -> Vec<String> {
        match (&f.content, f.lines) {
            (Some(c), _) => c.lines().map(str::to_owned).collect(),
            (None, Some(n)) => (1..=n).map(|i| format!("filler {i}")).collect(),
            (None, None) => Vec::new(),
        }
    }

    fn run_case(corpus_fixture: &FixtureCorpus, case: &Case) -> Result<Validated, String> {
        let entries = corpus_fixture
            .files
            .iter()
            .filter(|f| !crate::learning::agent_files::is_secret(&f.path))
            .map(|f| {
                let l = f.path.to_lowercase();
                (
                    CorpusFile {
                        path: f.path.clone(),
                        size: 100,
                        binary: f.binary,
                        large: false,
                        language: None,
                        markdown: l.ends_with(".md") || l.ends_with(".markdown"),
                    },
                    f.agent,
                )
            })
            .collect();
        let corpus = Corpus::from_entries(entries, &case.scope);
        let contents: BTreeMap<String, Arc<Vec<String>>> = corpus_fixture
            .files
            .iter()
            .filter(|f| !f.binary)
            .map(|f| (f.path.clone(), Arc::new(lines_of(f))))
            .collect();
        let mut read = |p: &str| contents.get(p).cloned();
        let mut ctx = Context {
            corpus: &corpus,
            agent_names: &corpus_fixture.agent_names,
            read: &mut read,
            project_name: &corpus_fixture.name,
            modules: &corpus_fixture.modules,
            exclude: &case.exclude,
            count: case.count,
        };
        validate(&case.output, &mut ctx)
    }

    /// The shared fixtures: the mock's validator must agree on every one (Vitest runs them too).
    #[test]
    fn the_shared_fixtures() {
        let dir = fixtures();
        let corpus: FixtureCorpus =
            serde_json::from_str(&std::fs::read_to_string(dir.join("corpus.json")).unwrap())
                .unwrap();
        let mut cases = 0;
        for entry in std::fs::read_dir(dir.join("cases")).unwrap() {
            let path = entry.unwrap().path();
            let case: Case = serde_json::from_str(&std::fs::read_to_string(&path).unwrap())
                .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            let name = format!(
                "{} ({})",
                path.file_name().unwrap().to_string_lossy(),
                case.description
            );
            match run_case(&corpus, &case) {
                Err(e) => assert!(
                    case.expected.shape_error,
                    "{name}: unexpected shape error {e}"
                ),
                Ok(v) => {
                    assert!(!case.expected.shape_error, "{name}: expected a shape error");
                    let accepted: Vec<&str> = v.accepted.iter().map(|q| q.id.as_str()).collect();
                    assert_eq!(
                        accepted, case.expected.accepted,
                        "{name}: accepted ({:?})",
                        v.rejected
                    );
                    let rejected: BTreeMap<String, String> = v
                        .rejected
                        .iter()
                        .map(|(id, r, _)| (id.clone(), r.code().to_owned()))
                        .collect();
                    assert_eq!(rejected, case.expected.rejected, "{name}: rejected");
                    assert_eq!(
                        v.insufficient_material, case.expected.insufficient,
                        "{name}"
                    );
                }
            }
            cases += 1;
        }
        assert!(cases >= 6, "the cases were found");
    }

    #[test]
    fn the_stop_words_match_the_shared_list() {
        let list: Vec<String> = serde_json::from_str(
            &std::fs::read_to_string(fixtures().join("stopwords.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            list,
            STOP_WORDS
                .iter()
                .map(|s| (*s).to_owned())
                .collect::<Vec<_>>()
        );
    }

    /// The same thresholds as `giveawayLength` in the mock.
    #[test]
    fn a_right_choice_gives_itself_away_only_when_much_longer() {
        // Short names of different lengths are fine.
        assert!(!giveaway_length(14, 4));
        // A sentence against short words is a giveaway; against sentences of its kind it is not.
        assert!(giveaway_length(60, 20));
        assert!(!giveaway_length(60, 41));
        assert!(giveaway_length(60, 40));
        assert!(!giveaway_length(39, 20));
    }

    #[test]
    fn words_and_summary() {
        let w = words("The AiGateway::start() in src/ai/gateway.rs, line 120 of 2024!");
        assert!(w.contains("aigateway") && w.contains("gateway") && !w.contains("start"));
        assert!(!w.contains("2024") && !w.contains("line"));
        let v = Validated {
            accepted: vec![],
            rejected: vec![
                ("q1".into(), Rejection::AgentFile, String::new()),
                ("q2".into(), Rejection::Generic, String::new()),
                ("q3".into(), Rejection::AgentFile, String::new()),
            ],
            insufficient_material: false,
            material_note: None,
            docs_note: None,
            suggested_subjects: vec![],
        };
        assert_eq!(
            v.summary(),
            "3 rejected: 2 cited agent files, 1 was generic"
        );
    }
}
