//! The project profile (ADR 0021): what kind of project the open folder is, built locally from
//! one walk of the folder, without any AI. Every learning generation (quiz, tutorials) receives
//! it as context, the subject proposals derive from it, and the user sees and corrects it.

pub mod languages;
pub mod walk;

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use languages::LanguageShare;
use walk::Walk;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectProfile {
    /// From the main manifest when it has one, else the folder name.
    pub name: String,
    pub languages: Vec<LanguageShare>,
    pub files_seen: u64,
    /// The walk hit its budget: the profile says what it saw.
    pub truncated: bool,
    pub built_ms: u64,
}

/// The profile of `walk`, for a folder called `folder_name`.
pub fn from_walk(walk: &Walk, folder_name: &str) -> ProjectProfile {
    ProjectProfile {
        name: folder_name.to_owned(),
        languages: languages::shares(walk),
        files_seen: walk.files.len() as u64,
        truncated: walk.truncated,
        built_ms: 0,
    }
}

/// Walks `root` and builds its profile.
pub fn build(root: &Path, extra_ignores: &[String], cancel: &AtomicBool) -> (ProjectProfile, Walk) {
    let started = Instant::now();
    let walk = walk::walk(root, extra_ignores, cancel);
    let name = root.file_name().map_or_else(
        || "project".to_owned(),
        |n| n.to_string_lossy().into_owned(),
    );
    let mut profile = from_walk(&walk, &name);
    profile.built_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    (profile, walk)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A temp folder holding `files` (`(path, content)`).
    pub fn tree(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (path, content) in files {
            let p = dir.path().join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, content).unwrap();
        }
        dir
    }

    pub fn profile_of(files: &[(&str, &str)]) -> ProjectProfile {
        let dir = tree(files);
        build(dir.path(), &[], &AtomicBool::new(false)).0
    }

    #[test]
    fn empty_folder() {
        let p = profile_of(&[]);
        assert_eq!(p.files_seen, 0);
        assert!(p.languages.is_empty());
        assert!(!p.truncated);
    }

    #[test]
    fn ignored_and_dotfiles() {
        let p = profile_of(&[
            (".gitignore", "build/\n"),
            ("build/huge.js", &"x".repeat(5000)),
            (".github/workflows/ci.yml", "on: push\n"),
            ("src/lib.rs", "pub fn a() {}\n"),
        ]);
        assert_eq!(p.files_seen, 3);
        assert_eq!(p.languages[0].name, "Rust");
        assert!(p.languages.iter().all(|l| l.name != "JavaScript"));
    }
}
