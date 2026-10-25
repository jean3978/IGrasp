//! The context of a message: the instruction files the provider declares, from the root down to
//! the current file's folder, then the current file. Read through the root guard (never out of
//! the folder, symlinks included), bounded, never written. The frontend lists the documents
//! with `collect` (no contents); `ai_start` reads the ones the user kept with `documents`.

use std::path::Path;

use super::types::{AiContextDocument, AiContextRole, AiRequest, AiStartRequest};
use crate::error::{AppError, AppResult};
use crate::paths::RootGuard;

/// Largest instruction file inlined in a message.
pub const INSTRUCTION_CAP: u64 = 32 * 1024;
/// Largest current file inlined in a message.
pub const CURRENT_CAP: u64 = 96 * 1024;

/// Up to what size a document's content is inlined, per role.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caps {
    pub instruction: u64,
    pub current: u64,
}

impl Default for Caps {
    fn default() -> Self {
        Self {
            instruction: INSTRUCTION_CAP,
            current: CURRENT_CAP,
        }
    }
}

impl Caps {
    fn of(self, role: AiContextRole) -> u64 {
        match role {
            AiContextRole::InstructionFile => self.instruction,
            AiContextRole::CurrentFile | AiContextRole::Capture => self.current,
        }
    }
}

fn base_name(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

/// The role of a path the frontend sends back: an instruction file by its name, else the
/// current file.
fn role_of(rel: &str, names: &[String]) -> AiContextRole {
    if names.iter().any(|n| n == base_name(rel)) {
        AiContextRole::InstructionFile
    } else {
        AiContextRole::CurrentFile
    }
}

/// UTF-8 text without a BOM, or `None` for binary content.
fn text_of(bytes: Vec<u8>) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    let text = String::from_utf8(bytes).ok()?;
    if let Some(stripped) = text.strip_prefix('\u{feff}') {
        return Some(stripped.to_owned());
    }
    Some(text)
}

/// The document at `rel`, if it is a file inside the root. Content is read when asked and the
/// file fits the cap of its role.
fn document(
    path: &Path,
    rel: &str,
    role: AiContextRole,
    caps: Caps,
    read: bool,
) -> AppResult<Option<AiContextDocument>> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Ok(None);
    }
    let bytes = metadata.len();
    let truncated = bytes > caps.of(role);
    let content = if read && !truncated {
        text_of(std::fs::read(path)?)
    } else {
        None
    };
    Ok(Some(AiContextDocument {
        path: rel.to_owned(),
        role,
        content,
        bytes,
        truncated,
    }))
}

/// The folders from the root (`""`) down to the folder of `file`.
fn folders_down_to(file: Option<&str>) -> Vec<String> {
    let mut out = vec![String::new()];
    if let Some((dir, _)) = file.and_then(|f| f.rsplit_once('/')) {
        let mut current = String::new();
        for segment in dir.split('/') {
            if !current.is_empty() {
                current.push('/');
            }
            current.push_str(segment);
            out.push(current.clone());
        }
    }
    out
}

/// What the next message would carry, without contents: every instruction file named in
/// `names` from the root down to the current file's folder (root first), then the current file.
/// Files that are missing, outside the root (through a symlink) or not files are left out; a
/// malformed `current` path is an error.
pub fn collect(
    guard: &RootGuard,
    current: Option<&str>,
    names: &[String],
    caps: Caps,
) -> AppResult<Vec<AiContextDocument>> {
    if let Some(current) = current {
        guard.join_lexical(current)?;
    }
    let mut out = Vec::new();
    for folder in folders_down_to(current) {
        for name in names {
            let rel = if folder.is_empty() {
                name.clone()
            } else {
                format!("{folder}/{name}")
            };
            if Some(rel.as_str()) == current {
                continue;
            }
            // The guard refuses symlinks out of the root; a missing file is simply absent.
            let Ok(path) = guard.resolve(&rel) else {
                continue;
            };
            if let Some(doc) = document(&path, &rel, AiContextRole::InstructionFile, caps, false)? {
                out.push(doc);
            }
        }
    }
    if let Some(current) = current
        && let Ok(path) = guard.resolve(current)
        && let Some(doc) = document(&path, current, AiContextRole::CurrentFile, caps, false)?
    {
        out.push(doc);
    }
    Ok(out)
}

/// The documents at `paths` (from `collect`, minus the ones the user removed), in that order,
/// with their contents when `read` and small enough. A path deleted since it was listed is
/// skipped; a malformed path or one that leads out of the root is an error.
pub fn documents(
    guard: &RootGuard,
    paths: &[String],
    names: &[String],
    caps: Caps,
    read: bool,
) -> AppResult<Vec<AiContextDocument>> {
    let mut out = Vec::new();
    for rel in paths {
        let path = match guard.resolve(rel) {
            Ok(path) => path,
            Err(AppError::NotFound(_)) => continue,
            Err(e) => return Err(e),
        };
        if let Some(doc) = document(&path, rel, role_of(rel, names), caps, read)? {
            out.push(doc);
        }
    }
    Ok(out)
}

/// The request a provider receives for what the frontend sent: the context documents read
/// from their paths (the frontend never sends contents) and the capture checked.
pub fn request_from(
    guard: &RootGuard,
    names: &[String],
    start: AiStartRequest,
) -> AppResult<AiRequest> {
    if let Some(capture) = &start.capture {
        guard.join_lexical(&capture.source_path)?;
    }
    Ok(AiRequest {
        context: documents(guard, &start.context_paths, names, Caps::default(), true)?,
        prompt: start.prompt,
        model: start.model,
        resume_id: start.resume_id,
        capture: start.capture,
        images: start.images,
        policy: start.policy,
        output_schema: start.output_schema,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn names() -> Vec<String> {
        vec!["CLAUDE.md".into(), "CLAUDE.local.md".into()]
    }

    /// A project with instruction files at two levels, one of them ignored by git.
    fn project() -> (tempfile::TempDir, RootGuard) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("docs/guide")).unwrap();
        fs::write(root.join("CLAUDE.md"), "# Root rules\n").unwrap();
        fs::write(root.join("docs/CLAUDE.md"), "# Docs rules\n").unwrap();
        fs::write(root.join("docs/CLAUDE.local.md"), "# My local rules\n").unwrap();
        fs::write(root.join(".gitignore"), "CLAUDE.local.md\n").unwrap();
        fs::write(root.join("docs/guide/start.md"), "\u{feff}# Start\n").unwrap();
        let guard = RootGuard::new(root).unwrap();
        (dir, guard)
    }

    fn listing(docs: &[AiContextDocument]) -> Vec<(&str, AiContextRole)> {
        docs.iter().map(|d| (d.path.as_str(), d.role)).collect()
    }

    #[test]
    fn walks_from_the_root_down_then_the_current_file() {
        let (_dir, guard) = project();
        let docs = collect(
            &guard,
            Some("docs/guide/start.md"),
            &names(),
            Caps::default(),
        )
        .unwrap();
        use AiContextRole::*;
        assert_eq!(
            listing(&docs),
            vec![
                ("CLAUDE.md", InstructionFile),
                ("docs/CLAUDE.md", InstructionFile),
                // Ignored by git, so not in the index: still found on disk.
                ("docs/CLAUDE.local.md", InstructionFile),
                ("docs/guide/start.md", CurrentFile),
            ]
        );
        assert!(docs.iter().all(|d| d.content.is_none() && !d.truncated));
        assert_eq!(docs[0].bytes, 13);
    }

    #[test]
    fn without_or_with_a_missing_current_file_lists_the_instructions_above_it() {
        let (_dir, guard) = project();
        let docs = collect(&guard, None, &names(), Caps::default()).unwrap();
        assert_eq!(
            listing(&docs),
            vec![("CLAUDE.md", AiContextRole::InstructionFile)]
        );
        let docs = collect(&guard, Some("docs/gone.md"), &names(), Caps::default()).unwrap();
        assert_eq!(
            docs.len(),
            3,
            "root and docs instruction files, no current file"
        );
        // An instruction file that is the current file is listed once, as the current file.
        let docs = collect(&guard, Some("docs/CLAUDE.md"), &names(), Caps::default()).unwrap();
        assert_eq!(
            listing(&docs),
            vec![
                ("CLAUDE.md", AiContextRole::InstructionFile),
                ("docs/CLAUDE.local.md", AiContextRole::InstructionFile),
                ("docs/CLAUDE.md", AiContextRole::CurrentFile),
            ]
        );
        assert!(collect(&guard, Some("../x.md"), &names(), Caps::default()).is_err());
    }

    #[test]
    fn reads_contents_within_the_caps_only() {
        let (dir, guard) = project();
        fs::write(dir.path().join("big.md"), "x".repeat(200)).unwrap();
        fs::write(dir.path().join("data.bin"), [0u8, 1, 2, 3]).unwrap();
        let caps = Caps {
            instruction: 10,
            current: 100,
        };
        let paths: Vec<String> = ["CLAUDE.md", "docs/guide/start.md", "big.md", "data.bin"]
            .map(String::from)
            .into();
        let docs = documents(&guard, &paths, &names(), caps, true).unwrap();
        // 13 bytes > 10: an instruction file listed by path only.
        assert_eq!(docs[0].role, AiContextRole::InstructionFile);
        assert!(docs[0].truncated && docs[0].content.is_none());
        // The BOM is dropped.
        assert_eq!(docs[1].content.as_deref(), Some("# Start\n"));
        assert!(!docs[1].truncated);
        assert!(docs[2].truncated && docs[2].content.is_none());
        assert_eq!(docs[2].bytes, 200);
        // Binary: by path only, not truncated.
        assert!(docs[3].content.is_none() && !docs[3].truncated);

        // Metadata only.
        let docs = documents(&guard, &paths, &names(), Caps::default(), false).unwrap();
        assert!(docs.iter().all(|d| d.content.is_none()));
    }

    #[test]
    fn skips_deleted_paths_and_refuses_malformed_ones() {
        let (_dir, guard) = project();
        let docs = documents(
            &guard,
            &["gone.md".into(), "CLAUDE.md".into()],
            &names(),
            Caps::default(),
            true,
        )
        .unwrap();
        assert_eq!(
            listing(&docs),
            vec![("CLAUDE.md", AiContextRole::InstructionFile)]
        );
        for bad in ["../secret.md", "/etc/passwd", "docs\\CLAUDE.md"] {
            assert!(
                matches!(
                    documents(&guard, &[bad.into()], &names(), Caps::default(), true),
                    Err(AppError::InvalidPath(_))
                ),
                "{bad}"
            );
        }
    }

    #[test]
    fn builds_the_provider_request_from_paths() {
        use crate::ai::types::{AiCapture, AiPolicy};
        let (_dir, guard) = project();
        let capture = AiCapture {
            source_path: "docs/guide/start.md".into(),
            first_line: 1,
            last_line: 1,
            text: "# Start".into(),
            selection: None,
        };
        let request = request_from(
            &guard,
            &names(),
            AiStartRequest {
                prompt: "Explain".into(),
                model: Some("m".into()),
                context_paths: vec!["CLAUDE.md".into(), "docs/guide/start.md".into()],
                capture: Some(capture.clone()),
                policy: AiPolicy::ReadOnly,
                ..AiStartRequest::default()
            },
        )
        .unwrap();
        assert_eq!(request.prompt, "Explain");
        assert_eq!(request.model.as_deref(), Some("m"));
        assert_eq!(request.policy, AiPolicy::ReadOnly);
        assert_eq!(request.capture, Some(capture.clone()));
        assert_eq!(request.context.len(), 2);
        assert_eq!(
            request.context[0].content.as_deref(),
            Some("# Root rules\n")
        );
        assert_eq!(request.context[1].role, AiContextRole::CurrentFile);

        let bad = AiStartRequest {
            capture: Some(AiCapture {
                source_path: "../x.md".into(),
                ..capture
            }),
            ..AiStartRequest::default()
        };
        assert!(request_from(&guard, &names(), bad).is_err());
    }

    #[test]
    fn never_writes_in_the_folder() {
        let (dir, guard) = project();
        let snapshot = |p: &Path| {
            let mut entries: Vec<_> = walk(p);
            entries.sort();
            entries
        };
        let before = snapshot(dir.path());
        collect(
            &guard,
            Some("docs/guide/start.md"),
            &names(),
            Caps::default(),
        )
        .unwrap();
        documents(
            &guard,
            &["CLAUDE.md".into(), "docs/guide/start.md".into()],
            &names(),
            Caps::default(),
            true,
        )
        .unwrap();
        assert_eq!(snapshot(dir.path()), before);
    }

    fn walk(p: &Path) -> Vec<(String, u64, Option<std::time::SystemTime>)> {
        let mut out = Vec::new();
        for entry in fs::read_dir(p).unwrap() {
            let entry = entry.unwrap();
            let meta = entry.metadata().unwrap();
            out.push((
                entry.path().display().to_string(),
                meta.len(),
                // NTFS updates a folder's time lazily: compare files' times only.
                meta.is_file().then(|| meta.modified().ok()).flatten(),
            ));
            if meta.is_dir() {
                out.extend(walk(&entry.path()));
            }
        }
        out
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_root_is_never_read() {
        let (dir, guard) = project();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("CLAUDE.md"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        let docs = collect(&guard, Some("link/a.md"), &names(), Caps::default()).unwrap();
        assert!(docs.iter().all(|d| !d.path.starts_with("link/")));
        assert!(matches!(
            documents(
                &guard,
                &["link/CLAUDE.md".into()],
                &names(),
                Caps::default(),
                true
            ),
            Err(AppError::OutsideRoot(_))
        ));
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_out_of_the_root_is_never_read() {
        let (dir, guard) = project();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("CLAUDE.md"), "secret").unwrap();
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(dir.path().join("link"))
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(status.status.success(), "mklink /J failed");
        let docs = collect(&guard, Some("link/a.md"), &names(), Caps::default()).unwrap();
        assert!(docs.iter().all(|d| !d.path.starts_with("link/")));
        assert!(matches!(
            documents(
                &guard,
                &["link/CLAUDE.md".into()],
                &names(),
                Caps::default(),
                true
            ),
            Err(AppError::OutsideRoot(_))
        ));
    }
}
