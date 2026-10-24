//! Translates the CLI's `stream-json` objects into provider-neutral `AiEvent`s. This is the only
//! place that knows the wire format; everything it does not recognise is dropped.

use std::path::Path;

use serde_json::Value;

use crate::ai::types::{AiEvent, EditHunk, ProposedEdit};

fn str_of<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn u64_of(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn base_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// One line describing a tool call.
pub fn summarize_tool(name: &str, input: &Value) -> String {
    let file = str_of(input, "file_path")
        .or_else(|| str_of(input, "path"))
        .or_else(|| str_of(input, "notebook_path"));
    match name {
        "Read" | "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
            file.map_or_else(|| name.to_owned(), |f| format!("{name} {}", base_name(f)))
        }
        "Bash" | "PowerShell" => str_of(input, "command").map_or_else(
            || name.to_owned(),
            |c| format!("{name}: {}", c.lines().next().unwrap_or_default()),
        ),
        "Glob" | "Grep" => {
            str_of(input, "pattern").map_or_else(|| name.to_owned(), |p| format!("{name} {p}"))
        }
        _ => name.to_owned(),
    }
}

/// Text of a tool result (`content` is a string or a list of text blocks).
fn result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|b| str_of(b, "text"))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// `path` relative to `root` with `/` separators when it is inside it, else as given.
pub fn display_path(path: &str, root: &Path) -> String {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_owned();
    let file = norm(path);
    let base = norm(&root.to_string_lossy());
    let inside = if cfg!(windows) {
        file.to_lowercase()
            .starts_with(&format!("{}/", base.to_lowercase()))
    } else {
        file.starts_with(&format!("{base}/"))
    };
    if !base.is_empty() && inside {
        file[base.len() + 1..].to_owned()
    } else {
        path.to_owned()
    }
}

fn is_markdown(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// The file change an `Edit`, `MultiEdit` or `Write` call proposes, if it is one.
pub fn proposed_edit(tool: &str, input: &Value, root: &Path) -> Option<ProposedEdit> {
    let file = str_of(input, "file_path")?;
    let hunk = |v: &Value| EditHunk {
        old_text: str_of(v, "old_string").unwrap_or_default().to_owned(),
        new_text: str_of(v, "new_string").unwrap_or_default().to_owned(),
    };
    let (whole_file, hunks) = match tool {
        "Edit" => (false, vec![hunk(input)]),
        "MultiEdit" => (
            false,
            input
                .get("edits")
                .and_then(Value::as_array)
                .map(|edits| edits.iter().map(hunk).collect())
                .unwrap_or_default(),
        ),
        "Write" => (
            true,
            vec![EditHunk {
                old_text: String::new(),
                new_text: str_of(input, "content").unwrap_or_default().to_owned(),
            }],
        ),
        _ => return None,
    };
    Some(ProposedEdit {
        path: display_path(file, root),
        is_markdown: is_markdown(file),
        whole_file,
        hunks,
    })
}

/// The neutral events carried by one `stream-json` object (none for noise such as rate-limit
/// or thinking-token notices).
pub fn events_of(message: &Value) -> Vec<AiEvent> {
    match str_of(message, "type") {
        Some("system") if str_of(message, "subtype") == Some("init") => vec![AiEvent::Session {
            resume_id: str_of(message, "session_id").unwrap_or_default().to_owned(),
            model: str_of(message, "model").unwrap_or_default().to_owned(),
        }],
        Some("stream_event") => {
            let event = message.get("event").cloned().unwrap_or(Value::Null);
            let text = match str_of(&event, "type") {
                Some("content_block_start") => event
                    .get("content_block")
                    .filter(|b| str_of(b, "type") == Some("text"))
                    .and_then(|b| str_of(b, "text")),
                Some("content_block_delta") => event
                    .get("delta")
                    .filter(|d| str_of(d, "type") == Some("text_delta"))
                    .and_then(|d| str_of(d, "text")),
                _ => None,
            };
            text.filter(|t| !t.is_empty())
                .map(|t| vec![AiEvent::TextDelta { text: t.to_owned() }])
                .unwrap_or_default()
        }
        Some("assistant") => message
            .pointer("/message/content")
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|b| match str_of(b, "type") {
                        Some("text") => Some(AiEvent::Text {
                            text: str_of(b, "text").unwrap_or_default().to_owned(),
                        }),
                        Some("tool_use") => {
                            let tool = str_of(b, "name").unwrap_or("tool").to_owned();
                            let input = b.get("input").cloned().unwrap_or(Value::Null);
                            Some(AiEvent::ToolUse {
                                tool_id: str_of(b, "id").unwrap_or_default().to_owned(),
                                summary: summarize_tool(&tool, &input),
                                tool,
                                input,
                            })
                        }
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        Some("user") => message
            .pointer("/message/content")
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| str_of(b, "type") == Some("tool_result"))
                    .map(|b| AiEvent::ToolResult {
                        tool_id: str_of(b, "tool_use_id").unwrap_or_default().to_owned(),
                        content: result_text(b.get("content")),
                        is_error: b.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        Some("result") => {
            let usage = message.get("usage").cloned().unwrap_or(Value::Null);
            let mut events = vec![AiEvent::Usage {
                input_tokens: u64_of(&usage, "input_tokens")
                    + u64_of(&usage, "cache_creation_input_tokens")
                    + u64_of(&usage, "cache_read_input_tokens"),
                output_tokens: u64_of(&usage, "output_tokens"),
                cost_usd: message.get("total_cost_usd").and_then(Value::as_f64),
                duration_ms: u64_of(message, "duration_ms"),
            }];
            if message.get("is_error").and_then(Value::as_bool) == Some(true) {
                events.push(AiEvent::Error {
                    message: str_of(message, "result")
                        .unwrap_or("The AI stopped with an error.")
                        .to_owned(),
                });
            }
            events
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn maps_the_recorded_protocol_to_neutral_events() {
        let init = json!({"type":"system","subtype":"init","session_id":"3c2e6d49","model":"claude-haiku-5-5","tools":["Read"]});
        assert_eq!(
            events_of(&init),
            vec![AiEvent::Session {
                resume_id: "3c2e6d49".into(),
                model: "claude-haiku-5-5".into()
            }]
        );

        let delta = json!({"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}});
        assert_eq!(
            events_of(&delta),
            vec![AiEvent::TextDelta { text: "Hel".into() }]
        );
        let input_delta = json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{"}}});
        assert!(events_of(&input_delta).is_empty());

        let tool_use = json!({"type":"assistant","message":{"id":"m1","content":[{"type":"thinking","thinking":""},{"type":"tool_use","id":"toolu_1","name":"Edit","input":{"file_path":"C:\\p\\notes.md","old_string":"a","new_string":"b"}}]}});
        assert_eq!(
            events_of(&tool_use),
            vec![AiEvent::ToolUse {
                tool_id: "toolu_1".into(),
                tool: "Edit".into(),
                summary: "Edit notes.md".into(),
                input: json!({"file_path":"C:\\p\\notes.md","old_string":"a","new_string":"b"}),
            }]
        );

        let tool_result = json!({"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"The user rejected this.","is_error":true}]}});
        assert_eq!(
            events_of(&tool_result),
            vec![AiEvent::ToolResult {
                tool_id: "toolu_1".into(),
                content: "The user rejected this.".into(),
                is_error: true
            }]
        );

        let text =
            json!({"type":"assistant","message":{"content":[{"type":"text","text":"Done."}]}});
        assert_eq!(
            events_of(&text),
            vec![AiEvent::Text {
                text: "Done.".into()
            }]
        );

        let result = json!({"type":"result","subtype":"success","is_error":false,"duration_ms":5000,"total_cost_usd":0.0031,"usage":{"input_tokens":4,"cache_creation_input_tokens":100,"cache_read_input_tokens":200,"output_tokens":40}});
        assert_eq!(
            events_of(&result),
            vec![AiEvent::Usage {
                input_tokens: 304,
                output_tokens: 40,
                cost_usd: Some(0.0031),
                duration_ms: 5000
            }]
        );

        let not_logged_in = json!({"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","total_cost_usd":0});
        let events = events_of(&not_logged_in);
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[1],
            AiEvent::Error {
                message: "Not logged in · Please run /login".into()
            }
        );

        assert!(events_of(&json!({"type":"rate_limit_event"})).is_empty());
        assert!(events_of(&json!({"type":"system","subtype":"thinking_tokens"})).is_empty());
        assert!(events_of(&json!("junk")).is_empty());
    }

    #[test]
    fn extracts_proposed_edits_relative_to_the_root() {
        let root = Path::new(if cfg!(windows) { "C:\\proj" } else { "/proj" });
        let file = if cfg!(windows) {
            "C:\\proj\\docs\\a.md"
        } else {
            "/proj/docs/a.md"
        };
        let edit = proposed_edit(
            "Edit",
            &json!({"file_path": file, "old_string": "x", "new_string": "y"}),
            root,
        )
        .unwrap();
        assert_eq!(edit.path, "docs/a.md");
        assert!(edit.is_markdown);
        assert!(!edit.whole_file);
        assert_eq!(edit.hunks[0].new_text, "y");

        let write = proposed_edit(
            "Write",
            &json!({"file_path": "/elsewhere/n.txt", "content": "new"}),
            root,
        )
        .unwrap();
        assert_eq!(write.path, "/elsewhere/n.txt");
        assert!(!write.is_markdown);
        assert!(write.whole_file);
        assert_eq!(write.hunks[0].old_text, "");

        let multi = proposed_edit(
            "MultiEdit",
            &json!({"file_path": file, "edits": [{"old_string": "1", "new_string": "2"}, {"old_string": "3", "new_string": "4"}]}),
            root,
        )
        .unwrap();
        assert_eq!(multi.hunks.len(), 2);

        assert!(proposed_edit("Bash", &json!({"command": "ls"}), root).is_none());
    }

    #[test]
    fn summarizes_tool_calls() {
        assert_eq!(
            summarize_tool("Read", &json!({"file_path": "/a/b.md"})),
            "Read b.md"
        );
        assert_eq!(
            summarize_tool("Bash", &json!({"command": "git status\ngit log"})),
            "Bash: git status"
        );
        assert_eq!(
            summarize_tool("Grep", &json!({"pattern": "TODO"})),
            "Grep TODO"
        );
        assert_eq!(
            summarize_tool("WebSearch", &json!({"query": "x"})),
            "WebSearch"
        );
    }
}
