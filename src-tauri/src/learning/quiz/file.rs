//! Shareable quiz files (ADR 0024): markdown with an `igrasp: quiz` front matter and one fenced
//! `igrasp-quiz` block per question. The frontend writes and reads the format (`quizFile.ts`);
//! the backend only recognizes a quiz file by its front matter (to refuse saving anything else
//! as a quiz, and for the graph to list the folder's quizzes).

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::commands::files::{MAX_MARKDOWN_BYTES, decode_text};
use crate::error::{AppError, AppResult};
use crate::index::scanner::rel_path;
use crate::learning::quiz::QuizCategory;

/// Whether `text` starts with a front matter that declares `igrasp: quiz`.
pub fn is_quiz_markdown(text: &str) -> bool {
    front_matter(text).is_some_and(|fm| {
        fm.lines().any(|line| {
            let Some((key, value)) = line.split_once(':') else {
                return false;
            };
            key.trim() == "igrasp" && value.trim().trim_matches(['"', '\'']) == "quiz"
        })
    })
}

/// A quiz file of the folder (Saved quizzes on the quiz home).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuizFileSummary {
    pub rel_path: String,
    pub title: Option<String>,
    pub subject: Option<String>,
    pub generated: Option<String>,
    pub questions: u32,
    pub category: Option<QuizCategory>,
    pub role: Option<String>,
    pub modified_ms: i64,
}

/// The text of a quiz file to play.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuizFileText {
    /// Absolute path.
    pub path: String,
    /// Root-relative with `/` when inside the open folder.
    pub rel_path: Option<String>,
    pub content: String,
}

/// Reads a quiz file the user chose (inside the folder or not): a markdown file with the quiz
/// front matter, else `NotAQuizFile`.
pub fn read(root: &Path, path: &Path) -> AppResult<QuizFileText> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(AppError::InvalidPath(path.display().to_string()));
    }
    if metadata.len() > MAX_MARKDOWN_BYTES {
        return Err(AppError::TooLarge {
            size: metadata.len(),
        });
    }
    let content = decode_text(&std::fs::read(path)?);
    if !is_quiz_markdown(&content) {
        return Err(AppError::NotAQuizFile(path.display().to_string()));
    }
    let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    Ok(QuizFileText {
        path: canonical.display().to_string(),
        rel_path: rel_path(root, &canonical),
        content,
    })
}

/// What the graph keeps of a quiz file, to list the folder's quizzes without reading them again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QuizFileInfo {
    pub title: Option<String>,
    pub subject: Option<String>,
    /// As written (an ISO date for the files IGrasp writes).
    pub generated: Option<String>,
    /// The `igrasp-quiz` blocks.
    pub questions: u32,
    /// The kind of quiz and who it was written for (the wizard's choices).
    pub category: Option<QuizCategory>,
    pub role: Option<String>,
}

/// The summary of a quiz file, or `None` when `text` is not one.
pub fn info(text: &str) -> Option<QuizFileInfo> {
    if !is_quiz_markdown(text) {
        return None;
    }
    let fm = front_matter(text).unwrap_or_default();
    let questions = text
        .lines()
        .filter(|l| {
            let l = l.trim_start();
            l.starts_with("```igrasp-quiz") || l.starts_with("~~~igrasp-quiz")
        })
        .count();
    Some(QuizFileInfo {
        title: field(fm, "title"),
        subject: field(fm, "subject"),
        generated: field(fm, "generated"),
        category: field(fm, "category").and_then(|c| match c.as_str() {
            "global" => Some(QuizCategory::Global),
            "feature" => Some(QuizCategory::Feature),
            "code" => Some(QuizCategory::Code),
            _ => None,
        }),
        role: field(fm, "role"),
        questions: u32::try_from(questions).unwrap_or(u32::MAX),
    })
}

/// A top-level scalar of the front matter: plain, single-quoted or double-quoted (the JSON
/// strings IGrasp writes). Anything fancier is left to the frontend's YAML reader.
fn field(fm: &str, key: &str) -> Option<String> {
    let value = fm.lines().find_map(|line| {
        let (k, v) = line.split_once(':')?;
        (k == key).then(|| v.trim())
    })?;
    let value = value
        .split_once(" #")
        .filter(|_| !value.starts_with(['"', '\'']))
        .map_or(value, |(v, _)| v.trim_end());
    let text = if let Some(inner) = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
        serde_json::from_str::<String>(value).unwrap_or_else(|_| inner.to_owned())
    } else if let Some(inner) = value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')) {
        inner.replace("''", "'")
    } else {
        value.to_owned()
    };
    (!text.is_empty()).then_some(text)
}

/// The front matter of `text` (between the leading `---` and the next `---`), if any.
pub fn front_matter(text: &str) -> Option<&str> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let rest = text
        .strip_prefix("---\r\n")
        .or_else(|| text.strip_prefix("---\n"))?;
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            return Some(&rest[..offset]);
        }
        offset += line.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_the_quiz_front_matter() {
        assert!(is_quiz_markdown("---\nigrasp: quiz\nid: x\n---\n# Q\n"));
        assert!(is_quiz_markdown(
            "\u{feff}---\r\ntitle: a\r\nigrasp: \"quiz\"\r\n---\r\n"
        ));
        assert!(!is_quiz_markdown("# No front matter\nigrasp: quiz\n"));
        assert!(!is_quiz_markdown("---\nigrasp: tutorial\n---\n"));
        assert!(!is_quiz_markdown("---\nigrasp: quiz\n"), "never closed");
        assert!(
            !is_quiz_markdown("---\ntitle: a\n---\nigrasp: quiz\n"),
            "outside it"
        );
        assert_eq!(front_matter("---\na: 1\n---\nbody"), Some("a: 1\n"));
    }

    #[test]
    fn reads_only_quiz_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        std::fs::create_dir(root.join("quizzes")).unwrap();
        std::fs::write(
            root.join("quizzes/q.md"),
            "\u{feff}---\nigrasp: quiz\n---\n",
        )
        .unwrap();
        std::fs::write(root.join("notes.md"), "# Notes\n").unwrap();
        let text = read(&root, &root.join("quizzes/q.md")).unwrap();
        assert_eq!(text.rel_path.as_deref(), Some("quizzes/q.md"));
        assert_eq!(text.content, "---\nigrasp: quiz\n---\n");
        assert!(matches!(
            read(&root, &root.join("notes.md")),
            Err(AppError::NotAQuizFile(_))
        ));
        let elsewhere = tempfile::tempdir().unwrap();
        std::fs::write(elsewhere.path().join("q.md"), "---\nigrasp: quiz\n---\n").unwrap();
        assert!(
            read(&root, &elsewhere.path().join("q.md"))
                .unwrap()
                .rel_path
                .is_none()
        );
    }

    #[test]
    fn summarizes_a_quiz_file() {
        let text = "---\nigrasp: quiz\ntitle: \"IGrasp \\u2014 \\\"gateway\\\"\"\nsubject: 'It''s the gateway'\n\
                    generated: 2026-10-24T14:02:00Z # UTC\ncategory: feature\nrole: Level designer\n\
                    sources:\n  - path: a.rs\n---\n\n# Q\n\n\
                    ## 1. One\n\n```igrasp-quiz\nid: q1\n```\n\n## 2. Two\n\n~~~igrasp-quiz\nid: q2\n~~~\n";
        assert_eq!(
            info(text),
            Some(QuizFileInfo {
                title: Some("IGrasp — \"gateway\"".to_owned()),
                subject: Some("It's the gateway".to_owned()),
                generated: Some("2026-10-24T14:02:00Z".to_owned()),
                questions: 2,
                category: Some(QuizCategory::Feature),
                role: Some("Level designer".to_owned()),
            })
        );
        assert_eq!(info("# Not a quiz\n"), None);
        assert_eq!(
            info("---\nigrasp: quiz\n---\n"),
            Some(QuizFileInfo::default())
        );
    }
}
