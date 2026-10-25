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
pub mod freshness;
pub mod markdown;
pub mod prompt;
pub mod schema;
pub mod validate;

use serde::{Deserialize, Serialize};

/// How well the reader knows this project (the wizard's first option).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// What the user asks for (the Academy's prompt and options). The frontend would send this; the
/// backend writes the prompts and the schemas.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TutorialInput {
    /// Free text ("how does damage get applied in multiplayer?") or a subject card's title.
    pub subject: String,
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
