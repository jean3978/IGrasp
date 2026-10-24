//! "Files to include / exclude" patterns of the search panel, with VS Code's semantics:
//! comma-separated globs; a pattern without `/` matches at any depth (`*.md`, `docs`), a folder
//! pattern matches everything inside it, `./docs/**` and `docs/` mean `docs`.

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};

use crate::error::{AppError, AppResult};

pub const MAX_PATTERNS: usize = 50;

fn variants(pattern: &str) -> Vec<String> {
    let p = pattern
        .trim()
        .trim_start_matches("./")
        .trim_start_matches('/');
    let p = p.strip_suffix('/').unwrap_or(p);
    let p = p.strip_suffix("/**").unwrap_or(p);
    if p.is_empty() {
        return Vec::new();
    }
    if p.contains('/') {
        vec![p.to_owned(), format!("{p}/**")]
    } else {
        vec![
            p.to_owned(),
            format!("**/{p}"),
            format!("{p}/**"),
            format!("**/{p}/**"),
        ]
    }
}

/// Compiles comma-separated patterns; `None` when there are none (match everything).
pub fn compile(patterns: &str) -> AppResult<Option<GlobSet>> {
    let list: Vec<&str> = patterns
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    if list.is_empty() {
        return Ok(None);
    }
    if list.len() > MAX_PATTERNS {
        return Err(AppError::InvalidPattern(format!(
            "At most {MAX_PATTERNS} patterns are supported."
        )));
    }
    let mut builder = GlobSetBuilder::new();
    for pattern in list {
        for variant in variants(pattern) {
            let glob = GlobBuilder::new(&variant)
                .literal_separator(true)
                .case_insensitive(cfg!(windows))
                .build()
                .map_err(|e| AppError::InvalidPattern(format!("{pattern}: {}", e.kind())))?;
            builder.add(glob);
        }
    }
    builder
        .build()
        .map(Some)
        .map_err(|e| AppError::InvalidPattern(e.to_string()))
}

/// Include and exclude sets of a search.
pub struct PathFilter {
    include: Option<GlobSet>,
    exclude: Option<GlobSet>,
}

impl PathFilter {
    pub fn new(include: &str, exclude: &str) -> AppResult<Self> {
        Ok(Self {
            include: compile(include)?,
            exclude: compile(exclude)?,
        })
    }

    /// Whether a root-relative path is searched.
    pub fn accepts(&self, rel: &str) -> bool {
        self.include.as_ref().is_none_or(|g| g.is_match(rel))
            && !self.exclude.as_ref().is_some_and(|g| g.is_match(rel))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accepts(include: &str, exclude: &str, rel: &str) -> bool {
        PathFilter::new(include, exclude).unwrap().accepts(rel)
    }

    #[test]
    fn empty_patterns_match_everything() {
        assert!(accepts("", "", "a/b.md"));
        assert!(accepts(" , ", "", "a/b.md"));
    }

    #[test]
    fn names_match_at_any_depth_and_folders_include_their_content() {
        assert!(accepts("*.md", "", "docs/deep/a.md"));
        assert!(!accepts("*.md", "", "docs/a.markdown"));
        assert!(accepts("docs", "", "docs/deep/a.md"));
        assert!(accepts("guide", "", "docs/guide/a.md"));
        assert!(!accepts("docs", "", "documents/a.md"));
    }

    #[test]
    fn paths_are_anchored_at_the_root() {
        assert!(accepts("docs/guide", "", "docs/guide/a.md"));
        assert!(!accepts("docs/guide", "", "x/docs/guide/a.md"));
        assert!(accepts("./docs/**", "", "docs/a.md"));
        assert!(accepts("docs/", "", "docs/a.md"));
        assert!(accepts("docs/*/a.md", "", "docs/x/a.md"));
        assert!(!accepts("docs/*/a.md", "", "docs/x/y/a.md"));
    }

    #[test]
    fn exclude_wins_and_lists_combine() {
        assert!(!accepts("docs", "drafts, *.tmp.md", "docs/drafts/a.md"));
        assert!(!accepts("", "drafts, *.tmp.md", "docs/a.tmp.md"));
        assert!(accepts("docs, notes", "drafts", "notes/a.md"));
    }

    #[test]
    fn invalid_patterns_are_reported() {
        assert!(matches!(
            PathFilter::new("docs/[", ""),
            Err(AppError::InvalidPattern(_))
        ));
        let many = vec!["a"; MAX_PATTERNS + 1].join(",");
        assert!(matches!(
            PathFilter::new(&many, ""),
            Err(AppError::InvalidPattern(_))
        ));
    }
}
