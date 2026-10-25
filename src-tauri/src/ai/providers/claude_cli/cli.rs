//! Locating the `claude` executable and checking that the user is logged in.

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;

/// What the probes found; the provider turns it into an `AiProviderStatus`.
#[derive(Debug, Clone, Default)]
pub struct CliStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub logged_in: bool,
    pub email: Option<String>,
    pub subscription: Option<String>,
    pub problem: Option<String>,
}

pub const NOT_INSTALLED: &str = "The Claude Code CLI was not found. Install it (see \
https://claude.com/claude-code), make sure `claude` works in a terminal, then check again.";
pub const NOT_LOGGED_IN: &str = "You are not logged in to Claude Code. Run `claude` in a terminal \
and log in (or run `claude auth login`), then check again.";

/// `--version` and `auth status` are quick; anything longer means the CLI is stuck.
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

/// Windows: do not flash a console window for each spawned process.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A command for `program` that never opens a console window.
pub fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Where the CLI installs itself. A desktop app launched from a menu often has a shorter `PATH`
/// than a terminal, so these are tried when `which` fails.
fn candidate_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    if let Some(home) = home {
        if cfg!(windows) {
            out.push(home.join(".local").join("bin").join("claude.exe"));
            if let Some(appdata) = std::env::var_os("APPDATA") {
                out.push(PathBuf::from(appdata).join("npm").join("claude.cmd"));
            }
        } else {
            out.push(home.join(".local/bin/claude"));
            out.push(home.join(".claude/local/claude"));
            out.push(home.join(".npm-global/bin/claude"));
        }
    }
    if !cfg!(windows) {
        out.push(PathBuf::from("/usr/local/bin/claude"));
        out.push(PathBuf::from("/opt/homebrew/bin/claude"));
    }
    out
}

/// The `claude` executable: on the `PATH` (honouring `PATHEXT` on Windows), else in the usual
/// install locations.
pub fn locate() -> Option<PathBuf> {
    if let Ok(path) = which::which("claude") {
        return Some(path);
    }
    candidate_paths().into_iter().find(|p| p.is_file())
}

/// Runs `program args` to completion, or kills it after `timeout` (`Ok(None)`).
fn run(program: &Path, args: &[&str], timeout: Duration) -> std::io::Result<Option<Output>> {
    let mut child = command(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let start = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output().map(Some);
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// `2.1.310 (Claude Code)` → `2.1.310`.
pub fn parse_version(stdout: &str) -> Option<String> {
    stdout
        .split_whitespace()
        .next()
        .filter(|v| v.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(str::to_owned)
}

/// The JSON printed by `claude auth status` (exit code 1 when logged out).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuthStatus {
    pub logged_in: bool,
    pub email: Option<String>,
    pub subscription_type: Option<String>,
}

pub fn parse_auth_status(stdout: &str) -> Option<AuthStatus> {
    // The JSON may be preceded by other output (e.g. an update notice).
    let start = stdout.find('{')?;
    serde_json::from_str(&stdout[start..]).ok()
}

/// One model the CLI offers, as its `initialize` answer lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliModel {
    /// What `--model` accepts (`default`, `opus`, a full id).
    pub id: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireModel {
    value: String,
    display_name: Option<String>,
    description: Option<String>,
}

/// The models of a `control_response` line answering `initialize` (`None` for any other line).
pub fn parse_models(line: &str) -> Option<Vec<CliModel>> {
    let message: serde_json::Value = serde_json::from_str(line).ok()?;
    if message["type"] != "control_response" || message["response"]["subtype"] != "success" {
        return None;
    }
    let models = message["response"]["response"].get("models")?.clone();
    let models: Vec<WireModel> = serde_json::from_value(models).ok()?;
    Some(
        models
            .into_iter()
            .filter(|m| !m.value.trim().is_empty())
            .map(|m| CliModel {
                label: m
                    .display_name
                    .filter(|l| !l.trim().is_empty())
                    .unwrap_or_else(|| m.value.clone()),
                id: m.value,
                description: m.description.filter(|d| !d.trim().is_empty()),
            })
            .collect(),
    )
}

/// The models this CLI offers to this account: starts it in stream-json mode, sends the
/// `initialize` control request and reads the answer. No message is sent, so no token is spent.
/// It runs in the temporary folder, never in the opened folder.
pub fn models(path: &Path) -> Result<Vec<CliModel>, String> {
    use std::io::{BufRead, BufReader, Write};

    let mut child = command(path)
        .args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
        ])
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Cannot run {}: {e}", path.display()))?;
    let request = r#"{"type":"control_request","request_id":"igrasp-models","request":{"subtype":"initialize"}}"#;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let written = writeln!(stdin, "{request}").and_then(|()| stdin.flush());

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(models) = parse_models(&line) {
                let _ = tx.send(models);
                return;
            }
        }
    });
    let answer = match written {
        Ok(()) => rx
            .recv_timeout(PROBE_TIMEOUT)
            .map_err(|_| "The Claude CLI did not list its models in time.".to_owned()),
        Err(e) => Err(format!("Cannot ask the Claude CLI for its models: {e}")),
    };
    // Its stdin stays open until here: the CLI would otherwise end before answering.
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    answer
}

/// Checks the installation and the login. Never fails: problems are reported in the status.
pub fn status() -> CliStatus {
    let Some(path) = locate() else {
        return CliStatus {
            problem: Some(NOT_INSTALLED.to_owned()),
            ..CliStatus::default()
        };
    };
    let mut status = CliStatus {
        installed: true,
        path: Some(path.display().to_string()),
        ..CliStatus::default()
    };

    match run(&path, &["--version"], PROBE_TIMEOUT) {
        Ok(Some(out)) if out.status.success() => {
            status.version = parse_version(&String::from_utf8_lossy(&out.stdout));
        }
        Ok(Some(out)) => {
            status.problem = Some(format!(
                "`claude --version` failed ({}): {}",
                out.status,
                String::from_utf8_lossy(&out.stderr).trim()
            ));
            return status;
        }
        Ok(None) => {
            status.problem = Some("`claude --version` did not answer in time.".to_owned());
            return status;
        }
        Err(e) => {
            status.problem = Some(format!("Cannot run {}: {e}", path.display()));
            return status;
        }
    }

    match run(&path, &["auth", "status"], PROBE_TIMEOUT) {
        Ok(Some(out)) => match parse_auth_status(&String::from_utf8_lossy(&out.stdout)) {
            Some(auth) if auth.logged_in => {
                status.logged_in = true;
                status.email = auth.email;
                status.subscription = auth.subscription_type;
            }
            Some(_) => status.problem = Some(NOT_LOGGED_IN.to_owned()),
            None => {
                status.problem = Some(format!(
                    "`claude auth status` gave an unexpected answer: {}",
                    String::from_utf8_lossy(&out.stdout).trim()
                ));
            }
        },
        Ok(None) => {
            status.problem = Some("`claude auth status` did not answer in time.".to_owned())
        }
        Err(e) => status.problem = Some(format!("Cannot run {}: {e}", path.display())),
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_models_of_the_initialize_answer() {
        let line = r#"{"type":"control_response","response":{"subtype":"success","request_id":"igrasp-models","response":{"commands":[],"models":[{"value":"default","resolvedModel":"claude-sonnet-5-5","displayName":"Default (recommended)","description":"Sonnet 5.5 · Efficient for routine tasks"},{"value":"opus","displayName":"Opus 5.5","description":"For complex work"},{"value":"claude-opus-4-8"},{"value":" "}]}}}"#;
        let models = parse_models(line).unwrap();
        assert_eq!(models.len(), 3);
        assert_eq!(
            models[0],
            CliModel {
                id: "default".into(),
                label: "Default (recommended)".into(),
                description: Some("Sonnet 5.5 · Efficient for routine tasks".into()),
            }
        );
        assert_eq!(models[2].label, "claude-opus-4-8");
        assert_eq!(models[2].description, None);

        assert!(parse_models(r#"{"type":"system","subtype":"init"}"#).is_none());
        assert!(
            parse_models(
                r#"{"type":"control_response","response":{"subtype":"error","error":"x"}}"#
            )
            .is_none()
        );
        assert!(parse_models("not json").is_none());
    }

    #[test]
    fn parses_the_version_line() {
        assert_eq!(
            parse_version("2.1.310 (Claude Code)\n").as_deref(),
            Some("2.1.310")
        );
        assert_eq!(parse_version("error: boom"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn parses_auth_status_logged_in_and_out() {
        let logged_in = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c","subscriptionType":"max"}"#;
        let auth = parse_auth_status(logged_in).unwrap();
        assert!(auth.logged_in);
        assert_eq!(auth.email.as_deref(), Some("a@b.c"));
        assert_eq!(auth.subscription_type.as_deref(), Some("max"));

        let logged_out = "Checking…\n{\"loggedIn\":false,\"authMethod\":\"none\"}\n";
        let auth = parse_auth_status(logged_out).unwrap();
        assert!(!auth.logged_in);
        assert_eq!(auth.email, None);

        assert!(parse_auth_status("not json").is_none());
    }

    #[test]
    fn status_of_a_missing_cli_names_the_problem() {
        // `locate` depends on the machine; only the shape of a "not installed" status is checked.
        let status = CliStatus {
            problem: Some(NOT_INSTALLED.to_owned()),
            ..CliStatus::default()
        };
        assert!(!status.installed);
        assert!(!status.logged_in);
        assert!(status.problem.as_deref().unwrap().contains("not found"));
    }
}
