//! Extracts the headings, anchors and links of a markdown document with `pulldown-cmark`.
//!
//! Heading text is what `rehype-slug` slugs in the preview (`hast-util-to-string`): the text,
//! inline code and math inside the heading, without image alt text or markup.

use std::collections::BTreeSet;
use std::ops::Range;
use std::sync::LazyLock;

use pulldown_cmark::{Event, HeadingLevel, LinkType, Options, Parser, Tag, TagEnd};
use regex::Regex;

use super::slug::Slugger;
use crate::learning::quiz::file::{self, QuizFileInfo};
use crate::learning::tutorial::markdown::{self as tutorial, TutorialFileInfo};

/// Headings and links kept per document; beyond, the rest is ignored (and counted).
pub const MAX_ITEMS_PER_DOC: usize = 5000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub slug: String,
    /// 1-based line of the heading in the source.
    pub line: u32,
}

/// A link as written in the document, before resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawLink {
    pub href: String,
    pub text: String,
    pub line: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedDoc {
    pub headings: Vec<Heading>,
    /// Heading slugs plus `id` / `name` attributes of inline HTML: valid `#fragment` targets.
    pub anchors: BTreeSet<String>,
    pub links: Vec<RawLink>,
    /// Headings or links beyond `MAX_ITEMS_PER_DOC`.
    pub truncated: bool,
    /// Set when the document is a quiz file (`igrasp: quiz` front matter).
    pub quiz: Option<QuizFileInfo>,
    /// Set when the document is a tutorial README or chapter (`igrasp: tutorial…`).
    pub tutorial: Option<TutorialFileInfo>,
}

static HTML_HREF: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)<a\s[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')"#).expect("valid regex")
});
static HTML_ANCHOR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)<[a-z][a-z0-9]*\s[^>]*?\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)')"#)
        .expect("valid regex")
});

/// Byte offsets of line starts, to turn offsets into 1-based line numbers.
struct Lines(Vec<usize>);

impl Lines {
    fn new(text: &str) -> Self {
        let mut starts = vec![0];
        starts.extend(text.match_indices('\n').map(|(i, _)| i + 1));
        Self(starts)
    }

    fn line_of(&self, offset: usize) -> u32 {
        let index = self.0.partition_point(|&start| start <= offset);
        u32::try_from(index).unwrap_or(u32::MAX)
    }
}

fn level_number(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        | Options::ENABLE_MATH
        | Options::ENABLE_GFM
}

struct OpenHeading {
    level: u8,
    text: String,
    start: usize,
}

struct OpenLink {
    href: String,
    text: String,
    start: usize,
}

/// Parses one document. Never fails: anything unusual degrades to "no heading" or "no link".
pub fn parse(text: &str) -> ParsedDoc {
    let lines = Lines::new(text);
    let mut doc = ParsedDoc::default();
    let mut slugger = Slugger::default();
    let mut heading: Option<OpenHeading> = None;
    let mut links: Vec<OpenLink> = Vec::new();
    // Text inside an image is its alt text: not part of a heading or link text.
    let mut in_image = 0usize;
    // The preview shows footnote references as their number, in order of first use.
    let mut footnotes: Vec<String> = Vec::new();

    let push_text = |heading: &mut Option<OpenHeading>, links: &mut Vec<OpenLink>, s: &str| {
        if let Some(h) = heading.as_mut() {
            h.text.push_str(s);
        }
        if let Some(l) = links.last_mut() {
            l.text.push_str(s);
        }
    };

    for (event, range) in Parser::new_ext(text, options()).into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                heading = Some(OpenHeading {
                    level: level_number(level),
                    text: String::new(),
                    start: range.start,
                });
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some(h) = heading.take() {
                    if doc.headings.len() >= MAX_ITEMS_PER_DOC {
                        doc.truncated = true;
                        continue;
                    }
                    let text = h.text.trim().to_owned();
                    let slug = slugger.slug(&text);
                    doc.anchors.insert(slug.clone());
                    doc.headings.push(Heading {
                        level: h.level,
                        text,
                        slug,
                        line: lines.line_of(h.start),
                    });
                }
            }
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                ..
            }) => {
                let href = match link_type {
                    LinkType::Email => format!("mailto:{dest_url}"),
                    _ => dest_url.into_string(),
                };
                links.push(OpenLink {
                    href,
                    text: String::new(),
                    start: range.start,
                });
            }
            Event::End(TagEnd::Link) => {
                if let Some(l) = links.pop() {
                    // Nested link text also belongs to the outer link.
                    if let Some(outer) = links.last_mut() {
                        outer.text.push_str(&l.text);
                    }
                    add_link(&mut doc, l.href, l.text.trim().to_owned(), &lines, l.start);
                }
            }
            Event::Start(Tag::Image { .. }) => in_image += 1,
            Event::End(TagEnd::Image) => in_image = in_image.saturating_sub(1),
            Event::Text(s) | Event::Code(s) | Event::InlineMath(s) if in_image == 0 => {
                push_text(&mut heading, &mut links, &s);
            }
            Event::FootnoteReference(label) if in_image == 0 => {
                let number = match footnotes.iter().position(|l| *l == *label) {
                    Some(i) => i + 1,
                    None => {
                        footnotes.push(label.to_string());
                        footnotes.len()
                    }
                };
                push_text(&mut heading, &mut links, &number.to_string());
            }
            Event::SoftBreak | Event::HardBreak if in_image == 0 => {
                push_text(&mut heading, &mut links, "\n");
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                scan_html(&mut doc, &html, &lines, range);
            }
            _ => {}
        }
    }
    doc.quiz = file::info(text);
    doc.tutorial = tutorial::info(text);
    doc
}

fn add_link(doc: &mut ParsedDoc, href: String, text: String, lines: &Lines, start: usize) {
    if doc.links.len() >= MAX_ITEMS_PER_DOC {
        doc.truncated = true;
        return;
    }
    doc.links.push(RawLink {
        href,
        text,
        line: lines.line_of(start),
    });
}

/// Links (`<a href>`) and anchors (`id` / `name`) written as HTML.
fn scan_html(doc: &mut ParsedDoc, html: &str, lines: &Lines, range: Range<usize>) {
    for caps in HTML_HREF.captures_iter(html) {
        if let Some(href) = caps.get(1).or_else(|| caps.get(2)) {
            let offset = range.start + caps.get(0).map_or(0, |m| m.start());
            add_link(doc, href.as_str().to_owned(), String::new(), lines, offset);
        }
    }
    for caps in HTML_ANCHOR.captures_iter(html) {
        if let Some(id) = caps.get(1).or_else(|| caps.get(2)) {
            doc.anchors.insert(id.as_str().to_owned());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headings(doc: &ParsedDoc) -> Vec<(u8, &str, &str, u32)> {
        doc.headings
            .iter()
            .map(|h| (h.level, h.text.as_str(), h.slug.as_str(), h.line))
            .collect()
    }

    #[test]
    fn atx_and_setext_headings_with_lines() {
        let doc = parse("# Title\n\ntext\n\nSub title\n---------\n\n### Third `code` *em*\n");
        assert_eq!(
            headings(&doc),
            [
                (1, "Title", "title", 1),
                (2, "Sub title", "sub-title", 5),
                (3, "Third code em", "third-code-em", 8),
            ]
        );
    }

    #[test]
    fn flags_quiz_files() {
        let quiz = parse(
            "---\nigrasp: quiz\nsubject: Gateway\n---\n\n## 1. Q\n\n```igrasp-quiz\nid: q1\n```\n",
        );
        let info = quiz.quiz.expect("a quiz file");
        assert_eq!(info.subject.as_deref(), Some("Gateway"));
        assert_eq!(info.questions, 1);
        assert_eq!(quiz.headings.len(), 1);
        assert!(parse("# Notes\n").quiz.is_none());
    }

    #[test]
    fn flags_tutorial_files() {
        let readme = parse(
            "---\nigrasp: tutorial\nid: t-1\ntitle: The watcher\nchapters: []\n---\n\n# The watcher\n",
        );
        let info = readme.tutorial.expect("a tutorial README");
        assert_eq!(info.id, "t-1");
        assert_eq!(info.chapter, None);
        assert_eq!(info.title.as_deref(), Some("The watcher"));
        let chapter = parse(
            "---\nigrasp: tutorial-chapter\ntutorial: t-1\nchapter: c2\n---\n\n# 2. Debounce\n",
        );
        assert_eq!(
            chapter.tutorial.expect("a chapter").chapter.as_deref(),
            Some("c2")
        );
        assert!(parse("---\nigrasp: quiz\n---\n").tutorial.is_none());
        assert!(parse("# igrasp: tutorial\n").tutorial.is_none());
    }

    #[test]
    fn front_matter_and_code_fences_are_not_headings() {
        let doc = parse("---\ntitle: x\n---\n\n# Real\n\n```sh\n# not a heading\n```\n");
        assert_eq!(headings(&doc), [(1, "Real", "real", 5)]);
    }

    #[test]
    fn crlf_line_numbers() {
        let doc = parse("intro\r\n\r\n## A\r\n\r\nsee [b](b.md)\r\n");
        assert_eq!(doc.headings[0].line, 3);
        assert_eq!(doc.links[0].line, 5);
    }

    #[test]
    fn duplicate_headings_get_suffixes() {
        let doc = parse("# Setup\n\n# Setup\n");
        let slugs: Vec<_> = doc.headings.iter().map(|h| h.slug.as_str()).collect();
        assert_eq!(slugs, ["setup", "setup-1"]);
        assert!(doc.anchors.contains("setup-1"));
    }

    #[test]
    fn image_alt_text_is_not_heading_text() {
        let doc = parse("# Logo ![alt text](logo.png) here\n");
        assert_eq!(doc.headings[0].text, "Logo  here");
        assert!(doc.links.is_empty(), "images are not links");
    }

    #[test]
    fn links_of_every_kind() {
        let doc = parse(
            "[inline](a.md#x) [ref][r] [collapsed][] [shortcut] <https://x.org> <me@x.org>\n\n\
             [r]: docs/r.md\n[collapsed]: c.md\n[shortcut]: s.md\n",
        );
        let hrefs: Vec<_> = doc.links.iter().map(|l| l.href.as_str()).collect();
        assert_eq!(
            hrefs,
            [
                "a.md#x",
                "docs/r.md",
                "c.md",
                "s.md",
                "https://x.org",
                "mailto:me@x.org"
            ]
        );
        assert_eq!(doc.links[0].text, "inline");
    }

    #[test]
    fn html_links_and_anchors() {
        let doc = parse(
            "<a name=\"top\"></a>\n\nText <a href='other.md'>x</a> and <span id=\"here\">y</span>\n",
        );
        assert!(doc.anchors.contains("top"));
        assert!(doc.anchors.contains("here"));
        assert_eq!(doc.links.len(), 1);
        assert_eq!(doc.links[0].href, "other.md");
        assert_eq!(doc.links[0].line, 3);
    }

    #[test]
    fn link_inside_a_heading() {
        let doc = parse("## See [the guide](guide.md)\n");
        assert_eq!(doc.headings[0].text, "See the guide");
        assert_eq!(doc.links[0].text, "the guide");
    }

    #[test]
    fn caps_items_per_document() {
        let text = "[x](a.md)\n".repeat(MAX_ITEMS_PER_DOC + 3);
        let doc = parse(&text);
        assert_eq!(doc.links.len(), MAX_ITEMS_PER_DOC);
        assert!(doc.truncated);
    }

    #[test]
    fn finds_the_same_anchors_as_the_preview() {
        // headings.json is written by the preview test (headingIds.test.ts).
        let expected: std::collections::BTreeMap<String, Vec<String>> = serde_json::from_str(
            include_str!("../../../src/test/fixtures/markdown/headings.json"),
        )
        .unwrap();
        let sources = [
            (
                "gfm.md",
                include_str!("../../../src/test/fixtures/markdown/gfm.md"),
            ),
            (
                "headings.md",
                include_str!("../../../src/test/fixtures/markdown/headings.md"),
            ),
            (
                "unsafe.md",
                include_str!("../../../src/test/fixtures/markdown/unsafe.md"),
            ),
        ];
        assert_eq!(sources.len(), expected.len());
        for (name, text) in sources {
            let got: Vec<String> = parse(text).headings.into_iter().map(|h| h.slug).collect();
            assert_eq!(&got, &expected[name], "{name}");
        }
    }
}
