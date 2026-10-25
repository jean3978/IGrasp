//! The reader's progress in a tutorial (ADR 0027): always personal, kept in app data and keyed
//! by the tutorial's id, so it survives updates of the tutorial and covers shared tutorials too.
//! The frontend owns its content (the player computes XP and the step hashes, `academyEngine.ts`);
//! the backend stores it and caps its size.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Completed steps and answers kept per tutorial at most (8 chapters of 12 steps fit).
pub const MAX_PROGRESS_STEPS: usize = 200;
/// Tutorials with progress kept per folder (the oldest opened are dropped first).
pub const MAX_PROGRESS_TUTORIALS: usize = 100;

/// How the reader did on an interactive step.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct StepAnswer {
    pub right: bool,
    /// Right at the first try, without a hint.
    pub first_try: bool,
    pub used_hint: bool,
    pub tries: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct TutorialProgress {
    pub tutorial_id: String,
    pub started_ms: i64,
    pub last_opened_ms: i64,
    pub finished_ms: Option<i64>,
    /// The position to resume at: chapter and step indices.
    pub chapter: u32,
    pub step: u32,
    /// Completed steps, `"<chapter id>:<step index>"` → the hash of the step when it was
    /// completed: a step whose hash differs now is "updated since you read it".
    pub completed: BTreeMap<String, String>,
    /// The interactive steps' answers, by the same key.
    pub answers: BTreeMap<String, StepAnswer>,
    pub xp: u32,
    /// Right interactive answers in a row, now and at best.
    pub streak: u32,
    pub best_streak: u32,
    /// Chapter ids completed.
    pub chapters_done: Vec<String>,
    pub graduated: bool,
}

impl TutorialProgress {
    /// Caps what the frontend sends.
    pub fn normalized(mut self) -> Self {
        while self.completed.len() > MAX_PROGRESS_STEPS {
            self.completed.pop_last();
        }
        while self.answers.len() > MAX_PROGRESS_STEPS {
            self.answers.pop_last();
        }
        self.chapters_done.truncate(64);
        self
    }
}

/// The tutorial operations of a folder, for the confirmation card's cost line ("the last
/// outline in this folder cost $0.41").
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct TutorialUsage {
    /// `outline`, `chapters`, `review` or `suggest`.
    pub kind: String,
    pub length: super::Length,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: Option<f64>,
    /// Provider calls of the operation (the chapters of a staged run).
    pub calls: u32,
    pub at_ms: i64,
}

/// Operations kept per folder.
pub const MAX_USAGE: usize = 20;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_is_capped_and_reads_with_defaults() {
        let mut p = TutorialProgress {
            tutorial_id: "t".into(),
            ..TutorialProgress::default()
        };
        for i in 0..(MAX_PROGRESS_STEPS + 5) {
            p.completed.insert(format!("c1:{i:03}"), "h".into());
        }
        let p = p.normalized();
        assert_eq!(p.completed.len(), MAX_PROGRESS_STEPS);
        let back: TutorialProgress =
            serde_json::from_str(r#"{ "tutorialId": "t", "xp": 30 }"#).unwrap();
        assert_eq!(back.xp, 30);
        assert!(back.completed.is_empty() && !back.graduated);
    }
}
