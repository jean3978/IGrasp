//! The single door to every AI provider. An operation starts only with an `AiUserAction`, one
//! runs at a time, and all of them stop when the folder, the window or the app closes.

use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use super::providers::claude_cli::ClaudeCliProvider;
use super::types::{
    AiCapabilities, AiEvent, AiProviderStatus, AiRequest, AiUserAction, PermissionDecision,
};
use super::{AiOperation, AiProvider};
use crate::error::{AppError, AppResult};

struct Running {
    id: u32,
    operation: Box<dyn AiOperation>,
}

type Slot = Arc<Mutex<Option<Running>>>;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct AiGateway {
    provider: Box<dyn AiProvider>,
    running: Slot,
    next_id: AtomicU32,
    /// Operations started so far (for the "no call without a user action" tests).
    starts: AtomicU32,
}

impl AiGateway {
    /// The app's gateway: Claude through its CLI, the only provider for now.
    pub fn with_default_provider() -> Self {
        Self::new(Box::new(ClaudeCliProvider::new()))
    }

    pub fn new(provider: Box<dyn AiProvider>) -> Self {
        Self {
            provider,
            running: Arc::default(),
            next_id: AtomicU32::new(0),
            starts: AtomicU32::new(0),
        }
    }

    pub fn status(&self) -> AiProviderStatus {
        self.provider.status()
    }

    pub fn capabilities(&self) -> AiCapabilities {
        self.provider.capabilities()
    }

    #[cfg(test)]
    pub fn starts(&self) -> u32 {
        self.starts.load(Ordering::SeqCst)
    }

    /// Starts an operation for `action` and returns its id. `sink` receives
    /// `(operation id, event)` until `Done`. Fails while another operation runs.
    pub fn start(
        &self,
        action: AiUserAction,
        request: AiRequest,
        root: &Path,
        mut sink: Box<dyn FnMut(u32, AiEvent) + Send + 'static>,
    ) -> AppResult<u32> {
        let mut slot = lock(&self.running);
        if slot.as_ref().is_some_and(|r| !r.operation.is_done()) {
            return Err(AppError::Ai(
                "An AI operation is still running; stop it first.".to_owned(),
            ));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        log::info!(
            "ai operation {id}: {action:?} with {} ({}, model {:?}, policy {:?})",
            self.provider.display_name(),
            self.provider.id(),
            request.model,
            request.policy
        );
        let running = self.running.clone();
        let operation = self.provider.start(
            request,
            root,
            Box::new(move |event| {
                let done = matches!(event, AiEvent::Done { .. });
                if done {
                    let mut slot = lock(&running);
                    if slot.as_ref().is_some_and(|r| r.id == id) {
                        slot.take();
                    }
                }
                sink(id, event);
            }),
        )?;
        self.starts.fetch_add(1, Ordering::SeqCst);
        *slot = Some(Running { id, operation });
        Ok(id)
    }

    pub fn respond(
        &self,
        operation_id: u32,
        request_id: &str,
        decision: &PermissionDecision,
    ) -> AppResult<()> {
        let slot = lock(&self.running);
        match slot.as_ref() {
            Some(r) if r.id == operation_id => r.operation.respond(request_id, decision),
            _ => Err(AppError::Ai("This AI operation is over.".to_owned())),
        }
    }

    /// Idempotent; `Done { Cancelled }` follows if the operation was running.
    pub fn cancel(&self, operation_id: u32) {
        let slot = lock(&self.running);
        if let Some(r) = slot.as_ref()
            && r.id == operation_id
        {
            r.operation.cancel();
        }
    }

    /// Stops whatever runs: called when the folder, the window or the app closes.
    pub fn cancel_all(&self) {
        if let Some(r) = lock(&self.running).as_ref() {
            r.operation.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::Duration;

    use super::super::providers::mock::MockProvider;
    use super::super::types::AiOutcome;
    use super::*;

    fn gateway() -> AiGateway {
        AiGateway::new(Box::new(MockProvider::default()))
    }

    fn request(prompt: &str) -> AiRequest {
        AiRequest {
            prompt: prompt.into(),
            ..AiRequest::default()
        }
    }

    fn collect(rx: &mpsc::Receiver<(u32, AiEvent)>) -> Vec<(u32, AiEvent)> {
        let mut out = Vec::new();
        while let Ok(item) = rx.recv_timeout(Duration::from_secs(5)) {
            let done = matches!(item.1, AiEvent::Done { .. });
            out.push(item);
            if done {
                break;
            }
        }
        out
    }

    #[test]
    fn nothing_runs_until_a_user_action_starts_it() {
        let g = gateway();
        assert_eq!(g.starts(), 0);
        let _ = g.status();
        let _ = g.capabilities();
        g.cancel_all();
        assert_eq!(
            g.starts(),
            0,
            "status, capabilities and cancel never call the provider"
        );
    }

    #[test]
    fn streams_a_turn_and_frees_the_slot_on_done() {
        let g = gateway();
        let (tx, rx) = mpsc::channel();
        let id = g
            .start(
                AiUserAction::ChatMessage,
                request("hello"),
                Path::new("."),
                Box::new(move |id, e| {
                    let _ = tx.send((id, e));
                }),
            )
            .unwrap();
        let events = collect(&rx);
        assert!(events.iter().all(|(i, _)| *i == id));
        assert!(matches!(events.first(), Some((_, AiEvent::Session { .. }))));
        assert!(matches!(
            events.last(),
            Some((
                _,
                AiEvent::Done {
                    outcome: AiOutcome::Completed,
                    ..
                }
            ))
        ));
        assert_eq!(g.starts(), 1);
        // The slot is free again: a second operation starts.
        let (tx, rx) = mpsc::channel();
        let id2 = g
            .start(
                AiUserAction::ChatMessage,
                request("again"),
                Path::new("."),
                Box::new(move |id, e| {
                    let _ = tx.send((id, e));
                }),
            )
            .unwrap();
        assert_eq!(id2, id + 1);
        collect(&rx);
    }

    #[test]
    fn one_operation_at_a_time_and_cancel_ends_it() {
        let g = gateway();
        let (tx, rx) = mpsc::channel();
        let id = g
            .start(
                AiUserAction::QuizGeneration,
                request("please edit notes.md"),
                Path::new("."),
                Box::new(move |id, e| {
                    let _ = tx.send((id, e));
                }),
            )
            .unwrap();
        // The mock pauses on its permission request.
        let request_id = loop {
            match rx.recv_timeout(Duration::from_secs(5)).unwrap() {
                (_, AiEvent::PermissionRequest { request_id, .. }) => break request_id,
                (_, AiEvent::Done { .. }) => panic!("ended before asking"),
                _ => {}
            }
        };
        let busy = g.start(
            AiUserAction::ChatMessage,
            request("x"),
            Path::new("."),
            Box::new(|_, _| {}),
        );
        assert!(matches!(busy, Err(AppError::Ai(_))));
        assert!(
            g.respond(
                id + 7,
                &request_id,
                &PermissionDecision::Deny {
                    message: "no".into()
                }
            )
            .is_err()
        );
        g.cancel(id);
        let events = collect(&rx);
        assert!(matches!(
            events.last(),
            Some((
                _,
                AiEvent::Done {
                    outcome: AiOutcome::Cancelled,
                    ..
                }
            ))
        ));
        assert!(
            g.respond(
                id,
                &request_id,
                &PermissionDecision::Deny {
                    message: "no".into()
                }
            )
            .is_err()
        );
    }

    #[test]
    fn a_permission_answer_reaches_the_provider() {
        let g = gateway();
        let (tx, rx) = mpsc::channel();
        let id = g
            .start(
                AiUserAction::ChatMessage,
                request("please edit notes.md"),
                Path::new("."),
                Box::new(move |id, e| {
                    let _ = tx.send((id, e));
                }),
            )
            .unwrap();
        let request_id = loop {
            if let (
                _,
                AiEvent::PermissionRequest {
                    request_id,
                    proposed_edit,
                    ..
                },
            ) = rx.recv_timeout(Duration::from_secs(5)).unwrap()
            {
                let edit = proposed_edit.expect("an edit is proposed");
                assert_eq!(edit.path, "notes.md");
                assert!(edit.is_markdown);
                break request_id;
            }
        };
        g.respond(
            id,
            &request_id,
            &PermissionDecision::Allow { updated_edit: None },
        )
        .unwrap();
        let events = collect(&rx);
        assert!(events.iter().any(|(_, e)| matches!(
            e,
            AiEvent::ToolResult {
                is_error: false,
                ..
            }
        )));
        assert!(
            events
                .iter()
                .any(|(_, e)| matches!(e, AiEvent::Usage { .. }))
        );
        assert!(matches!(
            events.last(),
            Some((
                _,
                AiEvent::Done {
                    outcome: AiOutcome::Completed,
                    ..
                }
            ))
        ));
    }
}
