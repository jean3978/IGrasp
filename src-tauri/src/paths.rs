//! Root guard: every project path from the frontend is root-relative and must stay inside the
//! opened folder, even through symlinks.

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct RootGuard {
    root: PathBuf,
}

impl RootGuard {
    /// Canonicalizes `path` (resolving symlinks, without the Windows `\\?\` prefix) and requires a
    /// directory.
    pub fn new(path: &Path) -> AppResult<Self> {
        let root = dunce::canonicalize(path)
            .map_err(|_| AppError::NotFound(path.display().to_string()))?;
        if !root.is_dir() {
            return Err(AppError::InvalidPath(format!(
                "{} is not a folder",
                root.display()
            )));
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Joins a `/`-separated relative path to the root without touching the file system.
    /// Rejects absolute paths, drive or UNC prefixes, `.`/`..` components and empty segments.
    pub fn join_lexical(&self, rel: &str) -> AppResult<PathBuf> {
        if rel.is_empty() {
            return Ok(self.root.clone());
        }
        if rel.contains('\\') || rel.contains('\0') || rel.starts_with('/') {
            return Err(AppError::InvalidPath(rel.to_owned()));
        }
        let mut path = self.root.clone();
        for segment in rel.split('/') {
            let mut components = Path::new(segment).components();
            match (components.next(), components.next()) {
                (Some(Component::Normal(name)), None) if !segment.contains(':') => path.push(name),
                _ => return Err(AppError::InvalidPath(rel.to_owned())),
            }
        }
        Ok(path)
    }

    /// Resolves an existing path under the root, following symlinks, and checks that the target
    /// is still inside the root.
    #[cfg_attr(not(test), expect(dead_code, reason = "used by read_markdown"))]
    pub fn resolve(&self, rel: &str) -> AppResult<PathBuf> {
        let joined = self.join_lexical(rel)?;
        let canonical =
            dunce::canonicalize(&joined).map_err(|_| AppError::NotFound(rel.to_owned()))?;
        if !canonical.starts_with(&self.root) {
            return Err(AppError::OutsideRoot(rel.to_owned()));
        }
        Ok(canonical)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn guard() -> (tempfile::TempDir, RootGuard) {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("docs/sub")).unwrap();
        fs::write(dir.path().join("docs/a.md"), "# A").unwrap();
        let g = RootGuard::new(dir.path()).unwrap();
        (dir, g)
    }

    #[test]
    fn resolves_relative_paths_inside_the_root() {
        let (_d, g) = guard();
        let p = g.resolve("docs/a.md").unwrap();
        assert!(p.ends_with("a.md"));
        assert_eq!(g.resolve("").unwrap(), g.root());
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let (_d, g) = guard();
        for bad in [
            "../x",
            "docs/../../x",
            "/etc/passwd",
            "docs//a.md",
            "./docs",
            "docs\\a.md",
            "C:/Windows",
            "C:",
            "\\\\server\\share",
        ] {
            assert!(
                matches!(g.join_lexical(bad), Err(AppError::InvalidPath(_))),
                "{bad} should be rejected"
            );
        }
    }

    #[test]
    fn missing_file_is_not_found() {
        let (_d, g) = guard();
        assert!(matches!(g.resolve("nope.md"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn root_must_be_a_folder() {
        let (d, _g) = guard();
        assert!(RootGuard::new(&d.path().join("docs/a.md")).is_err());
        assert!(RootGuard::new(&d.path().join("missing")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escaping_the_root_is_rejected() {
        let (d, g) = guard();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("link")).unwrap();
        assert!(matches!(
            g.resolve("link/secret.md"),
            Err(AppError::OutsideRoot(_))
        ));
    }

    #[cfg(windows)]
    #[test]
    fn junction_escaping_the_root_is_rejected() {
        // Directory junctions need no privileges on Windows (unlike symlinks).
        let (d, g) = guard();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "x").unwrap();
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(d.path().join("link"))
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(status.status.success());
        assert!(matches!(
            g.resolve("link/secret.md"),
            Err(AppError::OutsideRoot(_))
        ));
    }
}
