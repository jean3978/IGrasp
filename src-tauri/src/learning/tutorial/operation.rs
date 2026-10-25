//! A tutorial operation composed from what the user chose (`TutorialRequest`): the outline (one
//! validated run), the chapters the user ticked (a staged run, one validated run per chapter),
//! a chapter written again or for a missing topic (one stage), the review and the suggestions.
//! Shared by `ai_estimate` (its size, calls and cost line: nothing starts) and `ai_start` (the one
//! command that starts it). Every request is read-only, whatever the frontend sent.

use super::compose::{ChapterStages, compose_outline};
use super::cost;
use super::review::compose_review;
use super::share;
use super::suggest::compose_suggest;
use super::{Length, TutorialRef, TutorialRequest};
use crate::ai::run::RunPlan;
use crate::ai::types::{AiPolicy, AiRequest, AiUserAction};
use crate::appdata::AppData;
use crate::error::{AppError, AppResult};
use crate::learning::corpus::Inlined;
use crate::learning::{self, root_key};
use crate::state::Workspace;

pub struct TutorialOperation {
    /// `cost::OUTLINE`, `cost::CHAPTERS`, `cost::REVIEW` or `cost::SUGGEST`.
    pub kind: &'static str,
    pub length: Length,
    /// What the gateway starts: the request of a validated run (a staged run composes its
    /// stages' requests itself; this one then only carries the model and the policy).
    pub request: AiRequest,
    pub plan: RunPlan,
    /// The first call's prompt and what it inlines (the estimate).
    pub prompt_bytes: u64,
    pub inlined: Vec<Inlined>,
    pub calls: u32,
}

fn mismatch() -> AppError {
    AppError::Ai("This tutorial request does not match its action.".to_owned())
}

/// Composes the operation of `request` for `action` in the open folder (local, no AI).
pub fn compose_operation(
    ws: &Workspace,
    appdata: &AppData,
    names: &[String],
    action: AiUserAction,
    request: &TutorialRequest,
    model: Option<String>,
) -> AppResult<TutorialOperation> {
    match (action, request) {
        (AiUserAction::TutorialGeneration, TutorialRequest::Outline { input }) => {
            let input = input.clone().normalized();
            let cards = match &input.subject_id {
                Some(_) => learning::tutorial_subjects(ws, appdata, names)?.cards,
                None => Vec::new(),
            };
            let card = input
                .subject_id
                .as_deref()
                .and_then(|id| cards.iter().find(|c| c.id == id));
            let (profile, walk) = learning::corrected_profile(ws, appdata, false)?;
            let length = input.length;
            let composed =
                compose_outline(ws.guard.root(), &profile, &walk, names, input, card, model)?;
            Ok(TutorialOperation {
                kind: cost::OUTLINE,
                length,
                prompt_bytes: composed.prompt_bytes,
                inlined: composed.inlined,
                request: composed.request,
                plan: RunPlan::Validated(Box::new(composed.validator)),
                calls: 1,
            })
        }
        (
            AiUserAction::TutorialGeneration,
            TutorialRequest::Chapters { id, .. } | TutorialRequest::Chapter { id, .. },
        ) => {
            let (indices, goal) = match request {
                TutorialRequest::Chapter { index, goal, .. } => (vec![*index], goal.clone()),
                _ => (indices_of(request), None),
            };
            let tutorial = appdata.private_tutorial(&root_key(ws), id)?.tutorial;
            let (profile, walk) = learning::corrected_profile(ws, appdata, false)?;
            let stages = ChapterStages::new(
                ws.guard.root(),
                profile,
                walk,
                names,
                &tutorial,
                &indices,
                goal,
                model.clone(),
            )?;
            let first = stages.first()?;
            let calls = u32::try_from(indices.len()).unwrap_or(1);
            Ok(TutorialOperation {
                kind: cost::CHAPTERS,
                length: tutorial.length,
                prompt_bytes: first.prompt_bytes,
                inlined: first.inlined,
                request: AiRequest {
                    model,
                    policy: AiPolicy::ReadOnly,
                    ..AiRequest::default()
                },
                plan: RunPlan::Staged(Box::new(stages)),
                calls,
            })
        }
        (AiUserAction::SubjectSuggestion, TutorialRequest::Suggest) => {
            let offered = learning::tutorial_subjects(ws, appdata, names)?.cards;
            let (profile, walk) = learning::corrected_profile(ws, appdata, false)?;
            let composed =
                compose_suggest(ws.guard.root(), &profile, &walk, names, &offered, model)?;
            Ok(TutorialOperation {
                kind: cost::SUGGEST,
                length: Length::Standard,
                prompt_bytes: composed.prompt_bytes,
                inlined: composed.inlined,
                request: composed.request,
                plan: RunPlan::Validated(Box::new(composed.validator)),
                calls: 1,
            })
        }
        (AiUserAction::TutorialReview, TutorialRequest::Review { tutorial }) => {
            let t = match tutorial {
                TutorialRef::Private { id } => {
                    appdata.private_tutorial(&root_key(ws), id)?.tutorial
                }
                TutorialRef::Shared { rel_path } => share::read_shared(&ws.guard, rel_path)?,
            };
            let (profile, walk) = learning::corrected_profile(ws, appdata, false)?;
            let composed = compose_review(ws.guard.root(), &profile, &walk, names, &t, model)?;
            Ok(TutorialOperation {
                kind: cost::REVIEW,
                length: t.length,
                prompt_bytes: composed.prompt_bytes,
                inlined: composed.inlined,
                request: composed.request,
                plan: RunPlan::Validated(Box::new(composed.validator)),
                calls: 1,
            })
        }
        (
            AiUserAction::TutorialGeneration
            | AiUserAction::SubjectSuggestion
            | AiUserAction::TutorialReview,
            _,
        ) => Err(mismatch()),
        _ => Err(AppError::Ai(
            "This tutorial operation is not available yet.".to_owned(),
        )),
    }
}

fn indices_of(request: &TutorialRequest) -> Vec<u32> {
    match request {
        TutorialRequest::Chapters { indices, .. } => indices.clone(),
        _ => Vec::new(),
    }
}
