//! What the learning features remember per opened folder (`learning/`): the profile
//! corrections, the quiz being played and the finished quizzes. `index.json` maps each canonical
//! root path to a file id; `l0001.json` holds that folder's data. Never inside the opened folder.

use std::collections::BTreeMap;
use std::fs;

use serde::{Deserialize, Serialize};

use super::{AppData, Cache, read_json, write_json};
use crate::error::{AppError, AppResult};
use crate::profile::ProfileCorrections;

pub const LEARNING_DIR: &str = "learning";
pub const INDEX_FILE: &str = "index.json";

/// Everything the app keeps about one folder for the learning features.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FolderLearning {
    pub version: u32,
    pub root: String,
    pub profile_corrections: ProfileCorrections,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::ProjectKind;

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
