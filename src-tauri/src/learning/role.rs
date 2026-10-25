//! Who takes a quiz (or reads a tutorial): the role the player chose or typed, read as a family
//! of crafts. The family decides the audience of the prompt (how much code, what to focus on);
//! the wizard reads the same family to offer the kinds of quiz and the subjects that fit (the
//! rules exist twice, here and in `quizRoles.ts`, and must agree on
//! `src/test/fixtures/quiz/roles.json`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RoleFamily {
    /// Writes code for a living: programmers, engineers, contributors, maintainers.
    Developer,
    /// Finds how things break: testers, QA engineers.
    Qa,
    /// Artists, animators, modelers, VFX.
    Art,
    /// Sound designers, composers, audio engineers.
    Audio,
    /// Level designers.
    Level,
    /// Game, UX and UI designers.
    Design,
    /// Producers, product and project managers, leads who do not code.
    Production,
    /// Technical writers, narrative designers.
    Writing,
    /// A role the app does not recognise (a new hire, a reviewer): no assumption.
    General,
}

/// The family of a role, by its words. The order matters: a QA engineer is QA, a lead artist is
/// an artist, a tech lead is a developer, an engineering manager is production.
pub fn family(role: &str) -> RoleFamily {
    let r = role.to_lowercase();
    let words: Vec<&str> = r.split(|c: char| !c.is_alphanumeric()).collect();
    let has = |stems: &[&str]| stems.iter().any(|s| r.contains(s));
    let word = |ws: &[&str]| ws.iter().any(|w| words.contains(w));
    if word(&["qa"]) || has(&["test", "quality"]) {
        RoleFamily::Qa
    } else if has(&["writer", "narrative", "documentation"]) {
        RoleFamily::Writing
    } else if has(&["artist", "animator", "modeler", "modeller", "illustrat"]) || word(&["vfx"]) {
        RoleFamily::Art
    } else if has(&["sound", "audio", "music", "composer"]) {
        RoleFamily::Audio
    } else if has(&["level design", "level build", "world build"]) {
        RoleFamily::Level
    } else if has(&["produc", "manager", "director", "owner", "scrum"]) || word(&["pm", "po"]) {
        RoleFamily::Production
    } else if has(&[
        "develop",
        "program",
        "engineer",
        "coder",
        "contributor",
        "maintainer",
        "devops",
        "architect",
        "tech lead",
        "scientist",
    ]) || word(&["sre"])
    {
        RoleFamily::Developer
    } else if has(&["design"]) || word(&["ux", "ui"]) {
        RoleFamily::Design
    } else if has(&["lead"]) {
        RoleFamily::Production
    } else {
        RoleFamily::General
    }
}

/// What a family cares about most, for the prompt.
pub fn focus(family: RoleFamily) -> Option<&'static str> {
    Some(match family {
        RoleFamily::Art => {
            "how their assets get into the project and come alive: scenes and prefabs, sprites and textures, animations and their names, materials and shaders, import settings and naming conventions, and what in the project drives them"
        }
        RoleFamily::Audio => {
            "how sound gets into the project: audio files and buses, what triggers each sound or music, and where volumes and mixing are set"
        }
        RoleFamily::Level => {
            "how levels are built and wired: the scenes and tiles, spawn points, triggers and collectibles, camera limits, and the values a level can tune"
        }
        RoleFamily::Design => {
            "the rules and the experience: what the user or player can do, the values that tune it (speeds, timers, limits), the screens and their flow, and where each one is defined"
        }
        RoleFamily::Production => {
            "how the project is organised and shipped: its main parts and who depends on what, the build, test and release pipeline, the risky or complex areas, and the decisions that constrain the roadmap"
        }
        RoleFamily::Qa => {
            "how the project behaves and can break: the expected behaviour and edge cases, the existing tests and what they cover, and how to reproduce and isolate a problem"
        }
        RoleFamily::Writing => {
            "where the project's words and stories live and how they are shown: texts, dialogues, localisation files, and the documentation and its conventions"
        }
        RoleFamily::Developer | RoleFamily::General => return None,
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    struct Case {
        role: String,
        family: RoleFamily,
    }

    /// The same cases as `quizRoles.test.ts`.
    #[test]
    fn roles_fall_in_the_families_of_the_shared_fixture() {
        let path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/test/fixtures/quiz/roles.json");
        let cases: Vec<Case> =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert!(cases.len() > 20);
        for c in cases {
            assert_eq!(family(&c.role), c.family, "{}", c.role);
        }
    }
}
