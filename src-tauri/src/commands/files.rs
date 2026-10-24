//! Reading project files.

use std::path::Path;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::error::{AppError, AppResult};
use crate::index::model::is_markdown;
use crate::index::scanner::file_entry;
use crate::state::AppState;

/// Files above this size are refused.
pub const MAX_MARKDOWN_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileContent {
    pub rel_path: String,
    /// UTF-8 text with the byte-order mark removed; invalid bytes are replaced. Line endings are
    /// kept as they are on disk.
    pub content: String,
    pub size: u64,
    pub modified_ms: i64,
}

/// Decodes file bytes for display: strips a UTF-8 BOM and replaces invalid sequences.
pub fn decode_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    String::from_utf8_lossy(bytes).into_owned()
}

/// Reads a markdown file that the caller already resolved inside the root.
pub fn read_markdown_file(path: &Path, rel_path: &str) -> AppResult<FileContent> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(AppError::InvalidPath(rel_path.to_owned()));
    }
    if metadata.len() > MAX_MARKDOWN_BYTES {
        return Err(AppError::TooLarge {
            size: metadata.len(),
        });
    }
    let bytes = std::fs::read(path)?;
    let entry = file_entry(rel_path.to_owned(), &metadata);
    Ok(FileContent {
        rel_path: rel_path.to_owned(),
        content: decode_text(&bytes),
        size: entry.size,
        modified_ms: entry.modified_ms,
    })
}

#[tauri::command]
pub fn read_markdown(state: State<'_, AppState>, rel_path: String) -> AppResult<FileContent> {
    state.with_workspace(|ws| {
        let name = rel_path.rsplit('/').next().unwrap_or(&rel_path);
        if !is_markdown(name) {
            return Err(AppError::InvalidPath(format!(
                "{rel_path} is not a markdown file"
            )));
        }
        let path = ws.guard.resolve(&rel_path)?;
        read_markdown_file(&path, &rel_path)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_the_bom_and_keeps_line_endings() {
        assert_eq!(decode_text(b"\xEF\xBB\xBF# T\r\nx\n"), "# T\r\nx\n");
        assert_eq!(decode_text(b"plain"), "plain");
    }

    #[test]
    fn replaces_invalid_utf8() {
        assert_eq!(decode_text(b"a\xFFb"), "a\u{FFFD}b");
    }

    #[test]
    fn reads_content_and_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        std::fs::write(&path, "# Hello\n").unwrap();
        let c = read_markdown_file(&path, "a.md").unwrap();
        assert_eq!(c.content, "# Hello\n");
        assert_eq!(c.size, 8);
        assert!(c.modified_ms > 0);
        assert_eq!(c.rel_path, "a.md");
    }

    #[test]
    fn refuses_folders_and_huge_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            read_markdown_file(dir.path(), "x.md"),
            Err(AppError::InvalidPath(_))
        ));
        let big = dir.path().join("big.md");
        let f = std::fs::File::create(&big).unwrap();
        f.set_len(MAX_MARKDOWN_BYTES + 1).unwrap();
        assert!(matches!(
            read_markdown_file(&big, "big.md"),
            Err(AppError::TooLarge { .. })
        ));
    }
}
