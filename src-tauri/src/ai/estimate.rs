//! An approximate size of an operation, for the confirmation card: bytes → tokens → bucket.
//! Computed from sizes already known (metadata); nothing is read here. The quiz and tutorials
//! reuse it with their own inputs.

use super::types::{AiContextDocument, AiSizeBucket, AiSizeEstimate};

/// A common rule of thumb for English text and code.
pub const BYTES_PER_TOKEN: u64 = 4;
/// What one image costs, roughly, once downscaled to the 1568 px the capture produces.
pub const TOKENS_PER_IMAGE: u64 = 1_500;
/// Below this, a normal chat message: never worth a confirmation.
pub const SMALL_BELOW_TOKENS: u64 = 20_000;
/// Below this, a large file or several documents; above, a costly operation.
pub const MEDIUM_BELOW_TOKENS: u64 = 80_000;

/// The size of a prompt of `prompt_bytes` with `documents` (full size, even when they are too
/// large to inline: the model will read them) and `images`.
pub fn estimate(prompt_bytes: u64, documents: &[AiContextDocument], images: u32) -> AiSizeEstimate {
    let bytes = prompt_bytes + documents.iter().map(|d| d.bytes).sum::<u64>();
    let approx_tokens = bytes.div_ceil(BYTES_PER_TOKEN) + u64::from(images) * TOKENS_PER_IMAGE;
    let bucket = if approx_tokens < SMALL_BELOW_TOKENS {
        AiSizeBucket::Small
    } else if approx_tokens < MEDIUM_BELOW_TOKENS {
        AiSizeBucket::Medium
    } else {
        AiSizeBucket::Large
    };
    AiSizeEstimate {
        bytes,
        approx_tokens,
        bucket,
        documents: u32::try_from(documents.len()).unwrap_or(u32::MAX),
        images,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::AiContextRole;

    fn doc(bytes: u64, truncated: bool) -> AiContextDocument {
        AiContextDocument {
            path: "a.md".into(),
            role: AiContextRole::CurrentFile,
            content: None,
            bytes,
            truncated,
        }
    }

    #[test]
    fn counts_bytes_tokens_documents_and_images() {
        let e = estimate(10, &[doc(30, false), doc(400, true)], 2);
        assert_eq!(e.bytes, 440);
        assert_eq!(e.approx_tokens, 110 + 3_000);
        assert_eq!(e.documents, 2);
        assert_eq!(e.images, 2);
        assert_eq!(e.bucket, AiSizeBucket::Small);
    }

    #[test]
    fn buckets_at_the_thresholds() {
        let tokens = |t: u64| estimate(t * BYTES_PER_TOKEN, &[], 0).bucket;
        assert_eq!(tokens(0), AiSizeBucket::Small);
        assert_eq!(tokens(SMALL_BELOW_TOKENS - 1), AiSizeBucket::Small);
        assert_eq!(tokens(SMALL_BELOW_TOKENS), AiSizeBucket::Medium);
        assert_eq!(tokens(MEDIUM_BELOW_TOKENS - 1), AiSizeBucket::Medium);
        assert_eq!(tokens(MEDIUM_BELOW_TOKENS), AiSizeBucket::Large);
        // Images alone can make an operation large.
        assert_eq!(estimate(0, &[], 60).bucket, AiSizeBucket::Large);
        assert!(AiSizeBucket::Small < AiSizeBucket::Medium);
    }
}
