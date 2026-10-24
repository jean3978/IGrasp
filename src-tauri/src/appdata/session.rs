//! Per-folder session state (`sessions.json`): open tabs, scroll positions, layout.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MAX_SESSIONS: usize = 50;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionTab {
    pub rel_path: String,
    pub pinned: bool,
    pub scroll_top: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SidebarState {
    pub visible: bool,
    pub width_px: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Session {
    pub version: u32,
    pub tabs: Vec<SessionTab>,
    /// Relative path of the active document tab.
    pub active_tab: Option<String>,
    pub expanded_dirs: Vec<String>,
    pub sidebar: SidebarState,
    pub show_dotfiles: bool,
    pub show_ignored: bool,
    pub saved_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionsFile {
    pub version: u32,
    /// Keyed by the canonical path of the opened folder.
    pub sessions: BTreeMap<String, Session>,
}

impl Default for SessionsFile {
    fn default() -> Self {
        Self {
            version: 1,
            sessions: BTreeMap::new(),
        }
    }
}

impl SessionsFile {
    pub fn get(&self, root: &str) -> Option<Session> {
        self.sessions.get(root).cloned()
    }

    /// Stores `session` for `root` and evicts the least recently saved sessions beyond the limit.
    pub fn put(&mut self, root: &str, mut session: Session, now_ms: i64) {
        session.saved_at_ms = now_ms;
        self.sessions.insert(root.to_owned(), session);
        while self.sessions.len() > MAX_SESSIONS {
            let oldest = self
                .sessions
                .iter()
                .min_by_key(|(_, s)| s.saved_at_ms)
                .map(|(k, _)| k.clone());
            match oldest {
                Some(key) => self.sessions.remove(&key),
                None => break,
            };
        }
    }
}

#[cfg(test)]
pub fn sample_session() -> Session {
    Session {
        version: 1,
        tabs: vec![SessionTab {
            rel_path: "README.md".into(),
            pinned: true,
            scroll_top: 120.0,
        }],
        active_tab: Some("README.md".into()),
        expanded_dirs: vec!["docs".into()],
        sidebar: SidebarState {
            visible: true,
            width_px: 280.0,
        },
        show_dotfiles: false,
        show_ignored: false,
        saved_at_ms: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn put_then_get() {
        let mut f = SessionsFile::default();
        f.put("/root", sample_session(), 42);
        let s = f.get("/root").unwrap();
        assert_eq!(s.saved_at_ms, 42);
        assert_eq!(s.tabs[0].rel_path, "README.md");
        assert!(f.get("/other").is_none());
    }

    #[test]
    fn evicts_least_recently_saved() {
        let mut f = SessionsFile::default();
        for i in 0..(MAX_SESSIONS as i64 + 5) {
            f.put(&format!("/r{i}"), sample_session(), i);
        }
        assert_eq!(f.sessions.len(), MAX_SESSIONS);
        assert!(f.get("/r0").is_none());
        assert!(f.get("/r4").is_none());
        assert!(f.get("/r5").is_some());
    }
}
