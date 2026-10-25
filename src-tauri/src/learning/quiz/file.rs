//! Shareable quiz files (ADR 0024): markdown with an `igrasp: quiz` front matter and one fenced
//! `igrasp-quiz` block per question. The frontend writes and reads the format (`quizFile.ts`);
//! the backend only recognizes a quiz file by its front matter (to refuse saving anything else
//! as a quiz, and for the graph to list the folder's quizzes).

/// Whether `text` starts with a front matter that declares `igrasp: quiz`.
pub fn is_quiz_markdown(text: &str) -> bool {
    front_matter(text).is_some_and(|fm| {
        fm.lines().any(|line| {
            let Some((key, value)) = line.split_once(':') else {
                return false;
            };
            key.trim() == "igrasp" && value.trim().trim_matches(['"', '\'']) == "quiz"
        })
    })
}

/// The front matter of `text` (between the leading `---` and the next `---`), if any.
pub fn front_matter(text: &str) -> Option<&str> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let rest = text
        .strip_prefix("---\r\n")
        .or_else(|| text.strip_prefix("---\n"))?;
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            return Some(&rest[..offset]);
        }
        offset += line.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_the_quiz_front_matter() {
        assert!(is_quiz_markdown("---\nigrasp: quiz\nid: x\n---\n# Q\n"));
        assert!(is_quiz_markdown(
            "\u{feff}---\r\ntitle: a\r\nigrasp: \"quiz\"\r\n---\r\n"
        ));
        assert!(!is_quiz_markdown("# No front matter\nigrasp: quiz\n"));
        assert!(!is_quiz_markdown("---\nigrasp: tutorial\n---\n"));
        assert!(!is_quiz_markdown("---\nigrasp: quiz\n"), "never closed");
        assert!(
            !is_quiz_markdown("---\ntitle: a\n---\nigrasp: quiz\n"),
            "outside it"
        );
        assert_eq!(front_matter("---\na: 1\n---\nbody"), Some("a: 1\n"));
    }
}
