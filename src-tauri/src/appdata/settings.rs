//! User settings (`settings.json`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MIN_FONT_SIZE: u32 = 12;
pub const MAX_FONT_SIZE: u32 = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum Theme {
    Light,
    Dark,
    HighContrast,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ReadingWidth {
    Narrow,
    Medium,
    Wide,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum WindowFrame {
    Custom,
    Native,
}

/// How the app answers a permission request of one kind.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PermissionRule {
    /// Ask the user (the diff review for markdown edits, a card for the rest).
    #[default]
    Ask,
    Allow,
    Deny,
}

/// The app's answer per permission kind (`ai::policy`). Reads inside the folder never ask.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AiPermissionSettings {
    pub markdown_edits: PermissionRule,
    pub file_edits: PermissionRule,
    pub commands: PermissionRule,
    pub web: PermissionRule,
    pub other: PermissionRule,
}

/// From which estimated size the chat shows the confirmation card before starting.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ConfirmFrom {
    Medium,
    #[default]
    Large,
    Never,
}

pub const DEFAULT_AI_PROVIDER: &str = "claude-cli";
pub const DEFAULT_HISTORY_LIMIT: u32 = 100;
pub const MIN_HISTORY_LIMIT: u32 = 10;
pub const MAX_HISTORY_LIMIT: u32 = 1000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AiSettings {
    /// Id of the AI provider (changed through `ai_set_provider` only).
    pub provider: String,
    /// The last choice of the model picker; empty for the provider's default.
    pub model: String,
    pub permissions: AiPermissionSettings,
    pub confirm_from: ConfirmFrom,
    /// Conversations kept per folder.
    pub history_limit: u32,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: DEFAULT_AI_PROVIDER.to_owned(),
            model: String::new(),
            permissions: AiPermissionSettings::default(),
            confirm_from: ConfirmFrom::default(),
            history_limit: DEFAULT_HISTORY_LIMIT,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct AiPermissionSettingsPatch {
    pub markdown_edits: Option<PermissionRule>,
    pub file_edits: Option<PermissionRule>,
    pub commands: Option<PermissionRule>,
    pub web: Option<PermissionRule>,
    pub other: Option<PermissionRule>,
}

/// Partial update of `AiSettings`. The provider is not here: it changes through
/// `ai_set_provider`, which also swaps the running provider.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct AiSettingsPatch {
    pub model: Option<String>,
    pub permissions: Option<AiPermissionSettingsPatch>,
    pub confirm_from: Option<ConfirmFrom>,
    pub history_limit: Option<u32>,
}

impl AiSettingsPatch {
    pub fn apply(self, s: &mut AiSettings) {
        if let Some(v) = self.model {
            s.model = v;
        }
        if let Some(p) = self.permissions {
            let rules = &mut s.permissions;
            for (patch, rule) in [
                (p.markdown_edits, &mut rules.markdown_edits),
                (p.file_edits, &mut rules.file_edits),
                (p.commands, &mut rules.commands),
                (p.web, &mut rules.web),
                (p.other, &mut rules.other),
            ] {
                if let Some(v) = patch {
                    *rule = v;
                }
            }
        }
        if let Some(v) = self.confirm_from {
            s.confirm_from = v;
        }
        if let Some(v) = self.history_limit {
            s.history_limit = v;
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    pub version: u32,
    pub theme: Theme,
    /// Base font size of the preview, in CSS pixels (12–24).
    pub font_size: u32,
    pub reading_width: ReadingWidth,
    pub toasts_muted: bool,
    /// Extra gitignore-style patterns excluded from the file tree.
    pub ignore_patterns: Vec<String>,
    /// Default for "show dotfiles" in folders without a saved session.
    pub show_dotfiles: bool,
    /// Default for "show ignored files" in folders without a saved session.
    pub show_ignored: bool,
    pub window_frame: WindowFrame,
    pub ai: AiSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            theme: Theme::System,
            font_size: 16,
            reading_width: ReadingWidth::Medium,
            toasts_muted: false,
            ignore_patterns: Vec::new(),
            show_dotfiles: false,
            show_ignored: false,
            window_frame: WindowFrame::Custom,
            ai: AiSettings::default(),
        }
    }
}

impl Settings {
    /// Clamps values into their valid ranges and drops blank ignore patterns.
    pub fn normalize(&mut self) {
        self.version = 1;
        self.font_size = self.font_size.clamp(MIN_FONT_SIZE, MAX_FONT_SIZE);
        self.ignore_patterns = self
            .ignore_patterns
            .iter()
            .map(|p| p.trim().to_owned())
            .filter(|p| !p.is_empty() && !p.starts_with('#'))
            .collect();
        let ai = &mut self.ai;
        ai.provider = ai.provider.trim().to_owned();
        if ai.provider.is_empty() {
            DEFAULT_AI_PROVIDER.clone_into(&mut ai.provider);
        }
        ai.model = ai.model.trim().to_owned();
        // A model id is letters, digits and `.-_:/`, never a flag; anything else is dropped.
        let valid_model = ai
            .model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '/'));
        if !valid_model || ai.model.starts_with('-') {
            ai.model.clear();
        }
        ai.history_limit = ai.history_limit.clamp(MIN_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
    }
}

/// Partial update sent by the frontend; absent fields are left unchanged.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub font_size: Option<u32>,
    pub reading_width: Option<ReadingWidth>,
    pub toasts_muted: Option<bool>,
    pub ignore_patterns: Option<Vec<String>>,
    pub show_dotfiles: Option<bool>,
    pub show_ignored: Option<bool>,
    pub window_frame: Option<WindowFrame>,
    pub ai: Option<AiSettingsPatch>,
}

impl SettingsPatch {
    pub fn apply(self, s: &mut Settings) {
        if let Some(v) = self.theme {
            s.theme = v;
        }
        if let Some(v) = self.font_size {
            s.font_size = v;
        }
        if let Some(v) = self.reading_width {
            s.reading_width = v;
        }
        if let Some(v) = self.toasts_muted {
            s.toasts_muted = v;
        }
        if let Some(v) = self.ignore_patterns {
            s.ignore_patterns = v;
        }
        if let Some(v) = self.show_dotfiles {
            s.show_dotfiles = v;
        }
        if let Some(v) = self.show_ignored {
            s.show_ignored = v;
        }
        if let Some(v) = self.ai {
            v.apply(&mut s.ai);
        }
        if let Some(v) = self.window_frame {
            s.window_frame = v;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_and_missing_fields_fall_back_to_defaults() {
        let s: Settings = serde_json::from_str(r#"{ "theme": "dark", "future": 1 }"#).unwrap();
        assert_eq!(s.theme, Theme::Dark);
        assert_eq!(s.font_size, 16);
    }

    #[test]
    fn serializes_in_camel_and_kebab_case() {
        let s = Settings {
            theme: Theme::HighContrast,
            ..Settings::default()
        };
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["theme"], "high-contrast");
        assert_eq!(json["fontSize"], 16);
        assert_eq!(json["windowFrame"], "custom");
    }

    #[test]
    fn patch_then_normalize_clamps_and_cleans() {
        let mut s = Settings::default();
        let patch: SettingsPatch = serde_json::from_str(
            r##"{ "fontSize": 99, "ignorePatterns": ["  dist/ ", "", "# comment"] }"##,
        )
        .unwrap();
        patch.apply(&mut s);
        s.normalize();
        assert_eq!(s.font_size, MAX_FONT_SIZE);
        assert_eq!(s.ignore_patterns, vec!["dist/".to_owned()]);
        assert_eq!(s.theme, Theme::System);
    }

    #[test]
    fn ai_settings_default_and_round_trip() {
        // A settings file of an older version gets the AI defaults.
        let s: Settings = serde_json::from_str(r#"{ "theme": "dark" }"#).unwrap();
        assert_eq!(s.ai, AiSettings::default());
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(
            json["ai"],
            serde_json::json!({
                "provider": "claude-cli",
                "model": "",
                "permissions": { "markdownEdits": "ask", "fileEdits": "ask", "commands": "ask", "web": "ask", "other": "ask" },
                "confirmFrom": "large",
                "historyLimit": 100,
            })
        );
        // Missing AI fields fall back one by one.
        let s: Settings = serde_json::from_str(
            r#"{ "ai": { "model": "opus", "permissions": { "web": "deny" } } }"#,
        )
        .unwrap();
        assert_eq!(s.ai.model, "opus");
        assert_eq!(s.ai.permissions.web, PermissionRule::Deny);
        assert_eq!(s.ai.permissions.commands, PermissionRule::Ask);
        assert_eq!(s.ai.provider, DEFAULT_AI_PROVIDER);
    }

    #[test]
    fn ai_patch_changes_only_what_it_names() {
        let mut s = Settings::default();
        let patch: SettingsPatch = serde_json::from_str(
            r#"{ "ai": { "model": " sonnet ", "permissions": { "commands": "allow" }, "historyLimit": 5 } }"#,
        )
        .unwrap();
        patch.apply(&mut s);
        s.normalize();
        assert_eq!(s.ai.model, "sonnet");
        assert_eq!(s.ai.permissions.commands, PermissionRule::Allow);
        assert_eq!(s.ai.permissions.markdown_edits, PermissionRule::Ask);
        assert_eq!(s.ai.history_limit, MIN_HISTORY_LIMIT);
        assert_eq!(s.ai.confirm_from, ConfirmFrom::Large);

        let patch: SettingsPatch =
            serde_json::from_str(r#"{ "ai": { "model": "--dangerously-skip" } }"#).unwrap();
        patch.apply(&mut s);
        s.normalize();
        assert_eq!(s.ai.model, "", "a flag-like model is dropped");
        assert_eq!(s.ai.permissions.commands, PermissionRule::Allow);
    }
}
