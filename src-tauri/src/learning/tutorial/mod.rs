//! Tutorials (Hoot's Academy), **proof of concept before Phase 5**: the tutorial schema (outline,
//! chapters, every step type, citations with a file and a line range), the shared markdown
//! format (a `README.md` with a front matter plus one file per chapter, `igrasp-*` fenced blocks
//! with YAML), the generation prompts with the grounding rules, the validator, the freshness
//! check of the cited lines, and the composition of the two read-only requests (the outline,
//! then one chapter) that run through the gateway's validated runs like a quiz. Provider-neutral:
//! no provider name, flag or wire format here. Nothing is wired to IPC yet.
// Proof of concept: nothing reaches this module through IPC yet, so its items are unused.
#![allow(dead_code)]

pub mod compose;
pub mod cost;
pub mod families;
pub mod freshness;
pub mod markdown;
pub mod operation;
pub mod progress;
pub mod prompt;
pub mod repo;
pub mod schema;
pub mod validate;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How well the reader knows this project (the wizard's first option).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Familiarity {
    /// New here: an onboarding.
    #[default]
    NewHere,
    /// Already contributing: skips what the README says, goes to how things are done.
    Contributing,
    /// A deep dive for maintainers: invariants, trade-offs, the traps.
    Maintainer,
}

impl Familiarity {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "new" | "newhere" | "new-here" | "new_here" => Some(Self::NewHere),
            "contributing" => Some(Self::Contributing),
            "maintainer" | "maintainers" => Some(Self::Maintainer),
            _ => None,
        }
    }
}

/// How long the tutorial should take (the wizard's length).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Length {
    /// ~5 minutes.
    Quick,
    /// ~15 minutes.
    #[default]
    Standard,
    /// ~30 minutes.
    Deep,
}

impl Length {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "quick" => Some(Self::Quick),
            "standard" => Some(Self::Standard),
            "deep" => Some(Self::Deep),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Quick => "quick",
            Self::Standard => "standard",
            Self::Deep => "deep",
        }
    }

    /// Chapters in the outline, at least and at most.
    pub fn chapters(self) -> (usize, usize) {
        match self {
            Self::Quick => (2, 3),
            Self::Standard => (3, 5),
            Self::Deep => (5, 8),
        }
    }

    /// Steps in a chapter, at least and at most (the recap included).
    pub fn steps(self) -> (usize, usize) {
        match self {
            Self::Quick => (4, 6),
            Self::Standard => (5, 8),
            Self::Deep => (7, 10),
        }
    }

    pub fn minutes(self) -> u32 {
        match self {
            Self::Quick => 5,
            Self::Standard => 15,
            Self::Deep => 30,
        }
    }
}

/// Picks of a family card at most (the features of a Deep Dive, the actions of a Trace It).
pub const MAX_PICKS: usize = 4;

/// What the user asks for (the Academy's prompt and options). The frontend sends this; the
/// backend writes the prompts and the schemas.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct TutorialInput {
    /// Free text ("how does damage get applied in multiplayer?") or a subject card's title.
    pub subject: String,
    /// The subject card it came from (`families.rs`), so the prompt gets the card's family focus
    /// and anchors; `None` for typed text.
    pub subject_id: Option<String>,
    /// What the user picked on a card that needs a pick (a feature, an action to trace).
    pub picks: Vec<String>,
    pub familiarity: Familiarity,
    /// "I'm new to …": the domain the reader lacks, taught through this project's usage of it.
    pub domain_gap: Option<String>,
    pub length: Length,
    /// Who reads it, when not a developer (the quiz's roles).
    pub role: Option<String>,
}

impl Default for TutorialInput {
    fn default() -> Self {
        Self {
            subject: "The big picture".to_owned(),
            subject_id: None,
            picks: Vec::new(),
            familiarity: Familiarity::NewHere,
            domain_gap: None,
            length: Length::Standard,
            role: None,
        }
    }
}

impl TutorialInput {
    pub fn normalized(mut self) -> Self {
        self.subject = self.subject.trim().chars().take(300).collect();
        if self.subject.is_empty() {
            self.subject = "The big picture".to_owned();
        }
        self.subject_id = self
            .subject_id
            .map(|g| g.trim().chars().take(200).collect::<String>())
            .filter(|g| !g.is_empty());
        self.picks = self
            .picks
            .into_iter()
            .map(|p| p.trim().chars().take(200).collect::<String>())
            .filter(|p| !p.is_empty())
            .take(MAX_PICKS)
            .collect();
        self.domain_gap = self
            .domain_gap
            .map(|g| g.trim().chars().take(200).collect::<String>())
            .filter(|g| !g.is_empty());
        self.role = self
            .role
            .map(|r| r.trim().chars().take(80).collect::<String>())
            .filter(|r| !r.is_empty());
        self
    }
}

/// The id of a new tutorial: `<slug of the subject, at most 40 characters>-<yyyymmdd>-<4 hex>`,
/// from its RFC 3339 generation date.
pub fn new_tutorial_id(subject: &str, generated: &str) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let mut slug = markdown::slug(subject);
    if slug.len() > 40 {
        slug.truncate(40);
        slug = slug.trim_end_matches('-').to_owned();
    }
    if slug.is_empty() || slug == "chapter" {
        slug = "tutorial".to_owned();
    }
    let date: String = generated
        .chars()
        .filter(char::is_ascii_digit)
        .take(8)
        .collect();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    let n = nanos ^ COUNTER.fetch_add(0x9e37, Ordering::SeqCst);
    format!("{slug}-{date}-{:04x}", n & 0xffff)
}

/// A tutorial the user can open: private (app data) or shared (a README in the folder).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum TutorialRef {
    Private {
        id: String,
    },
    #[serde(rename_all = "camelCase")]
    Shared {
        /// Root-relative path of the tutorial's `README.md`.
        rel_path: String,
    },
}

/// What the frontend sends to start a tutorial operation; the backend composes the prompts, the
/// schemas and the validators (the frontend never writes a tutorial prompt).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum TutorialRequest {
    /// The outline of a new tutorial.
    Outline { input: TutorialInput },
    /// Writes these chapters (0-based indices in the saved outline) of a private tutorial, one
    /// stage each, in this order: one operation.
    Chapters { id: String, indices: Vec<u32> },
    /// Writes one chapter again (one stage), or a new chapter for a missing topic (`goal`).
    Chapter {
        id: String,
        index: u32,
        goal: Option<String>,
    },
    /// The AI review ("Check with <provider>"): the tutorial against the project as it is now.
    Review { tutorial: TutorialRef },
    /// "Suggest more subjects".
    Suggest,
}
