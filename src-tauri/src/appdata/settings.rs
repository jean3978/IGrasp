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
}
