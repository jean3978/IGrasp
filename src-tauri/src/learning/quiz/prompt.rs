//! The quiz generation prompt and the repair prompt, assembled from fixed blocks (owned by the
//! app, provider-neutral: every provider receives the same instructions) and the project's
//! facts. A snapshot test keeps the text stable; a neutrality test checks it names no provider.

use super::difficulty::plan_text;
use super::{QuizCategory, QuizExclusion, QuizRound};
use crate::learning::corpus::{SourceScope, profile_block};
use crate::learning::hoot::HOOT_TONE;
use crate::learning::subjects::Subject;
use crate::profile::ProjectProfile;

/// Everything the generation prompt is made of.
pub struct PromptInput<'a> {
    pub profile: &'a ProjectProfile,
    pub subject: Option<&'a Subject>,
    pub custom_subject: Option<&'a str>,
    pub category: Option<QuizCategory>,
    pub role: Option<&'a str>,
    pub count: u32,
    pub plan: [u32; 5],
    pub scope: &'a SourceScope,
    pub round: Option<QuizRound>,
    pub exclude: &'a [QuizExclusion],
    pub domain_gap: Option<&'a str>,
    pub corpus_map: &'a str,
    pub anchor_files: &'a str,
    pub agent_files: &'a str,
}

/// What the quiz is about, as the prompt names it.
pub fn subject_phrase(input: &PromptInput<'_>) -> String {
    let name = &input.profile.name;
    match (input.subject, input.custom_subject, input.scope) {
        (Some(s), _, _) => format!("{name}'s \"{}\" ({})", s.title, s.focus),
        (None, _, SourceScope::Paths { paths }) => {
            format!("the code of {name} in {}", paths.join(", "))
        }
        (None, Some(t), _) => {
            let what = match input.category {
                Some(QuizCategory::Feature) => "a feature of the project",
                Some(QuizCategory::Global) => "a concept across the project",
                _ => "a subject",
            };
            format!(
                "\"{t}\" in {name} ({what} that the player typed: interpret it in this project's terms; if the project has nothing about it, say so)"
            )
        }
        (None, None, _) => format!(
            "{name} as a whole (no specific subject): what it does, its architecture and main modules, how its parts interact, how it is built and tested, and the decisions behind it"
        ),
    }
}

/// Whether a role reads and writes code for a living (the default audience when none is given).
fn codes(role: &str) -> bool {
    let r = role.to_lowercase();
    [
        "develop",
        "program",
        "engineer",
        "coder",
        "contributor",
        "maintainer",
        "devops",
        "sre",
        "architect",
        "tech lead",
        "scientist",
    ]
    .iter()
    .any(|w| r.contains(w))
}

/// What a role cares about most, for the roles that do not write code every day.
fn role_focus(role: &str) -> Option<&'static str> {
    let r = role.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| r.contains(w));
    Some(
        if has(&["artist", "animator", "modeler", "illustrat", "vfx"]) {
            "how their assets get into the project and come alive: scenes and prefabs, sprites and textures, animations and their names, materials and shaders, import settings, and the code that drives them"
        } else if has(&["sound", "audio", "music", "composer"]) {
            "how sound gets into the project: audio files and buses, what triggers each sound or music, and where volumes and mixing are set"
        } else if has(&["level"]) {
            "how levels are built and wired: the scenes and tiles, spawn points, triggers and collectibles, camera limits, and the values a level can tune"
        } else if has(&["design", "ux", "ui"]) {
            "the rules and the experience: what the user or player can do, the values that tune it (speeds, timers, limits), the screens and their flow, and where each one is defined"
        } else if has(&["produc", "manager", "owner", "lead"]) {
            "how the project is organised and shipped: its main parts and who depends on what, the build, test and release pipeline, the risky or complex areas, and the decisions that constrain the roadmap"
        } else if has(&["qa", "test"]) {
            "how the project behaves and can break: the expected behaviour and edge cases, the existing tests and what they cover, and how to reproduce and isolate a problem"
        } else if has(&["writer", "narrative", "document"]) {
            "where the project's words and stories live and how they are shown: texts, dialogues, localisation files, and the documentation and its conventions"
        } else {
            return None;
        },
    )
}

/// Who takes the quiz: developers by default, else the role they gave, with the depth of code
/// detail that role needs. The grounding rules stay the same for every role.
fn audience_block(role: Option<&str>, gap: &str) -> String {
    let developers = format!(
        "They know how to program and how to use common tooling, but they may be new to this project, or new to a domain it uses ({gap}). Never explain programming basics (functions, variables, loops, git, package managers, what a framework is). Talk developer to developer: precise, concise, no hand-holding. Respect their expertise."
    );
    let a = |r: &str| {
        if r.starts_with(['A', 'E', 'I', 'O', 'U', 'a', 'e', 'i', 'o', 'u']) {
            "An"
        } else {
            "A"
        }
    };
    match role {
        None => format!("Developers. {developers}"),
        Some(r) if codes(r) => format!(
            "{} {r} on this project. {developers} Favour what they need to know to work on this project.",
            a(r)
        ),
        Some(r) => format!(
            "{} {r} on this project, who may not read code every day (new to a domain: {gap}). Ask what they need to understand about how this project is made and how their own work fits into it: the structure, the behaviour, the pipelines and tools that touch their work, the conventions and the decisions. Prefer behaviour and structure to code details, and name code concepts in plain words when you need them, but every question is still about this project and cites the files that prove its answer. Do not quiz them on syntax. Respect their expertise in their own craft.{}",
            a(r),
            role_focus(r).map_or_else(String::new, |f| format!(
                " Focus on what matters to their work: {f}."
            ))
        ),
    }
}

/// What kind of questions to write: understanding by default, a precise code check for paths.
fn style_block(scope: &SourceScope) -> &'static str {
    match scope {
        SourceScope::Paths { .. } => {
            "Question style: a code check. The developer wants to be sure they understand this code precisely, for example before submitting it for review. Ask detailed questions about the code in these files: control flow and edge cases, early returns and error paths, invariants and assumptions, what a function returns or does in a given situation, what a change would break, how the code interacts with its callers. Precise line-level questions are welcome here."
        }
        _ => {
            "Question style: test understanding, not memory. Ask what a concept or feature is in this project, how it is implemented and why that way, which parts collaborate and how data or control flows between them, what a design choice buys and what it costs, what would happen if something changed. Do not write trivia that only checks whether someone remembers one line: exact constant values, whether a function returns early, the name of a variable or parameter, the order of arguments, a count of lines or items. The explanation teaches the concept as this project implements it; the sources point to where it is implemented."
        }
    }
}

fn scope_block(scope: &SourceScope) -> String {
    match scope {
        SourceScope::WholeProject => "Sources: the whole project (code, configuration, build scripts, tests and documentation). Ask about how this project is made, not only about what its documentation says: at least half of the questions cite code, configuration, build or test files that you open with your tools (the anchor files below are only a starting point).".to_owned(),
        SourceScope::DocumentationOnly => "Sources are limited to the project's documentation listed below; cite documentation files only. The code is not available in this quiz; questions are about what the documentation says about this project and how its parts fit.".to_owned(),
        SourceScope::Paths { paths } => format!(
            "Sources are limited to these files; cite them only: {}.",
            paths.join(", ")
        ),
    }
}

fn round_block(round: Option<QuizRound>) -> Option<String> {
    let r = round?;
    Some(format!(
        "This is round {} of {} of a quiz you write while the developer plays. They answered {} of {} right so far and are now at level {}: write this round at that level. Do not repeat the questions of the previous rounds of this conversation.",
        r.number, r.of, r.right, r.asked, r.level
    ))
}

fn exclusions_block(exclude: &[QuizExclusion]) -> Option<String> {
    if exclude.is_empty() {
        return None;
    }
    let items: Vec<String> = exclude
        .iter()
        .map(|e| match &e.source {
            Some(s) => format!("- {} ({s})", e.question),
            None => format!("- {}", e.question),
        })
        .collect();
    Some(format!(
        "The developer already answered these questions; do not ask them again, nor the same fact from the same lines:\n{}",
        items.join("\n")
    ))
}

/// The prompt of a generation (the first attempt).
pub fn generation_prompt(input: &PromptInput<'_>) -> String {
    let subject = subject_phrase(input);
    let gap = input.domain_gap.map_or_else(
        || "none stated".to_owned(),
        |g| format!("they say: \"{g}\""),
    );
    let mut task = vec![
        format!(
            "Write {} questions about {subject}, with these difficulties: {}",
            input.count,
            plan_text(&input.plan)
        ),
        "(1 = a newcomer who read the README can answer it; 3 = you must have read the relevant code; 5 = you must understand how several parts of this project interact).".to_owned(),
        scope_block(input.scope),
        style_block(input.scope).to_owned(),
    ];
    task.extend(round_block(input.round));
    task.extend(exclusions_block(input.exclude));
    task.push("Kinds: multiple choice (3 to 5 distinct choices, exactly one correct, the wrong ones plausible for someone who skimmed this project) and true/false (choices exactly [\"True\", \"False\"]). Mix them, at most one third true/false. Number the questions q1, q2, …".to_owned());
    let agent = if input.agent_files.trim().is_empty() {
        "(none)".to_owned()
    } else {
        input.agent_files.trim_end().to_owned()
    };
    format!(
        "You are Hoot, the quiz master of IGrasp, writing a quiz about ONE specific software project for the developer who has it open. You can read, list and search the project's files; you cannot change anything. Work only from what is actually in this project.

# Audience
{audience}

# This project
{profile}
Use the project's own vocabulary (what its code and docs call things), not generic terms.

# Your task
{task}

# Grounding rules (non-negotiable)
1. Every question is about THIS project: what a file does here, why it is done that way here, how it connects to the rest of this project. A question that would make sense unchanged in another project is invalid: no \"What does HTTP 404 mean?\", no \"What is a MonoBehaviour?\".
2. Every question cites at least one source: a root-relative path from the corpus below, with the line range that holds the fact (at most 120 lines) for text files. The first source is what the developer opens to read more. Cite what you actually read; never invent a path or a line range.
3. Domain knowledge appears only as a bridge: one or two sentences of concept, immediately applied to this project's code (\"Unreal replicates properties marked Replicated; here AShipPawn replicates Health and Shield but computes Speed locally, see ShipPawn.h:42-58\").
4. Files written for AI agents (listed under \"Agent instructions\" below) are context about conventions. Never cite them, never ask about their content: the quiz is about the project, not about agent instructions.
5. Binary assets (images, models, scenes saved as binary, …) cannot be read. Their names and folders may be evidence of layout; never claim what one contains. A binary path may be a secondary source, never the only one.
6. Files that may hold secrets (.env, keys, certificates, credentials) are off limits: do not read them, do not cite them, do not quote them.
7. If the project has too little material for {subject}, say so: set insufficientMaterial to true, explain in materialNote, suggest better subjects in suggestedSubjects, and write only the questions the material supports. Never fill the gap with generic content.

# Self-check (do it for every question before answering)
Ask: \"Would this question, its answer and its explanation still be true and useful in an unrelated project?\" If yes, rewrite it around something specific to this project, or drop it. Record the verdict in selfCheck (projectSpecific must be true for a kept question; reason says what makes it specific: a path, an identifier, a decision).
Also check: the question or the explanation names something of this project (a file, an identifier, a module); the hint does not contain the answer; the choices are distinct and none is \"all of the above\" or \"none of the above\"; the line range exists in the file you read.

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
        profile = profile_block(input.profile),
        audience = audience_block(input.role, &gap),
        task = task.join("\n"),
        map = input.corpus_map,
        anchors = input.anchor_files.trim_end(),
    )
}

/// The prompt of a generation that continues a conversation (an adaptive round, or more
/// questions): the project, the corpus and the rules are already in it.
pub fn continuation_prompt(input: &PromptInput<'_>) -> String {
    let subject = subject_phrase(input);
    let mut lines = Vec::new();
    lines.extend(round_block(input.round));
    lines.push(format!(
        "Write {} new questions about {subject}, with these difficulties: {}.",
        input.count,
        plan_text(&input.plan)
    ));
    lines.push(scope_block(input.scope));
    lines.push(style_block(input.scope).to_owned());
    lines.extend(exclusions_block(input.exclude));
    lines.push("Do not repeat any question of this conversation. The grounding rules, the self-check, Hoot's voice and the schema are the same as before: every question cites lines you actually read in this project. Number the questions q1, q2, … Answer with JSON only.".to_owned());
    lines.join("\n")
}

/// The prompt of a retry: the accepted questions stay, the rejected ones are replaced.
pub fn repair_prompt(
    kept: usize,
    rejected: &[(String, String)],
    missing: &[u32],
    short_by: usize,
) -> String {
    let mut lines = vec![format!(
        "Thank you. IGrasp checked your questions against the project. {kept} were accepted."
    )];
    if rejected.is_empty() && short_by > 0 {
        lines.push(format!(
            "Add {short_by} new questions that respect the rules, and return the complete JSON again with the accepted questions unchanged (same ids)."
        ));
    } else if rejected.is_empty() {
        lines.push(
            "Your answer could not be read as the quiz JSON. Return the complete JSON again, following the schema."
                .to_owned(),
        );
    } else {
        lines.push(format!(
            "Replace the following {} questions with new ones that respect the rules, and return the complete JSON again with the accepted questions unchanged (same ids):",
            rejected.len()
        ));
        for (id, reason) in rejected {
            lines.push(format!("- {id}: {reason}"));
        }
    }
    if !missing.is_empty() {
        let levels: Vec<String> = missing.iter().map(u32::to_string).collect();
        lines.push(format!(
            "The plan still needs at least one question of difficulty {}.",
            levels.join(", ")
        ));
    }
    lines.push("Same schema, JSON only.".to_owned());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::learning::subjects::Material;
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
            corrections: ProfileCorrections {
                notes: "Also a server.".into(),
                ..ProfileCorrections::default()
            },
            files_seen: 3,
            truncated: false,
            built_ms: 1,
        }
    }

    fn subject() -> Subject {
        Subject {
            id: "build".into(),
            group: crate::learning::subjects::SubjectGroup::Global,
            title: "How demo is built".into(),
            focus: "its scripts".into(),
            anchors: vec!["Makefile".into()],
            material: Material::Some,
            files: 2,
            bytes: 3000,
            has_docs: false,
        }
    }

    fn prompt(round: Option<QuizRound>, scope: &SourceScope, exclude: &[QuizExclusion]) -> String {
        let p = profile();
        let s = subject();
        generation_prompt(&PromptInput {
            profile: &p,
            subject: Some(&s),
            custom_subject: None,
            category: None,
            role: None,
            count: 5,
            plan: [1, 2, 1, 1, 0],
            scope,
            round,
            exclude,
            domain_gap: Some("I'm new to make"),
            corpus_map: "Makefile (20 B)\nsrc/ (1 files, 300 B)\n  src/main.ts (300 B, TypeScript)",
            anchor_files: "## Makefile (2 lines)\n  1 | build:\n  2 | \tnpm run build\n",
            agent_files: "## AGENTS.md (1 lines)\n  1 | Be brief.\n",
        })
    }

    /// The prompt of a fixed quiz, compared with `snapshots/generation.txt`. Run with
    /// `UPDATE_SNAPSHOTS=1` to write the snapshot again after a deliberate change.
    #[test]
    fn the_generation_prompt_snapshot() {
        let text = prompt(None, &SourceScope::WholeProject, &[]);
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/learning/quiz/snapshots/generation.txt");
        if std::env::var_os("UPDATE_SNAPSHOTS").is_some() {
            std::fs::write(&path, &text).unwrap();
        }
        let expected = std::fs::read_to_string(&path)
            .unwrap()
            .replace("\r\n", "\n");
        assert_eq!(text, expected);
    }

    #[test]
    fn a_typed_subject_and_a_code_check() {
        let p = profile();
        let base = |custom: Option<&'static str>, scope: &'static SourceScope| PromptInput {
            profile: &p,
            subject: None,
            custom_subject: custom,
            category: None,
            role: None,
            count: 5,
            plan: [1, 2, 1, 1, 0],
            scope,
            round: None,
            exclude: &[],
            domain_gap: None,
            corpus_map: "",
            anchor_files: "",
            agent_files: "",
        };
        static WHOLE: SourceScope = SourceScope::WholeProject;
        let typed = generation_prompt(&base(Some("How saving works"), &WHOLE));
        assert!(typed.contains("\"How saving works\" in demo (a subject that the player typed"));
        assert!(typed.contains("test understanding, not memory"));
        assert!(typed.contains("whether a function returns early"));
        // The kind of quiz tells what a typed subject is.
        let feature = generation_prompt(&PromptInput {
            category: Some(QuizCategory::Feature),
            ..base(Some("Fishing"), &WHOLE)
        });
        assert!(
            feature.contains("\"Fishing\" in demo (a feature of the project that the player typed")
        );
        // The role sets the audience: developers by default, a role's own depth otherwise.
        assert!(typed.contains("# Audience\nDevelopers. They know how to program"));
        let programmer = generation_prompt(&PromptInput {
            role: Some("Gameplay programmer"),
            ..base(None, &WHOLE)
        });
        assert!(
            programmer.contains("A Gameplay programmer on this project. They know how to program")
        );
        let artist = generation_prompt(&PromptInput {
            role: Some("Artist"),
            ..base(None, &WHOLE)
        });
        assert!(artist.contains("An Artist on this project, who may not read code every day"));
        assert!(artist.contains("cites the files that prove its answer"));
        assert!(artist.contains("Focus on what matters to their work: how their assets get into"));
        assert!(!artist.contains("Never explain programming basics"));
        static PATHS: std::sync::LazyLock<SourceScope> =
            std::sync::LazyLock::new(|| SourceScope::Paths {
                paths: vec!["src/save".into(), "src/main.ts".into()],
            });
        let check = generation_prompt(&base(None, &PATHS));
        assert!(check.contains("the code of demo in src/save, src/main.ts"));
        assert!(check.contains("Question style: a code check"));
        assert!(!check.contains("test understanding, not memory"));
    }

    #[test]
    fn the_prompt_names_no_provider() {
        let text = prompt(None, &SourceScope::WholeProject, &[]).to_lowercase()
            + &repair_prompt(1, &[("q2".into(), "generic".into())], &[4], 0).to_lowercase();
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

    #[test]
    fn scope_round_and_exclusion_blocks() {
        let docs = prompt(None, &SourceScope::DocumentationOnly, &[]);
        assert!(docs.contains("cite documentation files only. The code is not available"));
        let round = prompt(
            Some(QuizRound {
                number: 2,
                of: 2,
                asked: 5,
                right: 4,
                level: 3,
            }),
            &SourceScope::WholeProject,
            &[QuizExclusion {
                question: "Which file builds?".into(),
                source: Some("Makefile".into()),
            }],
        );
        assert!(round.contains("This is round 2 of 2"));
        assert!(round.contains("They answered 4 of 5 right so far and are now at level 3"));
        assert!(round.contains("- Which file builds? (Makefile)"));
        assert!(round.contains("The developer adds: Also a server."));
        assert!(round.contains("they say: \"I'm new to make\""));
    }

    #[test]
    fn repair_prompt_lists_reasons_and_missing_levels() {
        let text = repair_prompt(
            7,
            &[
                (
                    "q3".into(),
                    "cites CLAUDE.md, an agent instruction file".into(),
                ),
                (
                    "q5".into(),
                    "src/a.rs has 212 lines; lines 400-420 do not exist".into(),
                ),
            ],
            &[4],
            0,
        );
        assert!(text.starts_with(
            "Thank you. IGrasp checked your questions against the project. 7 were accepted."
        ));
        assert!(text.contains("Replace the following 2 questions"));
        assert!(text.contains("- q3: cites CLAUDE.md, an agent instruction file"));
        assert!(text.contains("at least one question of difficulty 4."));
        assert!(text.ends_with("Same schema, JSON only."));
        assert!(repair_prompt(0, &[], &[], 0).contains("could not be read as the quiz JSON"));
        assert!(repair_prompt(4, &[], &[], 6).contains("Add 6 new questions"));
    }
}
