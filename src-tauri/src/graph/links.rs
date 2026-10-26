//! What a link points to and whether its target exists. The rules match the preview's
//! (`src/lib/paths.ts` `resolveRelative`): `/` separators, a leading `/` is the root, `..` above
//! the root leaves the folder, percent-escapes are decoded, query strings are ignored.

use std::collections::BTreeSet;

use serde::Serialize;
use ts_rs::TS;

use crate::index::model::is_markdown;

/// What a link points to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum LinkTarget {
    /// http, https and mailto links: opened by the system, never checked.
    External { url: String },
    /// `#fragment` in the same document.
    Anchor { fragment: String },
    /// A markdown file of the folder (opened in a document tab).
    Document {
        rel_path: String,
        fragment: Option<String>,
    },
    /// A folder; `readme` is its README markdown file when it has one.
    Folder {
        rel_path: String,
        readme: Option<String>,
    },
    /// Any other file (opened in the code viewer, or externally for media).
    File {
        rel_path: String,
        fragment: Option<String>,
    },
    /// A relative path that climbs above the opened folder.
    Outside,
    /// Other schemes (`file:`, `ftp:`…) and empty links: inert.
    Unsupported,
}

/// Whether the target of a link exists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum LinkStatus {
    Ok,
    MissingFile,
    MissingAnchor,
    /// The file exists with another case: opens on Windows and macOS, breaks on Linux.
    CaseMismatch {
        actual: String,
    },
    OutsideRoot,
    /// Not decided yet (the target document is not parsed) or not checkable.
    NotChecked,
}

impl LinkStatus {
    /// Statuses shown as problems (flagged in the preview, listed in Broken links).
    pub fn is_problem(&self) -> bool {
        matches!(
            self,
            Self::MissingFile | Self::MissingAnchor | Self::CaseMismatch { .. } | Self::OutsideRoot
        )
    }
}

/// What the resolver needs to know about the folder.
pub trait TargetLookup {
    /// An indexed markdown file.
    fn is_markdown_file(&self, rel: &str) -> bool;
    /// The indexed markdown file whose path matches `rel` ignoring case, if any.
    fn markdown_ignoring_case(&self, rel: &str) -> Option<String>;
    /// The anchors of a parsed markdown file; `None` while it is not parsed.
    fn anchors(&self, rel: &str) -> Option<&BTreeSet<String>>;
    /// What is on disk at `rel`: `Some(true)` a folder, `Some(false)` a file, `None` nothing.
    fn on_disk(&self, rel: &str) -> Option<bool>;
    /// The README markdown file directly inside a folder.
    fn readme_of(&self, dir: &str) -> Option<String>;
}

/// Decodes `%XX` escapes; leaves the text unchanged when the result is not UTF-8.
pub fn percent_decode(text: &str) -> String {
    if !text.contains('%') {
        return text.to_owned();
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2]))
        {
            out.push((h * 16 + l) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_owned())
}

fn has_scheme(href: &str) -> bool {
    let mut chars = href.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && href.split_once(':').is_some_and(|(scheme, _)| {
            scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        })
}

fn parent(rel: &str) -> &str {
    rel.rfind('/').map_or("", |i| &rel[..i])
}

/// Resolves a path link of `from_doc` to a root-relative path; `None` when it leaves the root.
fn resolve_path(from_doc: &str, path: &str) -> Option<String> {
    let decoded = percent_decode(path).replace('\\', "/");
    let mut parts: Vec<&str> = if decoded.starts_with('/') {
        Vec::new()
    } else {
        parent(from_doc)
            .split('/')
            .filter(|s| !s.is_empty())
            .collect()
    };
    for segment in decoded.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    Some(parts.join("/"))
}

/// Classifies a link written in `from_doc`, without looking at the folder.
pub fn classify(from_doc: &str, href: &str) -> (LinkTarget, Option<String>) {
    let href = href.trim();
    if href.is_empty() || href == "#" {
        return (LinkTarget::Unsupported, None);
    }
    if let Some(fragment) = href.strip_prefix('#') {
        return (
            LinkTarget::Anchor {
                fragment: percent_decode(fragment),
            },
            None,
        );
    }
    if has_scheme(href) || href.starts_with("//") {
        let lower = href.to_ascii_lowercase();
        if lower.starts_with("http:") || lower.starts_with("https:") || lower.starts_with("mailto:")
        {
            return (
                LinkTarget::External {
                    url: href.to_owned(),
                },
                None,
            );
        }
        return (LinkTarget::Unsupported, None);
    }
    let (rest, fragment) = match href.split_once('#') {
        Some((p, f)) if !f.is_empty() => (p, Some(percent_decode(f))),
        Some((p, _)) => (p, None),
        None => (href, None),
    };
    let path = rest.split('?').next().unwrap_or("");
    if path.is_empty() {
        // `?query` or `?x#frag`: the same document.
        return match fragment {
            Some(fragment) => (LinkTarget::Anchor { fragment }, None),
            None => (LinkTarget::Unsupported, None),
        };
    }
    match resolve_path(from_doc, path) {
        Some(rel) => (
            LinkTarget::File {
                rel_path: rel.clone(),
                fragment,
            },
            Some(rel),
        ),
        None => (LinkTarget::Outside, None),
    }
}

/// Does a fragment name one of the anchors? Exact, else ignoring case (the preview scrolls to
/// either).
pub fn has_anchor(anchors: &BTreeSet<String>, fragment: &str) -> bool {
    anchors.contains(fragment) || anchors.iter().any(|a| a.eq_ignore_ascii_case(fragment))
}

/// A GitHub line fragment: `L12` or `L12-L30` (a tutorial's citations use them, also into
/// markdown files).
pub fn is_line_fragment(fragment: &str) -> bool {
    let line = |s: &str| {
        s.strip_prefix('L')
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
    };
    match fragment.split_once('-') {
        Some((a, b)) => line(a) && line(b),
        None => line(fragment),
    }
}

fn fragment_status(anchors: Option<&BTreeSet<String>>, fragment: Option<&str>) -> LinkStatus {
    match (fragment, anchors) {
        (None, _) => LinkStatus::Ok,
        // Line ranges (#L10-L20) and fragments of files that are not parsed are not checked.
        (Some(_), None) => LinkStatus::NotChecked,
        (Some(f), Some(set)) if is_line_fragment(f) && !has_anchor(set, f) => {
            LinkStatus::NotChecked
        }
        (Some(f), Some(set)) if has_anchor(set, f) => LinkStatus::Ok,
        (Some(_), Some(_)) => LinkStatus::MissingAnchor,
    }
}

/// Resolves a link of `from_doc` against the folder: the precise target and its status.
pub fn resolve(
    from_doc: &str,
    href: &str,
    own_anchors: &BTreeSet<String>,
    lookup: &dyn TargetLookup,
) -> (LinkTarget, LinkStatus) {
    let (target, _) = classify(from_doc, href);
    match target {
        LinkTarget::External { .. } => (target, LinkStatus::Ok),
        LinkTarget::Unsupported => (target, LinkStatus::NotChecked),
        LinkTarget::Outside => (target, LinkStatus::OutsideRoot),
        LinkTarget::Anchor { ref fragment } => {
            let status = if has_anchor(own_anchors, fragment) {
                LinkStatus::Ok
            } else {
                LinkStatus::MissingAnchor
            };
            (target, status)
        }
        LinkTarget::File { rel_path, fragment } => resolve_file(rel_path, fragment, lookup),
        LinkTarget::Document { .. } | LinkTarget::Folder { .. } => (target, LinkStatus::Ok),
    }
}

fn resolve_file(
    rel: String,
    fragment: Option<String>,
    lookup: &dyn TargetLookup,
) -> (LinkTarget, LinkStatus) {
    let name = rel.rsplit('/').next().unwrap_or(&rel);
    if is_markdown(name) {
        if lookup.is_markdown_file(&rel) {
            let status = fragment_status(lookup.anchors(&rel), fragment.as_deref());
            return (
                LinkTarget::Document {
                    rel_path: rel,
                    fragment,
                },
                status,
            );
        }
        if let Some(actual) = lookup.markdown_ignoring_case(&rel) {
            let target = LinkTarget::Document {
                rel_path: actual.clone(),
                fragment,
            };
            return (target, LinkStatus::CaseMismatch { actual });
        }
    }
    match lookup.on_disk(&rel) {
        Some(true) => {
            let readme = lookup.readme_of(&rel);
            (
                LinkTarget::Folder {
                    rel_path: rel,
                    readme,
                },
                LinkStatus::Ok,
            )
        }
        // A markdown file that exists but is not indexed (ignored or hidden): opens, unchecked.
        Some(false) if is_markdown(name) => {
            let status = if fragment.is_some() {
                LinkStatus::NotChecked
            } else {
                LinkStatus::Ok
            };
            (
                LinkTarget::Document {
                    rel_path: rel,
                    fragment,
                },
                status,
            )
        }
        Some(false) => (
            LinkTarget::File {
                rel_path: rel,
                fragment,
            },
            LinkStatus::Ok,
        ),
        None if rel.is_empty() => (
            LinkTarget::Folder {
                rel_path: rel,
                readme: lookup.readme_of(""),
            },
            LinkStatus::Ok,
        ),
        None if is_markdown(name) => (
            LinkTarget::Document {
                rel_path: rel,
                fragment,
            },
            LinkStatus::MissingFile,
        ),
        None => (
            LinkTarget::File {
                rel_path: rel,
                fragment,
            },
            LinkStatus::MissingFile,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, HashSet};

    #[derive(Default)]
    struct Fake {
        md: BTreeMap<String, Option<BTreeSet<String>>>,
        dirs: HashSet<String>,
        files: HashSet<String>,
    }

    impl Fake {
        fn md(mut self, rel: &str, anchors: Option<&[&str]>) -> Self {
            let set = anchors.map(|a| a.iter().map(|s| (*s).to_owned()).collect());
            self.md.insert(rel.to_owned(), set);
            self
        }
    }

    impl TargetLookup for Fake {
        fn is_markdown_file(&self, rel: &str) -> bool {
            self.md.contains_key(rel)
        }
        fn markdown_ignoring_case(&self, rel: &str) -> Option<String> {
            let lower = rel.to_lowercase();
            self.md.keys().find(|k| k.to_lowercase() == lower).cloned()
        }
        fn anchors(&self, rel: &str) -> Option<&BTreeSet<String>> {
            self.md.get(rel).and_then(Option::as_ref)
        }
        fn on_disk(&self, rel: &str) -> Option<bool> {
            if self.dirs.contains(rel) {
                Some(true)
            } else if self.files.contains(rel) || self.md.contains_key(rel) {
                Some(false)
            } else {
                None
            }
        }
        fn readme_of(&self, dir: &str) -> Option<String> {
            let prefix = if dir.is_empty() {
                String::new()
            } else {
                format!("{dir}/")
            };
            self.md
                .keys()
                .find(|k| {
                    k.strip_prefix(&prefix)
                        .is_some_and(|n| n.eq_ignore_ascii_case("readme.md"))
                })
                .cloned()
        }
    }

    fn fake() -> Fake {
        let mut f = Fake::default()
            .md("README.md", Some(&["intro"]))
            .md("docs/guide.md", Some(&["setup", "install"]))
            .md("docs/README.md", Some(&[]))
            .md("docs/later.md", None);
        f.dirs.extend(["docs".to_owned(), "src".to_owned()]);
        f.files.insert("src/main.rs".to_owned());
        f
    }

    fn check(from: &str, href: &str) -> (LinkTarget, LinkStatus) {
        let own: BTreeSet<String> = ["here".to_owned()].into();
        resolve(from, href, &own, &fake())
    }

    #[test]
    fn classification_without_the_folder() {
        assert_eq!(classify("a.md", "").0, LinkTarget::Unsupported);
        assert_eq!(classify("a.md", "#").0, LinkTarget::Unsupported);
        assert_eq!(
            classify("a.md", "javascript:alert(1)").0,
            LinkTarget::Unsupported
        );
        assert_eq!(
            classify("a.md", "file:///etc/passwd").0,
            LinkTarget::Unsupported
        );
        assert_eq!(
            classify("a.md", "HTTPS://x.org").0,
            LinkTarget::External {
                url: "HTTPS://x.org".into()
            }
        );
        assert_eq!(classify("a.md", "../up.md").0, LinkTarget::Outside);
        assert_eq!(
            classify("docs/a.md", "../src/My%20File.rs?raw=1#L3").0,
            LinkTarget::File {
                rel_path: "src/My File.rs".into(),
                fragment: Some("L3".into())
            }
        );
        assert_eq!(
            classify("docs/deep/a.md", "/README.md").1.as_deref(),
            Some("README.md")
        );
        assert_eq!(
            classify("docs/a.md", "sub\\b.md").1.as_deref(),
            Some("docs/sub/b.md")
        );
    }

    #[test]
    fn anchors_in_the_same_document() {
        assert_eq!(check("a.md", "#here").1, LinkStatus::Ok);
        assert_eq!(check("a.md", "#HERE").1, LinkStatus::Ok);
        assert_eq!(check("a.md", "#gone").1, LinkStatus::MissingAnchor);
        assert!(is_line_fragment("L3") && is_line_fragment("L3-L8"));
        assert!(!is_line_fragment("L") && !is_line_fragment("l3") && !is_line_fragment("L3-8"));
    }

    #[test]
    fn documents_and_their_anchors() {
        assert_eq!(check("README.md", "docs/guide.md").1, LinkStatus::Ok);
        assert_eq!(check("README.md", "docs/guide.md#setup").1, LinkStatus::Ok);
        assert_eq!(
            check("README.md", "docs/guide.md#nope").1,
            LinkStatus::MissingAnchor
        );
        assert_eq!(
            check("README.md", "docs/later.md#x").1,
            LinkStatus::NotChecked
        );
        assert_eq!(
            check("README.md", "docs/missing.md").1,
            LinkStatus::MissingFile
        );
    }

    #[test]
    fn case_mismatch_points_to_the_actual_file() {
        let (target, status) = check("README.md", "Docs/Guide.md#setup");
        assert_eq!(
            status,
            LinkStatus::CaseMismatch {
                actual: "docs/guide.md".into()
            }
        );
        assert_eq!(
            target,
            LinkTarget::Document {
                rel_path: "docs/guide.md".into(),
                fragment: Some("setup".into())
            }
        );
    }

    #[test]
    fn folders_and_other_files() {
        assert_eq!(
            check("README.md", "docs/"),
            (
                LinkTarget::Folder {
                    rel_path: "docs".into(),
                    readme: Some("docs/README.md".into())
                },
                LinkStatus::Ok
            )
        );
        assert_eq!(
            check("README.md", "src"),
            (
                LinkTarget::Folder {
                    rel_path: "src".into(),
                    readme: None
                },
                LinkStatus::Ok
            )
        );
        assert_eq!(
            check("docs/guide.md", "../src/main.rs#L1-L4").1,
            LinkStatus::Ok
        );
        assert_eq!(check("README.md", "src/lib.rs").1, LinkStatus::MissingFile);
        assert_eq!(check("docs/a.md", "../../x.md").1, LinkStatus::OutsideRoot);
        assert_eq!(check("README.md", "https://x.org").1, LinkStatus::Ok);
    }

    #[test]
    fn problems_are_the_statuses_worth_flagging() {
        assert!(LinkStatus::MissingFile.is_problem());
        assert!(LinkStatus::CaseMismatch { actual: "a".into() }.is_problem());
        assert!(!LinkStatus::NotChecked.is_problem());
        assert!(!LinkStatus::Ok.is_problem());
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("a%20b%C3%A9"), "a bé");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%FF"), "%FF");
    }
}
