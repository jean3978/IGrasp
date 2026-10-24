//! Recently opened folders (`recent-folders.json`), most recent first.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MAX_RECENT: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    pub name: String,
    pub last_opened_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RecentFile {
    pub version: u32,
    pub entries: Vec<RecentEntry>,
}

impl Default for RecentFile {
    fn default() -> Self {
        Self {
            version: 1,
            entries: Vec::new(),
        }
    }
}

/// A recent folder as shown on the welcome screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecentFolder {
    pub path: String,
    pub name: String,
    pub last_opened_ms: i64,
    /// False when the folder was moved or deleted since it was opened.
    pub exists: bool,
}

fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

impl RecentFile {
    /// Moves `path` to the front (adding it if needed) and trims the list.
    pub fn touch(&mut self, path: &str, name: &str, now_ms: i64) {
        self.entries.retain(|e| !same_path(&e.path, path));
        self.entries.insert(
            0,
            RecentEntry {
                path: path.to_owned(),
                name: name.to_owned(),
                last_opened_ms: now_ms,
            },
        );
        self.entries.truncate(MAX_RECENT);
    }

    pub fn remove(&mut self, path: &str) {
        self.entries.retain(|e| !same_path(&e.path, path));
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn list(&self) -> Vec<RecentFolder> {
        self.entries
            .iter()
            .map(|e| RecentFolder {
                path: e.path.clone(),
                name: e.name.clone(),
                last_opened_ms: e.last_opened_ms,
                exists: Path::new(&e.path).is_dir(),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn touch_moves_to_front_without_duplicates() {
        let mut r = RecentFile::default();
        r.touch("/a", "a", 1);
        r.touch("/b", "b", 2);
        r.touch("/a", "a", 3);
        let paths: Vec<_> = r.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["/a", "/b"]);
        assert_eq!(r.entries[0].last_opened_ms, 3);
    }

    #[test]
    fn keeps_at_most_ten_entries() {
        let mut r = RecentFile::default();
        for i in 0..15 {
            r.touch(&format!("/p{i}"), "p", i);
        }
        assert_eq!(r.entries.len(), MAX_RECENT);
        assert_eq!(r.entries[0].path, "/p14");
    }

    #[test]
    fn reports_missing_folders() {
        let dir = tempfile::tempdir().unwrap();
        let mut r = RecentFile::default();
        r.touch(&dir.path().to_string_lossy(), "tmp", 1);
        r.touch("/definitely/not/here/igrasp", "gone", 2);
        let list = r.list();
        assert!(!list[0].exists);
        assert!(list[1].exists);
        r.remove("/definitely/not/here/igrasp");
        assert_eq!(r.entries.len(), 1);
    }
}
