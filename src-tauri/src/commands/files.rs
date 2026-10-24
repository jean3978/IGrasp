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

/// Media that a document may ask to open with the system's default application (the video
/// fallback). Anything else, executables and scripts in particular, is refused: a document must
/// never be able to launch a program through a link.
const EXTERNAL_MEDIA: [&str; 18] = [
    "mp4", "webm", "ogg", "ogv", "mov", "m4v", "mkv", "avi", "mp3", "wav", "flac", "m4a", "png",
    "jpg", "jpeg", "gif", "webp", "svg",
];

pub fn is_external_media(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(stem, ext)| {
        !stem.is_empty() && EXTERNAL_MEDIA.iter().any(|m| ext.eq_ignore_ascii_case(m))
    })
}

/// Opens a media file of the open folder with the system's default application.
#[tauri::command]
pub fn open_external(state: State<'_, AppState>, rel_path: String) -> AppResult<()> {
    let name = rel_path.rsplit('/').next().unwrap_or(&rel_path);
    if !is_external_media(name) {
        return Err(AppError::InvalidPath(format!(
            "{rel_path} cannot be opened externally"
        )));
    }
    let path = state.with_workspace(|ws| ws.guard.resolve(&rel_path))?;
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}

/// Text files above this size are refused by the code viewer.
pub const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
/// At most this much of a text file is returned; the rest is readable in an editor.
pub const MAX_TEXT_RETURNED: usize = 1024 * 1024;
/// How much of a file is inspected to decide whether it is text.
const SNIFF_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TextFileContent {
    pub rel_path: String,
    /// Decoded like markdown (BOM removed, invalid bytes replaced), cut at `MAX_TEXT_RETURNED`.
    pub content: String,
    pub size: u64,
    pub modified_ms: i64,
    /// The file is longer than what `content` holds.
    pub truncated: bool,
}

/// The heuristic git uses: no NUL byte, and at most 10 % of the bytes in invalid UTF-8
/// sequences (a sequence cut by the end of the sample does not count).
pub fn looks_like_text(sample: &[u8]) -> bool {
    if sample.contains(&0) {
        return false;
    }
    let mut invalid = 0usize;
    let mut chunks = sample.utf8_chunks().peekable();
    while let Some(chunk) = chunks.next() {
        let bad = chunk.invalid().len();
        let at_end = chunks.peek().is_none() && chunk.valid().len() + bad > 0;
        // A multibyte character cut by the sample boundary is not invalid.
        if !(at_end && bad < 4 && sample.len() == SNIFF_BYTES) {
            invalid += bad;
        }
    }
    invalid * 10 <= sample.len()
}

/// Cuts `text` to at most `max` bytes on a character boundary.
fn truncate_on_char(text: &mut String, max: usize) -> bool {
    if text.len() <= max {
        return false;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    true
}

/// Reads a text file that the caller already resolved inside the root.
pub fn read_text_file_at(path: &Path, rel_path: &str) -> AppResult<TextFileContent> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(AppError::InvalidPath(rel_path.to_owned()));
    }
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(AppError::TooLarge {
            size: metadata.len(),
        });
    }
    let bytes = std::fs::read(path)?;
    if !looks_like_text(&bytes[..bytes.len().min(SNIFF_BYTES)]) {
        return Err(AppError::NotText(rel_path.to_owned()));
    }
    let entry = file_entry(rel_path.to_owned(), &metadata);
    let mut content = decode_text(&bytes);
    let truncated = truncate_on_char(&mut content, MAX_TEXT_RETURNED);
    Ok(TextFileContent {
        rel_path: rel_path.to_owned(),
        content,
        size: entry.size,
        modified_ms: entry.modified_ms,
        truncated,
    })
}

/// Reads any text file of the open folder (source code, configuration, logs…).
#[tauri::command]
pub fn read_text_file(state: State<'_, AppState>, rel_path: String) -> AppResult<TextFileContent> {
    state.with_workspace(|ws| {
        let path = ws.guard.resolve(&rel_path)?;
        read_text_file_at(&path, &rel_path)
    })
}

/// Extensions never opened with the default application: executables, installers, shortcuts and
/// scripts that Windows or a desktop environment would run instead of opening.
const NEVER_OPENED: [&str; 31] = [
    "exe",
    "com",
    "bat",
    "cmd",
    "ps1",
    "psm1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "msi",
    "msp",
    "scr",
    "pif",
    "lnk",
    "reg",
    "hta",
    "cpl",
    "inf",
    "url",
    "application",
    "gadget",
    "jar",
    "sh",
    "run",
    "appimage",
    "desktop",
    "command",
    "app",
];

pub fn is_never_opened(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(_, ext)| NEVER_OPENED.iter().any(|x| ext.eq_ignore_ascii_case(x)))
}

#[cfg(unix)]
fn is_executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &std::fs::Metadata) -> bool {
    false
}

/// Checks that a resolved file may be handed to the default application: a regular text file,
/// not executable, with no extension that would make the system run it.
pub fn check_openable(path: &Path, rel_path: &str) -> AppResult<()> {
    let name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    let refuse = |why: &str| {
        Err(AppError::Forbidden(format!(
            "{rel_path} is not opened from IGrasp ({why}). Use Reveal in file manager instead."
        )))
    };
    if is_never_opened(name) {
        return refuse("programs and scripts are never launched");
    }
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(AppError::InvalidPath(rel_path.to_owned()));
    }
    if is_executable(&metadata) {
        return refuse("the file is executable");
    }
    let mut sample = vec![0u8; SNIFF_BYTES];
    let n = std::io::Read::read(&mut std::fs::File::open(path)?, &mut sample)?;
    sample.truncate(n);
    if !looks_like_text(&sample) {
        return refuse("only text files are opened");
    }
    Ok(())
}

/// Opens a text file of the open folder with the system's default application (the code
/// viewer's "Open in default editor"). Only ever called from a user click.
#[tauri::command]
pub fn open_with_default_app(state: State<'_, AppState>, rel_path: String) -> AppResult<()> {
    let path = state.with_workspace(|ws| ws.guard.resolve(&rel_path))?;
    check_openable(&path, &rel_path)?;
    log::info!("opening {rel_path} with the default application");
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}

/// Shows a file or folder of the open folder in the system file manager.
#[tauri::command]
pub fn reveal_in_file_manager(state: State<'_, AppState>, rel_path: String) -> AppResult<()> {
    let path = state.with_workspace(|ws| ws.guard.resolve(&rel_path))?;
    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_detection() {
        assert!(looks_like_text(b"fn main() {}\n"));
        assert!(looks_like_text("héllo wörld ✓".as_bytes()));
        assert!(looks_like_text(b""));
        assert!(!looks_like_text(b"ELF\0\x01\x02"));
        // Latin-1 text with a few accents is still text; random bytes are not.
        assert!(looks_like_text(
            b"caf\xE9 ol\xE9, a long enough line of plain ascii text"
        ));
        assert!(!looks_like_text(&[0xFF, 0xFE, 0xFD, 0x80, 0x81, b'a']));
    }

    #[test]
    fn a_character_cut_by_the_sample_is_not_invalid() {
        let mut sample = vec![b'a'; SNIFF_BYTES - 1];
        sample.push(0xE2); // first byte of a 3-byte character
        assert!(looks_like_text(&sample));
    }

    #[test]
    fn reads_text_and_truncates_big_files() {
        let dir = tempfile::tempdir().unwrap();
        let small = dir.path().join("main.rs");
        std::fs::write(&small, "\u{FEFF}fn main() {}\r\n").unwrap();
        let c = read_text_file_at(&small, "main.rs").unwrap();
        assert_eq!(c.content, "fn main() {}\r\n");
        assert!(!c.truncated);

        let big = dir.path().join("big.log");
        let line = "é".repeat(100) + "\n";
        std::fs::write(&big, line.repeat(MAX_TEXT_RETURNED / line.len() + 10)).unwrap();
        let c = read_text_file_at(&big, "big.log").unwrap();
        assert!(c.truncated);
        assert!(c.content.len() <= MAX_TEXT_RETURNED);
        assert!(c.size > MAX_TEXT_RETURNED as u64);
    }

    #[test]
    fn refuses_binary_huge_and_folders() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("a.png");
        std::fs::write(&bin, b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR").unwrap();
        assert!(matches!(
            read_text_file_at(&bin, "a.png"),
            Err(AppError::NotText(_))
        ));
        let huge = dir.path().join("huge.txt");
        std::fs::File::create(&huge)
            .unwrap()
            .set_len(MAX_TEXT_BYTES + 1)
            .unwrap();
        assert!(matches!(
            read_text_file_at(&huge, "huge.txt"),
            Err(AppError::TooLarge { .. })
        ));
        assert!(matches!(
            read_text_file_at(dir.path(), "x"),
            Err(AppError::InvalidPath(_))
        ));
    }

    #[test]
    fn programs_and_scripts_are_never_opened() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "run.exe",
            "a.BAT",
            "x.cmd",
            "s.ps1",
            "app.js",
            "go.sh",
            "l.lnk",
            "i.desktop",
        ] {
            let p = dir.path().join(name);
            std::fs::write(&p, "echo hi\n").unwrap();
            assert!(
                matches!(check_openable(&p, name), Err(AppError::Forbidden(_))),
                "{name}"
            );
        }
        let ok = dir.path().join("main.rs");
        std::fs::write(&ok, "fn main() {}\n").unwrap();
        assert!(check_openable(&ok, "main.rs").is_ok());
        let bin = dir.path().join("data.bin");
        std::fs::write(&bin, b"\0\0\0").unwrap();
        assert!(matches!(
            check_openable(&bin, "data.bin"),
            Err(AppError::Forbidden(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn executable_files_are_never_opened() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("tool");
        std::fs::write(&p, "#!/bin/sh\necho hi\n").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(
            check_openable(&p, "tool"),
            Err(AppError::Forbidden(_))
        ));
    }

    #[test]
    fn only_media_can_be_opened_externally() {
        for yes in ["clip.mp4", "a/b/Movie.MOV", "x.webm", "pic.PNG"] {
            assert!(is_external_media(yes), "{yes}");
        }
        for no in [
            "run.exe",
            "script.bat",
            "evil.cmd",
            "a.ps1",
            "doc.md",
            "mp4",
            ".mp4",
            "x.sh",
        ] {
            assert!(!is_external_media(no), "{no}");
        }
    }

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
