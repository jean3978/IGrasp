//! The confirmation card's cost line for a tutorial operation: what the same kind of operation
//! cost last time in this folder (the provider's own report), else the range measured on real
//! projects by the proof of concept (docs/plan/poc-tutorials.md). Words only, no promise: the
//! cost depends on the project far more than on the options.

use super::Length;
use super::progress::TutorialUsage;

/// The kinds of tutorial operations, as `TutorialUsage::kind` records them.
pub const OUTLINE: &str = "outline";
pub const CHAPTERS: &str = "chapters";
pub const REVIEW: &str = "review";
pub const SUGGEST: &str = "suggest";

/// Dollars per call measured by the proof of concept with a mid-size model, by kind and length.
fn measured(kind: &str, length: Length) -> (f64, f64) {
    match (kind, length) {
        (OUTLINE, Length::Quick) => (0.15, 0.25),
        (OUTLINE, Length::Standard) => (0.20, 0.45),
        (OUTLINE, Length::Deep) => (0.45, 0.60),
        (CHAPTERS, Length::Quick) => (0.15, 0.25),
        (CHAPTERS, Length::Standard) => (0.20, 0.45),
        (CHAPTERS, Length::Deep) => (0.40, 0.55),
        (REVIEW, _) => (0.20, 0.60),
        _ => (0.05, 0.20),
    }
}

fn what(kind: &str) -> &'static str {
    match kind {
        OUTLINE => "outline",
        CHAPTERS => "chapter",
        REVIEW => "review",
        _ => "suggestion",
    }
}

/// The cost line of an operation of `kind` and `length` making `calls` provider calls.
pub fn hint(usage: &[TutorialUsage], kind: &str, length: Length, calls: u32) -> String {
    let calls = calls.max(1);
    let last = usage
        .iter()
        .rev()
        .filter(|u| u.kind == kind && u.calls > 0)
        .find(|u| u.length == length || matches!(kind, REVIEW | SUGGEST));
    if let Some(u) = last
        && let Some(cost) = u.cost_usd
    {
        let per_call = cost / f64::from(u.calls);
        return if calls == 1 {
            format!(
                "The last {} in this folder cost ${per_call:.2} (with {}).",
                what(kind),
                if u.model.is_empty() {
                    "the default model"
                } else {
                    &u.model
                }
            )
        } else {
            format!(
                "About ${per_call:.2} per {} in this folder, so about ${:.2} for {calls}.",
                what(kind),
                per_call * f64::from(calls)
            )
        };
    }
    let (low, high) = measured(kind, length);
    let total = if calls > 1 {
        format!(
            ", about ${:.2}–{:.2} for {calls}",
            low * f64::from(calls),
            high * f64::from(calls)
        )
    } else {
        String::new()
    };
    format!(
        "Usually ${low:.2}–{high:.2} per {} with a mid-size model on real projects{total}; a large project costs more.",
        what(kind)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_folder_s_last_cost_wins_over_the_measured_range() {
        assert_eq!(
            hint(&[], OUTLINE, Length::Standard, 1),
            "Usually $0.20–0.45 per outline with a mid-size model on real projects; a large project costs more."
        );
        assert!(hint(&[], CHAPTERS, Length::Quick, 3).contains("about $0.45–0.75 for 3"));
        let usage = vec![
            TutorialUsage {
                kind: CHAPTERS.into(),
                length: Length::Quick,
                cost_usd: Some(0.9),
                calls: 3,
                ..TutorialUsage::default()
            },
            TutorialUsage {
                kind: OUTLINE.into(),
                length: Length::Standard,
                model: "m".into(),
                cost_usd: Some(0.41),
                calls: 1,
                ..TutorialUsage::default()
            },
        ];
        assert_eq!(
            hint(&usage, OUTLINE, Length::Standard, 1),
            "The last outline in this folder cost $0.41 (with m)."
        );
        assert_eq!(
            hint(&usage, CHAPTERS, Length::Quick, 2),
            "About $0.30 per chapter in this folder, so about $0.60 for 2."
        );
        // Another length: the measured range.
        assert!(hint(&usage, OUTLINE, Length::Deep, 1).starts_with("Usually $0.45–0.60"));
    }
}
