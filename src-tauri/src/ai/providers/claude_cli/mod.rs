//! Claude through the user's installed `claude` CLI (ADR 0014), behind the `AiProvider` trait.
//! `cli.rs` finds and probes the executable, `turn.rs` runs one process per operation, and
//! `protocol.rs` turns its `stream-json` output into neutral events.

mod cli;
mod protocol;
mod turn;

use std::path::Path;

use crate::ai::process::ProcessGuard;
use crate::ai::types::{
    AiCapabilities, AiContextRole, AiEvent, AiModel, AiOutcome, AiProviderStatus, AiRequest,
    PermissionDecision,
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

/// A fence longer than any run of backticks in `text`, so the text cannot close it.
fn fence_for(text: &str) -> String {
    let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    "`".repeat((longest + 1).max(3))
}

fn fenced(path: &str, text: &str) -> String {
    let fence = fence_for(text);
    let lang = if path.to_lowercase().ends_with(".md") {
        "markdown"
    } else {
        ""
    };
    let body = text.strip_suffix('\n').unwrap_or(text);
    format!("{fence}{lang}\n{body}\n{fence}")
}

fn role_label(role: AiContextRole) -> &'static str {
    match role {
        AiContextRole::InstructionFile => "instruction file",
        AiContextRole::CurrentFile => "the file the user is reading",
        AiContextRole::Capture => "the captured document",
    }
}

/// The prompt the CLI receives: the context documents inlined (instruction files first, then
/// the current file), the ones too large to inline listed as paths to read, the captured region
/// with its line range, then the user's message.
fn prompt_with_context(request: &AiRequest) -> String {
    if request.context.is_empty() && request.capture.is_none() {
        return request.prompt.clone();
    }
    let mut parts = Vec::new();
    let (inlined, listed): (Vec<_>, Vec<_>) =
        request.context.iter().partition(|d| d.content.is_some());
    if !inlined.is_empty() {
        parts.push(
            "The user is reading this project in IGrasp. These files are part of the context, \
             general rules first:"
                .to_owned(),
        );
        for doc in inlined {
            parts.push(format!(
                "{} ({}):\n{}",
                doc.path,
                role_label(doc.role),
                fenced(&doc.path, doc.content.as_deref().unwrap_or_default())
            ));
        }
    }
    if !listed.is_empty() {
        let lines = listed
            .iter()
            .map(|d| format!("- {} ({}, {} bytes)", d.path, role_label(d.role), d.bytes))
            .collect::<Vec<_>>()
            .join("\n");
        parts.push(format!(
            "These files are also part of the context but too large to include; read them if \
             you need them:\n{lines}"
        ));
    }
    if let Some(capture) = &request.capture {
        let image = if request.images.is_empty() {
            ""
        } else {
            "; the image shows how it is rendered"
        };
        parts.push(format!(
            "The user selected this region of `{}` (lines {}–{}){image}:\n{}",
            capture.source_path,
            capture.first_line,
            capture.last_line,
            fenced(&capture.source_path, &capture.text)
        ));
    }
    parts.push(format!("The user's message:\n\n{}", request.prompt));
    parts.join("\n\n")
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
                    kind: protocol::permission_kind(&p.tool_name, &p.input, &root_owned),
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
    use crate::ai::types::{AiCapture, AiContextDocument, AiImage};

    fn doc(path: &str, role: AiContextRole, content: Option<&str>) -> AiContextDocument {
        AiContextDocument {
            path: path.into(),
            role,
            content: content.map(String::from),
            bytes: content.map_or(500_000, |c| c.len() as u64),
            truncated: content.is_none(),
        }
    }

    #[test]
    fn context_documents_are_inlined_before_the_message() {
        let plain = AiRequest {
            prompt: "hi".into(),
            ..AiRequest::default()
        };
        assert_eq!(prompt_with_context(&plain), "hi");

        let with = AiRequest {
            prompt: "Explain this".into(),
            context: vec![
                doc(
                    "CLAUDE.md",
                    AiContextRole::InstructionFile,
                    Some("# Rules\n"),
                ),
                doc("docs/huge.md", AiContextRole::CurrentFile, None),
                doc(
                    "docs/a.md",
                    AiContextRole::CurrentFile,
                    Some("Code:\n```sh\nls\n```\n"),
                ),
            ],
            ..AiRequest::default()
        };
        let prompt = prompt_with_context(&with);
        let rules = prompt.find("CLAUDE.md (instruction file):\n```markdown\n# Rules\n```");
        let current = prompt.find("docs/a.md (the file the user is reading):\n````markdown\n");
        let listed = prompt.find("- docs/huge.md (the file the user is reading, 500000 bytes)");
        let message = prompt.find("The user's message:\n\nExplain this");
        assert!(
            rules.is_some() && current.is_some() && listed.is_some(),
            "{prompt}"
        );
        assert!(rules < current && current < listed && listed < message);
        assert!(prompt.ends_with("Explain this"));
    }

    #[test]
    fn a_capture_is_inlined_with_its_line_range() {
        let request = AiRequest {
            prompt: "About this region:".into(),
            capture: Some(AiCapture {
                source_path: "docs/a.md".into(),
                first_line: 40,
                last_line: 58,
                text: "| a | b |\n".into(),
            }),
            images: vec![AiImage {
                media_type: "image/png".into(),
                data_base64: "AAAA".into(),
            }],
            ..AiRequest::default()
        };
        let prompt = prompt_with_context(&request);
        assert!(prompt.starts_with(
            "The user selected this region of `docs/a.md` (lines 40–58); the image shows how \
             it is rendered:\n```markdown\n| a | b |\n```"
        ));
        assert!(prompt.ends_with("The user's message:\n\nAbout this region:"));
        assert_eq!(fence_for("````"), "`````");
        assert_eq!(fence_for("none"), "```");
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
