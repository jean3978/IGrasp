//! Shared tutorials: reading one from the folder, and the only writes of the Academy inside the
//! opened folder (sharing a private tutorial, updating a shared one, saving a copy elsewhere).
//! Each write is planned first, so the confirmation lists the exact files, then written
//! atomically (a temporary file renamed over each target, so the watcher reports *modified*);
//! the folder is created only by the write.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::markdown::{self, TutorialFile};
use super::schema::Tutorial;
use crate::error::{AppError, AppResult};
use crate::index::scanner::rel_path;
use crate::paths::RootGuard;

/// The longest folder name of a shared tutorial (its slug).
const MAX_SLUG: usize = 60;

/// Where a tutorial is written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum WriteTarget {
    /// Share a private tutorial: `<tutorials folder>/<slug>/` (or where it was shared before).
    Share { id: String },
    /// Update a shared tutorial in place (accepted proposals, relocations, verification).
    #[serde(rename_all = "camelCase")]
    Shared { rel_path: String },
    /// Save as…: a folder picked in a dialog, for a private tutorial.
    Export { id: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PlannedState {
    New,
    Unchanged,
    Changed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlannedFile {
    pub name: String,
    pub state: PlannedState,
    pub bytes: u64,
}

/// What a write will do, for the confirmation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WritePlan {
    /// Root-relative folder the files go to (empty for Save as…, chosen in the dialog).
    pub folder: String,
    pub files: Vec<PlannedFile>,
    /// Chapter files of the shared tutorial that the new version no longer has (deleted).
    pub removed: Vec<String>,
}

impl WritePlan {
    /// Nothing would change on disk.
    #[cfg(test)]
    pub fn is_noop(&self) -> bool {
        self.removed.is_empty()
            && self
                .files
                .iter()
                .all(|f| f.state == PlannedState::Unchanged)
    }
}

/// Where a write went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WrittenTutorial {
    /// Absolute folder, as written.
    pub folder: String,
    /// The README, root-relative, when inside the opened folder.
    pub readme: Option<String>,
    pub plan: WritePlan,
}

/// The folder of a shared README (`docs/tutorials/x/README.md` → `docs/tutorials/x`).
pub fn folder_of(readme: &str) -> &str {
    readme.rsplit_once('/').map_or("", |(folder, _)| folder)
}

fn join(folder: &str, name: &str) -> String {
    if folder.is_empty() {
        name.to_owned()
    } else {
        format!("{folder}/{name}")
    }
}

/// Reads a text file under the root, `None` when it does not exist.
fn read_text(guard: &RootGuard, rel: &str) -> AppResult<Option<String>> {
    let path = guard.join_lexical(rel)?;
    if !path.is_file() {
        return Ok(None);
    }
    let path = guard.resolve(rel)?;
    Ok(Some(std::fs::read_to_string(path)?))
}

/// A shared tutorial: its README and the chapter files it names (a missing one leaves its
/// chapter unwritten; a hand-edited block that no longer parses is skipped).
pub fn read_shared(guard: &RootGuard, readme: &str) -> AppResult<Tutorial> {
    let not = |e: String| AppError::NotATutorialFile(format!("{readme}: {e}"));
    let text =
        read_text(guard, readme)?.ok_or_else(|| AppError::TutorialNotFound(readme.to_owned()))?;
    let folder = folder_of(readme);
    let mut files = vec![TutorialFile {
        name: "README.md".to_owned(),
        text,
    }];
    for name in markdown::chapter_files(&files[0].text).map_err(not)? {
        // A name with a folder in it is not one IGrasp wrote: ignored.
        if name.contains(['/', '\\']) {
            continue;
        }
        if let Some(text) = read_text(guard, &join(folder, &name))? {
            files.push(TutorialFile { name, text });
        }
    }
    let (t, skipped) = markdown::read(&files).map_err(not)?;
    if !skipped.is_empty() {
        log::warn!("{readme}: {} blocks skipped", skipped.len());
    }
    Ok(t)
}

/// The folder a private tutorial is shared to: where it was shared before when that README
/// still holds it, else `<tutorials folder>/<slug of the title>`, refused when another
/// tutorial is there (`TutorialFolderTaken`).
pub fn share_folder(
    guard: &RootGuard,
    tutorials_folder: &str,
    t: &Tutorial,
    shared_as: Option<&str>,
) -> AppResult<String> {
    let holds = |readme: &str| -> AppResult<Option<bool>> {
        Ok(read_text(guard, readme)?
            .and_then(|text| markdown::info(&text))
            .map(|info| info.id == t.id))
    };
    if let Some(readme) = shared_as
        && holds(readme)? == Some(true)
    {
        return Ok(folder_of(readme).to_owned());
    }
    let slug: String = markdown::slug(&t.title).chars().take(MAX_SLUG).collect();
    let folder = join(
        tutorials_folder.trim_matches('/'),
        slug.trim_end_matches('-'),
    );
    let readme = join(&folder, "README.md");
    let taken = match holds(&readme)? {
        Some(same) => !same,
        // Something else in the way: a README that is not a tutorial, or a file named like the
        // folder.
        None => guard.join_lexical(&readme)?.exists() || guard.join_lexical(&folder)?.is_file(),
    };
    if taken {
        return Err(AppError::TutorialFolderTaken(folder));
    }
    Ok(folder)
}

/// Compares the files of `t` with what `folder` holds (root-relative).
pub fn plan(guard: &RootGuard, folder: &str, t: &Tutorial) -> AppResult<WritePlan> {
    let files = markdown::write(t, folder);
    let mut planned = Vec::with_capacity(files.len());
    for f in &files {
        let state = match read_text(guard, &join(folder, &f.name))? {
            None => PlannedState::New,
            Some(old) if old == f.text => PlannedState::Unchanged,
            Some(_) => PlannedState::Changed,
        };
        planned.push(PlannedFile {
            name: f.name.clone(),
            state,
            bytes: f.text.len() as u64,
        });
    }
    // Chapter files the README on disk names and the new version does not write.
    let mut removed = Vec::new();
    if let Some(old) = read_text(guard, &join(folder, "README.md"))?
        && markdown::info(&old).is_some_and(|i| i.id == t.id)
    {
        for name in markdown::chapter_files(&old).unwrap_or_default() {
            if !name.contains(['/', '\\'])
                && !files.iter().any(|f| f.name == name)
                && guard.join_lexical(&join(folder, &name))?.is_file()
            {
                removed.push(name);
            }
        }
    }
    Ok(WritePlan {
        folder: folder.to_owned(),
        files: planned,
        removed,
    })
}

/// Writes `files` into the absolute `dir` (created), each through a temporary file renamed over
/// the target; deletes `removed`.
fn write_files(dir: &Path, files: &[TutorialFile], removed: &[String]) -> AppResult<()> {
    std::fs::create_dir_all(dir)?;
    for f in files {
        let target = dir.join(&f.name);
        if std::fs::read_to_string(&target).is_ok_and(|old| old == f.text) {
            continue;
        }
        let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
        std::io::Write::write_all(&mut tmp, f.text.as_bytes())?;
        tmp.persist(&target).map_err(|e| AppError::Io(e.error))?;
    }
    for name in removed {
        let path = dir.join(name);
        if path.is_file() {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

/// Writes `t` into `folder` (root-relative), as `plan` described it.
pub fn write(guard: &RootGuard, folder: &str, t: &Tutorial) -> AppResult<WrittenTutorial> {
    let plan = plan(guard, folder, t)?;
    let dir = if folder.is_empty() {
        guard.root().to_path_buf()
    } else {
        guard.join_lexical(folder)?
    };
    // The folder must stay inside the root once its existing part is resolved.
    let mut existing = dir.as_path();
    while !existing.exists() {
        existing = existing.parent().unwrap_or(guard.root());
    }
    if let Some(rel) = rel_path(guard.root(), existing) {
        guard.resolve(&rel)?;
    }
    write_files(&dir, &markdown::write(t, folder), &plan.removed)?;
    log::info!("tutorial {} written to {folder}", t.id);
    Ok(WrittenTutorial {
        folder: dir.display().to_string(),
        readme: Some(join(folder, "README.md")),
        plan,
    })
}

/// The plan of a Save as…: every file new, in a folder the dialog will ask for.
pub fn export_plan(t: &Tutorial) -> WritePlan {
    WritePlan {
        folder: String::new(),
        files: planned_new(&markdown::write(t, "")),
        removed: Vec::new(),
    }
}

fn planned_new(files: &[TutorialFile]) -> Vec<PlannedFile> {
    files
        .iter()
        .map(|f| PlannedFile {
            name: f.name.clone(),
            state: PlannedState::New,
            bytes: f.text.len() as u64,
        })
        .collect()
}

/// Save as…: writes `t` into `<chosen>/<slug>/`, anywhere the user picked. The links to the
/// sources are relative to the opened folder when the copy is inside it.
pub fn export(root: &Path, chosen: &Path, t: &Tutorial) -> AppResult<WrittenTutorial> {
    let slug: String = markdown::slug(&t.title).chars().take(MAX_SLUG).collect();
    let dir: PathBuf = chosen.join(slug.trim_end_matches('-'));
    let canonical_parent = dunce::canonicalize(chosen).unwrap_or_else(|_| chosen.to_path_buf());
    let rel_parent = rel_path(root, &canonical_parent);
    let folder = rel_parent
        .as_deref()
        .map(|p| join(p, slug.trim_end_matches('-')));
    let files = markdown::write(t, folder.as_deref().unwrap_or(""));
    write_files(&dir, &files, &[])?;
    Ok(WrittenTutorial {
        folder: dir.display().to_string(),
        readme: folder.as_deref().map(|f| join(f, "README.md")),
        plan: WritePlan {
            folder: folder.unwrap_or_default(),
            files: planned_new(&files),
            removed: Vec::new(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::learning::tutorial::markdown::tests::sample;

    fn guard() -> (tempfile::TempDir, RootGuard) {
        let dir = tempfile::tempdir().unwrap();
        let guard = RootGuard::new(dir.path()).unwrap();
        (dir, guard)
    }

    #[test]
    fn shares_plans_then_writes_and_reads_back() {
        let (_dir, guard) = guard();
        let t = sample();
        let folder = share_folder(&guard, "docs/tutorials", &t, None).unwrap();
        assert_eq!(folder, "docs/tutorials/orbit-s-watcher");
        let p = plan(&guard, &folder, &t).unwrap();
        assert!(p.files.iter().all(|f| f.state == PlannedState::New));
        assert_eq!(p.files[0].name, "README.md");
        // Planning writes nothing.
        assert!(!guard.root().join("docs").exists());
        let written = write(&guard, &folder, &t).unwrap();
        assert_eq!(
            written.readme.as_deref(),
            Some("docs/tutorials/orbit-s-watcher/README.md")
        );
        let back = read_shared(&guard, written.readme.as_deref().unwrap()).unwrap();
        let mut expected = t.clone();
        markdown::normalize(&mut expected);
        assert_eq!(back, expected);
        // Again: nothing changes.
        assert!(plan(&guard, &folder, &t).unwrap().is_noop());
    }

    #[test]
    fn a_removed_chapter_file_is_planned_and_deleted() {
        let (_dir, guard) = guard();
        let t = sample();
        let folder = "docs/tutorials/w";
        write(&guard, folder, &t).unwrap();
        let mut shorter = t.clone();
        // The written chapter becomes unwritten: its file goes.
        let written = shorter
            .chapters
            .iter()
            .position(|c| c.is_written())
            .unwrap();
        shorter.chapters[written].steps.clear();
        let p = plan(&guard, folder, &shorter).unwrap();
        assert_eq!(p.removed.len(), 1, "{p:?}");
        assert_eq!(p.files[0].state, PlannedState::Changed);
        write(&guard, folder, &shorter).unwrap();
        assert!(!guard.root().join(folder).join(&p.removed[0]).exists());
    }

    #[test]
    fn a_folder_with_another_tutorial_is_taken() {
        let (_dir, guard) = guard();
        let t = sample();
        let folder = share_folder(&guard, "docs/tutorials", &t, None).unwrap();
        write(&guard, &folder, &t).unwrap();
        // The same tutorial again: the same folder.
        assert_eq!(
            share_folder(&guard, "docs/tutorials", &t, None).unwrap(),
            folder
        );
        let mut other = t.clone();
        other.id = "another".to_owned();
        assert!(matches!(
            share_folder(&guard, "docs/tutorials", &other, None),
            Err(AppError::TutorialFolderTaken(f)) if f == folder
        ));
        // A README that is not a tutorial is in the way too.
        std::fs::create_dir_all(guard.root().join("docs/tutorials/x")).unwrap();
        std::fs::write(guard.root().join("docs/tutorials/x/README.md"), "# X\n").unwrap();
        let mut x = t.clone();
        x.id = "x".to_owned();
        x.title = "X".to_owned();
        assert!(share_folder(&guard, "docs/tutorials", &x, None).is_err());
        // A `shared_as` whose README holds another tutorial is not reused.
        let readme = format!("{folder}/README.md");
        assert!(share_folder(&guard, "docs/tutorials", &x, Some(&readme)).is_err());
        // Renamed since it was shared: written where it was shared.
        let mut renamed = t.clone();
        renamed.title = "A new title".to_owned();
        assert_eq!(
            share_folder(&guard, "docs/tutorials", &renamed, Some(&readme)).unwrap(),
            folder
        );
    }

    #[test]
    fn export_writes_a_copy_where_the_user_chose() {
        let (_dir, guard) = guard();
        let elsewhere = tempfile::tempdir().unwrap();
        let t = sample();
        let w = export(guard.root(), elsewhere.path(), &t).unwrap();
        assert!(w.readme.is_none());
        assert!(elsewhere.path().join("orbit-s-watcher/README.md").is_file());
        // Inside the folder: a relative README, readable as a shared tutorial.
        std::fs::create_dir_all(guard.root().join("exports")).unwrap();
        let w = export(guard.root(), &guard.root().join("exports"), &t).unwrap();
        assert_eq!(
            w.readme.as_deref(),
            Some("exports/orbit-s-watcher/README.md")
        );
        read_shared(&guard, w.readme.as_deref().unwrap()).unwrap();
    }
}
