//! Validated runs (ADR 0022): one operation that may make several provider attempts when its
//! structured answer is not good enough, under one operation id. Rule 1 says retries belong to
//! the operation, are capped and visible: the cap is here, each retry is announced with
//! `AiEvent::Attempt`, and cancelling stops the run between attempts as well as during one. Only
//! the gateway starts a run (`AiGateway::start` with a validator), so no feature can loop on a
//! provider on its own.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;

use super::types::{AiEvent, AiOutcome, AiRequest, PermissionDecision};
use super::{AiOperation, AiProvider, EventSink};
use crate::error::{AppError, AppResult};

/// Attempts after the first one, at most.
pub const MAX_RETRIES: u32 = 2;

/// What a validator decides about the answer of an attempt.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    /// Good enough: emitted as the final `StructuredOutput`, then `Done(Completed)`.
    Accept(Value),
    /// Try again with `repair_prompt` (resuming the attempt's conversation); `reason` is shown.
    Retry {
        repair_prompt: String,
        reason: String,
    },
    /// Give up: `message` is emitted as an `Error`, then `Done(Failed)`.
    Fail { message: String },
}

/// Decides whether the structured answer of an attempt is good enough, and what to ask next.
pub trait OutputValidator: Send {
    /// Called once per attempt (1-based) with the structured answer, or `Value::Null` when the
    /// attempt gave none (or text that is not JSON, for a provider without structured output).
    fn check(&mut self, attempt: u32, output: &Value) -> Verdict;
    /// What to do when the last allowed attempt is still not good enough (a `Retry` here is a
    /// failure).
    fn on_exhausted(&mut self) -> Verdict;
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// What one attempt produced so far.
#[derive(Default)]
struct AttemptState {
    output: Option<Value>,
    last_text: Option<String>,
    session: Option<String>,
    had_error: bool,
}

struct Inner {
    provider: Arc<dyn AiProvider>,
    root: PathBuf,
    request: AiRequest,
    /// The provider honours `output_schema`; otherwise the last text block is parsed.
    structured: bool,
    validator: Mutex<Box<dyn OutputValidator>>,
    sink: Mutex<EventSink>,
    current: Mutex<Option<Box<dyn AiOperation>>>,
    /// Finished attempts, kept until the run is dropped (an attempt's own thread may still be
    /// returning from the callback that started the next one).
    retired: Mutex<Vec<Box<dyn AiOperation>>>,
    state: Mutex<AttemptState>,
    attempts: AtomicU32,
    cancelled: AtomicBool,
    done: AtomicBool,
}

/// The running operation the gateway keeps for a validated run.
pub struct ValidatedRun {
    inner: Arc<Inner>,
}

/// The JSON of a text answer: the whole text, or the inside of a fenced block, or from the first
/// `{` to the last `}`.
pub fn json_of_text(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        return Some(v);
    }
    let fenced = trimmed
        .split("```")
        .nth(1)
        .map(|block| block.trim_start_matches("json").trim());
    if let Some(block) = fenced
        && let Ok(v) = serde_json::from_str::<Value>(block)
    {
        return Some(v);
    }
    let (start, end) = (trimmed.find('{')?, trimmed.rfind('}')?);
    (start < end)
        .then(|| serde_json::from_str::<Value>(&trimmed[start..=end]).ok())
        .flatten()
}

impl Inner {
    fn emit(&self, event: AiEvent) {
        (lock(&self.sink))(event);
    }

    fn finish(&self, outcome: AiOutcome, detail: Option<String>) {
        if self.done.swap(true, Ordering::SeqCst) {
            return;
        }
        // The attempts hold this run through their sinks: let them go (elsewhere, since this
        // may be one of their own threads), so nothing outlives the operation.
        let mut ops: Vec<Box<dyn AiOperation>> = lock(&self.retired).drain(..).collect();
        ops.extend(lock(&self.current).take());
        std::thread::spawn(move || drop(ops));
        self.emit(AiEvent::Done { outcome, detail });
    }

    /// Starts attempt `n + 1` with `prompt`, resuming `resume` when given.
    fn start_attempt(self: &Arc<Self>, prompt: String, resume: Option<String>) -> AppResult<()> {
        let mut current = lock(&self.current);
        if self.cancelled.load(Ordering::SeqCst) || self.done.load(Ordering::SeqCst) {
            return Err(AppError::Ai("The operation was stopped.".to_owned()));
        }
        let number = self.attempts.load(Ordering::SeqCst) + 1;
        if number > 1 + MAX_RETRIES {
            return Err(AppError::Ai("No attempt is left.".to_owned()));
        }
        *lock(&self.state) = AttemptState::default();
        let mut request = self.request.clone();
        request.prompt = prompt;
        if resume.is_some() {
            request.resume_id = resume;
        }
        let me = self.clone();
        let op = self
            .provider
            .start(request, &self.root, Box::new(move |e| me.on_event(e)))?;
        self.attempts.store(number, Ordering::SeqCst);
        if let Some(previous) = current.replace(op) {
            lock(&self.retired).push(previous);
        }
        Ok(())
    }

    fn on_event(self: &Arc<Self>, event: AiEvent) {
        if self.done.load(Ordering::SeqCst) {
            return;
        }
        match event {
            AiEvent::StructuredOutput { value } => {
                lock(&self.state).output = Some(value);
            }
            AiEvent::Done { outcome, detail } => self.on_attempt_done(outcome, detail),
            event => {
                {
                    let mut state = lock(&self.state);
                    match &event {
                        AiEvent::Session { resume_id, .. } => {
                            state.session = Some(resume_id.clone());
                        }
                        AiEvent::Text { text } => state.last_text = Some(text.clone()),
                        AiEvent::Error { .. } => state.had_error = true,
                        _ => {}
                    }
                }
                self.emit(event);
            }
        }
    }

    fn on_attempt_done(self: &Arc<Self>, outcome: AiOutcome, detail: Option<String>) {
        match outcome {
            AiOutcome::Cancelled => return self.finish(AiOutcome::Cancelled, detail),
            AiOutcome::Failed => return self.finish(AiOutcome::Failed, detail),
            AiOutcome::Completed => {}
        }
        if self.cancelled.load(Ordering::SeqCst) {
            return self.finish(AiOutcome::Cancelled, None);
        }
        let (output, session, had_error) = {
            let mut state = lock(&self.state);
            let output = state.output.take().or_else(|| {
                (!self.structured)
                    .then(|| state.last_text.as_deref().and_then(json_of_text))
                    .flatten()
            });
            (output, state.session.clone(), state.had_error)
        };
        // An error the provider reported (not logged in, unknown model) is not fixed by asking
        // again.
        if output.is_none() && had_error {
            return self.finish(
                AiOutcome::Failed,
                Some("The AI reported an error before answering.".to_owned()),
            );
        }
        let attempt = self.attempts.load(Ordering::SeqCst);
        let mut verdict =
            lock(&self.validator).check(attempt, output.as_ref().unwrap_or(&Value::Null));
        if matches!(verdict, Verdict::Retry { .. }) && attempt > MAX_RETRIES {
            verdict = lock(&self.validator).on_exhausted();
        }
        match verdict {
            Verdict::Accept(value) => {
                self.emit(AiEvent::StructuredOutput { value });
                self.finish(AiOutcome::Completed, None);
            }
            Verdict::Fail { message } => {
                self.emit(AiEvent::Error { message });
                self.finish(AiOutcome::Failed, None);
            }
            Verdict::Retry {
                repair_prompt,
                reason,
            } => {
                if attempt > MAX_RETRIES {
                    self.emit(AiEvent::Error { message: reason });
                    return self.finish(AiOutcome::Failed, None);
                }
                self.emit(AiEvent::Attempt {
                    number: attempt + 1,
                    of: 1 + MAX_RETRIES,
                    reason,
                });
                if let Err(e) = self.start_attempt(repair_prompt, session) {
                    if self.cancelled.load(Ordering::SeqCst) {
                        return self.finish(AiOutcome::Cancelled, None);
                    }
                    self.emit(AiEvent::Error {
                        message: e.to_string(),
                    });
                    self.finish(AiOutcome::Failed, None);
                }
            }
        }
    }
}

/// Starts a validated run of `request`: the first attempt now, the next ones as the validator
/// asks, at most `1 + MAX_RETRIES` in all. Called by the gateway only.
pub fn start(
    provider: Arc<dyn AiProvider>,
    request: AiRequest,
    root: &Path,
    validator: Box<dyn OutputValidator>,
    sink: EventSink,
) -> AppResult<Box<dyn AiOperation>> {
    let structured = provider.capabilities().structured_output;
    let prompt = request.prompt.clone();
    let resume = request.resume_id.clone();
    let inner = Arc::new(Inner {
        provider,
        root: root.to_path_buf(),
        request,
        structured,
        validator: Mutex::new(validator),
        sink: Mutex::new(sink),
        current: Mutex::new(None),
        retired: Mutex::new(Vec::new()),
        state: Mutex::new(AttemptState::default()),
        attempts: AtomicU32::new(0),
        cancelled: AtomicBool::new(false),
        done: AtomicBool::new(false),
    });
    inner.start_attempt(prompt, resume)?;
    Ok(Box::new(ValidatedRun { inner }))
}

impl AiOperation for ValidatedRun {
    fn respond(&self, request_id: &str, decision: &PermissionDecision) -> AppResult<()> {
        match lock(&self.inner.current).as_ref() {
            Some(op) => op.respond(request_id, decision),
            None => Err(AppError::Ai("The operation is over.".to_owned())),
        }
    }

    fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::SeqCst);
        if let Some(op) = lock(&self.inner.current).as_ref() {
            op.cancel();
        }
    }

    fn is_done(&self) -> bool {
        self.inner.done.load(Ordering::SeqCst)
    }
}

impl Drop for ValidatedRun {
    fn drop(&mut self) {
        self.cancel();
    }
}

// ---------------------------------------------------------------------------------------------
// Staged runs (ADR 0026): several validated runs under one operation id, one after the other,
// all authorized by the same user action (the chapters of a tutorial the user ticked). The
// number of stages is fixed when the run starts and capped by `MAX_STAGES`; each stage has the
// validated run's own capped retries; a stage that fails ends the run; cancel stops it between
// stages as well as inside one; exactly one `Done` ends it.

/// Stages of a staged run at most (a tutorial outline's chapters at most).
pub const MAX_STAGES: u32 = 8;

/// Builds the stages of a staged run, one at a time, from what the earlier stages produced.
pub trait StageBuilder: Send {
    /// How many stages the run has (fixed when it starts).
    fn stages(&self) -> u32;
    /// The request, the validator and a label (shown to the user) of stage `n` (1-based), given
    /// the accepted outputs of the stages before it.
    fn next(
        &mut self,
        n: u32,
        accepted: &[Value],
    ) -> AppResult<(AiRequest, Box<dyn OutputValidator>, String)>;
}

/// How the gateway runs an operation with a structured answer.
pub enum RunPlan {
    /// One validated run.
    Validated(Box<dyn OutputValidator>),
    /// A staged run: one validated run per stage.
    // Until the tutorial chapters build one (the next steps of Phase 5).
    #[allow(dead_code)]
    Staged(Box<dyn StageBuilder>),
}

struct StagedInner {
    provider: Arc<dyn AiProvider>,
    root: PathBuf,
    builder: Mutex<Box<dyn StageBuilder>>,
    stages: u32,
    sink: Mutex<EventSink>,
    current: Mutex<Option<Box<dyn AiOperation>>>,
    retired: Mutex<Vec<Box<dyn AiOperation>>>,
    accepted: Mutex<Vec<Value>>,
    /// The accepted answer of the stage running now.
    output: Mutex<Option<Value>>,
    stage: AtomicU32,
    cancelled: AtomicBool,
    done: AtomicBool,
}

/// The running operation the gateway keeps for a staged run.
pub struct StagedRun {
    inner: Arc<StagedInner>,
}

impl StagedInner {
    fn emit(&self, event: AiEvent) {
        (lock(&self.sink))(event);
    }

    fn finish(&self, outcome: AiOutcome, detail: Option<String>) {
        if self.done.swap(true, Ordering::SeqCst) {
            return;
        }
        let mut ops: Vec<Box<dyn AiOperation>> = lock(&self.retired).drain(..).collect();
        ops.extend(lock(&self.current).take());
        std::thread::spawn(move || drop(ops));
        self.emit(AiEvent::Done { outcome, detail });
    }

    /// Starts the next stage, or finishes the run when every stage is done.
    fn start_next(self: &Arc<Self>) -> AppResult<()> {
        let mut current = lock(&self.current);
        if self.cancelled.load(Ordering::SeqCst) || self.done.load(Ordering::SeqCst) {
            drop(current);
            self.finish(AiOutcome::Cancelled, None);
            return Ok(());
        }
        let n = self.stage.load(Ordering::SeqCst) + 1;
        if n > self.stages {
            drop(current);
            self.finish(AiOutcome::Completed, None);
            return Ok(());
        }
        let accepted = lock(&self.accepted).clone();
        let (request, validator, label) = lock(&self.builder).next(n, &accepted)?;
        self.stage.store(n, Ordering::SeqCst);
        *lock(&self.output) = None;
        self.emit(AiEvent::Stage {
            number: n,
            of: self.stages,
            label,
        });
        let me = self.clone();
        let op = start(
            self.provider.clone(),
            request,
            &self.root,
            validator,
            Box::new(move |e| me.on_event(e)),
        )?;
        if let Some(previous) = current.replace(op) {
            lock(&self.retired).push(previous);
        }
        Ok(())
    }

    fn on_event(self: &Arc<Self>, event: AiEvent) {
        if self.done.load(Ordering::SeqCst) {
            return;
        }
        match event {
            AiEvent::Done { outcome, detail } => match outcome {
                AiOutcome::Completed => {
                    match lock(&self.output).take() {
                        Some(value) => lock(&self.accepted).push(value),
                        None => {
                            return self.finish(
                                AiOutcome::Failed,
                                Some("A stage ended without an answer.".to_owned()),
                            );
                        }
                    }
                    if let Err(e) = self.start_next() {
                        self.emit(AiEvent::Error {
                            message: e.to_string(),
                        });
                        self.finish(AiOutcome::Failed, None);
                    }
                }
                AiOutcome::Cancelled => self.finish(AiOutcome::Cancelled, detail),
                AiOutcome::Failed => self.finish(AiOutcome::Failed, detail),
            },
            AiEvent::StructuredOutput { value } => {
                *lock(&self.output) = Some(value.clone());
                self.emit(AiEvent::StructuredOutput { value });
            }
            event => self.emit(event),
        }
    }
}

/// Starts a staged run: the stages of `builder` one after the other, at most [`MAX_STAGES`].
/// Called by the gateway only.
pub fn start_staged(
    provider: Arc<dyn AiProvider>,
    root: &Path,
    builder: Box<dyn StageBuilder>,
    sink: EventSink,
) -> AppResult<Box<dyn AiOperation>> {
    let stages = builder.stages();
    if stages == 0 || stages > MAX_STAGES {
        return Err(AppError::Ai(format!(
            "An operation has between 1 and {MAX_STAGES} stages ({stages} asked)."
        )));
    }
    let inner = Arc::new(StagedInner {
        provider,
        root: root.to_path_buf(),
        builder: Mutex::new(builder),
        stages,
        sink: Mutex::new(sink),
        current: Mutex::new(None),
        retired: Mutex::new(Vec::new()),
        accepted: Mutex::new(Vec::new()),
        output: Mutex::new(None),
        stage: AtomicU32::new(0),
        cancelled: AtomicBool::new(false),
        done: AtomicBool::new(false),
    });
    inner.start_next()?;
    Ok(Box::new(StagedRun { inner }))
}

impl AiOperation for StagedRun {
    fn respond(&self, request_id: &str, decision: &PermissionDecision) -> AppResult<()> {
        match lock(&self.inner.current).as_ref() {
            Some(op) => op.respond(request_id, decision),
            None => Err(AppError::Ai("The operation is over.".to_owned())),
        }
    }

    fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::SeqCst);
        if let Some(op) = lock(&self.inner.current).as_ref() {
            op.cancel();
        }
    }

    fn is_done(&self) -> bool {
        self.inner.done.load(Ordering::SeqCst)
    }
}

impl Drop for StagedRun {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::mpsc;
    use std::time::Duration;

    use serde_json::json;

    use super::super::gateway::AiGateway;
    use super::super::policy::{AiPermissionSettings, PermissionRule, REASON_READ_ONLY};
    use super::super::providers::mock::MockProvider;
    use super::super::types::{AiPolicy, AiUserAction};
    use super::RunPlan;
    use super::*;

    /// Answers with the scripted verdicts, records what it was given.
    struct Script {
        verdicts: VecDeque<Verdict>,
        exhausted: Verdict,
        seen: Arc<Mutex<Vec<Value>>>,
    }

    impl OutputValidator for Script {
        fn check(&mut self, _attempt: u32, output: &Value) -> Verdict {
            lock(&self.seen).push(output.clone());
            self.verdicts.pop_front().unwrap_or_else(|| Verdict::Retry {
                repair_prompt: "again".into(),
                reason: "still wrong".into(),
            })
        }
        fn on_exhausted(&mut self) -> Verdict {
            self.exhausted.clone()
        }
    }

    fn retry(prompt: &str) -> Verdict {
        Verdict::Retry {
            repair_prompt: prompt.into(),
            reason: "2 rejected".into(),
        }
    }

    struct Run {
        mock: MockProvider,
        gateway: AiGateway,
        rx: mpsc::Receiver<AiEvent>,
        seen: Arc<Mutex<Vec<Value>>>,
        id: u32,
    }

    fn run(prompt: &str, outputs: Vec<Value>, verdicts: Vec<Verdict>, exhausted: Verdict) -> Run {
        run_with(
            MockProvider::default(),
            prompt,
            AiPolicy::ReadOnly,
            outputs,
            verdicts,
            exhausted,
        )
    }

    fn run_with(
        mock: MockProvider,
        prompt: &str,
        policy: AiPolicy,
        outputs: Vec<Value>,
        verdicts: Vec<Verdict>,
        exhausted: Verdict,
    ) -> Run {
        lock(&mock.outputs).extend(outputs);
        let gateway = AiGateway::new(Box::new(mock.clone()));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (tx, rx) = mpsc::channel();
        let allow_all = AiPermissionSettings {
            markdown_edits: PermissionRule::Allow,
            file_edits: PermissionRule::Allow,
            commands: PermissionRule::Allow,
            web: PermissionRule::Allow,
            other: PermissionRule::Allow,
        };
        let id = gateway
            .start(
                AiUserAction::QuizGeneration,
                AiRequest {
                    prompt: prompt.into(),
                    policy,
                    output_schema: Some(json!({ "type": "object" })),
                    ..AiRequest::default()
                },
                Path::new("."),
                allow_all,
                Some(RunPlan::Validated(Box::new(Script {
                    verdicts: verdicts.into(),
                    exhausted,
                    seen: seen.clone(),
                }))),
                Box::new(move |_, e| {
                    let _ = tx.send(e);
                }),
            )
            .unwrap();
        Run {
            mock,
            gateway,
            rx,
            seen,
            id,
        }
    }

    fn events(r: &Run) -> Vec<AiEvent> {
        let mut out = Vec::new();
        while let Ok(e) = r.rx.recv_timeout(Duration::from_secs(5)) {
            let done = matches!(e, AiEvent::Done { .. });
            out.push(e);
            if done {
                break;
            }
        }
        out
    }

    fn outcome(events: &[AiEvent]) -> AiOutcome {
        match events.last() {
            Some(AiEvent::Done { outcome, .. }) => *outcome,
            other => panic!("no done: {other:?}"),
        }
    }

    fn structured(events: &[AiEvent]) -> Vec<Value> {
        events
            .iter()
            .filter_map(|e| match e {
                AiEvent::StructuredOutput { value } => Some(value.clone()),
                _ => None,
            })
            .collect()
    }

    fn attempts(events: &[AiEvent]) -> Vec<(u32, u32)> {
        events
            .iter()
            .filter_map(|e| match e {
                AiEvent::Attempt { number, of, .. } => Some((*number, *of)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn accepted_the_first_time() {
        let r = run(
            "write",
            vec![json!({ "q": 1 })],
            vec![Verdict::Accept(json!({ "q": "accepted" }))],
            Verdict::Fail {
                message: "x".into(),
            },
        );
        let e = events(&r);
        assert_eq!(outcome(&e), AiOutcome::Completed);
        assert_eq!(
            structured(&e),
            vec![json!({ "q": "accepted" })],
            "only the accepted answer"
        );
        assert_eq!(*lock(&r.seen), vec![json!({ "q": 1 })]);
        assert_eq!(r.mock.provider_starts.load(Ordering::SeqCst), 1);
        assert_eq!(r.gateway.starts(), 1);
        assert!(attempts(&e).is_empty());
    }

    #[test]
    fn a_retry_resumes_the_session_with_the_repair_prompt() {
        let r = run(
            "write",
            vec![json!({ "bad": 1 }), json!({ "good": 1 })],
            vec![retry("fix q3"), Verdict::Accept(json!({ "ok": true }))],
            Verdict::Fail {
                message: "x".into(),
            },
        );
        let e = events(&r);
        assert_eq!(outcome(&e), AiOutcome::Completed);
        assert_eq!(attempts(&e), vec![(2, 3)]);
        assert_eq!(structured(&e), vec![json!({ "ok": true })]);
        let usages = e
            .iter()
            .filter(|e| matches!(e, AiEvent::Usage { .. }))
            .count();
        assert_eq!(usages, 2, "usage per attempt");
        let requests = lock(&r.mock.requests).clone();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[1].prompt, "fix q3");
        assert_eq!(requests[1].resume_id.as_deref(), Some("mock-session-1"));
        assert_eq!(requests[1].policy, AiPolicy::ReadOnly);
        assert!(requests[1].output_schema.is_some());
        assert_eq!(r.gateway.starts(), 1, "one operation");
    }

    #[test]
    fn exhausted_after_exactly_three_attempts() {
        let r = run(
            "write",
            vec![],
            vec![],
            Verdict::Fail {
                message: "Only 1 question could be verified.".into(),
            },
        );
        let e = events(&r);
        assert_eq!(outcome(&e), AiOutcome::Failed);
        assert_eq!(
            r.mock.provider_starts.load(Ordering::SeqCst),
            1 + MAX_RETRIES
        );
        assert_eq!(attempts(&e), vec![(2, 3), (3, 3)]);
        assert!(
            e.iter()
                .any(|e| matches!(e, AiEvent::Error { message } if message.starts_with("Only 1")))
        );
        // No attempt starts after the end.
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(r.mock.provider_starts.load(Ordering::SeqCst), 3);
        // The slot is free.
        assert!(!r.gateway.status(false).provider_id.is_empty());
    }

    #[test]
    fn exhausted_keeps_enough_verified_questions() {
        let r = run(
            "write",
            vec![],
            vec![],
            Verdict::Accept(json!({ "kept": 3 })),
        );
        let e = events(&r);
        assert_eq!(outcome(&e), AiOutcome::Completed);
        assert_eq!(structured(&e), vec![json!({ "kept": 3 })]);
    }

    #[test]
    fn cancel_during_attempt_two_makes_no_attempt_three() {
        let r = run(
            "write",
            vec![json!({}), json!({})],
            vec![retry("slow repair")],
            Verdict::Fail {
                message: "x".into(),
            },
        );
        // Wait for the second attempt to start, then cancel it.
        loop {
            match r.rx.recv_timeout(Duration::from_secs(5)).unwrap() {
                AiEvent::Attempt { .. } => break,
                AiEvent::Done { .. } => panic!("ended early"),
                _ => {}
            }
        }
        std::thread::sleep(Duration::from_millis(30));
        r.gateway.cancel(r.id);
        let e = events(&r);
        assert_eq!(outcome(&e), AiOutcome::Cancelled);
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(r.mock.provider_starts.load(Ordering::SeqCst), 2);
        assert!(structured(&e).is_empty());
    }

    #[test]
    fn the_text_fallback_without_structured_output() {
        let mock = MockProvider::default();
        mock.text_only.store(true, Ordering::SeqCst);
        let r = run_with(
            mock,
            "write",
            AiPolicy::ReadOnly,
            vec![json!({ "from": "text" })],
            vec![Verdict::Accept(json!({ "ok": 1 }))],
            Verdict::Fail {
                message: "x".into(),
            },
        );
        let e = events(&r);
        assert_eq!(outcome(&e), AiOutcome::Completed);
        assert_eq!(*lock(&r.seen), vec![json!({ "from": "text" })]);
    }

    #[test]
    fn an_error_without_an_answer_fails_without_retrying() {
        let r = run(
            "error",
            vec![],
            vec![],
            Verdict::Fail {
                message: "x".into(),
            },
        );
        let e = events(&r);
        assert_eq!(outcome(&e), AiOutcome::Failed);
        assert_eq!(r.mock.provider_starts.load(Ordering::SeqCst), 1);
        assert!(lock(&r.seen).is_empty());
    }

    #[test]
    fn a_quiz_is_read_only_whatever_the_settings() {
        // The settings allow everything; the read-only policy still refuses the edit.
        let r = run(
            "please edit notes.md",
            vec![json!({})],
            vec![Verdict::Accept(json!({}))],
            Verdict::Fail {
                message: "x".into(),
            },
        );
        let e = events(&r);
        assert_eq!(outcome(&e), AiOutcome::Completed);
        assert!(e.iter().any(|e| matches!(
            e,
            AiEvent::PermissionDecided { allowed: false, reason, .. } if reason == REASON_READ_ONLY
        )));
        assert!(
            !e.iter()
                .any(|e| matches!(e, AiEvent::PermissionRequest { .. }))
        );
    }

    /// Stages that accept what the provider answers, or fail at `fail_at`; records what each
    /// stage was given.
    struct Stages {
        count: u32,
        prompt: &'static str,
        fail_at: Option<u32>,
        seen: Arc<Mutex<Vec<(u32, usize)>>>,
    }

    struct AcceptAll {
        fail: bool,
    }

    impl OutputValidator for AcceptAll {
        fn check(&mut self, _attempt: u32, output: &Value) -> Verdict {
            if self.fail {
                Verdict::Fail {
                    message: "not enough material".into(),
                }
            } else {
                Verdict::Accept(json!({ "stage": output.clone() }))
            }
        }
        fn on_exhausted(&mut self) -> Verdict {
            Verdict::Fail {
                message: "x".into(),
            }
        }
    }

    impl StageBuilder for Stages {
        fn stages(&self) -> u32 {
            self.count
        }
        fn next(
            &mut self,
            n: u32,
            accepted: &[Value],
        ) -> AppResult<(AiRequest, Box<dyn OutputValidator>, String)> {
            lock(&self.seen).push((n, accepted.len()));
            Ok((
                AiRequest {
                    prompt: format!("{} {n}", self.prompt),
                    policy: AiPolicy::ReadOnly,
                    output_schema: Some(json!({ "type": "object" })),
                    ..AiRequest::default()
                },
                Box::new(AcceptAll {
                    fail: self.fail_at == Some(n),
                }),
                format!("Chapter {n}"),
            ))
        }
    }

    struct Staged {
        mock: MockProvider,
        gateway: AiGateway,
        rx: mpsc::Receiver<AiEvent>,
        seen: Arc<Mutex<Vec<(u32, usize)>>>,
        id: u32,
    }

    fn staged(count: u32, prompt: &'static str, fail_at: Option<u32>) -> AppResult<Staged> {
        let mock = MockProvider::default();
        lock(&mock.outputs).extend((1..=count).map(|n| json!({ "n": n })));
        let gateway = AiGateway::new(Box::new(mock.clone()));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (tx, rx) = mpsc::channel();
        let id = gateway.start(
            AiUserAction::TutorialGeneration,
            AiRequest::default(),
            Path::new("."),
            AiPermissionSettings::default(),
            Some(RunPlan::Staged(Box::new(Stages {
                count,
                prompt,
                fail_at,
                seen: seen.clone(),
            }))),
            Box::new(move |_, e| {
                let _ = tx.send(e);
            }),
        )?;
        Ok(Staged {
            mock,
            gateway,
            rx,
            seen,
            id,
        })
    }

    fn staged_events(r: &Staged) -> Vec<AiEvent> {
        let mut out = Vec::new();
        while let Ok(e) = r.rx.recv_timeout(Duration::from_secs(5)) {
            let done = matches!(e, AiEvent::Done { .. });
            out.push(e);
            if done {
                break;
            }
        }
        out
    }

    fn stages_of(events: &[AiEvent]) -> Vec<(u32, u32, String)> {
        events
            .iter()
            .filter_map(|e| match e {
                AiEvent::Stage { number, of, label } => Some((*number, *of, label.clone())),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_staged_run_writes_its_stages_in_order_under_one_operation() {
        let r = staged(3, "write chapter", None).unwrap();
        let e = staged_events(&r);
        assert_eq!(outcome(&e), AiOutcome::Completed);
        assert_eq!(
            stages_of(&e),
            vec![
                (1, 3, "Chapter 1".into()),
                (2, 3, "Chapter 2".into()),
                (3, 3, "Chapter 3".into())
            ]
        );
        assert_eq!(
            structured(&e),
            vec![
                json!({ "stage": { "n": 1 } }),
                json!({ "stage": { "n": 2 } }),
                json!({ "stage": { "n": 3 } })
            ],
            "each stage's accepted answer, once"
        );
        // Each stage sees the accepted answers of the ones before it.
        assert_eq!(*lock(&r.seen), vec![(1, 0), (2, 1), (3, 2)]);
        assert_eq!(
            e.iter()
                .filter(|e| matches!(e, AiEvent::Done { .. }))
                .count(),
            1
        );
        assert_eq!(r.mock.provider_starts.load(Ordering::SeqCst), 3);
        assert_eq!(r.gateway.starts(), 1, "one operation, one user action");
        let requests = lock(&r.mock.requests).clone();
        assert!(requests.iter().all(|q| q.policy == AiPolicy::ReadOnly));
        assert!(
            requests.iter().all(|q| q.resume_id.is_none()),
            "fresh prompts"
        );
    }

    #[test]
    fn a_failed_stage_ends_the_run() {
        let r = staged(3, "write chapter", Some(2)).unwrap();
        let e = staged_events(&r);
        assert_eq!(outcome(&e), AiOutcome::Failed);
        assert_eq!(stages_of(&e).len(), 2, "no stage after the failed one");
        assert_eq!(structured(&e).len(), 1, "the first chapter was kept");
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(r.mock.provider_starts.load(Ordering::SeqCst), 2);
        assert!(
            e.iter()
                .any(|e| matches!(e, AiEvent::Error { message } if message.contains("material")))
        );
    }

    #[test]
    fn cancel_stops_a_staged_run_without_another_stage() {
        let r = staged(3, "slow chapter", None).unwrap();
        loop {
            match r.rx.recv_timeout(Duration::from_secs(5)).unwrap() {
                AiEvent::TextDelta { .. } => break,
                AiEvent::Done { .. } => panic!("ended early"),
                _ => {}
            }
        }
        r.gateway.cancel(r.id);
        let e = staged_events(&r);
        assert_eq!(outcome(&e), AiOutcome::Cancelled);
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(r.mock.provider_starts.load(Ordering::SeqCst), 1);
        assert_eq!(lock(&r.seen).len(), 1);
    }

    #[test]
    fn a_staged_run_is_bounded() {
        assert!(matches!(
            staged(MAX_STAGES + 1, "write", None),
            Err(AppError::Ai(_))
        ));
        assert!(matches!(staged(0, "write", None), Err(AppError::Ai(_))));
    }

    #[test]
    fn json_of_text_finds_the_json() {
        assert_eq!(
            json_of_text(r#" {"a":1} "#),
            Some(serde_json::json!({"a":1}))
        );
        assert_eq!(
            json_of_text("Here:\n```json\n{\"a\":2}\n```\nDone."),
            Some(serde_json::json!({"a":2}))
        );
        assert_eq!(
            json_of_text("Sure! {\"a\":3} hope it helps"),
            Some(serde_json::json!({"a":3}))
        );
        assert_eq!(json_of_text("no json"), None);
    }
}
