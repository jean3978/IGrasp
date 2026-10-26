//! Private tutorials (ADR 0027): one JSON file per tutorial in
//! `learning/tutorials/<folder file id>/<tutorial id>.json`, so the folder's learning file stays
//! small while the progress is saved after every step. The progress, the AI's subject suggestions
//! and the usage of the tutorial operations live in the folder's learning file
//! (`appdata/learning.rs`). Never inside the opened folder.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{AppData, now_ms, read_json, write_json};
use crate::error::{AppError, AppResult};
use crate::learning::tutorial::families::TutorialSubject;
use crate::learning::tutorial::freshness::Badge;
use crate::learning::tutorial::progress::{
    MAX_PROGRESS_TUTORIALS, MAX_USAGE, TutorialProgress, TutorialUsage,
};
use crate::learning::tutorial::schema::{Tutorial, Verification};
use crate::learning::tutorial::{Familiarity, Length, TutorialRef};

pub const TUTORIALS_DIR: &str = "tutorials";
/// Tutorial ids: letters, digits, `-` and `_`, at most this long.
pub const MAX_TUTORIAL_ID: usize = 80;
/// Private tutorials kept per folder at most.
pub const MAX_PRIVATE_TUTORIALS: usize = 200;
/// AI suggestions kept per folder at most.
pub const MAX_SUGGESTED: usize = 24;

/// A private tutorial as app data keeps it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct StoredTutorial {
    pub version: u32,
    pub tutorial: Tutorial,
    pub created_ms: i64,
    pub updated_ms: i64,
    /// The README of its shared copy (root-relative), once shared with the project.
    pub shared_as: Option<String>,
}

/// The reader's progress, as a library row shows it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProgressSummary {
    pub steps_done: u32,
    pub xp: u32,
    pub graduated: bool,
    pub last_opened_ms: i64,
    pub chapter: u32,
    pub step: u32,
    /// Steps completed before that changed since ("updated since you read it").
    pub updated: u32,
}

/// A row of the Academy's library: a private tutorial or a tutorial shared in the folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TutorialSummary {
    pub reference: TutorialRef,
    pub id: String,
    pub title: String,
    pub subject: String,
    pub familiarity: Familiarity,
    pub length: Length,
    pub domain_gap: Option<String>,
    /// Who it was written for (null: a developer).
    pub role: Option<String>,
    pub chapters: u32,
    pub chapters_written: u32,
    pub steps_total: u32,
    pub generated: String,
    pub model: String,
    pub verified: Option<Verification>,
    /// A private tutorial's shared copy (root-relative README).
    pub shared_as: Option<String>,
    /// The shared copy (`shared_as`) holds this tutorial with other content (changed since it was
    /// shared, maybe by a teammate): it is listed on its own, and updating it replaces it.
    pub shared_differs: bool,
    /// When it last changed (a private tutorial's save, a shared README's modification).
    pub updated_ms: i64,
    pub progress: Option<ProgressSummary>,
    /// The local freshness check's badge (set by the library, which reads the files).
    pub freshness: Option<Badge>,
}

impl TutorialSummary {
    pub fn of(
        reference: TutorialRef,
        t: &Tutorial,
        shared_as: Option<String>,
        updated_ms: i64,
        progress: Option<&TutorialProgress>,
    ) -> Self {
        let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
        Self {
            reference,
            id: t.id.clone(),
            title: t.title.clone(),
            subject: t.subject.clone(),
            familiarity: t.familiarity,
            length: t.length,
            domain_gap: t.domain_gap.clone(),
            role: t.role.clone(),
            chapters: count(t.chapters.len()),
            chapters_written: count(t.chapters.iter().filter(|c| c.is_written()).count()),
            steps_total: count(t.chapters.iter().map(|c| c.steps.len()).sum()),
            generated: t.generated.clone(),
            model: t.model.clone(),
            verified: t.verified.clone(),
            shared_as,
            shared_differs: false,
            updated_ms,
            progress: progress.map(|p| ProgressSummary {
                steps_done: count(p.completed.len()),
                xp: p.xp,
                graduated: p.graduated,
                last_opened_ms: p.last_opened_ms,
                chapter: p.chapter,
                step: p.step,
                updated: crate::learning::tutorial::progress::updated_steps(t, p),
            }),
            freshness: None,
        }
    }
}

pub fn valid_tutorial_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_TUTORIAL_ID
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn check_id(id: &str) -> AppResult<()> {
    if valid_tutorial_id(id) {
        Ok(())
    } else {
        Err(AppError::InvalidPath(format!("invalid tutorial id {id:?}")))
    }
}

impl AppData {
    /// The folder of `root`'s private tutorials, if the folder has learning data.
    fn tutorials_dir(&self, root: &str, create: bool) -> AppResult<Option<PathBuf>> {
        let mut cache = self.lock();
        let id = self.learning_file_id(&mut cache, root, create)?;
        Ok(id.map(|id| self.learning_dir().join(TUTORIALS_DIR).join(id)))
    }

    /// The private tutorials of `root`, newest first. A corrupt file is moved aside and reported
    /// like the other app-data files.
    pub fn private_tutorials(&self, root: &str) -> AppResult<Vec<StoredTutorial>> {
        let Some(dir) = self.tutorials_dir(root, false)? else {
            return Ok(Vec::new());
        };
        let Ok(entries) = fs::read_dir(&dir) else {
            return Ok(Vec::new());
        };
        let mut out = Vec::new();
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(id) = name.strip_suffix(".json") else {
                continue;
            };
            if !valid_tutorial_id(id) {
                continue;
            }
            let (stored, recovered) = read_json::<StoredTutorial>(&dir, &name)?;
            if let Some(r) = recovered {
                self.lock().recovered.push(format!("{TUTORIALS_DIR}/{r}"));
                continue;
            }
            if stored.tutorial.id == id {
                out.push(stored);
            }
        }
        out.sort_by(|a, b| {
            b.updated_ms
                .cmp(&a.updated_ms)
                .then_with(|| a.tutorial.id.cmp(&b.tutorial.id))
        });
        Ok(out)
    }

    /// A private tutorial of `root`.
    pub fn private_tutorial(&self, root: &str, id: &str) -> AppResult<StoredTutorial> {
        check_id(id)?;
        let missing = || AppError::TutorialNotFound(id.to_owned());
        let dir = self.tutorials_dir(root, false)?.ok_or_else(missing)?;
        let name = format!("{id}.json");
        if !dir.join(&name).is_file() {
            return Err(missing());
        }
        let (stored, recovered) = read_json::<StoredTutorial>(&dir, &name)?;
        if let Some(r) = recovered {
            self.lock().recovered.push(format!("{TUTORIALS_DIR}/{r}"));
            return Err(missing());
        }
        Ok(stored)
    }

    /// Adds or replaces a private tutorial of `root` (its creation date and shared copy kept).
    pub fn save_private_tutorial(
        &self,
        root: &str,
        tutorial: Tutorial,
    ) -> AppResult<StoredTutorial> {
        check_id(&tutorial.id)?;
        let dir = self
            .tutorials_dir(root, true)?
            .ok_or_else(|| AppError::AppData("the learning index is invalid".to_owned()))?;
        let previous = self.private_tutorial(root, &tutorial.id).ok();
        if previous.is_none() && self.private_tutorials(root)?.len() >= MAX_PRIVATE_TUTORIALS {
            return Err(AppError::AppData(format!(
                "at most {MAX_PRIVATE_TUTORIALS} private tutorials per folder; delete one first"
            )));
        }
        let now = now_ms();
        let stored = StoredTutorial {
            version: 1,
            created_ms: previous.as_ref().map_or(now, |p| p.created_ms),
            updated_ms: now,
            shared_as: previous.and_then(|p| p.shared_as),
            tutorial,
        };
        write_json(&dir, &format!("{}.json", stored.tutorial.id), &stored)?;
        Ok(stored)
    }

    /// Records where a private tutorial was shared in the folder.
    pub fn set_tutorial_shared_as(&self, root: &str, id: &str, rel: &str) -> AppResult<()> {
        let mut stored = self.private_tutorial(root, id)?;
        stored.shared_as = Some(rel.to_owned());
        let dir = self
            .tutorials_dir(root, false)?
            .ok_or_else(|| AppError::TutorialNotFound(id.to_owned()))?;
        write_json(&dir, &format!("{id}.json"), &stored)
    }

    /// Deletes a private tutorial of `root` and, unless `keep_progress` (its shared copy, which has
    /// the same id, stays in the folder), the progress in it.
    pub fn delete_private_tutorial(
        &self,
        root: &str,
        id: &str,
        keep_progress: bool,
    ) -> AppResult<()> {
        check_id(id)?;
        if let Some(dir) = self.tutorials_dir(root, false)? {
            match fs::remove_file(dir.join(format!("{id}.json"))) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(AppError::AppData(format!("cannot delete {id}: {e}"))),
            }
        }
        if !keep_progress {
            self.update_folder_learning(root, |l| {
                l.tutorial_progress.remove(id);
            })?;
        }
        Ok(())
    }

    /// Forgets the private tutorials of `root`, every progress (shared tutorials included), the
    /// AI's suggestions and the usage. Shared tutorials in the folder stay.
    pub fn forget_tutorials(&self, root: &str) -> AppResult<()> {
        if let Some(dir) = self.tutorials_dir(root, false)?
            && dir.exists()
        {
            fs::remove_dir_all(&dir).map_err(|e| {
                AppError::AppData(format!("cannot delete the private tutorials: {e}"))
            })?;
        }
        self.update_folder_learning(root, |l| {
            l.tutorial_progress.clear();
            l.suggested_subjects.clear();
            l.tutorial_usage.clear();
        })?;
        Ok(())
    }

    pub fn tutorial_progress(&self, root: &str, id: &str) -> AppResult<Option<TutorialProgress>> {
        Ok(self
            .folder_learning(root)?
            .tutorial_progress
            .get(id)
            .cloned())
    }

    /// Saves the reader's progress in a tutorial (after each step). The progress of the
    /// tutorials opened longest ago is dropped beyond [`MAX_PROGRESS_TUTORIALS`].
    pub fn save_tutorial_progress(&self, root: &str, progress: TutorialProgress) -> AppResult<()> {
        check_id(&progress.tutorial_id)?;
        let progress = progress.normalized();
        self.update_folder_learning(root, |l| {
            l.tutorial_progress
                .insert(progress.tutorial_id.clone(), progress);
            while l.tutorial_progress.len() > MAX_PROGRESS_TUTORIALS {
                let oldest = l
                    .tutorial_progress
                    .iter()
                    .min_by_key(|(_, p)| p.last_opened_ms)
                    .map(|(k, _)| k.clone());
                match oldest {
                    Some(k) => l.tutorial_progress.remove(&k),
                    None => break,
                };
            }
        })?;
        Ok(())
    }

    /// Keeps the AI's subject suggestions of `root`, newest last, at most [`MAX_SUGGESTED`].
    pub fn save_suggested_subjects(
        &self,
        root: &str,
        subjects: Vec<TutorialSubject>,
    ) -> AppResult<Vec<TutorialSubject>> {
        let data = self.update_folder_learning(root, |l| {
            for s in subjects {
                if !l.suggested_subjects.iter().any(|o| o.title == s.title) {
                    l.suggested_subjects.push(s);
                }
            }
            let extra = l.suggested_subjects.len().saturating_sub(MAX_SUGGESTED);
            l.suggested_subjects.drain(..extra);
        })?;
        Ok(data.suggested_subjects)
    }

    /// Records the usage of a tutorial operation (the last [`MAX_USAGE`] are kept).
    pub fn record_tutorial_usage(&self, root: &str, usage: TutorialUsage) -> AppResult<()> {
        self.update_folder_learning(root, |l| {
            l.tutorial_usage.push(usage);
            let extra = l.tutorial_usage.len().saturating_sub(MAX_USAGE);
            l.tutorial_usage.drain(..extra);
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::learning::tutorial::markdown::tests::sample;

    fn data() -> (tempfile::TempDir, AppData) {
        let dir = tempfile::tempdir().unwrap();
        let data = AppData::new(dir.path().to_path_buf());
        (dir, data)
    }

    #[test]
    fn save_list_get_and_delete_private_tutorials() {
        let (_d, data) = data();
        assert!(data.private_tutorials("/r").unwrap().is_empty());
        let mut t = sample();
        t.id = "orbit-watcher-20261025-ab12".into();
        let saved = data.save_private_tutorial("/r", t.clone()).unwrap();
        assert!(saved.created_ms > 0);
        data.set_tutorial_shared_as("/r", &t.id, "docs/tutorials/orbit/README.md")
            .unwrap();
        // A later save keeps the creation date and the shared copy.
        t.title = "Renamed".into();
        let again = data.save_private_tutorial("/r", t.clone()).unwrap();
        assert_eq!(again.created_ms, saved.created_ms);
        assert_eq!(
            again.shared_as.as_deref(),
            Some("docs/tutorials/orbit/README.md")
        );
        let list = data.private_tutorials("/r").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].tutorial.title, "Renamed");
        assert_eq!(data.private_tutorial("/r", &t.id).unwrap().tutorial, t);
        assert!(data.private_tutorials("/other").unwrap().is_empty());

        data.save_tutorial_progress(
            "/r",
            TutorialProgress {
                tutorial_id: t.id.clone(),
                xp: 25,
                ..TutorialProgress::default()
            },
        )
        .unwrap();
        assert_eq!(data.tutorial_progress("/r", &t.id).unwrap().unwrap().xp, 25);
        data.delete_private_tutorial("/r", &t.id, false).unwrap();
        assert!(matches!(
            data.private_tutorial("/r", &t.id),
            Err(AppError::TutorialNotFound(_))
        ));
        assert!(data.tutorial_progress("/r", &t.id).unwrap().is_none());
        // Deleting twice is fine; a bad id is refused.
        data.delete_private_tutorial("/r", &t.id, false).unwrap();
        let mut bad = sample();
        bad.id = "../escape".into();
        assert!(data.save_private_tutorial("/r", bad).is_err());
    }

    #[test]
    fn a_corrupt_tutorial_is_recovered_and_forget_clears_everything() {
        let (dir, data) = data();
        let mut t = sample();
        t.id = "t1".into();
        data.save_private_tutorial("/r", t.clone()).unwrap();
        let folder = data.tutorials_dir("/r", false).unwrap().unwrap();
        assert!(folder.starts_with(dir.path()));
        std::fs::write(folder.join("t2.json"), "{ not json").unwrap();
        let list = data.private_tutorials("/r").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(data.take_recovered(), vec!["tutorials/t2.json".to_owned()]);

        data.save_suggested_subjects("/r", vec![]).unwrap();
        data.record_tutorial_usage("/r", TutorialUsage::default())
            .unwrap();
        data.forget_tutorials("/r").unwrap();
        assert!(data.private_tutorials("/r").unwrap().is_empty());
        let l = data.folder_learning("/r").unwrap();
        assert!(l.tutorial_usage.is_empty() && l.tutorial_progress.is_empty());
    }
}
