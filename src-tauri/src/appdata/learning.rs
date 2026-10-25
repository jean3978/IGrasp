//! What the learning features remember per opened folder (`learning/`): the profile
//! corrections, the quiz being played and the finished quizzes. `index.json` maps each canonical
//! root path to a file id; `l0001.json` holds that folder's data. Never inside the opened folder.

use std::collections::BTreeMap;
use std::fs;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::conversations::ConversationUsage;
use super::{AppData, Cache, read_json, write_json};
use crate::error::{AppError, AppResult};
use crate::learning::corpus::SourceScope;
use crate::learning::quiz::schema::QuizQuestion;
use crate::learning::quiz::{QuizCategory, QuizMode};
use crate::learning::tutorial::families::TutorialSubject;
use crate::profile::ProfileCorrections;

pub const LEARNING_DIR: &str = "learning";
pub const INDEX_FILE: &str = "index.json";
/// Finished quizzes kept per folder.
pub const MAX_HISTORY: usize = 20;
/// Questions (and answers) kept per quiz.
pub const MAX_QUIZ_QUESTIONS: usize = 300;
const MAX_ID_CHARS: usize = 64;

/// Where the questions of a quiz come from.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum QuizOrigin {
    /// Written by the AI for this quiz.
    #[default]
    Generated,
    /// Played again from a finished quiz of the history (no AI).
    Replay { of: String },
    /// Played from a quiz file (no AI).
    File { path: String },
}

/// One answer of the player.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct QuizAnswer {
    pub question_id: String,
    /// Index of the chosen choice.
    pub chosen: u32,
    pub correct: bool,
    pub used_hint: bool,
    /// The player opened the cited files ("Look it up") before answering. Absent in records
    /// saved before 0.4.0's look-up (false).
    pub looked_up: bool,
    /// The player's level when the question was asked.
    pub level_at: u32,
}

/// A quiz, played or being played. The frontend owns its content; the backend stores it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct QuizRecord {
    /// Chosen by the frontend: letters, digits, `-` and `_`.
    pub id: String,
    pub started_ms: i64,
    /// Set when the quiz is over: the record then moves to the history.
    pub finished_ms: Option<i64>,
    /// The provider and the model the questions were written with (empty on a replay of a
    /// file that does not say).
    pub provider_id: String,
    pub model: String,
    /// The subject id (`None`: no specific subject) and its title.
    pub subject: Option<String>,
    pub subject_title: String,
    pub mode: QuizMode,
    /// The wizard's choices, for sorting quizzes: the kind of quiz and who took it (absent in
    /// records saved before they existed).
    pub category: Option<QuizCategory>,
    pub role: Option<String>,
    pub scope: SourceScope,
    pub origin: QuizOrigin,
    /// Questions wanted (an adaptive quiz writes them round by round).
    pub count: u32,
    pub questions: Vec<QuizQuestion>,
    pub answers: Vec<QuizAnswer>,
    pub start_level: u32,
    pub level: u32,
    pub score: u32,
    pub best_streak: u32,
    /// Tokens and cost summed over the attempts and rounds (zero on a replay).
    pub usage: ConversationUsage,
    pub duration_ms: u64,
    pub attempts: u32,
    pub rounds: u32,
    /// What continues the generation's conversation (the next adaptive round).
    pub resume_id: Option<String>,
    pub material_note: Option<String>,
    /// What the project's documentation lacks for this quiz, as the generation reported it.
    pub docs_note: Option<String>,
    pub suggested_subjects: Vec<String>,
}

/// A line of the history.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuizSummary {
    pub id: String,
    pub finished_ms: Option<i64>,
    pub subject_title: String,
    pub origin: QuizOrigin,
    pub model: String,
    pub questions: u32,
    pub answered: u32,
    pub score: u32,
    pub level: u32,
    pub category: Option<QuizCategory>,
    pub role: Option<String>,
}

/// Everything the app keeps about one folder for the learning features.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FolderLearning {
    pub version: u32,
    pub root: String,
    pub profile_corrections: ProfileCorrections,
    /// The quiz being played, restored when the Quiz tab opens.
    pub current_quiz: Option<QuizRecord>,
    /// Finished quizzes, newest first, at most [`MAX_HISTORY`].
    pub history: Vec<QuizRecord>,
    /// The Academy's subject cards the AI suggested ("Suggest more subjects"), kept as cards.
    pub suggested_subjects: Vec<TutorialSubject>,
}

fn valid_record_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_CHARS
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn summary(r: &QuizRecord) -> QuizSummary {
    QuizSummary {
        id: r.id.clone(),
        finished_ms: r.finished_ms,
        subject_title: r.subject_title.clone(),
        origin: r.origin.clone(),
        model: r.model.clone(),
        questions: u32::try_from(r.questions.len()).unwrap_or(u32::MAX),
        answered: u32::try_from(r.answers.len()).unwrap_or(u32::MAX),
        score: r.score,
        level: r.level,
        category: r.category,
        role: r.role.clone(),
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct LearningIndex {
    version: u32,
    last: u32,
    /// Canonical root path → file id (`l0001`).
    roots: BTreeMap<String, String>,
}

/// A file id comes from our index, but the index is a file on disk: never let it name a path.
fn valid_file_id(id: &str) -> bool {
    id.len() > 1 && id.starts_with('l') && id[1..].chars().all(|c| c.is_ascii_digit())
}

impl AppData {
    fn learning_dir(&self) -> std::path::PathBuf {
        self.dir.join(LEARNING_DIR)
    }

    fn read_learning_json<T: serde::de::DeserializeOwned + Default>(
        &self,
        cache: &mut Cache,
        name: &str,
    ) -> AppResult<T> {
        let (value, recovered) = read_json::<T>(&self.learning_dir(), name)?;
        if recovered.is_some() {
            cache.recovered.push(format!("{LEARNING_DIR}/{name}"));
        }
        Ok(value)
    }

    fn learning_file_id(
        &self,
        cache: &mut Cache,
        root: &str,
        create: bool,
    ) -> AppResult<Option<String>> {
        let mut index: LearningIndex = self.read_learning_json(cache, INDEX_FILE)?;
        if let Some(id) = index.roots.get(root) {
            return Ok(valid_file_id(id).then(|| id.clone()));
        }
        if !create {
            return Ok(None);
        }
        // Never reuse a number: after a corrupt index, start after the files on disk.
        let on_disk = fs::read_dir(self.learning_dir())
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter_map(|e| {
                        let name = e.file_name().to_string_lossy().into_owned();
                        name.strip_suffix(".json")?
                            .strip_prefix('l')?
                            .parse::<u32>()
                            .ok()
                    })
                    .max()
                    .unwrap_or(0)
            })
            .unwrap_or(0);
        index.version = 1;
        index.last = index.last.max(on_disk) + 1;
        let id = format!("l{:04}", index.last);
        index.roots.insert(root.to_owned(), id.clone());
        write_json(&self.learning_dir(), INDEX_FILE, &index)?;
        Ok(Some(id))
    }

    /// What the app remembers about `root` (defaults when nothing yet).
    pub fn folder_learning(&self, root: &str) -> AppResult<FolderLearning> {
        let mut cache = self.lock();
        let Some(id) = self.learning_file_id(&mut cache, root, false)? else {
            return Ok(FolderLearning::default());
        };
        self.read_learning_json(&mut cache, &format!("{id}.json"))
    }

    /// Changes what the app remembers about `root` and returns the new state.
    pub fn update_folder_learning(
        &self,
        root: &str,
        f: impl FnOnce(&mut FolderLearning),
    ) -> AppResult<FolderLearning> {
        let mut cache = self.lock();
        let id = self
            .learning_file_id(&mut cache, root, true)?
            .ok_or_else(|| AppError::AppData("the learning index is invalid".to_owned()))?;
        let name = format!("{id}.json");
        let mut data: FolderLearning = self.read_learning_json(&mut cache, &name)?;
        f(&mut data);
        data.version = 1;
        root.clone_into(&mut data.root);
        write_json(&self.learning_dir(), &name, &data)?;
        Ok(data)
    }
}

impl AppData {
    /// The quiz being played in `root`, if any.
    pub fn current_quiz(&self, root: &str) -> AppResult<Option<QuizRecord>> {
        Ok(self.folder_learning(root)?.current_quiz)
    }

    /// Saves the quiz being played. A finished one (`finished_ms` set) moves to the history,
    /// newest first, trimmed to [`MAX_HISTORY`].
    pub fn save_current_quiz(&self, root: &str, mut record: QuizRecord) -> AppResult<()> {
        if !valid_record_id(&record.id) {
            return Err(AppError::AppData(format!(
                "invalid quiz id: {:?}",
                record.id
            )));
        }
        record.questions.truncate(MAX_QUIZ_QUESTIONS);
        record.answers.truncate(MAX_QUIZ_QUESTIONS);
        self.update_folder_learning(root, |l| {
            if record.finished_ms.is_some() {
                if l.current_quiz.as_ref().is_some_and(|c| c.id == record.id) {
                    l.current_quiz = None;
                }
                l.history.retain(|h| h.id != record.id);
                l.history.insert(0, record);
                l.history
                    .sort_by_key(|h| std::cmp::Reverse(h.finished_ms.unwrap_or(h.started_ms)));
                l.history.truncate(MAX_HISTORY);
            } else {
                l.current_quiz = Some(record);
            }
        })
        .map(|_| ())
    }

    pub fn clear_current_quiz(&self, root: &str) -> AppResult<()> {
        if self.folder_learning(root)?.current_quiz.is_none() {
            return Ok(());
        }
        self.update_folder_learning(root, |l| l.current_quiz = None)
            .map(|_| ())
    }

    /// The finished quizzes of `root`, newest first.
    pub fn quiz_history(&self, root: &str) -> AppResult<Vec<QuizSummary>> {
        Ok(self
            .folder_learning(root)?
            .history
            .iter()
            .map(summary)
            .collect())
    }

    /// A finished quiz of `root` (for Play again).
    pub fn quiz_record(&self, root: &str, id: &str) -> AppResult<QuizRecord> {
        self.folder_learning(root)?
            .history
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| AppError::NotFound(format!("quiz {id}")))
    }

    /// Forgets the history and the current quiz of `root` (saved quiz files stay: they are the
    /// user's files).
    pub fn forget_quizzes(&self, root: &str) -> AppResult<()> {
        self.update_folder_learning(root, |l| {
            l.current_quiz = None;
            l.history.clear();
        })
        .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::ProjectKind;

    fn record(id: &str, finished: Option<i64>) -> QuizRecord {
        QuizRecord {
            id: id.into(),
            started_ms: 10,
            finished_ms: finished,
            subject_title: format!("About {id}"),
            score: 3,
            ..QuizRecord::default()
        }
    }

    #[test]
    fn the_current_quiz_moves_to_the_history_when_finished() {
        let dir = tempfile::tempdir().unwrap();
        let data = AppData::new(dir.path().to_path_buf());
        assert!(data.current_quiz("/a").unwrap().is_none());
        data.save_current_quiz("/a", record("q-1", None)).unwrap();
        assert_eq!(data.current_quiz("/a").unwrap().unwrap().id, "q-1");
        data.save_current_quiz("/a", record("q-1", Some(100)))
            .unwrap();
        assert!(data.current_quiz("/a").unwrap().is_none());
        let history = data.quiz_history("/a").unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].subject_title, "About q-1");
        assert_eq!(data.quiz_record("/a", "q-1").unwrap().score, 3);
        assert!(matches!(
            data.quiz_record("/a", "nope"),
            Err(AppError::NotFound(_))
        ));
        // The history is trimmed, newest first.
        for i in 0..25 {
            data.save_current_quiz("/a", record(&format!("h{i}"), Some(200 + i)))
                .unwrap();
        }
        let history = data.quiz_history("/a").unwrap();
        assert_eq!(history.len(), MAX_HISTORY);
        assert_eq!(history[0].id, "h24");
        // Other folders are untouched; forgetting keeps nothing.
        assert!(data.quiz_history("/b").unwrap().is_empty());
        data.save_current_quiz("/a", record("c", None)).unwrap();
        data.forget_quizzes("/a").unwrap();
        assert!(data.quiz_history("/a").unwrap().is_empty());
        assert!(data.current_quiz("/a").unwrap().is_none());
        assert!(data.save_current_quiz("/a", record("../x", None)).is_err());
    }

    #[test]
    fn corrections_round_trip_per_folder() {
        let dir = tempfile::tempdir().unwrap();
        let data = AppData::new(dir.path().to_path_buf());
        assert_eq!(
            data.folder_learning("/a").unwrap(),
            FolderLearning::default()
        );
        data.update_folder_learning("/a", |l| {
            l.profile_corrections.add_kinds = vec![ProjectKind::Service];
        })
        .unwrap();
        data.update_folder_learning("/b", |l| l.profile_corrections.notes = "b".into())
            .unwrap();
        let reloaded = AppData::new(dir.path().to_path_buf());
        let a = reloaded.folder_learning("/a").unwrap();
        assert_eq!(a.profile_corrections.add_kinds, vec![ProjectKind::Service]);
        assert_eq!(a.root, "/a");
        assert_eq!(
            reloaded
                .folder_learning("/b")
                .unwrap()
                .profile_corrections
                .notes,
            "b"
        );
        assert!(dir.path().join("learning/l0001.json").exists());
        assert!(dir.path().join("learning/l0002.json").exists());
    }

    #[test]
    fn a_corrupt_file_is_recovered() {
        let dir = tempfile::tempdir().unwrap();
        let data = AppData::new(dir.path().to_path_buf());
        data.update_folder_learning("/a", |l| l.profile_corrections.notes = "x".into())
            .unwrap();
        fs::write(dir.path().join("learning/l0001.json"), "{ nope").unwrap();
        let data = AppData::new(dir.path().to_path_buf());
        assert_eq!(
            data.folder_learning("/a").unwrap(),
            FolderLearning::default()
        );
        assert_eq!(
            data.take_recovered(),
            vec!["learning/l0001.json".to_owned()]
        );
    }
}
