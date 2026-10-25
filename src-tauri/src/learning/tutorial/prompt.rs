//! The tutorial prompts: the outline (the first attempt of a generation, with the project, the
//! audience, the familiarity level, the domain gap and the grounding rules), a chapter (a
//! continuation of the outline's conversation, or a fresh prompt with the same preamble), and
//! the repair prompts of the validator. Owned by the app, provider-neutral.

use super::schema::Chapter;
use super::{Familiarity, Length, TutorialInput};
use crate::learning::corpus::profile_block;
use crate::learning::hoot::HOOT_TONE;
use crate::learning::role::{RoleFamily, family, focus};
use crate::profile::ProjectProfile;

/// Everything the prompts are made of.
pub struct PromptInput<'a> {
    pub profile: &'a ProjectProfile,
    pub input: &'a TutorialInput,
    pub corpus_map: &'a str,
    pub anchor_files: &'a str,
    pub agent_files: &'a str,
}

fn article(role: &str) -> &'static str {
    if role.starts_with(['A', 'E', 'I', 'O', 'U', 'a', 'e', 'i', 'o', 'u']) {
        "An"
    } else {
        "A"
    }
}

/// Who reads the tutorial: developers by default (the Audience rule), else the role's craft.
fn audience_block(input: &TutorialInput) -> String {
    let gap = input.domain_gap.as_deref().map_or_else(
        || "none stated".to_owned(),
        |g| format!("they say: \"{g}\""),
    );
    let developers = format!(
        "They know how to program and how to use common tooling, but they may be new to this project, or new to a domain it uses ({gap}). Never explain programming basics (functions, variables, loops, git, package managers, what a framework is). Talk developer to developer: precise, concise, no hand-holding. Respect their expertise."
    );
    let Some(r) = input.role.as_deref() else {
        return format!("Developers. {developers}");
    };
    let a = article(r);
    let fam = family(r);
    let focus = focus(fam).map_or_else(String::new, |f| {
        format!(" Focus on what matters to their work: {f}.")
    });
    match fam {
        RoleFamily::Developer => format!(
            "{a} {r} on this project. {developers} Favour what they need to know to work on this project."
        ),
        RoleFamily::Qa => format!(
            "{a} {r} on this project (new to a domain: {gap}). They read code and tests when they need to, but their craft is finding how things break: favour behaviour, edge cases, risks and tests over implementation details.{focus}"
        ),
        _ => format!(
            "{a} {r} on this project, who may not read code every day (new to a domain: {gap}). Teach what they need to understand about how this project is made and how their own work fits into it; name code concepts in plain words, but every step still cites the files that prove it.{focus}"
        ),
    }
}

/// What the familiarity level changes.
fn familiarity_block(f: Familiarity) -> &'static str {
    match f {
        Familiarity::NewHere => {
            "Familiarity: new here. An onboarding: start from what this project is and how its parts fit, name the places (folders, modules, entry points) before the details, and build up. Do not assume they read anything of this project yet."
        }
        Familiarity::Contributing => {
            "Familiarity: already contributing. Skip what the README says; go to how things are done here: the flows, the conventions, the places a change goes, the tests that cover it, the traps."
        }
        Familiarity::Maintainer => {
            "Familiarity: deep dive for maintainers. Invariants, trade-offs, failure modes, concurrency and ordering, what the decisions cost, what would break if a part changed. Precise and dense."
        }
    }
}

/// How a domain gap is taught: through this project only.
fn gap_block(input: &TutorialInput) -> Option<String> {
    let gap = input.domain_gap.as_deref()?;
    Some(format!(
        "Domain gap: the reader says \"{gap}\". Teach that domain THROUGH this project's own usage of it: a concept appears only where this project uses it, as a conceptBridge step (the concept in one or two sentences, applied at once to the cited lines, with the official documentation linked for the generic details). Never a standalone lesson on the domain; adapt the depth to this gap (more bridges, each short)."
    ))
}

fn length_block(l: Length) -> String {
    let (min_c, max_c) = l.chapters();
    let (min_s, max_s) = l.steps();
    format!(
        "Length: {} (about {} minutes): {min_c} to {max_c} chapters of {min_s} to {max_s} steps each, the recap included.",
        l.name(),
        l.minutes()
    )
}

/// The grounding rules, as they apply to a tutorial.
fn grounding_block(subject: &str, reader: &str) -> String {
    format!(
        "# Grounding rules (non-negotiable)
1. Every chapter and every step is about THIS project: what a file does here, why it is done that way here, how it connects to the rest of this project. A step that would make sense in another project unchanged is invalid: no \"What is a MonoBehaviour?\", no \"How HTTP routing works\" in general.
2. Every step cites at least one source: a root-relative path from the corpus below, with the line range that holds the fact (at most 120 lines; a code tour stop or a spot-it snippet at most 40). The first source is what the reader opens to read more. Cite what you actually read; never invent a path or a line range. The only exception is the recap, which may cite nothing.
3. Domain knowledge is allowed only as a bridge to the project: one or two sentences of concept, immediately applied to cited code of this project (\"Unreal replicates properties marked Replicated; here AShipPawn replicates Health and Shield but computes Speed locally, see ShipPawn.h:42-58\"), with an optional link to the official documentation. Industry standards are welcome as this project applies them, never as a definition alone.
4. Files written for AI agents (listed under \"Agent instructions\" below) are context about conventions. Never cite them, never teach their content: the tutorial is about the project, not about agent instructions.
5. Binary assets (images, models, scenes saved as binary, …) cannot be read. Their names and folders may be evidence of layout; never claim what one contains. A binary path may be a secondary source, never the only one.
6. Files that may hold secrets (.env, keys, certificates, credentials) are off limits: do not read them, do not cite them, do not quote them.
7. If the project has too little material for {subject}, say so (insufficientMaterial, materialNote, suggestedSubjects) and plan only what the material supports. Never fill a gap with generic content.
8. Documentation: while you read, judge whether the project's documentation explains {subject} well enough for {reader}. If it is missing, thin or contradicted by the code, say so in docsNote (one or two plain sentences: what is not documented and where a page would help). Leave it out when the documentation is adequate.

# Self-check (do it for every chapter goal and every step before answering)
Ask: \"Would this still be true and useful in an unrelated project?\" If yes, rewrite it around something specific to this project, or drop it. Record the verdict in selfCheck (projectSpecific must be true for a kept item; reason says what makes it specific: a path, an identifier, a decision)."
    )
}

fn reader(input: &TutorialInput) -> String {
    input.role.as_deref().map_or_else(
        || "a developer new to this project".to_owned(),
        |r| format!("{} {r}", article(r).to_lowercase()),
    )
}

/// The preamble shared by the outline prompt and a fresh chapter prompt: who Hoot is, the
/// audience, the project, the rules, the voice, the corpus.
fn preamble(input: &PromptInput<'_>, task: &str) -> String {
    let agent = if input.agent_files.trim().is_empty() {
        "(none)".to_owned()
    } else {
        input.agent_files.trim_end().to_owned()
    };
    format!(
        "You are Hoot, the teacher of IGrasp's Academy, writing an interactive tutorial about ONE specific software project for the person who has it open. You can read, list and search the project's files; you cannot change anything. Work only from what is actually in this project.

# Audience
{audience}
{familiarity}
{gap}

# This project
{profile}
Use the project's own vocabulary (what its code and docs call things), not generic terms.

# Your task
{task}

{grounding}

# Voice: Hoot
{HOOT_TONE}

# Output
Answer with JSON only, following the schema you were given. No prose outside the JSON.

# Corpus (root-relative paths; sizes; language)
{map}

# Anchor files (with line numbers)
{anchors}

# Agent instructions (context only, never a source)
{agent}
",
        audience = audience_block(input.input),
        familiarity = familiarity_block(input.input.familiarity),
        gap = gap_block(input.input).unwrap_or_default(),
        profile = profile_block(input.profile),
        grounding = grounding_block(&format!("\"{}\"", input.input.subject), &reader(input.input)),
        map = input.corpus_map,
        anchors = input.anchor_files.trim_end(),
    )
}

/// The outline task.
fn outline_task(input: &PromptInput<'_>) -> String {
    let name = &input.profile.name;
    format!(
        "Plan a tutorial about \"{subject}\" in {name} (interpret it in this project's terms; if the project has nothing about it, say so). {length}
First read: open the anchor files, the files the subject points at, and whatever you need to see how this project really does it (the anchor files are only a starting point; at least half of the chapters are built on code, configuration, build or test files that you open with your tools, not only on documentation).
Then write the outline: a title that names {name} or one of its parts; an intro of two or three sentences saying what the reader will be able to do afterwards, in this project's terms; and the chapters in learning order, each with an id (c1, c2, …), a title, a goal (what the reader can do or explain afterwards about this project, naming its files or identifiers), the minutes it takes, keySources (root-relative paths you opened that the chapter will be built on) and its selfCheck. One chapter is one idea of this project, followed end to end; the chapters together cover the subject without repeating each other.",
        subject = input.input.subject,
        length = length_block(input.input.length),
    )
}

/// The prompt of the outline (the first attempt of a generation).
pub fn outline_prompt(input: &PromptInput<'_>) -> String {
    preamble(input, &outline_task(input))
}

const STEP_TYPES: &str = "Step types (every step cites what it teaches; mix them so the chapter stays interactive, at most two explain cards in a row):
- explain: a short card on how this project does something (2 to 6 sentences of markdown), naming files and identifiers, the why when the project shows it (a comment, a doc, a test).
- conceptBridge: only when the reader lacks the concept (the domain gap, or a concept this project leans on): the concept in one or two sentences, then applied to the cited lines right away, docsUrl to the official documentation.
- codeTour: 2 to 6 stops in real files (each at most 40 lines), in reading order, each with an annotation of what those lines do here; the reader walks them like slides.
- diagram: Mermaid (flowchart, sequenceDiagram, classDiagram or stateDiagram-v2) whose nodes are this project's modules, files, types or messages, with a caption; cite the files it draws.
- putInOrder: 3 to 7 steps of a flow of this project, given in the right order (the app shuffles them), with an explanation.
- match: 3 to 6 pairs (this project's modules and responsibilities, or its terms and what they mean here), with an explanation.
- spotIt: a snippet of a real file (at most 40 lines) and the one line to click that does the given thing (answerLine is the absolute line number), with an explanation.
- quickCheck: one quiz question (multipleChoice with 3 to 5 choices alike in length and tone, exactly one right, or trueFalse with choices exactly [\"True\", \"False\"]), a hint that points where to look without the answer, and a gentle explanation. Never refer to a choice by its position.
- tryIt: something to do in this project (a command from its scripts or tooling, a small change to try, something to open in the engine, the IDE or the browser), with what to expect; the app never runs it.
- recap: exactly three takeaways, each naming something of this project; always the last step.";

/// The chapter task, for a continuation of the outline's conversation (the project, the corpus
/// and the rules are already in it).
pub fn chapter_prompt(
    chapter: &Chapter,
    number: usize,
    of: usize,
    input: &TutorialInput,
) -> String {
    let (min_s, max_s) = input.length.steps();
    format!(
        "Thank you, the outline is accepted. Now write chapter {number} of {of}: \"{title}\" (id {id}).
Goal: {goal}
Write {min_s} to {max_s} steps that reach this goal, in learning order, the recap last. Open the files again as needed and cite the exact lines you read (the ranges are checked against the files). {familiarity}
{types}
hootIntro introduces the chapter in one sentence, in this project's terms. Set docsNote only if the documentation lacks something for this chapter. The grounding rules, the self-check, Hoot's voice and the JSON-only output are the same as before; use the chapter schema you were given.",
        title = chapter.title,
        id = chapter.id,
        goal = chapter.goal,
        familiarity = familiarity_block(input.familiarity),
        types = STEP_TYPES,
    )
}

/// The chapter task as a fresh prompt (no conversation to continue): the preamble, the outline
/// for context, then the chapter.
pub fn chapter_prompt_fresh(
    input: &PromptInput<'_>,
    outline: &[Chapter],
    chapter: &Chapter,
    number: usize,
) -> String {
    let outline_text: Vec<String> = outline
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{}. {} ({}): {}", i + 1, c.title, c.id, c.goal))
        .collect();
    let (min_s, max_s) = input.input.length.steps();
    let task = format!(
        "The tutorial \"{subject}\" in {name} has this outline (already accepted):
{outline}
Write chapter {number} of {of}: \"{title}\" (id {id}).
Goal: {goal}
Write {min_s} to {max_s} steps that reach this goal, in learning order, the recap last. Open the files you need and cite the exact lines you read (the ranges are checked against the files).
{types}
hootIntro introduces the chapter in one sentence, in this project's terms. Set docsNote only if the documentation lacks something for this chapter.",
        subject = input.input.subject,
        name = input.profile.name,
        outline = outline_text.join("\n"),
        of = outline.len(),
        title = chapter.title,
        id = chapter.id,
        goal = chapter.goal,
        types = STEP_TYPES,
    );
    preamble(input, &task)
}

/// The repair prompt of an outline whose chapters did not all pass.
pub fn outline_repair_prompt(rejected: &[(String, String)], shape: Option<&str>) -> String {
    let mut lines = vec!["Thank you. IGrasp checked your outline against the project.".to_owned()];
    match shape {
        Some(s) => lines.push(format!(
            "Your answer could not be read as the outline JSON ({s}). Return the complete JSON again, following the schema."
        )),
        None => {
            lines.push(format!(
                "Rewrite the following {} chapters so they respect the rules (or drop them if the project has no material for them), and return the complete outline again with the other chapters unchanged (same ids):",
                rejected.len()
            ));
            for (id, reason) in rejected {
                lines.push(format!("- {id}: {reason}"));
            }
        }
    }
    lines.push("Same schema, JSON only.".to_owned());
    lines.join("\n")
}

/// The repair prompt of a chapter whose steps did not all pass.
pub fn chapter_repair_prompt(
    kept: usize,
    rejected: &[(String, String)],
    short_by: usize,
    shape: Option<&str>,
) -> String {
    let mut lines = vec![format!(
        "Thank you. IGrasp checked your chapter against the project. {kept} steps were accepted."
    )];
    if let Some(s) = shape {
        lines.push(format!(
            "Your answer could not be read as the chapter JSON ({s}). Return the complete JSON again, following the schema."
        ));
    } else if rejected.is_empty() && short_by > 0 {
        lines.push(format!(
            "Add {short_by} new steps that respect the rules, and return the complete chapter again with the accepted steps unchanged, the recap last."
        ));
    } else {
        lines.push(format!(
            "Replace the following {} steps with new ones that respect the rules, and return the complete chapter again with the accepted steps unchanged, the recap last:",
            rejected.len()
        ));
        for (id, reason) in rejected {
            lines.push(format!("- {id}: {reason}"));
        }
    }
    lines.push("Same schema, JSON only.".to_owned());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::summary::DocsFacts;
    use crate::profile::{Confidence, Detected, ProfileCorrections, ProjectKind};

    fn profile() -> ProjectProfile {
        ProjectProfile {
            name: "demo".into(),
            kinds: vec![Detected {
                value: ProjectKind::Cli,
                confidence: Confidence::High,
                evidence: vec!["package.json".into()],
            }],
            engines: vec![],
            frameworks: vec![],
            languages: vec![],
            dependencies: vec!["vitest".into()],
            build: vec![],
            tests: vec![],
            ci: vec![],
            modules: vec![],
            docs: DocsFacts::default(),
            repository: true,
            summary: "demo: a command-line tool in TypeScript.".into(),
            corrections: ProfileCorrections::default(),
            files_seen: 3,
            truncated: false,
            built_ms: 1,
        }
    }

    fn chapter() -> Chapter {
        Chapter {
            id: "c2".into(),
            title: "The build".into(),
            goal: "Explain how demo's Makefile builds the CLI.".into(),
            minutes: 5,
            hoot_intro: None,
            steps: Vec::new(),
        }
    }

    #[test]
    fn the_outline_prompt_carries_audience_familiarity_gap_length_and_rules() {
        let p = profile();
        let input = TutorialInput {
            subject: "How demo is built".into(),
            familiarity: Familiarity::Contributing,
            domain_gap: Some("I'm new to make".into()),
            length: Length::Quick,
            role: None,
        };
        let text = outline_prompt(&PromptInput {
            profile: &p,
            input: &input,
            corpus_map: "Makefile (20 B)",
            anchor_files: "## Makefile (2 lines)\n  1 | build:\n",
            agent_files: "",
        });
        assert!(text.contains("# Audience\nDevelopers. They know how to program"));
        assert!(text.contains("Familiarity: already contributing."));
        assert!(text.contains("Domain gap: the reader says \"I'm new to make\""));
        assert!(text.contains("Length: quick (about 5 minutes): 2 to 3 chapters of 4 to 6 steps"));
        assert!(text.contains("Plan a tutorial about \"How demo is built\" in demo"));
        assert!(text.contains("# Grounding rules (non-negotiable)"));
        assert!(text.contains("The only exception is the recap"));
        assert!(text.contains("# Agent instructions (context only, never a source)\n(none)"));
        let artist = outline_prompt(&PromptInput {
            profile: &p,
            input: &TutorialInput {
                role: Some("Artist".into()),
                ..input.clone()
            },
            corpus_map: "",
            anchor_files: "",
            agent_files: "",
        });
        assert!(artist.contains("An Artist on this project, who may not read code every day"));
        assert!(artist.contains("well enough for an Artist"));
    }

    #[test]
    fn the_chapter_prompts_name_the_chapter_and_every_step_type() {
        let input = TutorialInput::default();
        let text = chapter_prompt(&chapter(), 2, 4, &input);
        assert!(text.starts_with(
            "Thank you, the outline is accepted. Now write chapter 2 of 4: \"The build\" (id c2)."
        ));
        assert!(text.contains("Write 5 to 8 steps"));
        for t in [
            "explain",
            "conceptBridge",
            "codeTour",
            "diagram",
            "putInOrder",
            "match",
            "spotIt",
            "quickCheck",
            "tryIt",
            "recap",
        ] {
            assert!(text.contains(&format!("- {t}:")), "{t}");
        }
        let p = profile();
        let fresh = chapter_prompt_fresh(
            &PromptInput {
                profile: &p,
                input: &input,
                corpus_map: "",
                anchor_files: "",
                agent_files: "",
            },
            &[chapter()],
            &chapter(),
            1,
        );
        assert!(fresh.contains("has this outline (already accepted):\n1. The build (c2)"));
        assert!(fresh.contains("# Grounding rules"));
    }

    #[test]
    fn repair_prompts_list_the_reasons() {
        let r = outline_repair_prompt(&[("c2".into(), "generic goal".into())], None);
        assert!(r.contains("- c2: generic goal"));
        assert!(outline_repair_prompt(&[], Some("missing field")).contains("could not be read"));
        let c = chapter_repair_prompt(4, &[("s3".into(), "cites nothing".into())], 0, None);
        assert!(c.starts_with(
            "Thank you. IGrasp checked your chapter against the project. 4 steps were accepted."
        ));
        assert!(c.contains("- s3: cites nothing"));
        assert!(chapter_repair_prompt(2, &[], 3, None).contains("Add 3 new steps"));
    }

    #[test]
    fn the_prompts_name_no_provider() {
        let p = profile();
        let input = TutorialInput::default();
        let pi = PromptInput {
            profile: &p,
            input: &input,
            corpus_map: "",
            anchor_files: "",
            agent_files: "",
        };
        let text = (outline_prompt(&pi) + &chapter_prompt(&chapter(), 1, 1, &input)).to_lowercase();
        for name in [
            "claude",
            "anthropic",
            "gpt",
            "openai",
            "gemini",
            "codex",
            "ollama",
        ] {
            assert!(!text.contains(name), "{name}");
        }
    }
}
