//! The app's readable copy of the AI conversations, per opened folder (`conversations/`).
//!
//! `index.json` maps each canonical root path to a file id; `c0001.json` holds that folder's
//! conversations, newest first. Written once per operation end (by the frontend's request), never
//! inside the opened folder. The provider keeps its own transcript for resuming; this copy is
//! what the history shows, so a conversation stays readable even when the provider forgot it.

use std::collections::BTreeMap;
use std::fs;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{AppData, Cache, read_json, write_json};
use crate::error::{AppError, AppResult};

pub const CONVERSATIONS_DIR: &str = "conversations";
pub const INDEX_FILE: &str = "index.json";
/// Items kept per conversation (the oldest go first).
pub const MAX_ITEMS: usize = 400;
/// Characters kept of a title.
pub const MAX_TITLE_CHARS: usize = 80;
const MAX_ID_CHARS: usize = 64;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ConversationUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: Option<f64>,
}

/// One conversation as the chat shows it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Conversation {
    /// Chosen by the frontend: letters, digits, `-` and `_`.
    pub id: String,
    /// The first user message, at most 80 characters.
    pub title: String,
    pub created_ms: i64,
    pub updated_ms: i64,
    /// The provider and the model it ran with (the model the provider reported).
    pub provider_id: String,
    pub model: String,
    /// What continues the conversation with the provider.
    pub resume_id: Option<String>,
    pub usage: ConversationUsage,
    /// The chat items, opaque to the backend (the frontend's transcript items).
    pub items: Vec<serde_json::Value>,
}

/// A line of the history list.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub updated_ms: i64,
    pub model: String,
    pub usage: ConversationUsage,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ConversationIndex {
    version: u32,
    /// The number of the last file id given out.
    last: u32,
    /// Canonical root path → file id (`c0001`).
    roots: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ConversationFile {
    version: u32,
    root: String,
    /// Newest first.
    conversations: Vec<Conversation>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_CHARS
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A file id comes from our index, but the index is a file on disk: never let it name a path.
fn valid_file_id(id: &str) -> bool {
    id.len() > 1 && id.starts_with('c') && id[1..].chars().all(|c| c.is_ascii_digit())
}

fn summary(c: &Conversation) -> ConversationSummary {
    ConversationSummary {
        id: c.id.clone(),
        title: c.title.clone(),
        updated_ms: c.updated_ms,
        model: c.model.clone(),
        usage: c.usage.clone(),
    }
}

impl AppData {
    fn conversations_dir(&self) -> std::path::PathBuf {
        self.dir.join(CONVERSATIONS_DIR)
    }

    /// Reads `name` of the conversations folder; a corrupt file is moved aside and reported.
    fn read_conversations_json<T: serde::de::DeserializeOwned + Default>(
        &self,
        cache: &mut Cache,
        name: &str,
    ) -> AppResult<T> {
        let (value, recovered) = read_json::<T>(&self.conversations_dir(), name)?;
        if recovered.is_some() {
            cache.recovered.push(format!("{CONVERSATIONS_DIR}/{name}"));
        }
        Ok(value)
    }

    /// The file id of `root`, created in the index when `create`.
    fn conversation_file_id(
        &self,
        cache: &mut Cache,
        root: &str,
        create: bool,
    ) -> AppResult<Option<String>> {
        let mut index: ConversationIndex = self.read_conversations_json(cache, INDEX_FILE)?;
        if let Some(id) = index.roots.get(root) {
            return Ok(valid_file_id(id).then(|| id.clone()));
        }
        if !create {
            return Ok(None);
        }
        // Never reuse a number: after a corrupt index, start after the files on disk.
        let on_disk = fs::read_dir(self.conversations_dir())
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter_map(|e| {
                        let name = e.file_name().to_string_lossy().into_owned();
                        let stem = name.strip_suffix(".json")?.strip_prefix('c')?.to_owned();
                        stem.parse::<u32>().ok()
                    })
                    .max()
                    .unwrap_or(0)
            })
            .unwrap_or(0);
        index.version = 1;
        index.last = index.last.max(on_disk) + 1;
        let id = format!("c{:04}", index.last);
        index.roots.insert(root.to_owned(), id.clone());
        write_json(&self.conversations_dir(), INDEX_FILE, &index)?;
        Ok(Some(id))
    }

    fn read_conversation_file(
        &self,
        cache: &mut Cache,
        root: &str,
    ) -> AppResult<(Option<String>, ConversationFile)> {
        let Some(file_id) = self.conversation_file_id(cache, root, false)? else {
            return Ok((None, ConversationFile::default()));
        };
        let file: ConversationFile =
            self.read_conversations_json(cache, &format!("{file_id}.json"))?;
        Ok((Some(file_id), file))
    }

    /// The conversations of `root`, newest first.
    pub fn list_conversations(&self, root: &str) -> AppResult<Vec<ConversationSummary>> {
        let mut cache = self.lock();
        let (_, file) = self.read_conversation_file(&mut cache, root)?;
        Ok(file.conversations.iter().map(summary).collect())
    }

    pub fn get_conversation(&self, root: &str, id: &str) -> AppResult<Conversation> {
        let mut cache = self.lock();
        let (_, file) = self.read_conversation_file(&mut cache, root)?;
        file.conversations
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::NotFound(format!("conversation {id}")))
    }

    /// Adds or replaces a conversation of `root`, keeping its last [`MAX_ITEMS`] items and the
    /// `limit` most recently updated conversations of the folder.
    pub fn save_conversation(
        &self,
        root: &str,
        mut conversation: Conversation,
        limit: usize,
    ) -> AppResult<()> {
        if !valid_id(&conversation.id) {
            return Err(AppError::AppData(format!(
                "invalid conversation id: {:?}",
                conversation.id
            )));
        }
        if conversation.title.chars().count() > MAX_TITLE_CHARS {
            conversation.title = conversation.title.chars().take(MAX_TITLE_CHARS).collect();
        }
        if conversation.items.len() > MAX_ITEMS {
            let excess = conversation.items.len() - MAX_ITEMS;
            conversation.items.drain(..excess);
        }
        let mut cache = self.lock();
        let file_id = self
            .conversation_file_id(&mut cache, root, true)?
            .ok_or_else(|| AppError::AppData("the conversation index is invalid".to_owned()))?;
        let name = format!("{file_id}.json");
        let mut file: ConversationFile = self.read_conversations_json(&mut cache, &name)?;
        file.version = 1;
        root.clone_into(&mut file.root);
        file.conversations.retain(|c| c.id != conversation.id);
        file.conversations.push(conversation);
        file.conversations
            .sort_by_key(|c| std::cmp::Reverse(c.updated_ms));
        file.conversations.truncate(limit.max(1));
        write_json(&self.conversations_dir(), &name, &file)
    }

    /// Removes a conversation of `root` (nothing happens if it is not there).
    pub fn delete_conversation(&self, root: &str, id: &str) -> AppResult<()> {
        let mut cache = self.lock();
        let (Some(file_id), mut file) = self.read_conversation_file(&mut cache, root)? else {
            return Ok(());
        };
        let before = file.conversations.len();
        file.conversations.retain(|c| c.id != id);
        if file.conversations.len() == before {
            return Ok(());
        }
        write_json(&self.conversations_dir(), &format!("{file_id}.json"), &file)
    }

    /// Forgets every conversation of `root`: its file and its index entry.
    pub fn forget_conversations(&self, root: &str) -> AppResult<()> {
        let mut cache = self.lock();
        let mut index: ConversationIndex = self.read_conversations_json(&mut cache, INDEX_FILE)?;
        let Some(file_id) = index.roots.remove(root) else {
            return Ok(());
        };
        if valid_file_id(&file_id) {
            match fs::remove_file(self.conversations_dir().join(format!("{file_id}.json"))) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    return Err(AppError::AppData(format!(
                        "cannot delete the conversations of {root}: {e}"
                    )));
                }
            }
        }
        write_json(&self.conversations_dir(), INDEX_FILE, &index)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const ROOT: &str = "/home/me/project";

    fn data() -> (tempfile::TempDir, AppData) {
        let dir = tempfile::tempdir().unwrap();
        let data = AppData::new(dir.path().to_path_buf());
        (dir, data)
    }

    fn conversation(id: &str, updated_ms: i64) -> Conversation {
        Conversation {
            id: id.into(),
            title: format!("About {id}"),
            created_ms: updated_ms - 10,
            updated_ms,
            provider_id: "mock".into(),
            model: "m-1".into(),
            resume_id: Some(format!("session-{id}")),
            usage: ConversationUsage {
                input_tokens: 100,
                output_tokens: 20,
                cost_usd: Some(0.01),
            },
            items: vec![json!({ "kind": "user", "id": "u1", "text": "hello" })],
        }
    }

    #[test]
    fn round_trips_conversations_per_folder_newest_first() {
        let (dir, data) = data();
        assert!(data.list_conversations(ROOT).unwrap().is_empty());
        data.save_conversation(ROOT, conversation("a", 1_000), 100)
            .unwrap();
        data.save_conversation(ROOT, conversation("b", 2_000), 100)
            .unwrap();
        data.save_conversation("/other", conversation("z", 500), 100)
            .unwrap();

        let ids: Vec<String> = data
            .list_conversations(ROOT)
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, ["b", "a"]);
        assert_eq!(
            data.get_conversation(ROOT, "a").unwrap(),
            conversation("a", 1_000)
        );
        assert!(matches!(
            data.get_conversation(ROOT, "z"),
            Err(AppError::NotFound(_))
        ));

        // Upsert: the same id replaces the conversation and moves it first.
        let mut a = conversation("a", 3_000);
        a.items
            .push(json!({ "kind": "assistant", "id": "a1", "text": "hi", "streaming": false }));
        data.save_conversation(ROOT, a.clone(), 100).unwrap();
        let list = data.list_conversations(ROOT).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "a");
        assert_eq!(list[0].usage.cost_usd, Some(0.01));
        assert_eq!(data.get_conversation(ROOT, "a").unwrap().items.len(), 2);

        // Survives a restart; one file per folder plus the index, in the app-data folder.
        let reloaded = AppData::new(dir.path().to_path_buf());
        assert_eq!(reloaded.get_conversation(ROOT, "a").unwrap(), a);
        let mut files: Vec<String> = fs::read_dir(dir.path().join(CONVERSATIONS_DIR))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        files.sort();
        assert_eq!(files, ["c0001.json", "c0002.json", "index.json"]);

        data.delete_conversation(ROOT, "b").unwrap();
        data.delete_conversation(ROOT, "gone").unwrap();
        assert_eq!(data.list_conversations(ROOT).unwrap().len(), 1);
    }

    #[test]
    fn trims_items_titles_and_the_number_of_conversations() {
        let (_dir, data) = data();
        let mut long = conversation("long", 10);
        long.title = "é".repeat(200);
        long.items = (0..450).map(|i| json!({ "n": i })).collect();
        data.save_conversation(ROOT, long, 100).unwrap();
        let saved = data.get_conversation(ROOT, "long").unwrap();
        assert_eq!(saved.title.chars().count(), MAX_TITLE_CHARS);
        assert_eq!(saved.items.len(), MAX_ITEMS);
        assert_eq!(
            saved.items[0],
            json!({ "n": 50 }),
            "the oldest items go first"
        );

        for i in 0..5 {
            data.save_conversation(ROOT, conversation(&format!("c{i}"), 100 + i), 3)
                .unwrap();
        }
        let ids: Vec<String> = data
            .list_conversations(ROOT)
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, ["c4", "c3", "c2"]);
    }

    #[test]
    fn refuses_ids_that_could_name_anything_else() {
        let (_dir, data) = data();
        for bad in ["", "../x", "a/b", "a b", &"x".repeat(65)] {
            assert!(
                data.save_conversation(ROOT, conversation(bad, 1), 10)
                    .is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn a_corrupt_file_is_moved_aside_and_reported() {
        let (dir, data) = data();
        data.save_conversation(ROOT, conversation("a", 1), 10)
            .unwrap();
        let file = dir.path().join(CONVERSATIONS_DIR).join("c0001.json");
        fs::write(&file, b"{ not json").unwrap();
        assert!(data.list_conversations(ROOT).unwrap().is_empty());
        assert_eq!(
            data.take_recovered(),
            vec![format!("{CONVERSATIONS_DIR}/c0001.json")]
        );
        // Saving again works and keeps the same file.
        data.save_conversation(ROOT, conversation("b", 2), 10)
            .unwrap();
        assert_eq!(data.list_conversations(ROOT).unwrap().len(), 1);

        // A corrupt index: files on disk are not reused.
        fs::write(dir.path().join(CONVERSATIONS_DIR).join(INDEX_FILE), b"[").unwrap();
        data.save_conversation(ROOT, conversation("c", 3), 10)
            .unwrap();
        assert!(
            dir.path()
                .join(CONVERSATIONS_DIR)
                .join("c0002.json")
                .is_file()
        );
        assert_eq!(
            data.take_recovered(),
            vec![format!("{CONVERSATIONS_DIR}/{INDEX_FILE}")]
        );
    }

    #[test]
    fn forgets_a_folder_and_never_writes_in_it() {
        let (_dir, data) = data();
        let root = tempfile::tempdir().unwrap();
        let root_path = root.path().display().to_string();
        data.save_conversation(&root_path, conversation("a", 1), 10)
            .unwrap();
        data.save_conversation(ROOT, conversation("b", 1), 10)
            .unwrap();
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
        data.forget_conversations(&root_path).unwrap();
        assert!(data.list_conversations(&root_path).unwrap().is_empty());
        assert_eq!(data.list_conversations(ROOT).unwrap().len(), 1);
        data.forget_conversations("/never-seen").unwrap();
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }
}
