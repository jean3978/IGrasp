//! Which files are written for AI agents (read for context, never a source of a question or a
//! tutorial step: the learning features are about the project, not about agent instructions),
//! and which files may hold secrets (never listed, never inlined, never cited). One table each,
//! shared with the tutorials.

/// Agent instruction files, by lower-case file name.
const AGENT_NAMES: &[&str] = &[
    "claude.md",
    "claude.local.md",
    "agents.md",
    "agent.md",
    "gemini.md",
    ".cursorrules",
    ".windsurfrules",
    ".clinerules",
    ".roorules",
    "copilot-instructions.md",
    "conventions.md.aider",
];

/// Folders that hold agent configuration and instructions (any depth), lower-case.
const AGENT_DIRS: &[&str] = &[
    ".claude",
    ".cursor",
    ".codex",
    ".junie",
    ".continue",
    ".windsurf",
    ".clinerules",
    ".roo",
    ".gemini",
    ".aider",
];

/// Whether `path` (root-relative) is written for AI agents. `extra_names` are the instruction
/// file names the active provider declares (`AiCapabilities::context_file_names`).
pub fn is_agent_file(path: &str, extra_names: &[String]) -> bool {
    let lower = path.to_lowercase();
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    let dirs: Vec<&str> = lower.split('/').collect();
    let in_dir = dirs[..dirs.len().saturating_sub(1)]
        .iter()
        .any(|d| AGENT_DIRS.contains(d));
    AGENT_NAMES.contains(&name)
        || extra_names.iter().any(|n| n.eq_ignore_ascii_case(name))
        || in_dir
        || name.starts_with(".aider")
        || name.ends_with(".prompt.md")
        || name.ends_with(".instructions.md")
        || name.ends_with(".mdc") && in_dir
        || lower.starts_with(".github/instructions/")
        || lower.starts_with(".github/prompts/")
        || lower == ".github/copilot-instructions.md"
}

/// Whether `path` may hold secrets: environment files, keys, certificates, credentials,
/// Terraform state.
pub fn is_secret(path: &str) -> bool {
    let lower = path.to_lowercase();
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    let ext = name.rsplit_once('.').map_or("", |(_, e)| e);
    name == ".env"
        || name.starts_with(".env.")
        || name.ends_with(".env")
        || matches!(
            ext,
            "pem" | "key" | "p12" | "pfx" | "jks" | "keystore" | "tfstate" | "kdbx" | "ppk" | "asc"
        )
        || name.ends_with(".tfstate.backup")
        || name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
        || name.starts_with("id_ecdsa")
        || name.starts_with("id_dsa")
        || name.contains(".secret")
        || name.starts_with("secrets.")
        || name.starts_with("secret.")
        || name.starts_with("credentials")
        || matches!(
            name,
            ".netrc" | ".npmrc" | ".pypirc" | ".htpasswd" | "service-account.json"
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_files() {
        let extra = vec!["AGENTS.md".to_owned(), "RULES.md".to_owned()];
        for p in [
            "CLAUDE.md",
            "docs/CLAUDE.md",
            "src/claude.local.md",
            "AGENTS.md",
            "GEMINI.md",
            ".cursorrules",
            ".cursor/rules/style.mdc",
            ".claude/settings.json",
            ".claude/commands/review.md",
            ".github/copilot-instructions.md",
            ".github/instructions/rust.instructions.md",
            ".windsurfrules",
            ".clinerules",
            ".aider.conf.yml",
            ".codex/config.toml",
            ".junie/guidelines.md",
            ".continue/config.json",
            "prompts/review.prompt.md",
            "docs/RULES.md",
        ] {
            assert!(is_agent_file(p, &extra), "{p}");
        }
        for p in [
            "README.md",
            "docs/architecture.md",
            "src/agents/brain.rs",
            ".github/workflows/ci.yml",
            "docs/claude-integration.md",
        ] {
            assert!(!is_agent_file(p, &extra), "{p}");
        }
    }

    #[test]
    fn secrets() {
        for p in [
            ".env",
            ".env.local",
            "config/prod.env",
            "certs/server.pem",
            "keys/app.key",
            "android/release.keystore",
            "infra/terraform.tfstate",
            "infra/terraform.tfstate.backup",
            "home/id_rsa",
            "home/id_ed25519.pub",
            "config/app.secret.json",
            "secrets.yaml",
            "credentials.json",
            ".npmrc",
            ".netrc",
        ] {
            assert!(is_secret(p), "{p}");
        }
        for p in [
            "src/env.rs",
            "src/secretary.rs",
            "docs/keys.md",
            "keyboard.ts",
            "src/monkey.rs",
        ] {
            assert!(!is_secret(p), "{p}");
        }
    }
}
