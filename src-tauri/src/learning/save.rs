//! Saving the quiz's markdown files (results, or the quiz itself to share): the only writes of
//! the learning features inside a folder, each the direct result of the user's OK in a save
//! dialog. The frontend composes the markdown and never passes a path; the dialog opens on the
//! folder of the kind (`quiz-results/`, `quizzes/`), or the root when it does not exist yet.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::quiz::file::is_quiz_markdown;
use crate::appdata::settings::LearningSettings;
use crate::error::{AppError, AppResult};
use crate::index::scanner::rel_path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum QuizSaveKind {
    Results,
    Quiz,
}

/// Where a saved file went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SavedQuizFile {
    /// Absolute path, as the user chose it.
    pub path: String,
    /// Root-relative with `/` when inside the open folder (the preview can open it).
    pub rel_path: Option<String>,
}

/// The save dialog (the real one, or a stub in tests).
pub trait SaveDialog {
    /// The path the user picked, or `None` when the dialog was dismissed.
    fn pick(&self, directory: &Path, file_name: &str) -> Option<PathBuf>;
}

/// A file name for the dialog: no folders, no characters a file system refuses, `.md`.
pub fn safe_file_name(name: &str) -> String {
    let base: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '-'
            } else {
                c
            }
        })
        .collect();
    let base = base.trim().trim_matches('.').to_owned();
    let base = if base.is_empty() {
        "quiz".to_owned()
    } else {
        base
    };
    if base.to_lowercase().ends_with(".md") {
        base
    } else {
        format!("{base}.md")
    }
}

/// Shows the dialog and writes `markdown` where the user chose.
pub fn save(
    root: &Path,
    learning: &LearningSettings,
    kind: QuizSaveKind,
    markdown: &str,
    suggested_name: &str,
    dialog: &dyn SaveDialog,
) -> AppResult<SavedQuizFile> {
    if kind == QuizSaveKind::Quiz && !is_quiz_markdown(markdown) {
        return Err(AppError::NotAQuizFile(
            "the markdown does not start with the `igrasp: quiz` front matter".to_owned(),
        ));
    }
    let folder = match kind {
        QuizSaveKind::Results => &learning.quiz_results_folder,
        QuizSaveKind::Quiz => &learning.quizzes_folder,
    };
    let preferred = root.join(folder);
    let directory = if preferred.is_dir() {
        preferred
    } else {
        root.to_path_buf()
    };
    let chosen = dialog
        .pick(&directory, &safe_file_name(suggested_name))
        .ok_or(AppError::SaveCancelled)?;
    // The folder is created only for a path the user confirmed.
    if let Some(parent) = chosen.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&chosen, markdown.as_bytes())?;
    let canonical = dunce::canonicalize(&chosen).unwrap_or_else(|_| chosen.clone());
    log::info!("saved {kind:?} to {}", canonical.display());
    Ok(SavedQuizFile {
        path: canonical.display().to_string(),
        rel_path: rel_path(root, &canonical),
    })
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    /// Picks a fixed path (or cancels) and records where it was opened.
    struct Stub {
        answer: Option<PathBuf>,
        opened: RefCell<Option<(PathBuf, String)>>,
    }

    impl SaveDialog for Stub {
        fn pick(&self, directory: &Path, file_name: &str) -> Option<PathBuf> {
            *self.opened.borrow_mut() = Some((directory.to_path_buf(), file_name.to_owned()));
            self.answer.clone()
        }
    }

    const QUIZ: &str = "---\nigrasp: quiz\nid: q\n---\n\n# Quiz\n";

    #[test]
    fn saves_where_the_user_chose_in_the_folder_of_the_kind() {
        let root = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(root.path()).unwrap();
        let learning = LearningSettings::default();
        // The results folder does not exist: the dialog opens on the root.
        let stub = Stub {
            answer: Some(root.join("quiz-results/r.md")),
            opened: RefCell::new(None),
        };
        let saved = save(
            &root,
            &learning,
            QuizSaveKind::Results,
            "# R\n",
            "a/b:c?.md",
            &stub,
        )
        .unwrap();
        let (dir, name) = stub.opened.borrow().clone().unwrap();
        assert_eq!(dir, root);
        assert_eq!(name, "b-c-.md");
        assert_eq!(saved.rel_path.as_deref(), Some("quiz-results/r.md"));
        assert_eq!(
            std::fs::read_to_string(root.join("quiz-results/r.md")).unwrap(),
            "# R\n"
        );
        // Now it exists: the next dialog opens there.
        let stub = Stub {
            answer: Some(root.join("quiz-results/s.md")),
            opened: RefCell::new(None),
        };
        save(&root, &learning, QuizSaveKind::Results, "# S\n", "s", &stub).unwrap();
        assert_eq!(
            stub.opened.borrow().clone().unwrap().0,
            root.join("quiz-results")
        );
        // Outside the folder: written, without a relative path.
        let elsewhere = tempfile::tempdir().unwrap();
        let stub = Stub {
            answer: Some(elsewhere.path().join("q.md")),
            opened: RefCell::new(None),
        };
        let saved = save(&root, &learning, QuizSaveKind::Quiz, QUIZ, "q.md", &stub).unwrap();
        assert!(saved.rel_path.is_none());
    }

    #[test]
    fn a_dismissed_dialog_writes_nothing_and_a_quiz_needs_its_front_matter() {
        let root = tempfile::tempdir().unwrap();
        let learning = LearningSettings::default();
        let stub = Stub {
            answer: None,
            opened: RefCell::new(None),
        };
        let r = save(root.path(), &learning, QuizSaveKind::Quiz, QUIZ, "q", &stub);
        assert!(matches!(r, Err(AppError::SaveCancelled)));
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        let stub = Stub {
            answer: Some(root.path().join("x.md")),
            opened: RefCell::new(None),
        };
        let r = save(
            root.path(),
            &learning,
            QuizSaveKind::Quiz,
            "# Not a quiz\n",
            "x",
            &stub,
        );
        assert!(matches!(r, Err(AppError::NotAQuizFile(_))));
        assert!(stub.opened.borrow().is_none(), "refused before the dialog");
    }
}
