//! One turn of a conversation: one `claude -p` process.
//!
//! The user's message goes to the CLI's stdin as a `stream-json` line; the CLI prints its
//! messages on stdout, including `control_request` lines when a tool needs a permission, which
//! are answered on stdin. Stdin stays open until the CLI printed its `result`, so a late answer
//! still reaches it; closing stdin early makes the CLI deny the pending request and finish.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::cli;
use crate::ai::process::ProcessGuard;
use crate::ai::types::{AiImage, AiPolicy, PermissionDecision};
use crate::error::{AppError, AppResult};

/// What one turn needs from the neutral request.
#[derive(Debug, Clone, Default)]
pub struct TurnRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub resume_session_id: Option<String>,
    pub images: Vec<AiImage>,
    pub policy: AiPolicy,
    pub output_schema: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnOutcome {
    /// The CLI printed its `result` and exited.
    Completed,
    Cancelled,
    /// The process exited without a `result`.
    Crashed,
}

/// Tools allowed when the operation is read-only.
const READ_ONLY_TOOLS: &str = "Read,Glob,Grep";
const WRITE_TOOLS: &str = "Bash,PowerShell,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch";

/// Lines of stderr kept to explain a crash.
const STDERR_TAIL_LINES: usize = 40;

#[derive(Debug, Clone, PartialEq)]
pub struct PermissionRequest {
    pub request_id: String,
    pub tool_name: String,
    pub input: Value,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TurnEvent {
    /// Any `stream-json` object other than a permission request.
    Message(Value),
    Permission(PermissionRequest),
    End {
        outcome: TurnOutcome,
        exit_code: Option<i32>,
        stderr: Option<String>,
    },
}

pub type EventSink = Box<dyn FnMut(TurnEvent) + Send + 'static>;

/// A running (or finished) turn. Dropping it kills the process if it is still running.
pub struct ClaudeTurn {
    pid: u32,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    /// Inputs of the permission requests not answered yet, echoed back on allow.
    pending: Arc<Mutex<HashMap<String, Value>>>,
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// A session id is a UUID; anything else is refused rather than passed to the CLI.
fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// A model alias or id: letters, digits, `.`, `-`, `_`, `:` and `/`; never a flag.
fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && !model.starts_with('-')
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '/'))
}

pub fn build_args(request: &TurnRequest) -> AppResult<Vec<String>> {
    let mut args: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-prompt-tool",
        "stdio",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    if let Some(model) = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        if !valid_model(model) {
            return Err(AppError::Ai(format!("Invalid model name: {model}")));
        }
        args.push("--model".into());
        args.push(model.into());
    }
    if let Some(id) = request.resume_session_id.as_deref().map(str::trim) {
        if !valid_session_id(id) {
            return Err(AppError::Ai(format!("Invalid session id: {id}")));
        }
        args.push("--resume".into());
        args.push(id.into());
    }
    if request.policy == AiPolicy::ReadOnly {
        args.push("--tools".into());
        args.push(READ_ONLY_TOOLS.into());
        args.push("--disallowedTools".into());
        args.push(WRITE_TOOLS.into());
    }
    if let Some(schema) = &request.output_schema {
        args.push("--json-schema".into());
        args.push(schema.to_string());
    }
    Ok(args)
}

/// The stdin line carrying the user's message (a plain string, or content blocks with images).
pub fn user_message(prompt: &str, images: &[AiImage]) -> String {
    let content = if images.is_empty() {
        Value::String(prompt.to_owned())
    } else {
        let mut blocks = vec![json!({ "type": "text", "text": prompt })];
        blocks.extend(images.iter().map(|image| {
            json!({
                "type": "image",
                "source": { "type": "base64", "media_type": image.media_type, "data": image.data_base64 },
            })
        }));
        Value::Array(blocks)
    };
    json!({ "type": "user", "message": { "role": "user", "content": content } }).to_string()
}

/// The stdin line answering a permission request. The CLI wants the input to run with on an
/// allow, so the original input is echoed when the user did not change it.
pub fn control_response(
    request_id: &str,
    decision: &PermissionDecision,
    original_input: &Value,
) -> String {
    let response = match decision {
        PermissionDecision::Allow { updated_input } => json!({
            "behavior": "allow",
            "updatedInput": updated_input.as_ref().unwrap_or(original_input),
        }),
        PermissionDecision::Deny { message } => json!({ "behavior": "deny", "message": message }),
    };
    json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request_id, "response": response },
    })
    .to_string()
}

/// The stdin line refusing a control request the app does not understand, so the CLI never
/// waits forever for an answer.
fn control_error(request_id: &str, subtype: &str) -> String {
    json!({
        "type": "control_response",
        "response": {
            "subtype": "error",
            "request_id": request_id,
            "error": format!("IGrasp does not handle {subtype} requests"),
        },
    })
    .to_string()
}

pub enum Line {
    Permission(PermissionRequest),
    /// A control request of another kind, to refuse.
    UnknownControl {
        request_id: String,
        subtype: String,
    },
    Result,
    Other,
}

pub fn classify(value: &Value) -> Line {
    match value.get("type").and_then(Value::as_str) {
        Some("control_request") => {
            let request_id = value["request_id"].as_str().unwrap_or_default().to_owned();
            let request = &value["request"];
            let subtype = request["subtype"].as_str().unwrap_or_default();
            if subtype == "can_use_tool" {
                Line::Permission(PermissionRequest {
                    request_id,
                    tool_name: request["tool_name"].as_str().unwrap_or("?").to_owned(),
                    input: request.get("input").cloned().unwrap_or(Value::Null),
                    description: request["description"].as_str().map(str::to_owned),
                })
            } else {
                Line::UnknownControl {
                    request_id,
                    subtype: subtype.to_owned(),
                }
            }
        }
        Some("result") => Line::Result,
        _ => Line::Other,
    }
}

fn write_line(stdin: &mut ChildStdin, line: &str) -> std::io::Result<()> {
    stdin.write_all(line.as_bytes())?;
    stdin.write_all(b"\n")?;
    stdin.flush()
}

/// Kills the process and everything it spawned.
fn kill_tree(pid: u32) {
    if cfg!(windows) {
        let _ = cli::command(Path::new("taskkill"))
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    } else {
        // The child runs in its own process group (see `start`), whose id is its pid.
        let _ = std::process::Command::new("kill")
            .args(["-TERM", "--", &format!("-{pid}")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// Starts a turn in `root`. Events go to `sink` from a background thread, ending with
/// `TurnEvent::End` exactly once.
pub fn start(
    exe: &Path,
    root: &Path,
    request: &TurnRequest,
    id: u32,
    guard: &ProcessGuard,
    mut sink: EventSink,
) -> AppResult<ClaudeTurn> {
    let args = build_args(request)?;
    let mut cmd = cli::command(exe);
    cmd.args(&args)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group, so cancelling kills the CLI and its children together.
        cmd.process_group(0);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Ai(format!("Cannot start the Claude CLI: {e}")))?;
    let pid = child.id();
    guard.adopt(&child);
    log::info!("claude turn {id}: pid {pid}, args {args:?}");

    let mut stdin = child.stdin.take().expect("stdin is piped");
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    if let Err(e) = write_line(&mut stdin, &user_message(&request.prompt, &request.images)) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(AppError::Ai(format!("Cannot send the message: {e}")));
    }

    let stdin = Arc::new(Mutex::new(Some(stdin)));
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let pending: Arc<Mutex<HashMap<String, Value>>> = Arc::default();

    let stderr_thread = std::thread::Builder::new()
        .name(format!("igrasp-claude-{id}-stderr"))
        .spawn(move || {
            let mut tail = VecDeque::new();
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if tail.len() == STDERR_TAIL_LINES {
                    tail.pop_front();
                }
                tail.push_back(line);
            }
            tail.into_iter().collect::<Vec<_>>().join("\n")
        })
        .map_err(AppError::Io)?;

    {
        let stdin = stdin.clone();
        let child = child.clone();
        let cancelled = cancelled.clone();
        let finished = finished.clone();
        let pending = pending.clone();
        std::thread::Builder::new()
            .name(format!("igrasp-claude-{id}"))
            .spawn(move || {
                let mut got_result = false;
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    if line.trim().is_empty() {
                        continue;
                    }
                    let value: Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(e) => {
                            log::warn!("claude turn {id}: unparsable line ({e}): {line}");
                            continue;
                        }
                    };
                    match classify(&value) {
                        Line::Permission(request) => {
                            lock(&pending)
                                .insert(request.request_id.clone(), request.input.clone());
                            sink(TurnEvent::Permission(request));
                        }
                        Line::UnknownControl {
                            request_id,
                            subtype,
                        } => {
                            log::warn!("claude turn {id}: refusing control request {subtype}");
                            if let Some(stdin) = lock(&stdin).as_mut() {
                                let _ = write_line(stdin, &control_error(&request_id, &subtype));
                            }
                        }
                        Line::Result => {
                            got_result = true;
                            sink(TurnEvent::Message(value));
                            // Nothing more to say: let the CLI exit.
                            lock(&stdin).take();
                        }
                        Line::Other => sink(TurnEvent::Message(value)),
                    }
                }
                lock(&stdin).take();
                let stderr_tail = stderr_thread.join().unwrap_or_default();
                let exit_code = lock(&child).wait().ok().and_then(|s| s.code());
                let outcome = if cancelled.load(Ordering::SeqCst) {
                    TurnOutcome::Cancelled
                } else if got_result {
                    TurnOutcome::Completed
                } else {
                    TurnOutcome::Crashed
                };
                log::info!("claude turn {id}: {outcome:?}, exit code {exit_code:?}");
                finished.store(true, Ordering::SeqCst);
                sink(TurnEvent::End {
                    outcome,
                    exit_code,
                    stderr: (!stderr_tail.is_empty()).then_some(stderr_tail),
                });
            })
            .map_err(AppError::Io)?;
    }

    Ok(ClaudeTurn {
        pid,
        stdin,
        pending,
        child,
        cancelled,
        finished,
    })
}

impl ClaudeTurn {
    /// The process exited, or was told to.
    pub fn is_done(&self) -> bool {
        self.finished.load(Ordering::SeqCst) || self.cancelled.load(Ordering::SeqCst)
    }

    /// Answers a permission request.
    pub fn respond(&self, request_id: &str, decision: &PermissionDecision) -> AppResult<()> {
        let mut guard = lock(&self.stdin);
        let Some(stdin) = guard.as_mut() else {
            return Err(AppError::Ai(
                "Claude is no longer waiting for an answer.".to_owned(),
            ));
        };
        let original = lock(&self.pending)
            .remove(request_id)
            .unwrap_or(Value::Null);
        write_line(stdin, &control_response(request_id, decision, &original))
            .map_err(|e| AppError::Ai(format!("Cannot answer the permission request: {e}")))
    }

    /// Stops the turn. `TurnEvent::End` with `Cancelled` follows once the process is gone.
    pub fn cancel(&self) {
        if self.finished.load(Ordering::SeqCst) {
            return;
        }
        self.cancelled.store(true, Ordering::SeqCst);
        kill_tree(self.pid);
        if let Ok(mut child) = self.child.try_lock() {
            let _ = child.kill();
        }
        lock(&self.stdin).take();
    }
}

impl Drop for ClaudeTurn {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(model: Option<&str>, resume: Option<&str>) -> TurnRequest {
        TurnRequest {
            prompt: "hello".into(),
            model: model.map(String::from),
            resume_session_id: resume.map(String::from),
            ..TurnRequest::default()
        }
    }

    #[test]
    fn builds_the_cli_arguments() {
        let args = build_args(&request(None, None)).unwrap();
        assert_eq!(args[0], "-p");
        assert!(
            args.windows(2)
                .any(|w| w == ["--output-format", "stream-json"])
        );
        assert!(
            args.windows(2)
                .any(|w| w == ["--input-format", "stream-json"])
        );
        assert!(
            args.windows(2)
                .any(|w| w == ["--permission-prompt-tool", "stdio"])
        );
        assert!(!args.contains(&"--model".to_string()));
        assert!(!args.contains(&"--resume".to_string()));

        let args = build_args(&request(
            Some(" opus "),
            Some("3c2e6d49-bc84-4a2c-a93e-67d7cd8d7828"),
        ))
        .unwrap();
        assert!(args.windows(2).any(|w| w == ["--model", "opus"]));
        assert!(
            args.windows(2)
                .any(|w| w == ["--resume", "3c2e6d49-bc84-4a2c-a93e-67d7cd8d7828"])
        );
    }

    #[test]
    fn refuses_flag_like_models_and_odd_session_ids() {
        assert!(build_args(&request(Some("--dangerously-skip-permissions"), None)).is_err());
        assert!(build_args(&request(Some("opus sonnet"), None)).is_err());
        assert!(build_args(&request(None, Some("../x"))).is_err());
        assert!(build_args(&request(None, Some(""))).is_err());
    }

    #[test]
    fn classifies_the_recorded_protocol_lines() {
        let permission: Value = serde_json::from_str(
            r#"{"type":"control_request","request_id":"c38d6ca8","request":{"subtype":"can_use_tool","tool_name":"Edit","display_name":"Edit","input":{"file_path":"C:\\p\\notes.md","old_string":"Hello world.","new_string":"Hello IGrasp.","replace_all":false},"description":"notes.md","permission_suggestions":[{"type":"setMode","mode":"acceptEdits","destination":"session"}]}}"#,
        )
        .unwrap();
        match classify(&permission) {
            Line::Permission(p) => {
                assert_eq!(p.request_id, "c38d6ca8");
                assert_eq!(p.tool_name, "Edit");
                assert_eq!(p.input["new_string"], "Hello IGrasp.");
                assert_eq!(p.description.as_deref(), Some("notes.md"));
            }
            _ => panic!("expected a permission request"),
        }
        assert!(matches!(
            classify(&json!({"type":"control_request","request_id":"x","request":{"subtype":"hook_callback"}})),
            Line::UnknownControl { subtype, .. } if subtype == "hook_callback"
        ));
        assert!(matches!(
            classify(&json!({"type":"result","subtype":"success","is_error":false})),
            Line::Result
        ));
        assert!(matches!(
            classify(&json!({"type":"assistant","message":{}})),
            Line::Other
        ));
    }

    #[test]
    fn serializes_the_stdin_lines_the_cli_expects() {
        let user: Value = serde_json::from_str(&user_message("hi there", &[])).unwrap();
        assert_eq!(user["type"], "user");
        assert_eq!(user["message"]["role"], "user");
        assert_eq!(user["message"]["content"], "hi there");

        let allow = PermissionDecision::Allow {
            updated_input: None,
        };
        let line: Value = serde_json::from_str(&control_response(
            "req-1",
            &allow,
            &json!({"file_path": "a.md"}),
        ))
        .unwrap();
        assert_eq!(line["type"], "control_response");
        assert_eq!(line["response"]["subtype"], "success");
        assert_eq!(line["response"]["request_id"], "req-1");
        assert_eq!(line["response"]["response"]["behavior"], "allow");
        assert_eq!(
            line["response"]["response"]["updatedInput"]["file_path"],
            "a.md"
        );

        let deny = PermissionDecision::Deny {
            message: "no".into(),
        };
        let line: Value =
            serde_json::from_str(&control_response("req-2", &deny, &Value::Null)).unwrap();
        assert_eq!(line["response"]["response"]["behavior"], "deny");
        assert_eq!(line["response"]["response"]["message"], "no");

        let error: Value = serde_json::from_str(&control_error("req-3", "hook_callback")).unwrap();
        assert_eq!(error["response"]["subtype"], "error");
        assert!(
            error["response"]["error"]
                .as_str()
                .unwrap()
                .contains("hook_callback")
        );
    }

    #[test]
    fn decision_deserializes_from_the_frontend_shape() {
        let allow: PermissionDecision =
            serde_json::from_str(r#"{"behavior":"allow","updatedInput":{"a":1}}"#).unwrap();
        assert!(matches!(allow, PermissionDecision::Allow { .. }));
        let deny: PermissionDecision =
            serde_json::from_str(r#"{"behavior":"deny","message":"Rejected"}"#).unwrap();
        assert!(matches!(deny, PermissionDecision::Deny { message } if message == "Rejected"));
    }

    // ---- Tests against the real CLI (need an installed, logged-in `claude`; cost tokens) ----

    use std::sync::mpsc;
    use std::time::Duration;

    const TURN_TIMEOUT: Duration = Duration::from_secs(180);

    fn run_turn(
        root: &Path,
        request: &TurnRequest,
        id: u32,
        mut on_permission: impl FnMut(&ClaudeTurn, &PermissionRequest),
    ) -> (Vec<Value>, TurnOutcome, Option<i32>) {
        let exe = cli::locate().expect("the claude CLI is installed");
        let (tx, rx) = mpsc::channel();
        // The guard must outlive the process: closing its job object kills the child.
        let guard = ProcessGuard::new();
        let turn = start(
            &exe,
            root,
            request,
            id,
            &guard,
            Box::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .expect("the CLI starts");
        let mut messages = Vec::new();
        loop {
            match rx
                .recv_timeout(TURN_TIMEOUT)
                .expect("the turn ends in time")
            {
                TurnEvent::Message(v) => messages.push(v),
                TurnEvent::Permission(p) => on_permission(&turn, &p),
                TurnEvent::End {
                    outcome, exit_code, ..
                } => return (messages, outcome, exit_code),
            }
        }
    }

    fn session_id(messages: &[Value]) -> String {
        messages
            .iter()
            .find(|m| m["type"] == "system" && m["subtype"] == "init")
            .and_then(|m| m["session_id"].as_str())
            .expect("an init message")
            .to_owned()
    }

    fn assistant_text(messages: &[Value]) -> String {
        messages
            .iter()
            .filter(|m| m["type"] == "assistant")
            .flat_map(|m| {
                m["message"]["content"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
            })
            .filter_map(|block| block["text"].as_str().map(str::to_owned))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    #[ignore = "spawns the real claude CLI (needs a login, costs tokens)"]
    fn round_trip_denies_an_edit_then_allows_it_and_resumes() {
        let dir = tempfile::tempdir().unwrap();
        let notes = dir.path().join("notes.md");
        let original = "# Notes\n\nHello world.\n";
        std::fs::write(&notes, original).unwrap();
        let prompt = "In notes.md, change \"Hello world.\" to \"Hello IGrasp.\" with the Edit \
                      tool. Do not explain, just do it, and do not retry if it is refused.";

        // 1. Deny: the file is untouched and the CLI still finishes its turn.
        let mut denied = 0;
        let (messages, outcome, exit_code) = run_turn(
            dir.path(),
            &TurnRequest {
                prompt: prompt.into(),
                model: Some("haiku".into()),
                resume_session_id: None,
                ..TurnRequest::default()
            },
            1,
            |turn, request| {
                assert_eq!(request.tool_name, "Edit");
                assert_eq!(request.input["new_string"], "Hello IGrasp.");
                denied += 1;
                turn.respond(
                    &request.request_id,
                    &PermissionDecision::Deny {
                        message: "The user rejected this edit in IGrasp.".into(),
                    },
                )
                .unwrap();
            },
        );
        assert_eq!(denied, 1, "one permission request");
        assert_eq!(outcome, TurnOutcome::Completed);
        assert_eq!(exit_code, Some(0));
        assert_eq!(std::fs::read_to_string(&notes).unwrap(), original);
        let result = messages.iter().find(|m| m["type"] == "result").unwrap();
        assert_eq!(result["is_error"], false);
        let session = session_id(&messages);

        // 2. Resume and allow: the CLI remembers the conversation and applies the edit.
        let mut allowed = 0;
        let (messages, outcome, _) = run_turn(
            dir.path(),
            &TurnRequest {
                prompt: "Please try the same edit again; I will accept it this time.".into(),
                model: Some("haiku".into()),
                resume_session_id: Some(session.clone()),
                ..TurnRequest::default()
            },
            2,
            |turn, request| {
                allowed += 1;
                turn.respond(
                    &request.request_id,
                    &PermissionDecision::Allow {
                        updated_input: Some(request.input.clone()),
                    },
                )
                .unwrap();
            },
        );
        assert_eq!(allowed, 1);
        assert_eq!(outcome, TurnOutcome::Completed);
        assert_eq!(
            session_id(&messages),
            session,
            "resume keeps the session id"
        );
        assert!(!assistant_text(&messages).is_empty(), "the model answered");
        assert_eq!(
            std::fs::read_to_string(&notes).unwrap(),
            "# Notes\n\nHello IGrasp.\n"
        );
    }

    #[test]
    #[ignore = "spawns the real claude CLI (needs a login, costs tokens)"]
    fn cancel_kills_the_process_while_a_permission_is_pending() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("notes.md"), "# Notes\n\nHello world.\n").unwrap();
        let exe = cli::locate().expect("the claude CLI is installed");
        let (tx, rx) = mpsc::channel();
        // The guard must outlive the process: closing its job object kills the child.
        let guard = ProcessGuard::new();
        let turn = start(
            &exe,
            dir.path(),
            &TurnRequest {
                prompt:
                    "In notes.md, change \"Hello\" to \"Bonjour\" with the Edit tool. Just do it."
                        .into(),
                model: Some("haiku".into()),
                resume_session_id: None,
                ..TurnRequest::default()
            },
            3,
            &guard,
            Box::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .unwrap();
        let pid = turn.pid;
        let started = std::time::Instant::now();
        loop {
            match rx.recv_timeout(TURN_TIMEOUT).unwrap() {
                TurnEvent::Permission(_) => break,
                TurnEvent::End { outcome, .. } => panic!("ended early: {outcome:?}"),
                TurnEvent::Message(_) => {}
            }
        }
        turn.cancel();
        let end = loop {
            if let TurnEvent::End { outcome, .. } = rx
                .recv_timeout(Duration::from_secs(30))
                .expect("the end event")
            {
                break outcome;
            }
        };
        assert_eq!(end, TurnOutcome::Cancelled);
        assert!(started.elapsed() < TURN_TIMEOUT);
        assert!(turn.is_done());
        assert!(
            !process_exists(pid),
            "pid {pid} is still alive after cancel"
        );
    }

    fn process_exists(pid: u32) -> bool {
        if cfg!(windows) {
            let out = std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/NH"])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
        } else {
            // Signal 0 only checks that the process exists.
            std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    }
}
