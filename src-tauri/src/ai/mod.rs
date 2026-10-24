//! AI providers behind one abstraction, reached only through the gateway (ADR 0015).
//!
//! Features (chat, later quiz and tutorials) never talk to a provider: they ask
//! [`gateway::AiGateway`] to start an operation on behalf of a user action and receive the
//! provider-neutral [`types::AiEvent`] stream. The provider modules are private to this module,
//! so no other code can spawn a CLI or call an API.

pub mod context;
pub mod estimate;
pub mod gateway;
pub mod policy;
mod process;
mod providers;
pub mod types;

use std::path::Path;

use crate::error::AppResult;
use types::{AiCapabilities, AiEvent, AiProviderStatus, AiRequest, PermissionDecision};

/// Receives the events of one operation, from any thread, ending with `AiEvent::Done`.
pub type EventSink = Box<dyn FnMut(AiEvent) + Send + 'static>;

/// One implementation per provider (`providers/claude_cli` today).
pub trait AiProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn capabilities(&self) -> AiCapabilities;
    /// May run external commands; called from a blocking thread.
    fn status(&self) -> AiProviderStatus;
    /// Starts an operation in `root`. Events go to `sink` from a background thread.
    fn start(
        &self,
        request: AiRequest,
        root: &Path,
        sink: EventSink,
    ) -> AppResult<Box<dyn AiOperation>>;
}

/// A running operation. Dropping it must stop whatever runs behind it.
pub trait AiOperation: Send {
    fn respond(&self, request_id: &str, decision: &PermissionDecision) -> AppResult<()>;
    /// Stops the operation; `AiEvent::Done { Cancelled }` follows.
    fn cancel(&self);
    fn is_done(&self) -> bool;
}
