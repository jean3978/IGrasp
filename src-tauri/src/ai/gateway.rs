//! The single door to every AI provider. An operation starts only with an `AiUserAction`, one
//! runs at a time, and all of them stop when the folder, the window or the app closes.

use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::estimate::estimate;
use super::policy::{
    AiPermissionSettings, DENIED_BY_SETTINGS, DENIED_READ_ONLY, PermissionRule,
    REASON_ALLOWED_BY_SETTINGS, REASON_DENIED_BY_SETTINGS, REASON_READ_ONLY, decide,
};
use super::types::{
    AiCapabilities, AiEvent, AiPermissionKind, AiPolicy, AiProviderStatus, AiRequest, AiUserAction,
    PermissionDecision, ProposedEdit,
};
use super::{AiOperation, AiProvider, DEFAULT_PROVIDER_ID, build_provider};
use crate::appdata::settings::Settings;
use crate::error::{AppError, AppResult};

struct Running {
    id: u32,
    operation: Box<dyn AiOperation>,
}

type Slot = Arc<Mutex<Option<Running>>>;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// A markdown edit is reviewed as a diff only when it is one: an edit of a markdown file
/// inside the folder, with the edit it proposes. Anything else that claims the kind is `Other`.
fn effective_kind(kind: AiPermissionKind, edit: Option<&ProposedEdit>) -> AiPermissionKind {
    let inside = |path: &str| {
        !path.is_empty()
            && !path.starts_with('/')
            && !path.contains('\\')
            && !path.contains(':')
            && path
                .split('/')
                .all(|s| !s.is_empty() && s != "." && s != "..")
    };
    match (kind, edit) {
        (AiPermissionKind::MarkdownEdit, Some(e)) if e.is_markdown && inside(&e.path) => kind,
        (AiPermissionKind::MarkdownEdit, _) => AiPermissionKind::Other,
        _ => kind,
    }
}

/// The answer the app gives without asking, with the reason shown in the transcript, or `None`
/// when the user must answer. A read-only operation refuses everything that asks (providers do
/// not ask for reads), whatever the provider already enforced: defence in depth.
fn answer_automatically(
    policy: AiPolicy,
    kind: AiPermissionKind,
    permissions: &AiPermissionSettings,
) -> Option<(PermissionDecision, &'static str)> {
    if policy == AiPolicy::ReadOnly {
        return Some((
            PermissionDecision::Deny {
                message: DENIED_READ_ONLY.to_owned(),
            },
            REASON_READ_ONLY,
        ));
    }
    match decide(kind, permissions) {
        PermissionRule::Ask => None,
        PermissionRule::Allow => Some((
            PermissionDecision::Allow { updated_edit: None },
            REASON_ALLOWED_BY_SETTINGS,
        )),
        PermissionRule::Deny => Some((
            PermissionDecision::Deny {
                message: DENIED_BY_SETTINGS.to_owned(),
            },
            REASON_DENIED_BY_SETTINGS,
        )),
    }
}

/// How long a status check is reused: a check costs the provider's probes (for the Claude CLI,
/// two processes). "Check again" bypasses it.
pub const STATUS_CACHE: Duration = Duration::from_secs(60);

pub struct AiGateway {
    /// The provider chosen in the settings; swapped only while nothing runs.
    provider: Mutex<Arc<dyn AiProvider>>,
    /// The last status check and when it was made.
    status_cache: Mutex<Option<(Instant, AiProviderStatus)>>,
    running: Slot,
    next_id: AtomicU32,
    /// Operations started so far (for the "no call without a user action" tests).
    starts: AtomicU32,
}

impl AiGateway {
    /// The gateway with the provider named by `settings.ai.provider`; an id this version does
    /// not know falls back to the default provider.
    pub fn from_settings(settings: &Settings) -> Self {
        let id = settings.ai.provider.as_str();
        let provider = build_provider(id).unwrap_or_else(|| {
            log::warn!("unknown AI provider {id:?}; using {DEFAULT_PROVIDER_ID}");
            build_provider(DEFAULT_PROVIDER_ID).expect("the default provider exists")
        });
        Self::new(provider)
    }

    pub fn new(provider: Box<dyn AiProvider>) -> Self {
        Self {
            provider: Mutex::new(Arc::from(provider)),
            status_cache: Mutex::default(),
            running: Arc::default(),
            next_id: AtomicU32::new(0),
            starts: AtomicU32::new(0),
        }
    }

    fn provider(&self) -> Arc<dyn AiProvider> {
        lock(&self.provider).clone()
    }

    /// The id of the active provider.
    pub fn provider_id(&self) -> &'static str {
        self.provider().id()
    }

    /// Switches to the provider `id`. Refused while an operation runs (it belongs to the
    /// current provider) and for an id this version does not know.
    pub fn set_provider(&self, id: &str) -> AppResult<()> {
        let running = lock(&self.running);
        if running.as_ref().is_some_and(|r| !r.operation.is_done()) {
            return Err(AppError::Ai(
                "The AI provider cannot change while an operation runs; stop it first.".to_owned(),
            ));
        }
        if self.provider_id() == id {
            return Ok(());
        }
        let provider =
            build_provider(id).ok_or_else(|| AppError::Ai(format!("Unknown AI provider: {id}")))?;
        log::info!("ai provider: {} → {id}", self.provider_id());
        *lock(&self.provider) = Arc::from(provider);
        lock(&self.status_cache).take();
        Ok(())
    }

    /// Whether the provider can be used. Reuses a check younger than [`STATUS_CACHE`] unless
    /// `force`. May run the provider's probes: call it from a blocking thread.
    pub fn status(&self, force: bool) -> AiProviderStatus {
        let provider = self.provider();
        if !force
            && let Some((at, status)) = lock(&self.status_cache).as_ref()
            && at.elapsed() < STATUS_CACHE
            && status.provider_id == provider.id()
        {
            return status.clone();
        }
        let status = provider.status();
        *lock(&self.status_cache) = Some((Instant::now(), status.clone()));
        status
    }

    pub fn capabilities(&self) -> AiCapabilities {
        self.provider().capabilities()
    }

    #[cfg(test)]
    pub fn starts(&self) -> u32 {
        self.starts.load(Ordering::SeqCst)
    }

    /// Starts an operation for `action` and returns its id. `sink` receives
    /// `(operation id, event)` until `Done`. Fails while another operation runs.
    ///
    /// `permissions` is the settings' snapshot at this moment: a settings change never alters
    /// a running operation. Every permission request goes through the policy first (see
    /// [`answer_automatically`]); only the ones the user must answer reach `sink`.
    pub fn start(
        &self,
        action: AiUserAction,
        request: AiRequest,
        root: &Path,
        permissions: AiPermissionSettings,
        mut sink: Box<dyn FnMut(u32, AiEvent) + Send + 'static>,
    ) -> AppResult<u32> {
        let mut slot = lock(&self.running);
        if slot.as_ref().is_some_and(|r| !r.operation.is_done()) {
            return Err(AppError::Ai(
                "An AI operation is still running; stop it first.".to_owned(),
            ));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let provider = self.provider();
        let policy = request.policy;
        let size = estimate(
            request.prompt.len() as u64,
            &request.context,
            u32::try_from(request.images.len()).unwrap_or(u32::MAX),
        );
        log::info!(
            "ai operation {id}: {action:?} with {} ({}, model {:?}, policy {policy:?}, \
             permissions {permissions:?}, {} documents, {} images, ~{} tokens, {:?})",
            provider.display_name(),
            provider.id(),
            request.model,
            size.documents,
            size.images,
            size.approx_tokens,
            size.bucket,
        );
        let running = self.running.clone();
        let operation = provider.start(
            request,
            root,
            Box::new(move |event| match event {
                AiEvent::PermissionRequest {
                    request_id,
                    tool,
                    kind,
                    description,
                    input,
                    proposed_edit,
                } => {
                    let kind = effective_kind(kind, proposed_edit.as_ref());
                    match answer_automatically(policy, kind, &permissions) {
                        None => sink(
                            id,
                            AiEvent::PermissionRequest {
                                request_id,
                                tool,
                                kind,
                                description,
                                input,
                                proposed_edit,
                            },
                        ),
                        Some((decision, reason)) => {
                            sink(
                                id,
                                AiEvent::PermissionDecided {
                                    tool,
                                    kind,
                                    description,
                                    allowed: matches!(decision, PermissionDecision::Allow { .. }),
                                    reason: reason.to_owned(),
                                },
                            );
                            // The slot is set once `start` returns (it holds the lock until
                            // then), so the operation is there to answer.
                            let slot = lock(&running);
                            let answered = match slot.as_ref() {
                                Some(r) if r.id == id => {
                                    r.operation.respond(&request_id, &decision)
                                }
                                _ => Err(AppError::Ai("The operation is over.".to_owned())),
                            };
                            if let Err(e) = answered {
                                log::warn!("ai operation {id}: cannot answer {request_id}: {e}");
                            }
                        }
                    }
                }
                event => {
                    if matches!(event, AiEvent::Done { .. }) {
                        let mut slot = lock(&running);
                        if slot.as_ref().is_some_and(|r| r.id == id) {
                            slot.take();
                        }
                    }
                    sink(id, event);
                }
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
        let _ = g.status(false);
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
                AiPermissionSettings::default(),
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
                AiPermissionSettings::default(),
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
                AiPermissionSettings::default(),
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
            AiPermissionSettings::default(),
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
                AiPermissionSettings::default(),
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

    /// Runs `prompt` to its end with `permissions`, answering nothing: only automatic decisions
    /// can let it finish. Returns the events and the decisions the provider received.
    fn run_with(
        prompt: &str,
        policy: AiPolicy,
        permissions: AiPermissionSettings,
    ) -> (Vec<AiEvent>, Vec<PermissionDecision>) {
        let mock = MockProvider::default();
        let received = mock.decisions.clone();
        let g = AiGateway::new(Box::new(mock));
        let (tx, rx) = mpsc::channel();
        g.start(
            AiUserAction::ChatMessage,
            AiRequest {
                policy,
                ..request(prompt)
            },
            Path::new("."),
            permissions,
            Box::new(move |id, e| {
                let _ = tx.send((id, e));
            }),
        )
        .unwrap();
        let events: Vec<AiEvent> = collect(&rx).into_iter().map(|(_, e)| e).collect();
        let decisions = lock(&received).clone();
        (events, decisions)
    }

    fn decided(events: &[AiEvent]) -> Option<(AiPermissionKind, bool, String)> {
        events.iter().find_map(|e| match e {
            AiEvent::PermissionDecided {
                kind,
                allowed,
                reason,
                ..
            } => Some((*kind, *allowed, reason.clone())),
            _ => None,
        })
    }

    #[test]
    fn the_settings_allow_without_asking_and_say_so() {
        let permissions = AiPermissionSettings {
            commands: PermissionRule::Allow,
            ..AiPermissionSettings::default()
        };
        let (events, decisions) = run_with("run a command", AiPolicy::Interactive, permissions);
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, AiEvent::PermissionRequest { .. })),
            "the user is not asked"
        );
        assert_eq!(
            decided(&events),
            Some((
                AiPermissionKind::Command,
                true,
                REASON_ALLOWED_BY_SETTINGS.to_owned()
            ))
        );
        assert_eq!(
            decisions,
            vec![PermissionDecision::Allow { updated_edit: None }]
        );
        assert!(events.iter().any(|e| matches!(
            e,
            AiEvent::ToolResult {
                is_error: false,
                ..
            }
        )));
    }

    #[test]
    fn the_settings_deny_with_a_message_the_model_sees() {
        let permissions = AiPermissionSettings {
            web: PermissionRule::Deny,
            ..AiPermissionSettings::default()
        };
        let (events, decisions) = run_with("fetch it", AiPolicy::Interactive, permissions);
        assert_eq!(
            decided(&events),
            Some((
                AiPermissionKind::Web,
                false,
                REASON_DENIED_BY_SETTINGS.to_owned()
            ))
        );
        assert_eq!(
            decisions,
            vec![PermissionDecision::Deny {
                message: DENIED_BY_SETTINGS.to_owned()
            }]
        );
    }

    #[test]
    fn a_read_only_operation_refuses_every_prompt_whatever_the_settings() {
        let allow_all = AiPermissionSettings {
            markdown_edits: PermissionRule::Allow,
            file_edits: PermissionRule::Allow,
            commands: PermissionRule::Allow,
            web: PermissionRule::Allow,
            other: PermissionRule::Allow,
        };
        for prompt in [
            "edit notes.md",
            "edit src/main.ts",
            "run a command",
            "fetch it",
        ] {
            let (events, decisions) = run_with(prompt, AiPolicy::ReadOnly, allow_all);
            let (_, allowed, reason) = decided(&events).expect("decided");
            assert!(!allowed, "{prompt}");
            assert_eq!(reason, REASON_READ_ONLY);
            assert_eq!(
                decisions,
                vec![PermissionDecision::Deny {
                    message: DENIED_READ_ONLY.to_owned()
                }]
            );
        }
    }

    #[test]
    fn asking_kinds_reach_the_frontend_with_their_kind() {
        let mock = MockProvider::default();
        let g = AiGateway::new(Box::new(mock));
        let (tx, rx) = mpsc::channel();
        let id = g
            .start(
                AiUserAction::ChatMessage,
                request("edit src/main.ts"),
                Path::new("."),
                AiPermissionSettings::default(),
                Box::new(move |id, e| {
                    let _ = tx.send((id, e));
                }),
            )
            .unwrap();
        let kind = loop {
            if let (_, AiEvent::PermissionRequest { kind, .. }) =
                rx.recv_timeout(Duration::from_secs(5)).unwrap()
            {
                break kind;
            }
        };
        assert_eq!(kind, AiPermissionKind::FileEdit);
        g.cancel(id);
        collect(&rx);
    }

    #[test]
    fn a_markdown_edit_is_reviewed_only_inside_the_folder() {
        let edit = |path: &str, is_markdown: bool| ProposedEdit {
            path: path.into(),
            is_markdown,
            whole_file: false,
            hunks: vec![],
        };
        let md = AiPermissionKind::MarkdownEdit;
        assert_eq!(effective_kind(md, Some(&edit("docs/a.md", true))), md);
        for outside in ["/etc/a.md", "C:/x/a.md", "../a.md", r"a\b.md", ""] {
            assert_eq!(
                effective_kind(md, Some(&edit(outside, true))),
                AiPermissionKind::Other,
                "{outside}"
            );
        }
        assert_eq!(effective_kind(md, None), AiPermissionKind::Other);
        assert_eq!(
            effective_kind(md, Some(&edit("a.txt", false))),
            AiPermissionKind::Other
        );
        assert_eq!(
            effective_kind(AiPermissionKind::Command, None),
            AiPermissionKind::Command
        );
    }

    #[test]
    fn the_provider_comes_from_the_settings_with_a_fallback() {
        let mut settings = Settings::default();
        assert_eq!(settings.ai.provider, DEFAULT_PROVIDER_ID);
        assert_eq!(
            AiGateway::from_settings(&settings).provider_id(),
            DEFAULT_PROVIDER_ID
        );
        settings.ai.provider = "gone-provider".into();
        let g = AiGateway::from_settings(&settings);
        assert_eq!(g.provider_id(), DEFAULT_PROVIDER_ID);
        assert_eq!(g.starts(), 0);
        let infos = super::super::provider_infos();
        assert!(infos.iter().any(|p| p.id == DEFAULT_PROVIDER_ID));
    }

    #[test]
    fn the_provider_cannot_change_while_an_operation_runs() {
        let g = gateway();
        let (tx, rx) = mpsc::channel();
        let id = g
            .start(
                AiUserAction::ChatMessage,
                request("a slow answer"),
                Path::new("."),
                AiPermissionSettings::default(),
                Box::new(move |id, e| {
                    let _ = tx.send((id, e));
                }),
            )
            .unwrap();
        assert!(matches!(
            g.set_provider(DEFAULT_PROVIDER_ID),
            Err(AppError::Ai(_))
        ));
        assert_eq!(g.provider_id(), "mock");
        g.cancel(id);
        collect(&rx);
        assert!(matches!(g.set_provider("nope"), Err(AppError::Ai(_))));
        g.set_provider(DEFAULT_PROVIDER_ID).unwrap();
        assert_eq!(g.provider_id(), DEFAULT_PROVIDER_ID);
        assert_eq!(g.starts(), 1, "swapping runs nothing");
    }

    #[test]
    fn the_status_is_cached_unless_forced() {
        let mock = MockProvider::default();
        let calls = mock.status_calls.clone();
        let g = AiGateway::new(Box::new(mock));
        assert!(g.status(false).installed);
        g.status(false);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        g.status(true);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        g.status(false);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(g.starts(), 0);
    }
}
