//! Claude through the user's installed `claude` CLI (ADR 0014), behind the `AiProvider` trait.
//! `cli.rs` finds and probes the executable, `turn.rs` runs one process per operation, and
//! `protocol.rs` turns its `stream-json` output into neutral events.

mod cli;
mod protocol;
mod turn;

use std::path::Path;

use crate::ai::process::ProcessGuard;
use crate::ai::types::{
    AiCapabilities, AiEvent, AiModel, AiOutcome, AiProviderStatus, AiRequest, PermissionDecision,
};
use crate::ai::{AiOperation, AiProvider, EventSink};
use crate::error::{AppError, AppResult};
use turn::{ClaudeTurn, TurnEvent, TurnOutcome, TurnRequest};

pub const PROVIDER_ID: &str = "claude-cli";
pub const DISPLAY_NAME: &str = "Claude";

pub struct ClaudeCliProvider {
    guard: ProcessGuard,
}

impl ClaudeCliProvider {
    pub fn new() -> Self {
        Self {
            guard: ProcessGuard::new(),
        }
    }
}

impl Default for ClaudeCliProvider {
    fn default() -> Self {
        Self::new()
    }
}

/// The prompt the CLI receives: the user's text, plus the files it should read first.
fn prompt_with_context(request: &AiRequest) -> String {
    if request.context_files.is_empty() {
        return request.prompt.clone();
    }
    let files = request
        .context_files
        .iter()
        .map(|f| format!("- {f}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "{}\n\n(Context: read these files of the project first, they are what the user is \
         looking at:\n{files})",
        request.prompt
    )
}

impl AiProvider for ClaudeCliProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn display_name(&self) -> &'static str {
        DISPLAY_NAME
    }

    fn capabilities(&self) -> AiCapabilities {
        let model = |id: &str, label: &str| AiModel {
            id: id.into(),
            label: label.into(),
        };
        AiCapabilities {
            streaming: true,
            resume: true,
            structured_output: true,
            image_input: true,
            permission_prompts: true,
            read_only_mode: true,
            usage_reporting: true,
            cost_reporting: true,
            models: vec![
                model("sonnet", "Sonnet (default)"),
                model("opus", "Opus"),
                model("haiku", "Haiku"),
            ],
            context_file_names: vec!["CLAUDE.md".into(), "CLAUDE.local.md".into()],
        }
    }

    fn status(&self) -> AiProviderStatus {
        let s = cli::status();
        log::info!("claude CLI: {:?} version {:?}", s.path, s.version);
        let help = if !s.installed {
            Some("Install Claude Code (https://claude.com/claude-code) and make sure `claude` runs in a terminal.".to_owned())
        } else if !s.logged_in {
            Some("Run `claude` in a terminal and log in, or run `claude auth login`.".to_owned())
        } else {
            None
        };
        AiProviderStatus {
            provider_id: PROVIDER_ID.into(),
            display_name: DISPLAY_NAME.into(),
            installed: s.installed,
            logged_in: s.logged_in,
            version: s.version,
            account: s.email,
            plan: s.subscription,
            problem: s.problem,
            help,
        }
    }

    fn start(
        &self,
        request: AiRequest,
        root: &Path,
        mut sink: EventSink,
    ) -> AppResult<Box<dyn AiOperation>> {
        let exe = cli::locate().ok_or_else(|| AppError::Ai(cli::NOT_INSTALLED.to_owned()))?;
        let turn_request = TurnRequest {
            prompt: prompt_with_context(&request),
            model: request.model,
            resume_session_id: request.resume_id,
            images: request.images,
            policy: request.policy,
            output_schema: request.output_schema,
        };
        let root_owned = root.to_path_buf();
        let turn = turn::start(
            &exe,
            root,
            &turn_request,
            0,
            &self.guard,
            Box::new(move |event| match event {
                TurnEvent::Message(value) => {
                    for e in protocol::events_of(&value) {
                        sink(e);
                    }
                }
                TurnEvent::Permission(p) => sink(AiEvent::PermissionRequest {
                    proposed_edit: protocol::proposed_edit(&p.tool_name, &p.input, &root_owned),
                    request_id: p.request_id,
                    tool: p.tool_name,
                    description: p.description,
                    input: p.input,
                }),
                TurnEvent::End {
                    outcome,
                    exit_code,
                    stderr,
                } => {
                    let detail = match (exit_code, stderr) {
                        (Some(code), Some(err)) => Some(format!("exit code {code}\n{err}")),
                        (Some(code), None) => Some(format!("exit code {code}")),
                        (None, err) => err,
                    };
                    sink(AiEvent::Done {
                        outcome: match outcome {
                            TurnOutcome::Completed => AiOutcome::Completed,
                            TurnOutcome::Cancelled => AiOutcome::Cancelled,
                            TurnOutcome::Crashed => AiOutcome::Failed,
                        },
                        detail,
                    });
                }
            }),
        )?;
        Ok(Box::new(turn))
    }
}

impl AiOperation for ClaudeTurn {
    fn respond(&self, request_id: &str, decision: &PermissionDecision) -> AppResult<()> {
        ClaudeTurn::respond(self, request_id, decision)
    }

    fn cancel(&self) {
        ClaudeTurn::cancel(self);
    }

    fn is_done(&self) -> bool {
        ClaudeTurn::is_done(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_files_are_listed_after_the_prompt() {
        let plain = AiRequest {
            prompt: "hi".into(),
            ..AiRequest::default()
        };
        assert_eq!(prompt_with_context(&plain), "hi");
        let with = AiRequest {
            prompt: "Explain this".into(),
            context_files: vec!["docs/a.md".into(), "CLAUDE.md".into()],
            ..AiRequest::default()
        };
        let prompt = prompt_with_context(&with);
        assert!(prompt.starts_with("Explain this\n\n(Context:"));
        assert!(prompt.contains("- docs/a.md\n- CLAUDE.md"));
    }

    #[test]
    fn declares_what_the_cli_supports() {
        let p = ClaudeCliProvider::new();
        assert_eq!(p.id(), "claude-cli");
        assert_eq!(p.display_name(), "Claude");
        let caps = p.capabilities();
        assert!(caps.permission_prompts && caps.resume && caps.streaming);
        assert_eq!(caps.models[0].id, "sonnet");
    }
}
