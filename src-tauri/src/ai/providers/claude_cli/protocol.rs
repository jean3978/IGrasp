//! Translates the CLI's `stream-json` objects into provider-neutral `AiEvent`s. This is the only
//! place that knows the wire format; everything it does not recognise is dropped.

use std::path::Path;

use serde_json::Value;

use crate::ai::types::{AiEvent, AiPermissionKind, EditHunk, ProposedEdit};

/// The tool the CLI uses to deliver the answer of `--json-schema`.
const STRUCTURED_OUTPUT_TOOL: &str = "StructuredOutput";

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

/// `path` relative to `root` with `/` separators when it is inside it (no `..` segment), else
/// `None`. A relative path is taken as relative to the root, where the CLI runs.
fn relative_inside(path: &str, root: &Path) -> Option<String> {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_owned();
    let file = norm(path);
    let base = norm(&root.to_string_lossy());
    let absolute = file.starts_with('/') || file.as_bytes().get(1) == Some(&b':');
    let rel = if !absolute {
        file
    } else {
        let inside = if cfg!(windows) {
            file.to_lowercase()
                .starts_with(&format!("{}/", base.to_lowercase()))
        } else {
            file.starts_with(&format!("{base}/"))
        };
        if base.is_empty() || !inside {
            return None;
        }
        file[base.len() + 1..].to_owned()
    };
    let rel = rel.trim_start_matches("./").to_owned();
    let clean = !rel.is_empty()
        && rel
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != "..");
    clean.then_some(rel)
}

/// `path` relative to `root` with `/` separators when it is inside it, else as given.
pub fn display_path(path: &str, root: &Path) -> String {
    relative_inside(path, root).unwrap_or_else(|| path.to_owned())
}

fn is_markdown(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// The file a file tool works on.
fn tool_file(input: &Value) -> Option<&str> {
    str_of(input, "file_path").or_else(|| str_of(input, "notebook_path"))
}

/// What a tool call would do, for the app's permission policy.
pub fn permission_kind(tool: &str, input: &Value, root: &Path) -> AiPermissionKind {
    match tool {
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => {
            match tool_file(input).and_then(|f| relative_inside(f, root)) {
                Some(rel) if is_markdown(&rel) => AiPermissionKind::MarkdownEdit,
                Some(_) => AiPermissionKind::FileEdit,
                // An edit outside the folder is never reviewed as an ordinary edit.
                None => AiPermissionKind::Other,
            }
        }
        "Bash" | "PowerShell" | "Task" | "KillShell" => AiPermissionKind::Command,
        "WebFetch" | "WebSearch" => AiPermissionKind::Web,
        _ => AiPermissionKind::Other,
    }
}

/// The tool input that runs `edit` (a subset of the proposed hunks, or a composed whole file)
/// instead of the original call: `Edit` takes its single hunk, `MultiEdit` keeps the accepted
/// entries of its `edits` in their order, `Write` gets the composed content. `None` when the
/// edit cannot be expressed for this tool (no hunk, unknown tool): the caller denies instead.
pub fn tool_input_for(tool: &str, original: &Value, edit: &ProposedEdit) -> Option<Value> {
    let mut input = original.clone();
    let object = input.as_object_mut()?;
    match tool {
        "Edit" => {
            let [hunk] = edit.hunks.as_slice() else {
                return None;
            };
            object.insert("old_string".into(), Value::String(hunk.old_text.clone()));
            object.insert("new_string".into(), Value::String(hunk.new_text.clone()));
        }
        "MultiEdit" => {
            let edits = object.get("edits").and_then(Value::as_array)?;
            let mut wanted: Vec<&EditHunk> = edit.hunks.iter().collect();
            let kept: Vec<Value> = edits
                .iter()
                .filter(|e| {
                    let old = str_of(e, "old_string").unwrap_or_default();
                    let new = str_of(e, "new_string").unwrap_or_default();
                    let at = wanted
                        .iter()
                        .position(|h| h.old_text == old && h.new_text == new);
                    at.map(|i| wanted.remove(i)).is_some()
                })
                .cloned()
                .collect();
            if kept.is_empty() || !wanted.is_empty() {
                // Hunks that are not among the proposed edits are refused, never invented.
                return None;
            }
            object.insert("edits".into(), Value::Array(kept));
        }
        "Write" => {
            let [hunk] = edit.hunks.as_slice() else {
                return None;
            };
            object.insert("content".into(), Value::String(hunk.new_text.clone()));
        }
        _ => return None,
    }
    Some(input)
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
                        // How the CLI delivers `--json-schema` output: the value comes again in
                        // the result line (`structured_output`), so the call is not shown.
                        Some("tool_use") if str_of(b, "name") == Some(STRUCTURED_OUTPUT_TOOL) => {
                            None
                        }
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
            let mut events = Vec::new();
            if let Some(value) = message.get("structured_output").filter(|v| !v.is_null()) {
                events.push(AiEvent::StructuredOutput {
                    value: value.clone(),
                });
            }
            events.push(AiEvent::Usage {
                input_tokens: u64_of(&usage, "input_tokens")
                    + u64_of(&usage, "cache_creation_input_tokens")
                    + u64_of(&usage, "cache_read_input_tokens"),
                output_tokens: u64_of(&usage, "output_tokens"),
                cost_usd: message.get("total_cost_usd").and_then(Value::as_f64),
                duration_ms: u64_of(message, "duration_ms"),
            });
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

    /// Recorded from `claude -p --json-schema … --tools Read,Glob,Grep` (CLI 2.1.310): the value
    /// comes through a `StructuredOutput` tool call and again in the result line.
    #[test]
    fn maps_the_structured_output_of_a_result() {
        let call = json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_01Sf","name":"StructuredOutput","input":{"answer":42,"file":"docs/architecture.md"}}]}});
        assert!(
            events_of(&call).is_empty(),
            "the internal call is not shown"
        );
        let result = json!({"type":"result","subtype":"success","is_error":false,"duration_ms":1450,"total_cost_usd":0.0062,"usage":{"input_tokens":2,"cache_creation_input_tokens":30771,"cache_read_input_tokens":0,"output_tokens":105},"result":"{\"answer\":42}","structured_output":{"answer":42}});
        assert_eq!(
            events_of(&result),
            vec![
                AiEvent::StructuredOutput {
                    value: json!({ "answer": 42 })
                },
                AiEvent::Usage {
                    input_tokens: 30773,
                    output_tokens: 105,
                    cost_usd: Some(0.0062),
                    duration_ms: 1450
                }
            ]
        );
        let none = json!({"type":"result","is_error":false,"structured_output":null});
        assert!(
            !events_of(&none)
                .iter()
                .any(|e| matches!(e, AiEvent::StructuredOutput { .. }))
        );
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

    fn proj() -> (&'static Path, &'static str) {
        if cfg!(windows) {
            (Path::new("C:\\proj"), "C:\\proj\\")
        } else {
            (Path::new("/proj"), "/proj/")
        }
    }

    #[test]
    fn classifies_permission_kinds() {
        use AiPermissionKind::*;
        let (root, prefix) = proj();
        let file = |rel: &str| json!({ "file_path": format!("{prefix}{rel}") });
        let table = [
            ("Edit", file("docs/a.md"), MarkdownEdit),
            ("MultiEdit", file("README.MARKDOWN"), MarkdownEdit),
            ("Write", file("notes/new.md"), MarkdownEdit),
            ("Write", json!({ "file_path": "docs/rel.md" }), MarkdownEdit),
            ("Edit", file("src/main.ts"), FileEdit),
            (
                "NotebookEdit",
                json!({ "notebook_path": format!("{prefix}n.ipynb") }),
                FileEdit,
            ),
            ("Edit", json!({ "file_path": "/elsewhere/a.md" }), Other),
            ("Edit", file("../outside.md"), Other),
            ("Edit", json!({}), Other),
            ("Bash", json!({ "command": "npm test" }), Command),
            ("PowerShell", json!({ "command": "ls" }), Command),
            ("Task", json!({}), Command),
            ("KillShell", json!({}), Command),
            ("WebFetch", json!({ "url": "https://x" }), Web),
            ("WebSearch", json!({ "query": "x" }), Web),
            ("Read", file("a.md"), Other),
            ("mcp__server__tool", json!({}), Other),
        ];
        for (tool, input, kind) in table {
            assert_eq!(permission_kind(tool, &input, root), kind, "{tool} {input}");
        }
    }

    fn hunk(old: &str, new: &str) -> EditHunk {
        EditHunk {
            old_text: old.into(),
            new_text: new.into(),
        }
    }

    fn edit(whole_file: bool, hunks: Vec<EditHunk>) -> ProposedEdit {
        ProposedEdit {
            path: "a.md".into(),
            is_markdown: true,
            whole_file,
            hunks,
        }
    }

    #[test]
    fn maps_an_accepted_edit_back_to_the_tool_input() {
        let original = json!({ "file_path": "/p/a.md", "old_string": "a", "new_string": "b", "replace_all": false });
        let input = tool_input_for("Edit", &original, &edit(false, vec![hunk("a", "c")])).unwrap();
        assert_eq!(
            input,
            json!({ "file_path": "/p/a.md", "old_string": "a", "new_string": "c", "replace_all": false })
        );
        assert!(tool_input_for("Edit", &original, &edit(false, vec![])).is_none());

        let multi = json!({ "file_path": "/p/a.md", "edits": [
            { "old_string": "1", "new_string": "2" },
            { "old_string": "3", "new_string": "4", "replace_all": true },
            { "old_string": "5", "new_string": "6" },
        ]});
        // The accepted hunks, in any order, keep the original order and their other fields.
        let input = tool_input_for(
            "MultiEdit",
            &multi,
            &edit(false, vec![hunk("5", "6"), hunk("3", "4")]),
        )
        .unwrap();
        assert_eq!(
            input["edits"],
            json!([
                { "old_string": "3", "new_string": "4", "replace_all": true },
                { "old_string": "5", "new_string": "6" },
            ])
        );
        assert_eq!(input["file_path"], "/p/a.md");
        assert!(tool_input_for("MultiEdit", &multi, &edit(false, vec![])).is_none());
        // A hunk that was never proposed is refused.
        assert!(tool_input_for("MultiEdit", &multi, &edit(false, vec![hunk("x", "y")])).is_none());

        let write = json!({ "file_path": "/p/a.md", "content": "old whole" });
        let input =
            tool_input_for("Write", &write, &edit(true, vec![hunk("", "composed")])).unwrap();
        assert_eq!(
            input,
            json!({ "file_path": "/p/a.md", "content": "composed" })
        );
        assert!(tool_input_for("Write", &write, &edit(true, vec![])).is_none());
        // An Edit has a single hunk to accept; two cannot be expressed.
        assert!(
            tool_input_for(
                "Edit",
                &original,
                &edit(false, vec![hunk("a", "b"), hunk("c", "d")])
            )
            .is_none()
        );
        assert!(
            tool_input_for(
                "Bash",
                &json!({ "command": "ls" }),
                &edit(false, vec![hunk("a", "b")])
            )
            .is_none()
        );
    }
}
