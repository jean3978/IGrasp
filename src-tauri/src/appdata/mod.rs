//! App state persisted as versioned JSON files in the OS app-data folder.
//!
//! Writes are atomic (temp file in the same folder, then rename) and serialized through a mutex.
//! A file that cannot be parsed is moved aside as `<name>.corrupt-<timestamp>.json` and defaults
//! are used, so a broken file never prevents the app from starting.

pub mod conversations;
pub mod recent;
pub mod session;
pub mod settings;

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{AppError, AppResult};
use recent::RecentFile;
use session::SessionsFile;
use settings::Settings;

pub const SETTINGS_FILE: &str = "settings.json";
pub const RECENT_FILE: &str = "recent-folders.json";
pub const SESSIONS_FILE: &str = "sessions.json";

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

struct Cache {
    settings: Option<Settings>,
    recent: Option<RecentFile>,
    sessions: Option<SessionsFile>,
    /// Files recovered from corruption that the frontend has not been told about yet.
    recovered: Vec<String>,
}

pub struct AppData {
    dir: PathBuf,
    cache: Mutex<Cache>,
}

impl AppData {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            cache: Mutex::new(Cache {
                settings: None,
                recent: None,
                sessions: None,
                recovered: Vec::new(),
            }),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Names of files that were corrupt and replaced by defaults since the last call.
    pub fn take_recovered(&self) -> Vec<String> {
        std::mem::take(&mut self.lock().recovered)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Cache> {
        // A panic while holding the lock leaves the cache usable; recover instead of poisoning.
        self.cache.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn settings(&self) -> AppResult<Settings> {
        let mut cache = self.lock();
        self.ensure_settings(&mut cache)?;
        Ok(cache.settings.clone().unwrap_or_default())
    }

    pub fn update_settings(&self, f: impl FnOnce(&mut Settings)) -> AppResult<Settings> {
        let mut cache = self.lock();
        self.ensure_settings(&mut cache)?;
        let mut settings = cache.settings.clone().unwrap_or_default();
        f(&mut settings);
        settings.normalize();
        write_json(&self.dir, SETTINGS_FILE, &settings)?;
        cache.settings = Some(settings.clone());
        Ok(settings)
    }

    pub fn with_recent<R>(&self, f: impl FnOnce(&mut RecentFile) -> R) -> AppResult<R> {
        let mut cache = self.lock();
        if cache.recent.is_none() {
            let (value, recovered) = read_json::<RecentFile>(&self.dir, RECENT_FILE)?;
            cache.recovered.extend(recovered);
            cache.recent = Some(value);
        }
        let recent = cache.recent.get_or_insert_with(RecentFile::default);
        let before = serde_json::to_value(&*recent).ok();
        let result = f(recent);
        if serde_json::to_value(&*recent).ok() != before {
            write_json(&self.dir, RECENT_FILE, &*recent)?;
        }
        Ok(result)
    }

    pub fn with_sessions<R>(&self, f: impl FnOnce(&mut SessionsFile) -> R) -> AppResult<R> {
        let mut cache = self.lock();
        if cache.sessions.is_none() {
            let (value, recovered) = read_json::<SessionsFile>(&self.dir, SESSIONS_FILE)?;
            cache.recovered.extend(recovered);
            cache.sessions = Some(value);
        }
        let sessions = cache.sessions.get_or_insert_with(SessionsFile::default);
        let before = serde_json::to_value(&*sessions).ok();
        let result = f(sessions);
        if serde_json::to_value(&*sessions).ok() != before {
            write_json(&self.dir, SESSIONS_FILE, &*sessions)?;
        }
        Ok(result)
    }

    fn ensure_settings(&self, cache: &mut Cache) -> AppResult<()> {
        if cache.settings.is_none() {
            let (mut value, recovered) = read_json::<Settings>(&self.dir, SETTINGS_FILE)?;
            value.normalize();
            cache.recovered.extend(recovered);
            cache.settings = Some(value);
        }
        Ok(())
    }
}

/// Reads `name` from `dir`. Missing file → defaults. Unparsable file → moved aside, defaults,
/// and the file name is returned so the user can be told.
pub fn read_json<T: DeserializeOwned + Default>(
    dir: &Path,
    name: &str,
) -> AppResult<(T, Option<String>)> {
    let path = dir.join(name);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((T::default(), None)),
        Err(e) => return Err(AppError::AppData(format!("cannot read {name}: {e}"))),
    };
    match serde_json::from_slice::<T>(&bytes) {
        Ok(value) => Ok((value, None)),
        Err(err) => {
            let stem = name.trim_end_matches(".json");
            let aside = dir.join(format!("{stem}.corrupt-{}.json", now_ms()));
            log::warn!("{name} is corrupt ({err}); moved to {}", aside.display());
            fs::rename(&path, &aside)
                .map_err(|e| AppError::AppData(format!("cannot move corrupt {name}: {e}")))?;
            Ok((T::default(), Some(name.to_owned())))
        }
    }
}

/// Atomically writes `value` as pretty JSON to `dir/name`.
pub fn write_json<T: Serialize + ?Sized>(dir: &Path, name: &str, value: &T) -> AppResult<()> {
    let err = |e: &dyn std::fmt::Display| AppError::AppData(format!("cannot write {name}: {e}"));
    fs::create_dir_all(dir).map_err(|e| err(&e))?;
    let mut json = serde_json::to_vec_pretty(value).map_err(|e| err(&e))?;
    json.push(b'\n');
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| err(&e))?;
    tmp.write_all(&json).map_err(|e| err(&e))?;
    tmp.as_file().sync_all().map_err(|e| err(&e))?;
    tmp.persist(dir.join(name)).map_err(|e| err(&e.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_files_give_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let data = AppData::new(dir.path().to_path_buf());
        assert_eq!(data.settings().unwrap(), Settings::default());
        assert!(data.take_recovered().is_empty());
    }

    #[test]
    fn settings_round_trip_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let data = AppData::new(dir.path().to_path_buf());
        data.update_settings(|s| s.font_size = 18).unwrap();
        let reloaded = AppData::new(dir.path().to_path_buf());
        assert_eq!(reloaded.settings().unwrap().font_size, 18);
    }

    #[test]
    fn corrupt_file_is_moved_aside_and_reported() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SETTINGS_FILE), b"{ not json").unwrap();
        let data = AppData::new(dir.path().to_path_buf());
        assert_eq!(data.settings().unwrap(), Settings::default());
        assert_eq!(data.take_recovered(), vec![SETTINGS_FILE.to_owned()]);
        assert!(data.take_recovered().is_empty());
        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().any(|n| n.starts_with("settings.corrupt-")));
        assert!(!names.contains(&SETTINGS_FILE.to_owned()));
    }

    #[test]
    fn write_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        write_json(dir.path(), "a.json", &serde_json::json!({ "x": 1 })).unwrap();
        write_json(dir.path(), "a.json", &serde_json::json!({ "x": 2 })).unwrap();
        let names: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(names.len(), 1);
        let content = fs::read_to_string(dir.path().join("a.json")).unwrap();
        assert!(content.contains("\"x\": 2"));
    }

    #[test]
    fn failed_write_keeps_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        write_json(dir.path(), "a.json", &serde_json::json!({ "x": 1 })).unwrap();
        // A directory where the target should be makes the final rename fail.
        let blocked = dir.path().join("b.json");
        fs::create_dir(&blocked).unwrap();
        assert!(write_json(dir.path(), "b.json", &serde_json::json!({})).is_err());
        assert!(blocked.is_dir());
        let content = fs::read_to_string(dir.path().join("a.json")).unwrap();
        assert!(content.contains("\"x\": 1"));
        // No stray temp file was left behind.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
