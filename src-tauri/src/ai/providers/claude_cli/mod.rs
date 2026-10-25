//! Claude through the user's installed `claude` CLI (ADR 0014), behind the `AiProvider` trait.
//! `cli.rs` finds and probes the executable, `turn.rs` runs one process per operation, and
//! `protocol.rs` turns its `stream-json` output into neutral events.

mod cli;
mod protocol;
mod turn;

use std::path::Path;
use std::sync::Mutex;

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
    /// The models the CLI listed (empty until then), and for which CLI version and account: the
    /// list only changes with them, and listing starts a whole CLI session.
    models: Mutex<Vec<AiModel>>,
    models_for: Mutex<Option<ModelsKey>>,
}

/// What the model list depends on: the CLI version and the logged-in account.
type ModelsKey = (Option<String>, Option<String>);

/// The CLI is asked for its models when logged in and not yet asked for this version and account.
fn should_list_models(listed_for: Option<&ModelsKey>, key: &ModelsKey, logged_in: bool) -> bool {
    logged_in && listed_for != Some(key)
}

impl ClaudeCliProvider {
    pub fn new() -> Self {
        Self {
            guard: ProcessGuard::new(),
            models: Mutex::new(Vec::new()),
            models_for: Mutex::new(None),
        }
    }
}

/// The CLI's default model: what the picker offers until the CLI has listed its models.
fn default_model() -> AiModel {
    AiModel {
        id: "default".into(),
        label: "Default".into(),
        description: None,
        image_input: true,
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
        let source = fenced(&capture.source_path, &capture.text);
        parts.push(match &capture.selection {
            Some(selection) => format!(
                "The user highlighted this text in `{}` (the selection is exactly this text):\n{}\n\
                 It sits in lines {}–{}, whose source is given as context{image}:\n{source}",
                capture.source_path,
                fenced("", selection),
                capture.first_line,
                capture.last_line,
            ),
            None => format!(
                "The user selected this region of `{}` (lines {}–{}){image}:\n{source}",
                capture.source_path, capture.first_line, capture.last_line,
            ),
        });
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
        // Exactly the models the CLI lists for this account (`status` asks it).
        let listed = self.models.lock().map(|m| m.clone()).unwrap_or_default();
        let models = if listed.is_empty() {
            vec![default_model()]
        } else {
            listed
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
            models,
            context_file_names: vec!["CLAUDE.md".into(), "CLAUDE.local.md".into()],
        }
    }

    fn status(&self) -> AiProviderStatus {
        let s = cli::status();
        log::info!("claude CLI: {:?} version {:?}", s.path, s.version);
        let key: ModelsKey = (s.version.clone(), s.email.clone());
        let listed_for = self.models_for.lock().ok().and_then(|k| k.clone());
        if should_list_models(listed_for.as_ref(), &key, s.logged_in)
            && let Some(path) = s.path.as_deref()
        {
            match cli::models(Path::new(path)) {
                Ok(listed) if !listed.is_empty() => {
                    let models = listed
                        .into_iter()
                        .map(|m| AiModel {
                            id: m.id,
                            label: m.label,
                            description: m.description,
                            // An image a model refuses surfaces as the CLI's error result.
                            image_input: true,
                        })
                        .collect();
                    if let Ok(mut cached) = self.models.lock() {
                        *cached = models;
                    }
                    if let Ok(mut listed_for) = self.models_for.lock() {
                        *listed_for = Some(key);
                    }
                }
                Ok(_) => log::warn!("claude CLI listed no models"),
                Err(e) => log::warn!("claude CLI models: {e}"),
            }
        }
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

    /// The context bar's flow: `collect` lists the documents, the user drops one with its ✕,
    /// `request_from` reads the paths kept, and the prompt inlines exactly those.
    #[test]
    fn the_prompt_carries_the_documents_the_user_kept() {
        use crate::ai::context::{Caps, collect, request_from};
        use crate::ai::types::AiStartRequest;
        use crate::paths::RootGuard;
        use std::fs;

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("docs/guide")).unwrap();
        fs::write(root.join("CLAUDE.md"), "# Root rules\n").unwrap();
        fs::write(root.join("docs/CLAUDE.md"), "# Docs rules\n").unwrap();
        fs::write(root.join("docs/guide/start.md"), "# Start\n").unwrap();
        let guard = RootGuard::new(root).unwrap();
        let names = vec!["CLAUDE.md".to_string(), "CLAUDE.local.md".to_string()];

        let listed = collect(&guard, Some("docs/guide/start.md"), &names, Caps::default()).unwrap();
        let paths: Vec<&str> = listed.iter().map(|d| d.path.as_str()).collect();
        assert_eq!(
            paths,
            ["CLAUDE.md", "docs/CLAUDE.md", "docs/guide/start.md"]
        );
        assert!(
            listed.iter().all(|d| d.content.is_none()),
            "no content listed"
        );

        let kept: Vec<String> = paths
            .iter()
            .filter(|p| **p != "docs/CLAUDE.md")
            .map(|p| (*p).to_string())
            .collect();
        let request = request_from(
            &guard,
            &names,
            AiStartRequest {
                prompt: "Explain".into(),
                context_paths: kept,
                ..AiStartRequest::default()
            },
        )
        .unwrap();
        let prompt = prompt_with_context(&request);
        assert!(prompt.contains("# Root rules"), "{prompt}");
        assert!(prompt.contains("docs/guide/start.md (the file the user is reading)"));
        assert!(!prompt.contains("# Docs rules"), "{prompt}");
        assert!(!prompt.contains("docs/CLAUDE.md"), "{prompt}");
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
                selection: None,
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
    fn a_text_selection_is_inlined_with_its_source_lines() {
        let request = AiRequest {
            prompt: "Shorten it".into(),
            capture: Some(AiCapture {
                source_path: "docs/a.md".into(),
                first_line: 3,
                last_line: 4,
                text: "Some **bold** words\nand more.\n".into(),
                selection: Some("bold words".into()),
            }),
            ..AiRequest::default()
        };
        let prompt = prompt_with_context(&request);
        assert!(prompt.starts_with(
            "The user highlighted this text in `docs/a.md` (the selection is exactly this \
             text):\n```\nbold words\n```\nIt sits in lines 3–4, whose source is given as \
             context:\n```markdown\nSome **bold** words\nand more.\n```"
        ));
        assert!(prompt.ends_with("The user's message:\n\nShorten it"));
    }

    #[test]
    fn lists_the_models_once_per_cli_version_and_account() {
        let key: ModelsKey = (Some("2.1.310".into()), Some("a@b.c".into()));
        assert!(should_list_models(None, &key, true));
        assert!(!should_list_models(None, &key, false));
        assert!(!should_list_models(Some(&key), &key, true));
        let updated: ModelsKey = (Some("2.1.311".into()), Some("a@b.c".into()));
        assert!(should_list_models(Some(&key), &updated, true));
        let other_account: ModelsKey = (Some("2.1.310".into()), Some("x@y.z".into()));
        assert!(should_list_models(Some(&key), &other_account, true));
    }

    #[test]
    fn declares_what_the_cli_supports() {
        let p = ClaudeCliProvider::new();
        assert_eq!(p.id(), "claude-cli");
        assert_eq!(p.display_name(), "Claude");
        let caps = p.capabilities();
        assert!(caps.permission_prompts && caps.resume && caps.streaming);
        // Before the CLI has listed its models: only its default.
        assert_eq!(caps.models, vec![default_model()]);
        // After: exactly what it listed.
        let listed = AiModel {
            id: "opus".into(),
            label: "Opus 5.5".into(),
            description: Some("For complex work".into()),
            image_input: true,
        };
        *p.models.lock().unwrap() = vec![listed.clone()];
        assert_eq!(p.capabilities().models, vec![listed]);
    }
}
