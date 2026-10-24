//! Heading slugs compatible with `github-slugger`, which `rehype-slug` uses in the preview: the
//! anchors computed here must match the ids the rendered document has. The shared fixture
//! `src/test/fixtures/slugs.json` is checked by both `cargo test` and Vitest.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

/// Everything github-slugger removes: what is not a letter, mark, number, connector punctuation,
/// space or hyphen (its generated `regex.js` is this class for its Unicode version).
static REMOVED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^\p{L}\p{M}\p{N}\p{Pc} \-]").expect("valid slug regex"));

/// The slug of one heading text, without de-duplication.
pub fn slug(text: &str) -> String {
    REMOVED
        .replace_all(&text.to_lowercase(), "")
        .replace(' ', "-")
}

/// Slugs of one document: repeated headings get `-1`, `-2`, … like github-slugger.
#[derive(Debug, Default)]
pub struct Slugger {
    occurrences: HashMap<String, u32>,
}

impl Slugger {
    pub fn slug(&mut self, text: &str) -> String {
        let original = slug(text);
        let mut result = original.clone();
        while self.occurrences.contains_key(&result) {
            let count = self.occurrences.entry(original.clone()).or_insert(0);
            *count += 1;
            result = format!("{original}-{count}");
        }
        self.occurrences.insert(result.clone(), 0);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Case {
        name: String,
        headings: Vec<String>,
        slugs: Vec<String>,
    }

    #[test]
    fn matches_the_shared_github_slugger_fixture() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../../../src/test/fixtures/slugs.json")).unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let mut slugger = Slugger::default();
            // The fixture holds heading lines as written; the parser hands over the rendered
            // text, which is trimmed and has no code backticks.
            let got: Vec<String> = case
                .headings
                .iter()
                .map(|h| slugger.slug(&h.trim().replace('`', "")))
                .collect();
            assert_eq!(got, case.slugs, "case {:?}", case.name);
        }
    }

    #[test]
    fn duplicates_follow_github_slugger() {
        let mut s = Slugger::default();
        let got: Vec<String> = ["a", "a", "a-1", "a"].iter().map(|t| s.slug(t)).collect();
        assert_eq!(got, ["a", "a-1", "a-1-1", "a-2"]);
    }
}
