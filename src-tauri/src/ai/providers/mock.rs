//! A scripted provider for the gateway tests: the second implementation that keeps the trait
//! honest without spawning anything. A prompt mentioning a markdown file asks permission to
//! edit it and waits for the answer; anything else is a short streamed answer.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use serde_json::json;

use super::super::types::{
    AiCapabilities, AiEvent, AiModel, AiOutcome, AiProviderStatus, AiRequest, EditHunk,
    PermissionDecision, ProposedEdit,
};
use super::super::{AiOperation, AiProvider, EventSink};
use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct MockProvider;

struct MockOperation {
    decisions: Mutex<Option<mpsc::Sender<PermissionDecision>>>,
    cancelled: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
}

impl AiProvider for MockProvider {
    fn id(&self) -> &'static str {
        "mock"
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
            }],
            context_file_names: vec![],
        }
    }

    fn status(&self) -> AiProviderStatus {
        AiProviderStatus {
            provider_id: "mock".into(),
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
            let done = |outcome: AiOutcome| AiEvent::Done {
                outcome,
                detail: None,
            };
            sink(AiEvent::Session {
                resume_id: request.resume_id.unwrap_or_else(|| "mock-session-1".into()),
                model: request.model.unwrap_or_else(|| "mock".into()),
            });
            let file = request
                .prompt
                .split_whitespace()
                .find(|w| w.ends_with(".md"))
                .map(str::to_owned);
            if let Some(file) = file {
                sink(AiEvent::TextDelta {
                    text: "Editing ".into(),
                });
                sink(AiEvent::Text {
                    text: format!("Editing {file}."),
                });
                let input = json!({ "file_path": file, "old_string": "a", "new_string": "b" });
                sink(AiEvent::ToolUse {
                    tool_id: "t1".into(),
                    tool: "Edit".into(),
                    summary: format!("Edit {file}"),
                    input: input.clone(),
                });
                sink(AiEvent::PermissionRequest {
                    request_id: "r1".into(),
                    tool: "Edit".into(),
                    description: Some(file.clone()),
                    input,
                    proposed_edit: Some(ProposedEdit {
                        path: file.clone(),
                        is_markdown: true,
                        whole_file: false,
                        hunks: vec![EditHunk {
                            old_text: "a".into(),
                            new_text: "b".into(),
                        }],
                    }),
                });
                let decision = loop {
                    if cancelled.load(Ordering::SeqCst) {
                        finished.store(true, Ordering::SeqCst);
                        sink(done(AiOutcome::Cancelled));
                        return;
                    }
                    match rx.recv_timeout(step) {
                        Ok(d) => break d,
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            finished.store(true, Ordering::SeqCst);
                            sink(done(AiOutcome::Cancelled));
                            return;
                        }
                    }
                };
                let allowed = matches!(decision, PermissionDecision::Allow { .. });
                sink(AiEvent::ToolResult {
                    tool_id: "t1".into(),
                    content: if allowed {
                        "ok".into()
                    } else {
                        "denied".into()
                    },
                    is_error: !allowed,
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
            finished.store(true, Ordering::SeqCst);
            sink(done(if cancelled.load(Ordering::SeqCst) {
                AiOutcome::Cancelled
            } else {
                AiOutcome::Completed
            }));
        });
        Ok(Box::new(op))
    }
}

impl AiOperation for MockOperation {
    fn respond(&self, _request_id: &str, decision: &PermissionDecision) -> AppResult<()> {
        let guard = self.decisions.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(tx) if !self.is_done() => tx
                .send(decision.clone())
                .map_err(|_| AppError::Ai("The mock operation is over.".into())),
            _ => Err(AppError::Ai("The mock operation is over.".into())),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.decisions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
    }

    fn is_done(&self) -> bool {
        self.finished.load(Ordering::SeqCst) || self.cancelled.load(Ordering::SeqCst)
    }
}
