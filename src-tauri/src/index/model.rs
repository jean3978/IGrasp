//! In-memory index of the markdown files under the root.
//!
//! Only directories that contain markdown (directly or below) exist in the index, so a listing
//! never shows an empty folder. Paths are root-relative with `/` separators; `""` is the root.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileEntry {
    pub name: String,
    pub rel_path: String,
    pub size: u64,
    pub modified_ms: i64,
    /// Shown only because dotfiles or ignored files are displayed.
    pub hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DirEntry {
    pub name: String,
    pub rel_path: String,
    /// Markdown files in this folder and all its subfolders.
    pub md_count: u32,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DirListing {
    pub rel_path: String,
    pub generation: u64,
    pub dirs: Vec<DirEntry>,
    pub files: Vec<FileEntry>,
}

#[derive(Debug, Clone, Default)]
struct DirNode {
    subdirs: BTreeSet<String>,
    files: BTreeSet<String>,
    md_count: u32,
    hidden: bool,
}

/// Differences between two versions of (part of) the index.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Changes {
    pub added: Vec<FileEntry>,
    pub modified: Vec<FileEntry>,
    pub removed: Vec<String>,
}

impl Changes {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.modified.is_empty() && self.removed.is_empty()
    }
}

#[derive(Debug, Clone)]
pub struct Index {
    dirs: HashMap<String, DirNode>,
    files: HashMap<String, FileEntry>,
}

impl Default for Index {
    fn default() -> Self {
        let mut dirs = HashMap::new();
        dirs.insert(String::new(), DirNode::default());
        Self {
            dirs,
            files: HashMap::new(),
        }
    }
}

pub fn parent_of(rel: &str) -> &str {
    rel.rfind('/').map_or("", |i| &rel[..i])
}

pub fn name_of(rel: &str) -> &str {
    rel.rfind('/').map_or(rel, |i| &rel[i + 1..])
}

/// Whether `rel` is `dir` itself or inside it.
pub fn is_within(rel: &str, dir: &str) -> bool {
    dir.is_empty()
        || rel == dir
        || (rel.len() > dir.len() && rel.starts_with(dir) && rel.as_bytes()[dir.len()] == b'/')
}

pub fn is_markdown(name: &str) -> bool {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => {
            ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown")
        }
        _ => false,
    }
}

/// Case-insensitive natural order: `file2` sorts before `file10`.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.as_bytes(), b.as_bytes());
    loop {
        match (a.first(), b.first()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let da = a.iter().take_while(|c| c.is_ascii_digit()).count();
                let db = b.iter().take_while(|c| c.is_ascii_digit()).count();
                let (na, nb) = (&a[..da], &b[..db]);
                let trim = |n: &[u8]| -> usize { n.iter().take_while(|&&c| c == b'0').count() };
                let (ta, tb) = (&na[trim(na)..], &nb[trim(nb)..]);
                let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if ord != Ordering::Equal {
                    return ord;
                }
                a = &a[da..];
                b = &b[db..];
            }
            (Some(x), Some(y)) => {
                let ord = x.to_ascii_lowercase().cmp(&y.to_ascii_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                a = &a[1..];
                b = &b[1..];
            }
        }
    }
}

impl Index {
    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    /// Number of folders, not counting the root.
    pub fn dir_count(&self) -> usize {
        self.dirs.len() - 1
    }

    pub fn file(&self, rel: &str) -> Option<&FileEntry> {
        self.files.get(rel)
    }

    pub fn has_dir(&self, rel: &str) -> bool {
        self.dirs.contains_key(rel)
    }

    /// Marks a folder as hidden (dotfolder or ignored). Applies when the folder exists or is
    /// created later by `insert_file`.
    pub fn set_dir_hidden(&mut self, rel: &str, hidden: bool) {
        if let Some(d) = self.dirs.get_mut(rel) {
            d.hidden = hidden;
        }
    }

    /// Inserts or replaces a file. Returns true if the file is new.
    pub fn insert_file(&mut self, entry: FileEntry) -> bool {
        let rel = entry.rel_path.clone();
        let is_new = self.files.insert(rel.clone(), entry).is_none();
        if !is_new {
            return false;
        }
        // Create missing ancestors, then register the file and bump counts up the chain.
        let mut child = rel.as_str();
        loop {
            let parent = parent_of(child).to_owned();
            let node = self.dirs.entry(parent.clone()).or_default();
            node.md_count += 1;
            if child == rel {
                node.files.insert(name_of(child).to_owned());
            } else {
                node.subdirs.insert(name_of(child).to_owned());
            }
            if parent.is_empty() {
                break;
            }
            child = &rel[..parent.len()];
        }
        true
    }

    /// Removes a file and prunes folders left without markdown. Returns true if it existed.
    pub fn remove_file(&mut self, rel: &str) -> bool {
        if self.files.remove(rel).is_none() {
            return false;
        }
        let mut child = rel;
        loop {
            let parent = parent_of(child);
            let Some(node) = self.dirs.get_mut(parent) else {
                break;
            };
            node.md_count = node.md_count.saturating_sub(1);
            if child == rel {
                node.files.remove(name_of(child));
            }
            let empty = node.md_count == 0 && !parent.is_empty();
            if empty {
                self.dirs.remove(parent);
                if let Some(grand) = self.dirs.get_mut(parent_of(parent)) {
                    grand.subdirs.remove(name_of(parent));
                }
            }
            if parent.is_empty() {
                break;
            }
            child = parent;
        }
        true
    }

    /// Removes every file under `dir`. Returns the removed paths.
    pub fn remove_dir(&mut self, dir: &str) -> Vec<String> {
        let mut removed: Vec<String> = self
            .files
            .keys()
            .filter(|k| is_within(k, dir))
            .cloned()
            .collect();
        removed.sort();
        for rel in &removed {
            self.remove_file(rel);
        }
        removed
    }

    /// Lists a folder: subfolders first, then files, both in natural order.
    pub fn list_dir(&self, rel: &str) -> Option<(Vec<DirEntry>, Vec<FileEntry>)> {
        let node = self.dirs.get(rel)?;
        let join = |name: &str| {
            if rel.is_empty() {
                name.to_owned()
            } else {
                format!("{rel}/{name}")
            }
        };
        let mut dirs: Vec<DirEntry> = node
            .subdirs
            .iter()
            .filter_map(|name| {
                let path = join(name);
                let d = self.dirs.get(&path)?;
                (d.md_count > 0).then(|| DirEntry {
                    name: name.clone(),
                    rel_path: path,
                    md_count: d.md_count,
                    hidden: d.hidden,
                })
            })
            .collect();
        let mut files: Vec<FileEntry> = node
            .files
            .iter()
            .filter_map(|name| self.files.get(&join(name)).cloned())
            .collect();
        dirs.sort_by(|a, b| natural_cmp(&a.name, &b.name));
        files.sort_by(|a, b| natural_cmp(&a.name, &b.name));
        Some((dirs, files))
    }

    /// Files under `dir` (all files when `dir` is empty), sorted by path.
    pub fn files_within(&self, dir: &str) -> BTreeMap<&str, &FileEntry> {
        self.files
            .iter()
            .filter(|(k, _)| is_within(k, dir))
            .map(|(k, v)| (k.as_str(), v))
            .collect()
    }

    /// Files sorted by modification time, newest first (ties by path), with the total count.
    pub fn recent_files(&self, offset: usize, limit: usize) -> (usize, Vec<FileEntry>) {
        let mut all: Vec<&FileEntry> = self.files.values().collect();
        all.sort_by(|a, b| {
            b.modified_ms
                .cmp(&a.modified_ms)
                .then_with(|| a.rel_path.cmp(&b.rel_path))
        });
        let page = all.into_iter().skip(offset).take(limit).cloned().collect();
        (self.files.len(), page)
    }

    /// What changed under `dir` between `self` (old) and `new`.
    pub fn diff_within(&self, new: &Index, dir: &str) -> Changes {
        let old_files = self.files_within(dir);
        let new_files = new.files_within(dir);
        let mut changes = Changes::default();
        for (rel, entry) in &new_files {
            match old_files.get(rel) {
                None => changes.added.push((*entry).clone()),
                Some(old) if old.modified_ms != entry.modified_ms || old.size != entry.size => {
                    changes.modified.push((*entry).clone())
                }
                Some(_) => {}
            }
        }
        for rel in old_files.keys() {
            if !new_files.contains_key(rel) {
                changes.removed.push((*rel).to_owned());
            }
        }
        changes
    }
}

#[cfg(test)]
pub fn entry(rel: &str) -> FileEntry {
    FileEntry {
        name: name_of(rel).to_owned(),
        rel_path: rel.to_owned(),
        size: 1,
        modified_ms: 1,
        hidden: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index(paths: &[&str]) -> Index {
        let mut i = Index::default();
        for p in paths {
            i.insert_file(entry(p));
        }
        i
    }

    #[test]
    fn markdown_extensions_are_case_insensitive() {
        for yes in ["a.md", "A.MD", "b.Markdown", "c.d.md"] {
            assert!(is_markdown(yes), "{yes}");
        }
        for no in ["a.mdx", "md", ".md", "a.txt", "readme"] {
            assert!(!is_markdown(no), "{no}");
        }
    }

    #[test]
    fn natural_order() {
        let mut v = vec!["file10.md", "File2.md", "file1.md", "a.md", "file02b.md"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(
            v,
            ["a.md", "file1.md", "File2.md", "file02b.md", "file10.md"]
        );
    }

    #[test]
    fn counts_markdown_up_the_tree() {
        let i = index(&[
            "README.md",
            "docs/a.md",
            "docs/guide/b.md",
            "docs/guide/c.md",
        ]);
        let (dirs, files) = i.list_dir("").unwrap();
        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0].name, "docs");
        assert_eq!(dirs[0].md_count, 3);
        assert_eq!(files[0].name, "README.md");
        let (dirs, files) = i.list_dir("docs").unwrap();
        assert_eq!(dirs[0].rel_path, "docs/guide");
        assert_eq!(dirs[0].md_count, 2);
        assert_eq!(files.len(), 1);
        assert_eq!(i.dir_count(), 2);
    }

    #[test]
    fn removing_the_last_file_prunes_empty_folders() {
        let mut i = index(&["README.md", "docs/deep/x/a.md"]);
        assert!(i.has_dir("docs/deep/x"));
        assert!(i.remove_file("docs/deep/x/a.md"));
        assert!(!i.has_dir("docs"));
        assert!(!i.has_dir("docs/deep/x"));
        let (dirs, _) = i.list_dir("").unwrap();
        assert!(dirs.is_empty());
        assert!(!i.remove_file("docs/deep/x/a.md"));
    }

    #[test]
    fn remove_dir_removes_its_subtree_only() {
        let mut i = index(&["docs/a.md", "docs/b/c.md", "docsx/d.md"]);
        let removed = i.remove_dir("docs");
        assert_eq!(removed, ["docs/a.md", "docs/b/c.md"]);
        assert!(i.file("docsx/d.md").is_some());
    }

    #[test]
    fn diff_reports_added_modified_removed() {
        let old = index(&["a.md", "docs/b.md", "docs/c.md"]);
        let mut new = index(&["a.md", "docs/b.md", "docs/new.md"]);
        let mut changed = entry("docs/b.md");
        changed.modified_ms = 2;
        new.insert_file(changed.clone());
        new.files.insert("docs/b.md".into(), changed);
        let c = old.diff_within(&new, "docs");
        assert_eq!(c.added.len(), 1);
        assert_eq!(c.added[0].rel_path, "docs/new.md");
        assert_eq!(c.modified.len(), 1);
        assert_eq!(c.removed, ["docs/c.md"]);
        assert!(old.diff_within(&old, "").is_empty());
    }

    #[test]
    fn recent_files_are_newest_first_and_paged() {
        let mut i = Index::default();
        for (rel, ms) in [("a.md", 5), ("b.md", 9), ("c.md", 5), ("d/e.md", 1)] {
            let mut e = entry(rel);
            e.modified_ms = ms;
            i.insert_file(e);
        }
        let (total, page) = i.recent_files(0, 3);
        assert_eq!(total, 4);
        let names: Vec<_> = page.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(names, ["b.md", "a.md", "c.md"]);
        let (_, rest) = i.recent_files(3, 3);
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].rel_path, "d/e.md");
        assert!(i.recent_files(10, 3).1.is_empty());
    }

    #[test]
    fn is_within_respects_segment_boundaries() {
        assert!(is_within("docs/a.md", "docs"));
        assert!(is_within("docs", "docs"));
        assert!(!is_within("docsx/a.md", "docs"));
        assert!(is_within("anything", ""));
    }
}
