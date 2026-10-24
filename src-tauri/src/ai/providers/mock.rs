//! A scripted provider for the gateway tests: the second implementation that keeps the trait
//! honest without spawning anything. Words of the prompt pick the script: a markdown file name
//! asks to edit it, `main.ts` asks to edit a code file, `command` to run one, `fetch` to fetch a
//! URL, `slow` streams for a while; anything else is a short streamed answer. Every tool call
//! waits for its answer; what the provider received is recorded for the tests.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use serde_json::{Value, json};

use super::super::types::{
    AiCapabilities, AiEvent, AiModel, AiOutcome, AiPermissionKind, AiProviderStatus, AiRequest,
    EditHunk, PermissionDecision, ProposedEdit,
};
use super::super::{AiOperation, AiProvider, EventSink};
use crate::error::{AppError, AppResult};

pub const MOCK_ID: &str = "mock";

#[derive(Default, Clone)]
pub struct MockProvider {
    /// The last request a start received.
    pub last_request: Arc<Mutex<Option<AiRequest>>>,
    /// Every permission answer the provider received, in order.
    pub decisions: Arc<Mutex<Vec<PermissionDecision>>>,
    /// How many status checks ran.
    pub status_calls: Arc<AtomicU32>,
}

struct MockOperation {
    decisions: Mutex<Option<mpsc::Sender<PermissionDecision>>>,
    cancelled: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// The tool call a prompt asks for, if any.
fn tool_call(
    prompt: &str,
) -> Option<(&'static str, AiPermissionKind, Value, Option<ProposedEdit>)> {
    let words: Vec<&str> = prompt.split_whitespace().collect();
    let has = |w: &str| words.iter().any(|x| x.eq_ignore_ascii_case(w));
    if has("command") {
        return Some((
            "Bash",
            AiPermissionKind::Command,
            json!({ "command": "git log --oneline -5" }),
            None,
        ));
    }
    if has("fetch") {
        return Some((
            "WebFetch",
            AiPermissionKind::Web,
            json!({ "url": "https://example.com/" }),
            None,
        ));
    }
    let file = words
        .iter()
        .find(|w| w.ends_with(".md") || w.ends_with(".ts"))?
        .to_string();
    let markdown = file.ends_with(".md");
    let hunk = EditHunk {
        old_text: "a".into(),
        new_text: "b".into(),
    };
    Some((
        "Edit",
        if markdown {
            AiPermissionKind::MarkdownEdit
        } else {
            AiPermissionKind::FileEdit
        },
        json!({ "file_path": file, "old_string": "a", "new_string": "b" }),
        Some(ProposedEdit {
            path: file,
            is_markdown: markdown,
            whole_file: false,
            hunks: vec![hunk],
        }),
    ))
}

impl AiProvider for MockProvider {
    fn id(&self) -> &'static str {
        MOCK_ID
    }

    fn display_name(&self) -> &'static str {
        "Mock AI"
    }

    fn capabilities(&self) -> AiCapabilities {
        AiCapabilities {
            streaming: true,
            resume: true,
            structured_output: false,
            image_input: false,
            permission_prompts: true,
            read_only_mode: true,
            usage_reporting: true,
            cost_reporting: false,
            models: vec![AiModel {
                id: "mock".into(),
                label: "Mock".into(),
                image_input: false,
            }],
            context_file_names: vec!["AGENTS.md".into()],
        }
    }

    fn status(&self) -> AiProviderStatus {
        self.status_calls.fetch_add(1, Ordering::SeqCst);
        AiProviderStatus {
            provider_id: MOCK_ID.into(),
            display_name: "Mock AI".into(),
            installed: true,
            logged_in: true,
            version: Some("0.0".into()),
            ..AiProviderStatus::default()
        }
    }

    fn start(
        &self,
        request: AiRequest,
        _root: &Path,
        mut sink: EventSink,
    ) -> AppResult<Box<dyn AiOperation>> {
        *lock(&self.last_request) = Some(request.clone());
        let received = self.decisions.clone();
        let (tx, rx) = mpsc::channel::<PermissionDecision>();
        let cancelled = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let op = MockOperation {
            decisions: Mutex::new(Some(tx)),
            cancelled: cancelled.clone(),
            finished: finished.clone(),
        };
        std::thread::spawn(move || {
            let step = Duration::from_millis(5);
            let end = |sink: &mut EventSink, outcome: AiOutcome| {
                finished.store(true, Ordering::SeqCst);
                sink(AiEvent::Done {
                    outcome,
                    detail: None,
                });
            };
            sink(AiEvent::Session {
                resume_id: request
                    .resume_id
                    .clone()
                    .unwrap_or_else(|| "mock-session-1".into()),
                model: request.model.clone().unwrap_or_else(|| "mock".into()),
            });
            if request.prompt.split_whitespace().any(|w| w == "slow") {
                for _ in 0..200 {
                    if cancelled.load(Ordering::SeqCst) {
                        end(&mut sink, AiOutcome::Cancelled);
                        return;
                    }
                    sink(AiEvent::TextDelta { text: ".".into() });
                    std::thread::sleep(step);
                }
            } else if let Some((tool, kind, input, proposed_edit)) = tool_call(&request.prompt) {
                sink(AiEvent::ToolUse {
                    tool_id: "t1".into(),
                    tool: tool.into(),
                    summary: tool.into(),
                    input: input.clone(),
                });
                sink(AiEvent::PermissionRequest {
                    request_id: "r1".into(),
                    tool: tool.into(),
                    kind,
                    description: proposed_edit.as_ref().map(|e| e.path.clone()),
                    input,
                    proposed_edit,
                });
                let decision = loop {
                    if cancelled.load(Ordering::SeqCst) {
                        end(&mut sink, AiOutcome::Cancelled);
                        return;
                    }
                    match rx.recv_timeout(step) {
                        Ok(d) => break d,
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            end(&mut sink, AiOutcome::Cancelled);
                            return;
                        }
                    }
                };
                lock(&received).push(decision.clone());
                let (content, is_error) = match decision {
                    PermissionDecision::Allow { .. } => ("ok".to_owned(), false),
                    PermissionDecision::Deny { message } => (message, true),
                };
                sink(AiEvent::ToolResult {
                    tool_id: "t1".into(),
                    content,
                    is_error,
                });
            } else {
                sink(AiEvent::TextDelta {
                    text: "Hello ".into(),
                });
                sink(AiEvent::TextDelta {
                    text: "there.".into(),
                });
                sink(AiEvent::Text {
                    text: "Hello there.".into(),
                });
            }
            sink(AiEvent::Usage {
                input_tokens: 10,
                output_tokens: 5,
                cost_usd: None,
                duration_ms: 1,
            });
            let outcome = if cancelled.load(Ordering::SeqCst) {
                AiOutcome::Cancelled
            } else {
                AiOutcome::Completed
            };
            end(&mut sink, outcome);
        });
        Ok(Box::new(op))
    }
}

impl AiOperation for MockOperation {
    fn respond(&self, _request_id: &str, decision: &PermissionDecision) -> AppResult<()> {
        let guard = lock(&self.decisions);
        match guard.as_ref() {
            Some(tx) if !self.is_done() => tx
                .send(decision.clone())
                .map_err(|_| AppError::Ai("The mock operation is over.".into())),
            _ => Err(AppError::Ai("The mock operation is over.".into())),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        lock(&self.decisions).take();
    }

    fn is_done(&self) -> bool {
        self.finished.load(Ordering::SeqCst) || self.cancelled.load(Ordering::SeqCst)
    }
}
