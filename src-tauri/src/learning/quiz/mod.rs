//! The quiz generator: what the user chose (`QuizGenerationInput`), the app-owned schema and
//! prompt, the validator of the answers, and the composition of the one read-only request
//! `ai_start` sends. Provider-neutral: no provider name, flag or wire format here.

pub mod compose;
pub mod difficulty;
pub mod file;
pub mod prompt;
pub mod schema;
pub mod validate;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::corpus::SourceScope;

/// Questions per generation, at least and at most.
pub const MIN_COUNT: u32 = 3;
pub const MAX_COUNT: u32 = 30;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum QuizMode {
    /// One generation writes the whole quiz; the level changes the order of the questions.
    #[default]
    Fixed,
    /// Written in rounds while the player plays, each at the level reached, each round started
    /// by the player's click.
    Adaptive,
}

/// Where an adaptive quiz stands when its next round is asked.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuizRound {
    /// 1-based.
    pub number: u32,
    pub of: u32,
    /// Questions answered so far, and how many right.
    pub asked: u32,
    pub right: u32,
    /// The level reached (1–5).
    pub level: u32,
}

/// A question already asked, so a later generation does not repeat it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuizExclusion {
    pub question: String,
    /// The first source's path, when it had one.
    pub source: Option<String>,
}

/// What the user chose for a quiz generation. The frontend sends this; the backend writes the
/// prompt (the frontend never sends a prompt or a schema for a quiz).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct QuizGenerationInput {
    /// From `list_subjects`; `None` is "No specific subject".
    pub subject_id: Option<String>,
    /// A subject the developer typed ("How saving works"), when no proposed subject is chosen.
    pub custom_subject: Option<String>,
    /// Questions to write in this operation (a whole fixed quiz, or one adaptive round).
    pub count: u32,
    pub mode: QuizMode,
    /// Adaptive rounds after the first.
    pub round: Option<QuizRound>,
    /// The level the plan is centred on (2 for a new quiz; the level reached afterwards).
    pub start_level: u32,
    pub exclude: Vec<QuizExclusion>,
    pub scope: SourceScope,
    /// "I'm new to …" (optional, reused by the tutorials).
    pub domain_gap: Option<String>,
}

impl Default for QuizGenerationInput {
    fn default() -> Self {
        Self {
            subject_id: None,
            custom_subject: None,
            count: 10,
            mode: QuizMode::Fixed,
            round: None,
            start_level: 2,
            exclude: Vec::new(),
            scope: SourceScope::WholeProject,
            domain_gap: None,
        }
    }
}

impl QuizGenerationInput {
    /// Clamps the numbers into their ranges and trims the texts.
    pub fn normalized(mut self) -> Self {
        self.count = self.count.clamp(MIN_COUNT, MAX_COUNT);
        // An adaptive operation writes one round, never more.
        if self.mode == QuizMode::Adaptive {
            self.count = self.count.min(difficulty::ROUND_SIZE);
        }
        self.start_level = self
            .start_level
            .clamp(difficulty::MIN_LEVEL, difficulty::MAX_LEVEL);
        if let Some(r) = &mut self.round {
            r.level = r.level.clamp(difficulty::MIN_LEVEL, difficulty::MAX_LEVEL);
            r.number = r.number.max(1);
            r.right = r.right.min(r.asked);
        }
        self.exclude.truncate(200);
        self.domain_gap = self
            .domain_gap
            .map(|g| g.trim().chars().take(200).collect::<String>())
            .filter(|g| !g.is_empty());
        // A proposed subject wins over a typed one.
        let has_subject = self.subject_id.is_some();
        self.custom_subject = self
            .custom_subject
            .filter(|_| !has_subject)
            .map(|s| s.trim().chars().take(200).collect::<String>())
            .filter(|s| !s.is_empty());
        // "Check specific code": root-relative files or folders, `/` separators.
        if let SourceScope::Paths { paths } = &mut self.scope {
            for p in paths.iter_mut() {
                *p = p.trim().replace('\\', "/").trim_matches('/').to_owned();
            }
            paths.retain(|p| !p.is_empty());
            paths.dedup();
            paths.truncate(50);
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inputs_are_normalized_and_default() {
        let input: QuizGenerationInput = serde_json::from_str(r#"{ "count": 99 }"#).unwrap();
        let input = input.normalized();
        assert_eq!(input.count, MAX_COUNT);
        assert_eq!(input.start_level, 2);
        assert_eq!(input.scope, SourceScope::WholeProject);
        let input: QuizGenerationInput = serde_json::from_str(
            r#"{ "count": 1, "startLevel": 9, "mode": "adaptive", "scope": { "type": "documentationOnly" },
                 "round": { "number": 0, "of": 2, "asked": 3, "right": 7, "level": 0 }, "domainGap": "  " }"#,
        )
        .unwrap();
        let input = input.normalized();
        assert_eq!((input.count, input.start_level), (MIN_COUNT, 5));
        let adaptive: QuizGenerationInput =
            serde_json::from_str(r#"{ "count": 10, "mode": "adaptive" }"#).unwrap();
        assert_eq!(adaptive.normalized().count, difficulty::ROUND_SIZE);
        assert_eq!(input.mode, QuizMode::Adaptive);
        assert_eq!(input.scope, SourceScope::DocumentationOnly);
        let round = input.round.unwrap();
        assert_eq!((round.number, round.right, round.level), (1, 3, 1));
        assert_eq!(input.domain_gap, None);
    }

    #[test]
    fn a_typed_subject_and_paths_are_normalized() {
        let input: QuizGenerationInput = serde_json::from_str(
            r#"{ "customSubject": "  How saving works ", "scope": { "type": "paths", "paths": ["src\\save\\", " /src/save/", "", "README.md"] } }"#,
        )
        .unwrap();
        let input = input.normalized();
        assert_eq!(input.custom_subject.as_deref(), Some("How saving works"));
        assert_eq!(
            input.scope,
            SourceScope::Paths {
                paths: vec!["src/save".into(), "README.md".into()]
            }
        );
        let both: QuizGenerationInput =
            serde_json::from_str(r#"{ "subjectId": "concept:security", "customSubject": "x" }"#)
                .unwrap();
        assert_eq!(both.normalized().custom_subject, None);
    }
}
