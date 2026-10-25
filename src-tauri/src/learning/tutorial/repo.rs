//! Repository facts a tutorial records (its generation commit, who verified it), read from the
//! `.git` files as text: no git process (the git layer arrives with Phase 7). Covers a `.git`
//! folder and the `.git` file of a worktree or a submodule, a detached HEAD, a loose ref and a
//! packed one.

use std::fs;
use std::path::{Path, PathBuf};

/// The folder holding `HEAD`, and the common folder holding the refs and the config.
fn git_dirs(root: &Path) -> Option<(PathBuf, PathBuf)> {
    let dot = root.join(".git");
    let dir = if dot.is_dir() {
        dot
    } else {
        let text = fs::read_to_string(&dot).ok()?;
        let target = text.trim().strip_prefix("gitdir:")?.trim();
        let path = Path::new(target);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            root.join(path)
        }
    };
    let common = fs::read_to_string(dir.join("commondir"))
        .ok()
        .map(|c| {
            let c = c.trim();
            if Path::new(c).is_absolute() {
                PathBuf::from(c)
            } else {
                dir.join(c)
            }
        })
        .unwrap_or_else(|| dir.clone());
    Some((dir, common))
}

fn is_hash(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// The commit `HEAD` points at, if `root` is a repository with at least one commit.
pub fn head_commit(root: &Path) -> Option<String> {
    let (dir, common) = git_dirs(root)?;
    let head = fs::read_to_string(dir.join("HEAD")).ok()?;
    let head = head.trim();
    let Some(name) = head.strip_prefix("ref:").map(str::trim) else {
        return is_hash(head).then(|| head.to_owned());
    };
    if name.contains("..") {
        return None;
    }
    for base in [&dir, &common] {
        if let Ok(text) = fs::read_to_string(base.join(name)) {
            let hash = text.trim();
            if is_hash(hash) {
                return Some(hash.to_owned());
            }
        }
    }
    let packed = fs::read_to_string(common.join("packed-refs")).ok()?;
    packed
        .lines()
        .filter(|l| !l.starts_with('#') && !l.starts_with('^'))
        .find_map(|l| {
            let (hash, r) = l.split_once(' ')?;
            (r.trim() == name && is_hash(hash)).then(|| hash.to_owned())
        })
}

/// `[user] name` of the repository's own config, if it sets one.
pub fn user_name(root: &Path) -> Option<String> {
    let (_, common) = git_dirs(root)?;
    let text = fs::read_to_string(common.join("config")).ok()?;
    let mut in_user = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_user = line.trim_start_matches('[').trim_end_matches(']').trim() == "user";
            continue;
        }
        if in_user
            && let Some((key, value)) = line.split_once('=')
            && key.trim().eq_ignore_ascii_case("name")
        {
            let value = value.trim().trim_matches('"').trim();
            if !value.is_empty() {
                return Some(value.chars().take(80).collect());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "0123456789abcdef0123456789abcdef01234567";
    const B: &str = "89abcdef0123456789abcdef0123456789abcdef";

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    #[test]
    fn reads_a_loose_ref_a_packed_ref_and_a_detached_head() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(head_commit(root), None, "not a repository");
        write(root, ".git/HEAD", "ref: refs/heads/main\n");
        assert_eq!(head_commit(root), None, "no commit yet");
        write(
            root,
            ".git/packed-refs",
            &format!("# pack-refs\n{B} refs/heads/main\n"),
        );
        assert_eq!(head_commit(root).as_deref(), Some(B));
        write(root, ".git/refs/heads/main", &format!("{A}\n"));
        assert_eq!(head_commit(root).as_deref(), Some(A), "a loose ref wins");
        write(root, ".git/HEAD", &format!("{B}\n"));
        assert_eq!(head_commit(root).as_deref(), Some(B), "detached");
        write(root, ".git/HEAD", "ref: ../../etc/passwd\n");
        assert_eq!(head_commit(root), None);
    }

    #[test]
    fn follows_the_git_file_of_a_worktree_and_reads_the_user() {
        let dir = tempfile::tempdir().unwrap();
        let main = dir.path().join("main");
        write(&main, ".git/refs/heads/feature", &format!("{A}\n"));
        write(
            &main,
            ".git/config",
            "[core]\n\tbare = false\n[user]\n\tname = \"Ada Lovelace\"\n\temail = a@b.c\n",
        );
        write(&main, ".git/worktrees/wt/HEAD", "ref: refs/heads/feature\n");
        write(&main, ".git/worktrees/wt/commondir", "../..\n");
        let wt = dir.path().join("wt");
        write(
            &wt,
            ".git",
            &format!("gitdir: {}\n", main.join(".git/worktrees/wt").display()),
        );
        assert_eq!(head_commit(&wt).as_deref(), Some(A));
        assert_eq!(user_name(&wt).as_deref(), Some("Ada Lovelace"));
        assert_eq!(user_name(dir.path()), None);
    }
}
