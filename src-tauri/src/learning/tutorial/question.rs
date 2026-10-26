//! Questions readers ask about a step of a tutorial. The reader highlights text of a step card or
//! frames part of it, asks in the chat (an ordinary chat message, started by its Send), and may
//! save the question with the answer on the step: kept with a private tutorial, written into a
//! shared one's chapter file after the write confirmation. A saved question carries no author
//! and no date: shared, it is anonymous.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::TutorialRef;
use super::markdown;
use super::schema::{StepQuestion, Tutorial};
use crate::error::{AppError, AppResult};

pub const MAX_QUESTION_CHARS: usize = 1_000;
pub const MAX_QUOTE_CHARS: usize = 1_000;
pub const MAX_ANSWER_CHARS: usize = 20_000;
/// Saved questions per chapter at most.
pub const MAX_QUESTIONS_PER_CHAPTER: usize = 50;

/// The step a chat message is about, sent with the message (`AiStartRequest::tutorial_step`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, optional_fields)]
pub struct TutorialStepContext {
    pub tutorial: TutorialRef,
    pub chapter: u32,
    pub step: u32,
    /// The text of the step the reader highlighted or framed.
    pub quote: Option<String>,
}

fn refuse(what: &str) -> AppError {
    AppError::Forbidden(what.to_owned())
}

/// The tutorial with `question` saved on step `question.step` of chapter `chapter`.
pub fn with_question(t: &Tutorial, chapter: u32, question: StepQuestion) -> AppResult<Tutorial> {
    let mut t = t.clone();
    let c = t
        .chapters
        .get_mut(chapter as usize)
        .ok_or_else(|| refuse("This chapter does not exist."))?;
    if question.step as usize >= c.steps.len() {
        return Err(refuse("This step does not exist."));
    }
    if c.questions.len() >= MAX_QUESTIONS_PER_CHAPTER {
        return Err(refuse(&format!(
            "A chapter keeps at most {MAX_QUESTIONS_PER_CHAPTER} questions; remove one first."
        )));
    }
    let q = question.question.trim();
    let a = question.answer.trim();
    if q.is_empty() || a.is_empty() {
        return Err(refuse(
            "A saved question needs its question and its answer.",
        ));
    }
    let count = |s: &str| s.chars().count();
    if count(q) > MAX_QUESTION_CHARS
        || count(a) > MAX_ANSWER_CHARS
        || question
            .quote
            .as_deref()
            .is_some_and(|s| count(s) > MAX_QUOTE_CHARS)
    {
        return Err(refuse("This question or its answer is too long to save."));
    }
    c.questions.push(question);
    markdown::normalize(&mut t);
    Ok(t)
}

/// The tutorial without the `index`-th saved question of chapter `chapter`.
pub fn without_question(t: &Tutorial, chapter: u32, index: u32) -> AppResult<Tutorial> {
    let mut t = t.clone();
    let c = t
        .chapters
        .get_mut(chapter as usize)
        .ok_or_else(|| refuse("This chapter does not exist."))?;
    if index as usize >= c.questions.len() {
        return Err(refuse("This question does not exist."));
    }
    c.questions.remove(index as usize);
    Ok(t)
}

/// What a chat message about a step adds to its prompt (the step as the reader sees it, what
/// they pointed at) and the files the step cites, for the context.
pub fn step_context(
    t: &Tutorial,
    ctx: &TutorialStepContext,
    question: &str,
) -> AppResult<(String, Vec<String>)> {
    let chapter = t
        .chapters
        .get(ctx.chapter as usize)
        .ok_or_else(|| refuse("This chapter does not exist."))?;
    let step = chapter
        .steps
        .get(ctx.step as usize)
        .ok_or_else(|| refuse("This step does not exist."))?;
    let quote = ctx
        .quote
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(|q| {
            let q: String = q.chars().take(MAX_QUOTE_CHARS).collect();
            format!(
                "\nThey pointed at this part of the step:\n> {}\n",
                q.replace('\n', "\n> ")
            )
        })
        .unwrap_or_default();
    let prompt = format!(
        "The user is taking the tutorial \"{title}\" about the project {project}: chapter {c} \"{chapter_title}\", step {s} of {n}. The step reads:\n\n{step_text}\n{quote}\nAnswer their question about this step in the terms of this project, citing its files (path and lines) when it helps; if the step itself is wrong or out of date, say so. Do not change any file.\n\nTheir question: {question}",
        title = t.title,
        project = t.project,
        c = ctx.chapter + 1,
        chapter_title = chapter.title,
        s = ctx.step + 1,
        n = chapter.steps.len(),
        step_text = markdown::step_text(step),
    );
    let mut paths: Vec<String> = Vec::new();
    for c in step.citations() {
        if !paths.contains(&c.path) {
            paths.push(c.path);
        }
    }
    Ok((prompt, paths))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::learning::tutorial::markdown::tests::sample;

    fn question(step: u32) -> StepQuestion {
        StepQuestion {
            step,
            quote: Some("  DEBOUNCE_MS  ".into()),
            question: " Why 200 ms? ".into(),
            answer: "Because the watcher batches events.\n".into(),
        }
    }

    #[test]
    fn saves_and_removes_a_question_on_a_step() {
        let t = sample();
        let with = with_question(&t, 0, question(1)).unwrap();
        let saved = &with.chapters[0].questions[0];
        assert_eq!(saved.question, "Why 200 ms?");
        assert_eq!(saved.quote.as_deref(), Some("DEBOUNCE_MS"));
        // It reads back from the shared format, anonymously (no author, no date).
        let files = markdown::write(&with, "docs/tutorials/x");
        assert!(files[1].text.contains("## Questions from readers"));
        let (back, skipped) = markdown::read(&files).unwrap();
        assert!(skipped.is_empty());
        assert_eq!(back.chapters[0].questions, with.chapters[0].questions);
        let without = without_question(&with, 0, 0).unwrap();
        assert!(without.chapters[0].questions.is_empty());
    }

    #[test]
    fn refuses_a_missing_step_an_empty_answer_and_too_many() {
        let t = sample();
        assert!(with_question(&t, 0, question(99)).is_err());
        assert!(with_question(&t, 9, question(0)).is_err());
        let mut empty = question(0);
        empty.answer = "  ".into();
        assert!(with_question(&t, 0, empty).is_err());
        let mut full = t.clone();
        for _ in 0..MAX_QUESTIONS_PER_CHAPTER {
            full = with_question(&full, 0, question(0)).unwrap();
        }
        assert!(with_question(&full, 0, question(0)).is_err());
        assert!(without_question(&t, 0, 0).is_err());
    }

    #[test]
    fn the_prompt_holds_the_step_and_what_was_pointed_at() {
        let t = sample();
        let ctx = TutorialStepContext {
            tutorial: TutorialRef::Private { id: t.id.clone() },
            chapter: 0,
            step: 0,
            quote: Some("waits DEBOUNCE_MS".into()),
        };
        let (prompt, paths) = step_context(&t, &ctx, "Why wait?").unwrap();
        assert!(prompt.contains(&t.title));
        assert!(prompt.contains("> waits DEBOUNCE_MS"));
        assert!(prompt.ends_with("Their question: Why wait?"));
        assert_eq!(paths, vec!["src/index/watcher.rs".to_owned()]);
    }
}
