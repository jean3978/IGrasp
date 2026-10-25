//! The reader's progress in a tutorial (ADR 0027): always personal, kept in app data and keyed
//! by the tutorial's id, so it survives updates of the tutorial and covers shared tutorials too.
//! The frontend owns its content (the player computes XP and the step hashes, `academyEngine.ts`);
//! the backend stores it and caps its size, and counts the steps updated since they were read
//! (`step_hash` mirrors the frontend's, asserted on a shared fixture) for the library.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use ts_rs::TS;

use super::schema::{Step, Tutorial};

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

/// The JSON of `v` with sorted keys, without nulls, empty lists and self-checks (`canonicalJson` in
/// `src/lib/tutorial.ts`). `serde_json`'s map is sorted and its strings escape like
/// `JSON.stringify`.
fn canonical(v: &Value) -> String {
    match v {
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        Value::Object(map) => format!(
            "{{{}}}",
            map.iter()
                .filter(|(k, v)| {
                    !v.is_null()
                        && !v.as_array().is_some_and(Vec::is_empty)
                        && k.as_str() != "selfCheck"
                })
                .map(|(k, v)| format!("{}:{}", Value::String(k.clone()), canonical(v)))
                .collect::<Vec<_>>()
                .join(",")
        ),
        other => other.to_string(),
    }
}

static LINE_NUMBERS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#""(?:firstLine|lastLine|answerLine)":\d+,?"#).expect("valid regex")
});

/// The hash a step had when the reader completed it (`stepHash` in `src/lib/tutorial.ts`):
/// line numbers are left out, so a relocation alone does not mark a step updated.
pub fn step_hash(step: &Step) -> String {
    let json = canonical(&serde_json::to_value(step).unwrap_or(Value::Null));
    let json = LINE_NUMBERS.replace_all(&json, "");
    let digest = Sha256::digest(json.as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// The steps the reader completed that changed since (the library's "n updated").
pub fn updated_steps(t: &Tutorial, p: &TutorialProgress) -> u32 {
    let mut n = 0u32;
    for c in &t.chapters {
        for (i, s) in c.steps.iter().enumerate() {
            if let Some(hash) = p.completed.get(&format!("{}:{i}", c.id))
                && *hash != step_hash(s)
            {
                n += 1;
            }
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_hashes_match_the_frontend() {
        #[derive(Deserialize)]
        struct Input {
            tutorial: Tutorial,
        }
        #[derive(Deserialize)]
        struct Hashes {
            hashes: BTreeMap<String, String>,
        }
        let base =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/test/fixtures/tutorial");
        let input: Input = serde_json::from_str(
            &std::fs::read_to_string(base.join("format/every-step/input.json")).unwrap(),
        )
        .unwrap();
        let expected: Hashes =
            serde_json::from_str(&std::fs::read_to_string(base.join("step-hashes.json")).unwrap())
                .unwrap();
        let mut seen = 0;
        for c in &input.tutorial.chapters {
            for (i, s) in c.steps.iter().enumerate() {
                let key = format!("{}:{i}", c.id);
                assert_eq!(Some(&step_hash(s)), expected.hashes.get(&key), "{key}");
                seen += 1;
            }
        }
        assert_eq!(seen, expected.hashes.len());

        // Completed with these hashes: nothing updated; one step changed: one.
        let mut p = TutorialProgress {
            completed: expected.hashes.clone(),
            ..Default::default()
        };
        assert_eq!(updated_steps(&input.tutorial, &p), 0);
        p.completed.insert("c1:0".into(), "0000000000000000".into());
        assert_eq!(updated_steps(&input.tutorial, &p), 1);
    }

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
