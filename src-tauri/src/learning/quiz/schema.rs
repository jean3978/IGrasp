//! The quiz's output schema (sent as `AiRequest::output_schema`) and the typed structs the
//! answer is read into. The structs, with `deny_unknown_fields`, are the schema check (no JSON
//! schema crate); a test keeps both in step. Field names are what the specification asks for:
//! question, choices, correct answer, hint, explanation, source file and lines, difficulty.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

/// Questions in one answer at most.
pub const MAX_QUESTIONS: usize = 40;
/// Lines of a cited range at most.
pub const MAX_RANGE_LINES: u32 = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum QuestionKind {
    MultipleChoice,
    TrueFalse,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawSource {
    pub path: String,
    #[serde(default)]
    pub first_line: Option<u32>,
    #[serde(default)]
    pub last_line: Option<u32>,
    #[serde(default)]
    pub why: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelfCheck {
    pub project_specific: bool,
    pub reason: String,
}

/// A question as the model writes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawQuestion {
    pub id: String,
    pub kind: QuestionKind,
    pub question: String,
    pub choices: Vec<String>,
    pub answer: u32,
    pub hint: String,
    pub explanation: String,
    pub sources: Vec<RawSource>,
    pub difficulty: u8,
    pub self_check: SelfCheck,
}

/// The whole answer as the model writes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuizOutput {
    pub insufficient_material: bool,
    #[serde(default)]
    pub material_note: Option<String>,
    /// What the project's documentation lacks for this subject and this reader, if anything.
    #[serde(default)]
    pub docs_note: Option<String>,
    #[serde(default)]
    pub suggested_subjects: Vec<String>,
    pub questions: Vec<RawQuestion>,
}

/// What a cited file is, so the UI knows where to open it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum QuizSourceKind {
    Markdown,
    Code,
    Binary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuizSource {
    /// Root-relative with `/`.
    pub path: String,
    pub first_line: Option<u32>,
    pub last_line: Option<u32>,
    pub why: Option<String>,
    pub kind: QuizSourceKind,
}

/// A question that passed the validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuizQuestion {
    pub id: String,
    pub kind: QuestionKind,
    pub question: String,
    pub choices: Vec<String>,
    /// Index of the correct choice.
    pub answer: u32,
    pub hint: String,
    pub explanation: String,
    /// The first one is the "Read more" link.
    pub sources: Vec<QuizSource>,
    /// 1 (a newcomer who read the README) to 5 (how several parts interact).
    pub difficulty: u32,
}

/// The accepted answer of a quiz generation (the `structuredOutput` of the operation).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuizResult {
    pub questions: Vec<QuizQuestion>,
    pub insufficient_material: bool,
    pub material_note: Option<String>,
    /// The documentation gap the model reported (the project is not well documented here).
    pub docs_note: Option<String>,
    pub suggested_subjects: Vec<String>,
    /// Questions the validation rejected over all attempts.
    pub rejected_count: u32,
}

/// The JSON schema of [`QuizOutput`].
pub fn schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["questions", "insufficientMaterial"],
        "properties": {
            "insufficientMaterial": {
                "type": "boolean",
                "description": "true when the project has too little material for the subject; then questions may be few and suggestedSubjects says what to ask instead."
            },
            "materialNote": { "type": "string", "maxLength": 400 },
            "docsNote": {
                "type": "string",
                "maxLength": 400,
                "description": "Only when the project's documentation is missing, thin or out of date for this subject and this reader: what is not documented and where a page would help."
            },
            "suggestedSubjects": {
                "type": "array",
                "maxItems": 5,
                "items": { "type": "string", "maxLength": 120 }
            },
            "questions": {
                "type": "array",
                "maxItems": MAX_QUESTIONS,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["id", "kind", "question", "choices", "answer", "hint", "explanation", "sources", "difficulty", "selfCheck"],
                    "properties": {
                        "id": { "type": "string", "pattern": "^q[0-9]{1,3}$" },
                        "kind": { "enum": ["multipleChoice", "trueFalse"] },
                        "question": { "type": "string", "minLength": 12, "maxLength": 400 },
                        "choices": {
                            "type": "array",
                            "minItems": 2,
                            "maxItems": 5,
                            "items": { "type": "string", "minLength": 1, "maxLength": 200 },
                            "description": "Exactly [\"True\", \"False\"] for trueFalse; 3 to 5 distinct answers for multipleChoice."
                        },
                        "answer": { "type": "integer", "minimum": 0, "maximum": 4, "description": "Index of the correct choice." },
                        "hint": { "type": "string", "minLength": 1, "maxLength": 300, "description": "Points towards the answer without giving it; names where to look." },
                        "explanation": { "type": "string", "minLength": 20, "maxLength": 900, "description": "Why the answer is right in this project, developer to developer, gentle; names the cited file." },
                        "sources": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": 4,
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["path"],
                                "properties": {
                                    "path": { "type": "string", "description": "Root-relative with / separators, as listed in the corpus map." },
                                    "firstLine": { "type": "integer", "minimum": 1 },
                                    "lastLine": { "type": "integer", "minimum": 1 },
                                    "why": { "type": "string", "maxLength": 200 }
                                }
                            },
                            "description": "The first source is the 'Read more' link. Text files carry a line range (at most 120 lines). A binary asset may be listed by path only, never alone."
                        },
                        "difficulty": { "type": "integer", "minimum": 1, "maximum": 5 },
                        "selfCheck": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["projectSpecific", "reason"],
                            "properties": {
                                "projectSpecific": { "type": "boolean", "description": "false if the question would still be true and useful in an unrelated project." },
                                "reason": { "type": "string", "maxLength": 200 }
                            }
                        }
                    }
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    fn sample() -> QuizOutput {
        QuizOutput {
            insufficient_material: false,
            material_note: Some("n".into()),
            docs_note: Some("d".into()),
            suggested_subjects: vec!["s".into()],
            questions: vec![RawQuestion {
                id: "q1".into(),
                kind: QuestionKind::TrueFalse,
                question: "Is the gateway the only door?".into(),
                choices: vec!["True".into(), "False".into()],
                answer: 0,
                hint: "h".into(),
                explanation: "e".into(),
                sources: vec![RawSource {
                    path: "a.rs".into(),
                    first_line: Some(1),
                    last_line: Some(2),
                    why: Some("w".into()),
                }],
                difficulty: 2,
                self_check: SelfCheck {
                    project_specific: true,
                    reason: "r".into(),
                },
            }],
        }
    }

    fn keys(v: &Value) -> BTreeSet<String> {
        v.as_object().unwrap().keys().cloned().collect()
    }

    fn strings(v: &Value) -> BTreeSet<String> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_owned())
            .collect()
    }

    /// Every property of the schema is a field of the structs and the reverse; the required
    /// ones are the non-optional fields.
    #[test]
    fn the_schema_matches_the_structs() {
        let s = schema();
        let value = serde_json::to_value(sample()).unwrap();
        assert_eq!(keys(&s["properties"]), keys(&value));
        assert_eq!(
            strings(&s["required"]),
            ["questions", "insufficientMaterial"]
                .map(String::from)
                .into()
        );
        let q = &s["properties"]["questions"]["items"];
        let question = &value["questions"][0];
        assert_eq!(keys(&q["properties"]), keys(question));
        assert_eq!(
            strings(&q["required"]),
            keys(question),
            "every question field is required"
        );
        let src = &q["properties"]["sources"]["items"];
        assert_eq!(keys(&src["properties"]), keys(&question["sources"][0]));
        assert_eq!(strings(&src["required"]), ["path"].map(String::from).into());
        let check = &q["properties"]["selfCheck"];
        assert_eq!(keys(&check["properties"]), keys(&question["selfCheck"]));
        assert!(
            s.get("$schema").is_none(),
            "providers may not know a draft URL"
        );
    }

    #[test]
    fn unknown_fields_and_wrong_types_are_refused() {
        let mut v = serde_json::to_value(sample()).unwrap();
        assert!(serde_json::from_value::<QuizOutput>(v.clone()).is_ok());
        v["questions"][0]["extra"] = json!(1);
        assert!(serde_json::from_value::<QuizOutput>(v.clone()).is_err());
        let mut v = serde_json::to_value(sample()).unwrap();
        v["questions"][0]["difficulty"] = json!("hard");
        assert!(serde_json::from_value::<QuizOutput>(v).is_err());
        // Optional fields may be absent or null.
        let v = json!({ "insufficientMaterial": false, "questions": [], "materialNote": null });
        assert!(serde_json::from_value::<QuizOutput>(v).is_ok());
    }
}
