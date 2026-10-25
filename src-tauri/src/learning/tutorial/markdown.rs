//! The shared markdown format of a tutorial (ADR 0025): a `README.md` whose front matter holds
//! the tutorial's metadata, its outline and every cited range with its hash, plus one markdown
//! file per written chapter. Prose steps are plain markdown (a heading, paragraphs, a `Sources:`
//! line with links); interactive steps are fenced `igrasp-*` blocks with YAML, as the quiz files
//! (ADR 0024). GitHub shows all of it as readable text; IGrasp renders the blocks as cards.
//! `write` then `read` loses nothing of a normalized tutorial.

use serde::{Deserialize, Serialize};

use super::schema::{
    Chapter, Citation, CodeTourStep, ConceptBridgeStep, DiagramStep, ExplainStep, MatchPair,
    MatchStep, PutInOrderStep, QuickCheckStep, RecapStep, SourceHash, SpotItStep, Step, TourStop,
    TryItStep, Tutorial, Verification,
};
use super::{Familiarity, Length};
use crate::learning::quiz::schema::QuestionKind;

/// The kind declared by a tutorial's README front matter.
pub const KIND: &str = "tutorial";
/// The kind declared by a chapter file's front matter.
pub const CHAPTER_KIND: &str = "tutorial-chapter";
const SOURCES: &str = "Sources: ";
const HOOT: &str = "> **Hoot:** ";
const CONCEPT: &str = "> **Concept:** ";
const DOCS: &str = "> Official docs: ";

/// A file of the shared format: its name in the tutorial's folder and its text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TutorialFile {
    pub name: String,
    pub text: String,
}

// ---------------------------------------------------------------------------------------------
// Front matters and YAML blocks.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChapterMeta {
    id: String,
    title: String,
    goal: String,
    minutes: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrontMatter {
    igrasp: String,
    id: String,
    title: String,
    intro: String,
    project: String,
    subject: String,
    familiarity: Familiarity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    domain_gap: Option<String>,
    length: Length,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    generated: String,
    provider: String,
    model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    generation_commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    verified: Option<Verification>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    material_note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    docs_note: Option<String>,
    chapters: Vec<ChapterMeta>,
    #[serde(default)]
    sources: Vec<SourceHash>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChapterFrontMatter {
    igrasp: String,
    tutorial: String,
    chapter: String,
}

/// A citation inside a YAML block: `lines: "12-30"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YamlCitation {
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    lines: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    why: Option<String>,
}

/// `"12-30"` or `"7"` to a range.
fn parse_lines(s: &str) -> Option<(u32, u32)> {
    let s = s.trim();
    let (a, b) = match s.split_once('-') {
        Some((a, b)) => (a.trim().parse().ok()?, b.trim().parse().ok()?),
        None => {
            let n: u32 = s.parse().ok()?;
            (n, n)
        }
    };
    Some((a, b))
}

impl From<&Citation> for YamlCitation {
    fn from(c: &Citation) -> Self {
        Self {
            path: c.path.clone(),
            lines: c.lines(),
            why: c.why.clone(),
        }
    }
}

impl From<&YamlCitation> for Citation {
    fn from(y: &YamlCitation) -> Self {
        let range = y.lines.as_deref().and_then(parse_lines);
        Self {
            path: y.path.clone(),
            first_line: range.map(|r| r.0),
            last_line: range.map(|r| r.1),
            why: y.why.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YamlStop {
    path: String,
    lines: String,
    annotation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeTourBlock {
    stops: Vec<YamlStop>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutInOrderBlock {
    prompt: String,
    items: Vec<String>,
    explanation: String,
    sources: Vec<YamlCitation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MatchBlock {
    prompt: String,
    pairs: Vec<MatchPair>,
    explanation: String,
    sources: Vec<YamlCitation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpotItBlock {
    prompt: String,
    path: String,
    lines: String,
    answer_line: u32,
    explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuizBlock {
    kind: QuestionKind,
    choices: Vec<String>,
    answer: u32,
    hint: String,
    explanation: String,
    sources: Vec<YamlCitation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TryItBlock {
    instruction: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    #[serde(default, rename = "where", skip_serializing_if = "Option::is_none")]
    where_: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expected: Option<String>,
    sources: Vec<YamlCitation>,
}

// ---------------------------------------------------------------------------------------------
// Writing.

/// `the-watcher` from `The watcher!`.
pub fn slug(text: &str) -> String {
    let mut out = String::new();
    let mut dash = true;
    for c in text.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    let out = out.trim_end_matches('-').to_owned();
    if out.is_empty() {
        "chapter".to_owned()
    } else {
        out
    }
}

/// `01-the-watcher.md`.
pub fn chapter_file_name(index: usize, title: &str) -> String {
    let s: String = slug(title).chars().take(60).collect();
    format!("{:02}-{}.md", index + 1, s.trim_end_matches('-'))
}

/// A fence longer than any backtick run inside the text.
fn fence_for(text: &str) -> String {
    let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    "`".repeat(longest.max(2) + 1)
}

fn yaml_block(kind: &str, value: &impl Serialize) -> String {
    let yaml = serde_yaml::to_string(value).unwrap_or_default();
    let fence = fence_for(&yaml);
    format!("{fence}{kind}\n{yaml}{fence}")
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The `Sources:` line: links to the files (relative to the tutorial's folder, for GitHub) with
/// the root-relative path as text (what the reader parses).
fn sources_line(sources: &[Citation], up: &str) -> String {
    let items: Vec<String> = sources
        .iter()
        .map(|c| {
            let label = match c.lines() {
                Some(l) => format!("{}:{l}", c.path),
                None => c.path.clone(),
            };
            let anchor = match (c.first_line, c.last_line) {
                (Some(a), Some(b)) if a != b => format!("#L{a}-L{b}"),
                (Some(a), _) => format!("#L{a}"),
                _ => String::new(),
            };
            let mut item = format!("[`{label}`]({up}{}{anchor})", c.path);
            if let Some(why) = &c.why {
                item.push_str(" — ");
                item.push_str(&one_line(why));
            }
            item
        })
        .collect();
    format!("{SOURCES}{}", items.join(" · "))
}

fn step_markdown(step: &Step, up: &str) -> String {
    match step {
        Step::Explain(s) => format!("{}\n\n{}", s.body.trim(), sources_line(&s.sources, up)),
        Step::ConceptBridge(s) => {
            let mut alert = format!("> [!NOTE]\n{CONCEPT}{}", one_line(&s.concept));
            if let Some(u) = &s.docs_url {
                alert.push_str(&format!("\n{DOCS}<{u}>"));
            }
            format!(
                "{alert}\n\n{}\n\n{}",
                s.applied.trim(),
                sources_line(&s.sources, up)
            )
        }
        Step::CodeTour(s) => yaml_block(
            "igrasp-code-tour",
            &CodeTourBlock {
                stops: s
                    .stops
                    .iter()
                    .map(|t| YamlStop {
                        path: t.path.clone(),
                        lines: Citation::new(&t.path, t.first_line, t.last_line)
                            .lines()
                            .unwrap_or_default(),
                        annotation: t.annotation.clone(),
                    })
                    .collect(),
            },
        ),
        Step::Diagram(s) => {
            let fence = fence_for(&s.mermaid);
            let mut out = format!("{fence}mermaid\n{}\n{fence}", s.mermaid.trim());
            if let Some(c) = &s.caption {
                out.push_str("\n\n");
                out.push_str(c.trim());
            }
            format!("{out}\n\n{}", sources_line(&s.sources, up))
        }
        Step::PutInOrder(s) => yaml_block(
            "igrasp-put-in-order",
            &PutInOrderBlock {
                prompt: s.prompt.clone(),
                items: s.items.clone(),
                explanation: s.explanation.clone(),
                sources: s.sources.iter().map(YamlCitation::from).collect(),
            },
        ),
        Step::Match(s) => yaml_block(
            "igrasp-match",
            &MatchBlock {
                prompt: s.prompt.clone(),
                pairs: s.pairs.clone(),
                explanation: s.explanation.clone(),
                sources: s.sources.iter().map(YamlCitation::from).collect(),
            },
        ),
        Step::SpotIt(s) => yaml_block(
            "igrasp-spot-it",
            &SpotItBlock {
                prompt: s.prompt.clone(),
                path: s.path.clone(),
                lines: Citation::new(&s.path, s.first_line, s.last_line)
                    .lines()
                    .unwrap_or_default(),
                answer_line: s.answer_line,
                explanation: s.explanation.clone(),
            },
        ),
        Step::QuickCheck(s) => yaml_block(
            "igrasp-quiz",
            &QuizBlock {
                kind: s.kind,
                choices: s.choices.clone(),
                answer: s.answer,
                hint: s.hint.clone(),
                explanation: s.explanation.clone(),
                sources: s.sources.iter().map(YamlCitation::from).collect(),
            },
        ),
        Step::TryIt(s) => yaml_block(
            "igrasp-try-it",
            &TryItBlock {
                instruction: s.instruction.clone(),
                command: s.command.clone(),
                where_: s.where_.clone(),
                expected: s.expected.clone(),
                sources: s.sources.iter().map(YamlCitation::from).collect(),
            },
        ),
        Step::Recap(s) => {
            let items: Vec<String> = s
                .takeaways
                .iter()
                .map(|t| format!("- {}", one_line(t)))
                .collect();
            let mut out = items.join("\n");
            if !s.sources.is_empty() {
                out.push_str("\n\n");
                out.push_str(&sources_line(&s.sources, up));
            }
            out
        }
    }
}

fn chapter_markdown(t: &Tutorial, index: usize, c: &Chapter, up: &str) -> String {
    let front = serde_yaml::to_string(&ChapterFrontMatter {
        igrasp: CHAPTER_KIND.to_owned(),
        tutorial: t.id.clone(),
        chapter: c.id.clone(),
    })
    .unwrap_or_default();
    let mut out = format!(
        "---\n{front}---\n\n# {}. {}\n",
        index + 1,
        one_line(&c.title)
    );
    if let Some(h) = &c.hoot_intro {
        out.push_str(&format!("\n{HOOT}{}\n", one_line(h)));
    }
    for (i, step) in c.steps.iter().enumerate() {
        out.push_str(&format!(
            "\n## {}. {}\n\n{}\n",
            i + 1,
            one_line(&step.title()),
            step_markdown(step, up)
        ));
    }
    out
}

fn familiarity_words(f: Familiarity) -> &'static str {
    match f {
        Familiarity::NewHere => "developers new to the project",
        Familiarity::Contributing => "developers already contributing",
        Familiarity::Maintainer => "maintainers (deep dive)",
    }
}

/// The files of `t`: `README.md` first, then one file per written chapter. `folder` is where
/// they will live, root-relative (`docs/tutorials/the-watcher`), for the links to the sources.
pub fn write(t: &Tutorial, folder: &str) -> Vec<TutorialFile> {
    let depth = folder.split('/').filter(|p| !p.is_empty()).count();
    let up = "../".repeat(depth);
    let mut files = Vec::new();
    let mut metas = Vec::new();
    for (i, c) in t.chapters.iter().enumerate() {
        let file = c.is_written().then(|| chapter_file_name(i, &c.title));
        if let Some(name) = &file {
            files.push(TutorialFile {
                name: name.clone(),
                text: chapter_markdown(t, i, c, &up),
            });
        }
        metas.push(ChapterMeta {
            id: c.id.clone(),
            title: c.title.clone(),
            goal: c.goal.clone(),
            minutes: c.minutes,
            file,
        });
    }
    let front = FrontMatter {
        igrasp: KIND.to_owned(),
        id: t.id.clone(),
        title: t.title.clone(),
        intro: t.intro.clone(),
        project: t.project.clone(),
        subject: t.subject.clone(),
        familiarity: t.familiarity,
        domain_gap: t.domain_gap.clone(),
        length: t.length,
        role: t.role.clone(),
        generated: t.generated.clone(),
        provider: t.provider.clone(),
        model: t.model.clone(),
        generation_commit: t.generation_commit.clone(),
        verified: t.verified.clone(),
        material_note: t.material_note.clone(),
        docs_note: t.docs_note.clone(),
        chapters: metas.clone(),
        sources: t.sources.clone(),
    };
    let yaml = serde_yaml::to_string(&front).unwrap_or_default();
    let mut body = format!("---\n{yaml}---\n\n# {}\n\n{}\n\n", t.title, t.intro.trim());
    let mut facts = vec![
        format!("**Project:** {}", t.project),
        format!("**Subject:** {}", t.subject),
        format!("**For:** {}", familiarity_words(t.familiarity)),
    ];
    if let Some(g) = &t.domain_gap {
        facts.push(format!("**New to:** {g}"));
    }
    if let Some(r) = &t.role {
        facts.push(format!("**Role:** {r}"));
    }
    facts.push(format!(
        "**Length:** {} (~{} min)",
        t.length.name(),
        t.length.minutes()
    ));
    facts.push(format!(
        "**Written:** {} by Hoot with {}",
        t.generated.get(..10).unwrap_or(&t.generated),
        t.model
    ));
    if let Some(v) = &t.verified {
        facts.push(format!("**Verified:** {}", v.date));
    }
    body.push_str(&facts.join(" · "));
    body.push_str("\n\n## Chapters\n\n");
    for (i, m) in metas.iter().enumerate() {
        let line = match &m.file {
            Some(f) => format!(
                "{}. [{}]({f}) — {} ({} min)",
                i + 1,
                m.title,
                m.goal,
                m.minutes
            ),
            None => format!("{}. {} — {} (not written yet)", i + 1, m.title, m.goal),
        };
        body.push_str(&line);
        body.push('\n');
    }
    if t.material_note.is_some() || t.docs_note.is_some() {
        body.push_str("\n## Hoot's notes\n\n");
        if let Some(n) = &t.material_note {
            body.push_str(&format!("- Material: {n}\n"));
        }
        if let Some(n) = &t.docs_note {
            body.push_str(&format!("- Documentation: {n}\n"));
        }
    }
    body.push_str(&format!(
        "\n<sub>Written by IGrasp's Academy. Open this folder in IGrasp to take the tutorial; the {} cited ranges are checked against the files when it opens.</sub>\n",
        t.sources.len()
    ));
    files.insert(
        0,
        TutorialFile {
            name: "README.md".to_owned(),
            text: body,
        },
    );
    files
}

// ---------------------------------------------------------------------------------------------
// Reading.

fn front_matter(text: &str) -> Option<(&str, &str)> {
    let rest = text.strip_prefix("---\n")?;
    let end = rest.find("\n---\n")?;
    Some((&rest[..end], &rest[end + 5..]))
}

/// A fence opener: its marker (the run of backticks or tildes) and its info string.
fn fence_open(line: &str) -> Option<(&str, &str)> {
    let t = line.trim_start();
    let c = t.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = t.chars().take_while(|x| *x == c).count();
    if n < 3 {
        return None;
    }
    Some((&t[..n], t[n..].trim()))
}

fn fence_closes(line: &str, marker: &str) -> bool {
    let t = line.trim();
    let c = marker.chars().next().unwrap_or('`');
    t.len() >= marker.len() && t.chars().all(|x| x == c)
}

/// Splits `lines` into steps at `## n. ` headings outside fences: `(heading, body lines)`.
fn split_steps(lines: &[&str]) -> Vec<(String, Vec<String>)> {
    let mut steps: Vec<(String, Vec<String>)> = Vec::new();
    let mut fence: Option<String> = None;
    for line in lines {
        if let Some(m) = &fence {
            if fence_closes(line, m) {
                fence = None;
            }
        } else if let Some((m, _)) = fence_open(line) {
            fence = Some(m.to_owned());
        } else if let Some(h) = line.strip_prefix("## ")
            && let Some((n, title)) = h.trim().split_once(". ")
            && !n.is_empty()
            && n.chars().all(|c| c.is_ascii_digit())
        {
            // Only the numbered headings the writer emits start a step; a heading the model
            // wrote inside a body stays in the body.
            steps.push((title.trim().to_owned(), Vec::new()));
            continue;
        }
        if let Some((_, body)) = steps.last_mut() {
            body.push((*line).to_owned());
        }
    }
    steps
}

/// The `Sources:` line parsed: `[`path:lines`](…) — why · …`.
fn parse_sources(line: &str) -> Vec<Citation> {
    let mut out = Vec::new();
    for item in line.trim_start_matches(SOURCES).split(" · ") {
        let Some(start) = item.find("[`") else {
            continue;
        };
        let Some(end) = item[start + 2..].find("`]") else {
            continue;
        };
        let label = &item[start + 2..start + 2 + end];
        let why = item
            .split_once(" — ")
            .map(|(_, w)| w.trim().to_owned())
            .filter(|w| !w.is_empty());
        let (path, range) = match label.rsplit_once(':') {
            Some((p, l)) if parse_lines(l).is_some() => (p.to_owned(), parse_lines(l)),
            _ => (label.to_owned(), None),
        };
        out.push(Citation {
            path,
            first_line: range.map(|r| r.0),
            last_line: range.map(|r| r.1),
            why,
        });
    }
    out
}

/// Splits a prose body into the markdown before the `Sources:` line and the sources.
fn prose_and_sources(body: &[String]) -> (String, Vec<Citation>) {
    let idx = body.iter().rposition(|l| l.starts_with(SOURCES));
    let (prose, sources) = match idx {
        Some(i) => (&body[..i], parse_sources(&body[i])),
        None => (body, Vec::new()),
    };
    (prose.join("\n").trim().to_owned(), sources)
}

/// The YAML inside the first fenced block of `body`, with its info string.
fn fenced(body: &[String]) -> Option<(String, String, Vec<String>)> {
    let first = body.iter().position(|l| !l.trim().is_empty())?;
    let (marker, info) = fence_open(&body[first])?;
    let marker = marker.to_owned();
    let mut inner = Vec::new();
    let mut after = Vec::new();
    let mut closed = false;
    for line in &body[first + 1..] {
        if closed {
            after.push(line.clone());
        } else if fence_closes(line, &marker) {
            closed = true;
        } else {
            inner.push(line.clone());
        }
    }
    closed.then(|| (info.to_owned(), inner.join("\n"), after))
}

fn range_of(lines: &str) -> Result<(u32, u32), String> {
    parse_lines(lines).ok_or_else(|| format!("bad line range \"{lines}\""))
}

fn parse_step(title: &str, body: &[String]) -> Result<Step, String> {
    let yaml = |text: &str| -> Result<serde_yaml::Value, String> {
        serde_yaml::from_str(text).map_err(|e| e.to_string())
    };
    if let Some((info, text, after)) = fenced(body) {
        match info.as_str() {
            "igrasp-code-tour" => {
                let b: CodeTourBlock =
                    serde_yaml::from_value(yaml(&text)?).map_err(|e| e.to_string())?;
                let mut stops = Vec::new();
                for s in b.stops {
                    let (a, z) = range_of(&s.lines)?;
                    stops.push(TourStop {
                        path: s.path,
                        first_line: a,
                        last_line: z,
                        annotation: s.annotation,
                    });
                }
                return Ok(Step::CodeTour(CodeTourStep {
                    title: title.to_owned(),
                    stops,
                    self_check: None,
                }));
            }
            "igrasp-put-in-order" => {
                let b: PutInOrderBlock =
                    serde_yaml::from_value(yaml(&text)?).map_err(|e| e.to_string())?;
                return Ok(Step::PutInOrder(PutInOrderStep {
                    title: title.to_owned(),
                    prompt: b.prompt,
                    items: b.items,
                    explanation: b.explanation,
                    sources: b.sources.iter().map(Citation::from).collect(),
                    self_check: None,
                }));
            }
            "igrasp-match" => {
                let b: MatchBlock =
                    serde_yaml::from_value(yaml(&text)?).map_err(|e| e.to_string())?;
                return Ok(Step::Match(MatchStep {
                    title: title.to_owned(),
                    prompt: b.prompt,
                    pairs: b.pairs,
                    explanation: b.explanation,
                    sources: b.sources.iter().map(Citation::from).collect(),
                    self_check: None,
                }));
            }
            "igrasp-spot-it" => {
                let b: SpotItBlock =
                    serde_yaml::from_value(yaml(&text)?).map_err(|e| e.to_string())?;
                let (a, z) = range_of(&b.lines)?;
                return Ok(Step::SpotIt(SpotItStep {
                    title: title.to_owned(),
                    prompt: b.prompt,
                    path: b.path,
                    first_line: a,
                    last_line: z,
                    answer_line: b.answer_line,
                    explanation: b.explanation,
                    self_check: None,
                }));
            }
            "igrasp-quiz" => {
                let b: QuizBlock =
                    serde_yaml::from_value(yaml(&text)?).map_err(|e| e.to_string())?;
                return Ok(Step::QuickCheck(QuickCheckStep {
                    kind: b.kind,
                    question: title.to_owned(),
                    choices: b.choices,
                    answer: b.answer,
                    hint: b.hint,
                    explanation: b.explanation,
                    sources: b.sources.iter().map(Citation::from).collect(),
                    self_check: None,
                }));
            }
            "igrasp-try-it" => {
                let b: TryItBlock =
                    serde_yaml::from_value(yaml(&text)?).map_err(|e| e.to_string())?;
                return Ok(Step::TryIt(TryItStep {
                    title: title.to_owned(),
                    instruction: b.instruction,
                    command: b.command,
                    where_: b.where_,
                    expected: b.expected,
                    sources: b.sources.iter().map(Citation::from).collect(),
                    self_check: None,
                }));
            }
            "mermaid" => {
                let (caption, sources) = prose_and_sources(&after);
                return Ok(Step::Diagram(DiagramStep {
                    title: title.to_owned(),
                    mermaid: text.trim().to_owned(),
                    caption: Some(caption).filter(|c| !c.is_empty()),
                    sources,
                    self_check: None,
                }));
            }
            other if other.starts_with("igrasp-") => {
                return Err(format!("unknown block {other}"));
            }
            _ => {}
        }
    }
    let first = body.iter().position(|l| !l.trim().is_empty()).unwrap_or(0);
    if title == "Recap" {
        let (prose, sources) = prose_and_sources(body);
        let takeaways: Vec<String> = prose
            .lines()
            .filter_map(|l| l.trim().strip_prefix("- ").map(|t| t.trim().to_owned()))
            .collect();
        return Ok(Step::Recap(RecapStep {
            takeaways,
            sources,
            self_check: None,
        }));
    }
    if body.get(first).is_some_and(|l| l.trim() == "> [!NOTE]") {
        let mut concept = String::new();
        let mut docs_url = None;
        let mut i = first + 1;
        while let Some(line) = body.get(i)
            && line.starts_with('>')
        {
            if let Some(c) = line.strip_prefix(CONCEPT) {
                concept = c.trim().to_owned();
            } else if let Some(d) = line.strip_prefix(DOCS) {
                docs_url = Some(d.trim().trim_matches(['<', '>']).to_owned());
            }
            i += 1;
        }
        let (applied, sources) = prose_and_sources(&body[i..]);
        return Ok(Step::ConceptBridge(ConceptBridgeStep {
            title: title.to_owned(),
            concept,
            applied,
            docs_url,
            sources,
            self_check: None,
        }));
    }
    let (prose, sources) = prose_and_sources(body);
    Ok(Step::Explain(ExplainStep {
        title: title.to_owned(),
        body: prose,
        sources,
        self_check: None,
    }))
}

/// What reading a chapter file gives: the title, Hoot's intro, the steps, and the blocks that
/// did not parse (hand edits), skipped.
pub struct ReadChapter {
    pub title: String,
    pub hoot_intro: Option<String>,
    pub steps: Vec<Step>,
    pub skipped: Vec<(String, String)>,
}

/// Reads a chapter file.
pub fn read_chapter(text: &str) -> Result<ReadChapter, String> {
    let text = text.replace("\r\n", "\n");
    let (fm, body) = front_matter(&text).ok_or("no front matter")?;
    let meta: ChapterFrontMatter = serde_yaml::from_str(fm).map_err(|e| e.to_string())?;
    if meta.igrasp != CHAPTER_KIND {
        return Err(format!("not a tutorial chapter (igrasp: {})", meta.igrasp));
    }
    let lines: Vec<&str> = body.lines().collect();
    let mut title = String::new();
    let mut hoot_intro = None;
    let mut start = 0;
    for (i, line) in lines.iter().enumerate() {
        if let Some(h) = line.strip_prefix("# ") {
            let h = h.trim();
            title = h
                .split_once(". ")
                .filter(|(n, _)| n.chars().all(|c| c.is_ascii_digit()))
                .map_or(h, |(_, t)| t.trim())
                .to_owned();
            start = i + 1;
            break;
        }
    }
    for line in &lines[start..] {
        if let Some(h) = line.strip_prefix(HOOT) {
            hoot_intro = Some(h.trim().to_owned());
            break;
        }
        if line.starts_with("## ") {
            break;
        }
    }
    let mut steps = Vec::new();
    let mut skipped = Vec::new();
    for (heading, body) in split_steps(&lines[start..]) {
        match parse_step(&heading, &body) {
            Ok(s) => steps.push(s),
            Err(e) => skipped.push((heading, e)),
        }
    }
    Ok(ReadChapter {
        title,
        hoot_intro,
        steps,
        skipped,
    })
}

/// Reads a tutorial from its files (`README.md` and the chapter files its front matter names;
/// a missing chapter file leaves the chapter unwritten). Returns the tutorial and the skipped
/// blocks.
pub fn read(files: &[TutorialFile]) -> Result<(Tutorial, Vec<(String, String)>), String> {
    let readme = files
        .iter()
        .find(|f| f.name.eq_ignore_ascii_case("README.md"))
        .ok_or("no README.md")?;
    let text = readme.text.replace("\r\n", "\n");
    let (fm, _) = front_matter(&text).ok_or("README.md has no front matter")?;
    let front: FrontMatter = serde_yaml::from_str(fm).map_err(|e| e.to_string())?;
    if front.igrasp != KIND {
        return Err(format!("not a tutorial (igrasp: {})", front.igrasp));
    }
    let mut skipped = Vec::new();
    let mut chapters = Vec::new();
    for m in &front.chapters {
        let mut chapter = Chapter {
            id: m.id.clone(),
            title: m.title.clone(),
            goal: m.goal.clone(),
            minutes: m.minutes,
            hoot_intro: None,
            steps: Vec::new(),
        };
        if let Some(name) = &m.file
            && let Some(f) = files.iter().find(|f| &f.name == name)
        {
            let r = read_chapter(&f.text)?;
            if chapter.title.is_empty() {
                chapter.title = r.title;
            }
            chapter.hoot_intro = r.hoot_intro;
            chapter.steps = r.steps;
            skipped.extend(
                r.skipped
                    .into_iter()
                    .map(|(h, e)| (format!("{name}: {h}"), e)),
            );
        }
        chapters.push(chapter);
    }
    Ok((
        Tutorial {
            id: front.id,
            title: front.title,
            intro: front.intro,
            project: front.project,
            subject: front.subject,
            familiarity: front.familiarity,
            domain_gap: front.domain_gap,
            length: front.length,
            role: front.role,
            generated: front.generated,
            provider: front.provider,
            model: front.model,
            generation_commit: front.generation_commit,
            verified: front.verified,
            material_note: front.material_note,
            docs_note: front.docs_note,
            chapters,
            sources: front.sources,
        },
        skipped,
    ))
}

// ---------------------------------------------------------------------------------------------
// Normalization: what the format can hold exactly (trimmed texts, one-line titles and reasons).

fn trim(s: &mut String) {
    let t = s.replace("\r\n", "\n");
    *s = t.trim().to_owned();
}

fn trim_opt(s: &mut Option<String>) {
    if let Some(v) = s {
        trim(v);
        if v.is_empty() {
            *s = None;
        }
    }
}

fn line(s: &mut String) {
    *s = one_line(s);
}

fn why(c: &mut Citation) {
    if let Some(w) = &mut c.why {
        *w = one_line(w).replace(" · ", ", ").replace(" — ", " - ");
        if w.is_empty() {
            c.why = None;
        }
    }
}

fn citations(v: &mut [Citation]) {
    v.iter_mut().for_each(why);
}

/// Normalizes `t` so that `read(write(t)) == t`.
pub fn normalize(t: &mut Tutorial) {
    line(&mut t.title);
    trim(&mut t.intro);
    line(&mut t.subject);
    trim_opt(&mut t.domain_gap);
    trim_opt(&mut t.role);
    trim_opt(&mut t.material_note);
    trim_opt(&mut t.docs_note);
    for c in &mut t.chapters {
        line(&mut c.title);
        trim(&mut c.goal);
        if let Some(h) = &mut c.hoot_intro {
            line(h);
        }
        for s in &mut c.steps {
            s.strip_self_check();
            match s {
                Step::Explain(s) => {
                    line(&mut s.title);
                    trim(&mut s.body);
                    citations(&mut s.sources);
                }
                Step::ConceptBridge(s) => {
                    line(&mut s.title);
                    line(&mut s.concept);
                    trim(&mut s.applied);
                    trim_opt(&mut s.docs_url);
                    citations(&mut s.sources);
                }
                Step::CodeTour(s) => {
                    line(&mut s.title);
                    for t in &mut s.stops {
                        trim(&mut t.annotation);
                    }
                }
                Step::Diagram(s) => {
                    line(&mut s.title);
                    trim(&mut s.mermaid);
                    trim_opt(&mut s.caption);
                    citations(&mut s.sources);
                }
                Step::PutInOrder(s) => {
                    line(&mut s.title);
                    trim(&mut s.prompt);
                    trim(&mut s.explanation);
                    citations(&mut s.sources);
                }
                Step::Match(s) => {
                    line(&mut s.title);
                    trim(&mut s.prompt);
                    trim(&mut s.explanation);
                    citations(&mut s.sources);
                }
                Step::SpotIt(s) => {
                    line(&mut s.title);
                    trim(&mut s.prompt);
                    trim(&mut s.explanation);
                }
                Step::QuickCheck(s) => {
                    line(&mut s.question);
                    trim(&mut s.hint);
                    trim(&mut s.explanation);
                    citations(&mut s.sources);
                }
                Step::TryIt(s) => {
                    line(&mut s.title);
                    trim(&mut s.instruction);
                    trim_opt(&mut s.command);
                    trim_opt(&mut s.expected);
                    citations(&mut s.sources);
                }
                Step::Recap(s) => {
                    s.takeaways.iter_mut().for_each(line);
                    citations(&mut s.sources);
                }
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::schema::tests::every_step;
    use super::*;

    pub(crate) fn sample() -> Tutorial {
        let mut t = Tutorial {
            id: "orbit-the-watcher-20261025".into(),
            title: "Orbit's watcher".into(),
            intro: "You will follow a file change from the disk to the toast.".into(),
            project: "orbit".into(),
            subject: "How the watcher works".into(),
            familiarity: Familiarity::NewHere,
            domain_gap: Some("I'm new to file watchers".into()),
            length: Length::Standard,
            role: None,
            generated: "2026-10-25T10:00:00Z".into(),
            provider: "mock".into(),
            model: "m".into(),
            generation_commit: Some("abc1234".into()),
            verified: None,
            material_note: None,
            docs_note: Some("Nothing documents the poll fallback.".into()),
            chapters: vec![
                Chapter {
                    id: "c1".into(),
                    title: "The watcher".into(),
                    goal: "Explain how src/index/watcher.rs debounces.".into(),
                    minutes: 5,
                    hoot_intro: Some("Let us follow a change.".into()),
                    steps: every_step(),
                },
                Chapter {
                    id: "c2".into(),
                    title: "The graph".into(),
                    goal: "Explain how the graph applies a batch.".into(),
                    minutes: 6,
                    hoot_intro: None,
                    steps: Vec::new(),
                },
            ],
            sources: vec![SourceHash {
                path: "src/index/watcher.rs".into(),
                lines: Some("2-6".into()),
                sha256: Some("00".repeat(32)),
            }],
        };
        normalize(&mut t);
        t
    }

    #[test]
    fn the_round_trip_loses_nothing() {
        let t = sample();
        let files = write(&t, "docs/tutorials/the-watcher");
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].name, "README.md");
        assert_eq!(files[1].name, "01-the-watcher.md");
        let (back, skipped) = read(&files).unwrap();
        assert_eq!(skipped, vec![]);
        assert_eq!(back, t);
    }

    #[test]
    fn the_markdown_reads_well() {
        let t = sample();
        let files = write(&t, "docs/tutorials/the-watcher");
        let readme = &files[0].text;
        assert!(readme.starts_with("---\nigrasp: tutorial\nid: orbit-the-watcher-20261025\n"));
        assert!(readme.contains("# Orbit's watcher\n\nYou will follow a file change"));
        assert!(readme.contains("1. [The watcher](01-the-watcher.md) — Explain how src/index/watcher.rs debounces. (5 min)"));
        assert!(
            readme.contains(
                "2. The graph — Explain how the graph applies a batch. (not written yet)"
            )
        );
        assert!(readme.contains("- Documentation: Nothing documents the poll fallback."));
        let chapter = &files[1].text;
        assert!(chapter.starts_with("---\nigrasp: tutorial-chapter\ntutorial: orbit-the-watcher-20261025\nchapter: c1\n---\n\n# 1. The watcher\n\n> **Hoot:** Let us follow a change.\n"));
        assert!(chapter.contains("## 1. The watcher debounces\n\nThe watcher of Orbit waits `DEBOUNCE_MS` before it re-walks.\n\nThen it classifies.\n\nSources: [`src/index/watcher.rs:2-6`](../../../src/index/watcher.rs#L2-L6) — the debounce\n"));
        assert!(chapter.contains("## 2. Debouncing\n\n> [!NOTE]\n> **Concept:** Debouncing merges a burst of events into one.\n> Official docs: <https://docs.rs/notify-debouncer-full>\n\nHere `WatchContext`"));
        assert!(chapter.contains("## 3. From event to batch\n\n```igrasp-code-tour\nstops:\n- path: src/index/watcher.rs\n  lines: '2'\n  annotation: The debounce constant.\n"));
        assert!(chapter.contains("## 4. The flow\n\n```mermaid\nflowchart LR\n  W[watcher.rs] --> G[graph]\n```\n\nEvents reach the graph after the index.\n\nSources: "));
        assert!(chapter.contains("```igrasp-put-in-order\nprompt: Put the watcher's steps in order.\nitems:\n- debounce\n"));
        assert!(chapter.contains("```igrasp-match\n"));
        assert!(chapter.contains("```igrasp-spot-it\nprompt: Click the line that sets the debounce.\npath: src/index/watcher.rs\nlines: 1-6\nanswerLine: 2\n"));
        assert!(chapter.contains("## 8. Which constant sets Orbit's debounce?\n\n```igrasp-quiz\nkind: multipleChoice\nchoices:\n- DEBOUNCE_MS\n"));
        assert!(chapter.contains("```igrasp-try-it\ninstruction: Open the folder in Orbit, then touch a file and watch the toast.\ncommand: touch README.md\nwhere: terminal\n"));
        assert!(chapter.ends_with("## 10. Recap\n\n- watcher.rs debounces for 200 ms.\n- WatchContext carries the generation.\n- Late batches are dropped.\n"));
    }

    #[test]
    fn reading_tolerates_hand_edits_and_refuses_other_files() {
        let t = sample();
        let mut files = write(&t, "");
        // A block that does not parse is skipped, the rest is kept; a missing chapter file leaves
        // the chapter unwritten; CRLF is fine.
        files[1].text = files[1]
            .text
            .replace("```igrasp-match\n", "```igrasp-match\n: : not yaml\n")
            .replace('\n', "\r\n");
        let (back, skipped) = read(&files).unwrap();
        assert_eq!(skipped.len(), 1);
        assert!(skipped[0].0.starts_with("01-the-watcher.md: Who does what"));
        assert_eq!(back.chapters[0].steps.len(), 9);
        let (back, _) = read(&files[..1]).unwrap();
        assert!(!back.chapters[0].is_written());
        assert!(
            read(&[TutorialFile {
                name: "README.md".into(),
                text: "---\nigrasp: quiz\n---\n# q\n".into()
            }])
            .is_err()
        );
        assert!(read_chapter("# no front matter\n").is_err());
        // Links point at the root from the tutorial's folder.
        assert!(files[0].text.contains("igrasp: tutorial"));
        assert!(
            write(&t, "")[1]
                .text
                .contains("](src/index/watcher.rs#L2-L6)")
        );
        assert!(
            write(&t, "a/b")[1]
                .text
                .contains("](../../src/index/watcher.rs#L2-L6)")
        );
    }

    #[test]
    fn a_fence_inside_a_block_is_escaped_and_headings_in_bodies_survive() {
        let mut t = sample();
        if let Step::TryIt(s) = &mut t.chapters[0].steps[8] {
            s.instruction = "Run:\n\n```sh\nnpm test\n```\n\nThen look.".into();
        }
        if let Step::Explain(s) = &mut t.chapters[0].steps[0] {
            s.body = "## A heading the model wrote\n\nStill one step of Orbit's watcher.".into();
        }
        if let Step::Diagram(s) = &mut t.chapters[0].steps[3] {
            s.mermaid = "flowchart LR\n  A[\"x ``` y\"] --> B".into();
        }
        normalize(&mut t);
        let files = write(&t, "docs/tutorials/x");
        assert!(files[1].text.contains("````igrasp-try-it\n"));
        let (back, skipped) = read(&files).unwrap();
        assert_eq!(skipped, vec![]);
        assert_eq!(back, t);
        assert_eq!(
            chapter_file_name(2, "Build, Run & Ship!"),
            "03-build-run-ship.md"
        );
    }
}
