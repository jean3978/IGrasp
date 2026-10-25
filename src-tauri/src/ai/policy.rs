//! The app's permission policy: what happens to a permission request of each kind, from the
//! user's settings. Pure; the gateway applies it before a request reaches the frontend.
//!
//! Reads inside the folder never get here: providers do not prompt for them. What the app
//! cannot see either: a provider's own allow rules (for the Claude CLI, the user's or the
//! project's `.claude/settings.json`) let some tools run without prompting; every tool call is
//! still shown in the transcript.

pub use crate::appdata::settings::{AiPermissionSettings, PermissionRule};

use super::types::AiPermissionKind;

/// What the model is told when the settings deny a tool call.
pub const DENIED_BY_SETTINGS: &str = "Denied by the user's IGrasp settings.";
/// What the model is told when a read-only operation asks to change something.
pub const DENIED_READ_ONLY: &str = "This is a read-only operation: IGrasp does not allow \
changing files, running commands or browsing during it.";

pub const REASON_ALLOWED_BY_SETTINGS: &str = "allowed by your settings";
pub const REASON_DENIED_BY_SETTINGS: &str = "denied by your settings";
pub const REASON_READ_ONLY: &str = "read-only operation";

/// The rule of the settings for `kind`.
pub fn decide(kind: AiPermissionKind, settings: &AiPermissionSettings) -> PermissionRule {
    match kind {
        AiPermissionKind::MarkdownEdit => settings.markdown_edits,
        AiPermissionKind::FileEdit => settings.file_edits,
        AiPermissionKind::Command => settings.commands,
        AiPermissionKind::Web => settings.web,
        AiPermissionKind::Other => settings.other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KINDS: [AiPermissionKind; 5] = [
        AiPermissionKind::MarkdownEdit,
        AiPermissionKind::FileEdit,
        AiPermissionKind::Command,
        AiPermissionKind::Web,
        AiPermissionKind::Other,
    ];

    #[test]
    fn everything_asks_by_default() {
        let settings = AiPermissionSettings::default();
        for kind in KINDS {
            assert_eq!(decide(kind, &settings), PermissionRule::Ask, "{kind:?}");
        }
    }

    #[test]
    fn each_kind_follows_its_own_setting() {
        for (i, kind) in KINDS.into_iter().enumerate() {
            for rule in [
                PermissionRule::Ask,
                PermissionRule::Allow,
                PermissionRule::Deny,
            ] {
                // Every other kind gets a different rule, so a mix-up shows.
                let rest = if rule == PermissionRule::Ask {
                    PermissionRule::Deny
                } else {
                    PermissionRule::Ask
                };
                let mut rules = [rest; 5];
                rules[i] = rule;
                let [markdown_edits, file_edits, commands, web, other] = rules;
                let settings = AiPermissionSettings {
                    markdown_edits,
                    file_edits,
                    commands,
                    web,
                    other,
                };
                for (j, k) in KINDS.into_iter().enumerate() {
                    let want = if i == j { rule } else { rest };
                    assert_eq!(
                        decide(k, &settings),
                        want,
                        "{k:?} when {kind:?} is {rule:?}"
                    );
                }
            }
        }
    }
}
