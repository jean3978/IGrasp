//! The project profile (ADR 0021): what kind of project the open folder is, built locally from
//! one walk of the folder, without any AI. Every learning generation (quiz, tutorials) receives
//! it as context, the subject proposals derive from it, and the user sees and corrects it.

pub mod languages;
pub mod manifests;
pub mod markers;
pub mod modules;
pub mod summary;
pub mod walk;

#[cfg(test)]
pub mod tests;

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use languages::LanguageShare;
use manifests::Manifests;
use walk::Walk;

/// How sure a detection is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Confidence {
    Low,
    Medium,
    High,
}

/// A detected value with the files that justify it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Detected<T> {
    pub value: T,
    pub confidence: Confidence,
    /// Root-relative paths that justify it (at most 5); `(you)` for a correction.
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ProjectKind {
    Game,
    WebFrontend,
    WebBackend,
    Mobile,
    Desktop,
    Library,
    Cli,
    Service,
    DataMl,
    Infrastructure,
    Embedded,
    Monorepo,
    Documentation,
    Unknown,
}

impl ProjectKind {
    /// How the summary and the prompts name it.
    pub fn label(self) -> &'static str {
        match self {
            Self::Game => "game",
            Self::WebFrontend => "web front end",
            Self::WebBackend => "web back end",
            Self::Mobile => "mobile app",
            Self::Desktop => "desktop app",
            Self::Library => "library",
            Self::Cli => "command-line tool",
            Self::Service => "service",
            Self::DataMl => "data / machine-learning project",
            Self::Infrastructure => "infrastructure project",
            Self::Embedded => "embedded project",
            Self::Monorepo => "monorepo",
            Self::Documentation => "documentation site",
            Self::Unknown => "project",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectProfile {
    /// From the main manifest when it has one, else the folder name.
    pub name: String,
    pub kinds: Vec<Detected<ProjectKind>>,
    /// "Unity 2022.3", "Unreal Engine 5.4", "Godot 4.3", "Bevy 0.15", "Custom engine".
    pub engines: Vec<Detected<String>>,
    pub frameworks: Vec<Detected<String>>,
    pub languages: Vec<LanguageShare>,
    /// Notable dependencies from the manifests, runtime ones first, at most 40.
    pub dependencies: Vec<String>,
    pub build: Vec<Detected<String>>,
    pub tests: Vec<Detected<String>>,
    pub ci: Vec<Detected<String>>,
    /// Main areas: workspace members, source folders, engine modules, plugins.
    pub modules: Vec<modules::Module>,
    pub docs: summary::DocsFacts,
    /// A `.git` folder at the root.
    pub repository: bool,
    /// One line: "IGrasp: a Tauri desktop app in Rust and TypeScript (React), tested with …".
    pub summary: String,
    pub files_seen: u64,
    /// The walk hit its budget: the profile says what it saw.
    pub truncated: bool,
    pub built_ms: u64,
}

/// Dependencies listed at most.
pub const MAX_DEPENDENCIES: usize = 40;

/// Dependencies that say nothing about the project (engine built-ins, type packages).
fn is_noise_dependency(name: &str) -> bool {
    name.starts_with("com.unity.modules.")
        || name.starts_with("com.unity.ugui")
        || name.starts_with("@types/")
        || name.starts_with("microsoft.net.sdk")
        || name.starts_with("use-")
}

/// The profile of `walk` (with its manifests), for a folder called `folder_name`.
pub fn from_walk(
    root: &Path,
    walk: &Walk,
    manifests: &Manifests,
    folder_name: &str,
) -> ProjectProfile {
    let detection = markers::detect(root, walk, manifests);
    let name = manifests
        .names
        .iter()
        .find(|(path, _)| !path.contains('/'))
        .or_else(|| manifests.names.first())
        .map_or_else(|| folder_name.to_owned(), |(_, n)| n.clone());
    let mut dependencies: Vec<String> = Vec::new();
    for dev in [false, true] {
        for dep in &manifests.order {
            if dependencies.len() >= MAX_DEPENDENCIES {
                break;
            }
            if manifests.deps[dep].dev == dev && !is_noise_dependency(dep) {
                dependencies.push(dep.clone());
            }
        }
    }
    let mut kinds = detection.kinds;
    if kinds.is_empty() {
        kinds.push(Detected {
            value: ProjectKind::Unknown,
            confidence: Confidence::Low,
            evidence: Vec::new(),
        });
    }
    let mut profile = ProjectProfile {
        name,
        kinds,
        engines: detection.engines,
        frameworks: detection.frameworks,
        languages: languages::shares(walk),
        dependencies,
        build: detection.build,
        tests: detection.tests,
        ci: detection.ci,
        modules: modules::modules(walk, manifests),
        docs: summary::docs_facts(walk),
        repository: false,
        summary: String::new(),
        files_seen: walk.files.len() as u64,
        truncated: walk.truncated,
        built_ms: 0,
    };
    profile.summary = summary::summary(&profile);
    profile
}

/// Walks `root` and builds its profile.
pub fn build(root: &Path, extra_ignores: &[String], cancel: &AtomicBool) -> (ProjectProfile, Walk) {
    let started = Instant::now();
    let walk = walk::walk(root, extra_ignores, cancel);
    let manifests = manifests::read(root, &walk);
    let name = root.file_name().map_or_else(
        || "project".to_owned(),
        |n| n.to_string_lossy().into_owned(),
    );
    let mut profile = from_walk(root, &walk, &manifests, &name);
    profile.repository = root.join(".git").exists();
    profile.built_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    (profile, walk)
}
