//! The learning features' shared pipeline (ADR 0016, ADR 0022): the project profile of the open
//! folder as the generators see it, and later the corpus, the subjects and the quiz. Nothing here
//! calls a provider: generations go through `ai_start` and the gateway like every AI operation.

pub mod agent_files;
pub mod corpus;
pub mod hoot;
pub mod quiz;
pub mod role;
pub mod save;
pub mod subjects;
pub mod tutorial;

use std::sync::Arc;
use std::sync::atomic::Ordering;

use crate::appdata::AppData;
use crate::error::AppResult;
use crate::profile::{self, ProjectProfile, walk::Walk};
use crate::state::Workspace;

/// The detected profile and the walk of a workspace, reused while the disk is unchanged.
pub struct LearningCache {
    pub revision: u64,
    /// As detected, before the user's corrections.
    pub profile: ProjectProfile,
    pub walk: Arc<Walk>,
}

/// The key of the open folder in app data: its canonical path (like the conversations).
pub fn root_key(ws: &Workspace) -> String {
    ws.guard.root().display().to_string()
}

/// The detected profile and the walk of `ws`, built now when the disk changed since the last
/// build (or `force`), else from the cache. Local: one walk of the folder, no AI.
pub fn detected(ws: &Workspace, force: bool) -> (ProjectProfile, Arc<Walk>) {
    let revision = ws.disk_revision.load(Ordering::SeqCst);
    let mut cache = ws.learning.lock().unwrap_or_else(|e| e.into_inner());
    if !force
        && let Some(c) = cache.as_ref()
        && c.revision == revision
    {
        return (c.profile.clone(), c.walk.clone());
    }
    let (profile, walk) = profile::build(ws.guard.root(), &ws.options.extra_ignores, &ws.cancel);
    let walk = Arc::new(walk);
    log::info!(
        "project profile of {} files in {} ms: {}",
        profile.files_seen,
        profile.built_ms,
        profile.summary
    );
    *cache = Some(LearningCache {
        revision,
        profile: profile.clone(),
        walk: walk.clone(),
    });
    (profile, walk)
}

/// The profile of `ws` with the user's corrections applied.
pub fn corrected_profile(
    ws: &Workspace,
    appdata: &AppData,
    force: bool,
) -> AppResult<(ProjectProfile, Arc<Walk>)> {
    let corrections = appdata.folder_learning(&root_key(ws))?.profile_corrections;
    let (mut profile, walk) = detected(ws, force);
    profile::apply_corrections(&mut profile, &corrections);
    Ok((profile, walk))
}

/// The subject proposals of `ws` (local: the profile, the whole-project corpus, no AI).
pub fn subjects(
    ws: &Workspace,
    appdata: &AppData,
    agent_names: &[String],
) -> AppResult<Vec<subjects::Subject>> {
    let (profile, walk) = corrected_profile(ws, appdata, false)?;
    let corpus = corpus::Corpus::build(
        ws.guard.root(),
        &walk,
        &corpus::SourceScope::WholeProject,
        agent_names,
    );
    Ok(subjects::propose(&profile, &corpus))
}

/// The Academy's subject cards and domains of `ws` (local: the profile, the corpus, the subject
/// detection, no AI), followed by the subjects the AI suggested earlier in this folder.
pub fn tutorial_subjects(
    ws: &Workspace,
    appdata: &AppData,
    agent_names: &[String],
) -> AppResult<tutorial::families::TutorialSubjects> {
    let (profile, walk) = corrected_profile(ws, appdata, false)?;
    let corpus = corpus::Corpus::build(
        ws.guard.root(),
        &walk,
        &corpus::SourceScope::WholeProject,
        agent_names,
    );
    let detected = subjects::propose(&profile, &corpus);
    let mut out = tutorial::families::build(&profile, &corpus, &detected);
    out.cards
        .extend(appdata.folder_learning(&root_key(ws))?.suggested_subjects);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;

    use super::*;
    use crate::index::scanner::ScanOptions;
    use crate::paths::RootGuard;
    use crate::profile::{ProfileCorrections, ProjectKind, tests::tree};

    #[test]
    fn the_profile_is_cached_until_the_disk_changes_and_corrected_from_app_data() {
        let dir = tree(&[
            ("Cargo.toml", "[package]\nname = \"x\"\n"),
            ("src/lib.rs", ""),
        ]);
        let appdata = tempfile::tempdir().unwrap();
        let appdata = AppData::new(appdata.path().to_path_buf());
        let ws = Workspace::new(
            RootGuard::new(dir.path()).unwrap(),
            1,
            ScanOptions::default(),
        );
        let (p, walk) = detected(&ws, false);
        assert_eq!(p.kinds[0].value, ProjectKind::Library);
        // A new file is not seen until the watcher reports a batch.
        std::fs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();
        let (_, again) = detected(&ws, false);
        assert!(Arc::ptr_eq(&walk, &again));
        ws.disk_revision.fetch_add(1, Ordering::SeqCst);
        let (p, again) = detected(&ws, false);
        assert!(!Arc::ptr_eq(&walk, &again));
        assert_eq!(p.kinds[0].value, ProjectKind::Cli);

        appdata
            .update_folder_learning(&root_key(&ws), |l| {
                l.profile_corrections = ProfileCorrections {
                    add_kinds: vec![ProjectKind::Service],
                    ..ProfileCorrections::default()
                };
            })
            .unwrap();
        let (p, _) = corrected_profile(&ws, &appdata, false).unwrap();
        assert_eq!(p.kinds[0].value, ProjectKind::Service);
        assert_eq!(p.corrections.add_kinds, vec![ProjectKind::Service]);
    }
}
