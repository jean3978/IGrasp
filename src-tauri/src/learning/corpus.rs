//! The corpus: the files a generation may read and cite, from the profile's walk (the scan's
//! ignore rules, dot-folders included). Secret-looking files are left out entirely; agent
//! instruction files are context only, never a citation; binary files are listed by name (their
//! names and folders are evidence of layout, never of content). Renders the map of the project
//! sent in the prompt and the files inlined with line numbers.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::agent_files::{is_agent_file, is_secret};
use crate::commands::files::{decode_text, looks_like_text};
use crate::profile::ProjectProfile;
use crate::profile::languages::{is_generated, language_of};
use crate::profile::walk::{FileFact, Walk};

/// What a generation may read and cite.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum SourceScope {
    /// Code, configuration, build, tests and docs: the quiz is about how the project is made.
    #[default]
    WholeProject,
    /// The project's markdown files only ("did I read the docs").
    DocumentationOnly,
    /// Only these files and folders ("Check specific code"; a tutorial's sources in Phase 5).
    Paths { paths: Vec<String> },
}

/// Text files above this size are listed as large: the model reads parts of them.
pub const LARGE_TEXT_BYTES: u64 = 1024 * 1024;
/// Lines of the corpus map at most.
pub const MAX_MAP_LINES: usize = 400;
/// Files listed per folder of the map at most.
const MAX_FILES_PER_FOLDER: usize = 30;
/// Anchor files: bytes inlined per file and in all.
pub const ANCHOR_FILE_BYTES: usize = 24 * 1024;
pub const ANCHOR_TOTAL_BYTES: usize = 64 * 1024;
/// Agent instruction files: bytes inlined per file and in all.
pub const AGENT_FILE_BYTES: usize = 16 * 1024;
pub const AGENT_TOTAL_BYTES: usize = 48 * 1024;
/// Unknown extensions sniffed at most (the rest count as binary).
const MAX_SNIFFS: usize = 2000;
const SNIFF_BYTES: usize = 1024;

/// Extensions known to be text, besides the languages of `profile::languages`.
const TEXT_EXTS: &[&str] = &[
    "json",
    "jsonc",
    "json5",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "config",
    "txt",
    "xml",
    "csv",
    "tsv",
    "env",
    "properties",
    "gradle",
    "lock",
    "editorconfig",
    "gitignore",
    "gitattributes",
    "dockerignore",
    "npmrc",
    "nvmrc",
    "svg",
    "plist",
    "csproj",
    "fsproj",
    "sln",
    "props",
    "targets",
    "uproject",
    "uplugin",
    "godot",
    "import",
    "tscn",
    "tres",
    "unity",
    "prefab",
    "asset",
    "mat",
    "meta",
    "anim",
    "controller",
    "asmdef",
    "inputactions",
    "shadergraph",
    "mdc",
    "rst",
    "adoc",
    "org",
    "tex",
    "bib",
    "http",
    "graphql",
    "prisma",
    "sql",
    "proto",
    "thrift",
    "ipynb",
];

/// Extensions known to be binary.
const BINARY_EXTS: &[&str] = &[
    "png",
    "jpg",
    "jpeg",
    "gif",
    "bmp",
    "tga",
    "tif",
    "tiff",
    "psd",
    "webp",
    "ico",
    "icns",
    "exr",
    "hdr",
    "dds",
    "ktx",
    "ktx2",
    "basis",
    "mp3",
    "wav",
    "ogg",
    "flac",
    "aiff",
    "m4a",
    "mp4",
    "mov",
    "webm",
    "avi",
    "mkv",
    "ttf",
    "otf",
    "woff",
    "woff2",
    "zip",
    "gz",
    "tgz",
    "tar",
    "7z",
    "rar",
    "xz",
    "bz2",
    "exe",
    "dll",
    "so",
    "dylib",
    "a",
    "lib",
    "o",
    "obj",
    "pdb",
    "uasset",
    "umap",
    "fbx",
    "blend",
    "glb",
    "3ds",
    "max",
    "ma",
    "mb",
    "pdf",
    "jar",
    "class",
    "wasm",
    "bin",
    "dat",
    "db",
    "sqlite",
    "pck",
    "res",
    "bank",
    "pak",
    "keystore",
    "apk",
    "aab",
    "ipa",
    "dmg",
    "msi",
    "deb",
    "rpm",
    "parquet",
    "npy",
    "npz",
    "pt",
    "pth",
    "onnx",
    "h5",
    "pkl",
    "ckpt",
    "safetensors",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorpusFile {
    pub path: String,
    pub size: u64,
    pub binary: bool,
    /// A text file above [`LARGE_TEXT_BYTES`].
    pub large: bool,
    pub language: Option<&'static str>,
    pub markdown: bool,
}

/// What a path is to a generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathStatus<'a> {
    Citable(&'a CorpusFile),
    /// Written for AI agents: context only.
    Agent,
    Secret,
    /// A file of the project outside the chosen scope (code under "Documentation only").
    OutOfScope,
    /// Not a file of the project (unknown, ignored, outside the root, or invalid).
    Unknown,
}

#[derive(Debug, Clone, Default)]
pub struct Corpus {
    pub scope: SourceScope,
    /// The files that may be cited, by path.
    pub files: BTreeMap<String, CorpusFile>,
    /// Agent instruction files (context only, never a citation).
    pub agent_files: Vec<CorpusFile>,
    /// Every file of the project outside the scope (to tell "out of scope" from "unknown").
    pub outside_scope: BTreeSet<String>,
    pub truncated: bool,
}

/// A document inlined in the prompt (for the confirmation card and the estimate).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inlined {
    pub path: String,
    /// Bytes of the file (the whole file, even when only a part is inlined).
    pub bytes: u64,
    /// An agent instruction file (context only).
    pub agent: bool,
}

fn is_markdown_path(path: &str) -> bool {
    let l = path.to_lowercase();
    l.ends_with(".md") || l.ends_with(".markdown")
}

/// Text or binary: by extension first, then a 1 KB sniff for unknown extensions.
fn is_binary(root: &Path, f: &FileFact, sniffs: &mut usize) -> bool {
    if BINARY_EXTS.contains(&f.ext.as_str()) {
        return true;
    }
    if TEXT_EXTS.contains(&f.ext.as_str()) || language_of(f).is_some() || f.size == 0 {
        return false;
    }
    // Files without an extension that are usually text.
    if matches!(
        f.name.as_str(),
        "license"
            | "copying"
            | "authors"
            | "codeowners"
            | "procfile"
            | "gemfile"
            | "podfile"
            | "jenkinsfile"
            | "vagrantfile"
            | "brewfile"
    ) {
        return false;
    }
    if *sniffs >= MAX_SNIFFS {
        return true;
    }
    *sniffs += 1;
    let mut buf = [0u8; SNIFF_BYTES];
    let Ok(mut file) = std::fs::File::open(root.join(&f.path)) else {
        return true;
    };
    let n = file.read(&mut buf).unwrap_or(0);
    !looks_like_text(&buf[..n])
}

impl Corpus {
    /// The corpus of `walk` for `scope`. `agent_names` are the provider's instruction files.
    pub fn build(root: &Path, walk: &Walk, scope: &SourceScope, agent_names: &[String]) -> Self {
        let mut sniffs = 0usize;
        let entries = walk
            .files
            .iter()
            .filter(|f| !is_secret(&f.path) && !is_generated(&f.path))
            .map(|f| {
                let markdown = is_markdown_path(&f.path);
                let binary = !markdown && is_binary(root, f, &mut sniffs);
                let file = CorpusFile {
                    path: f.path.clone(),
                    size: f.size,
                    binary,
                    large: !binary && f.size > LARGE_TEXT_BYTES,
                    language: language_of(f).map(|(l, _)| l),
                    markdown,
                };
                (file, is_agent_file(&f.path, agent_names))
            })
            .collect();
        let mut corpus = Self::from_entries(entries, scope);
        corpus.truncated = walk.truncated;
        corpus
    }

    /// The corpus of known files (`(file, is an agent file)`), partitioned by `scope`.
    pub fn from_entries(entries: Vec<(CorpusFile, bool)>, scope: &SourceScope) -> Self {
        let mut corpus = Self {
            scope: scope.clone(),
            ..Self::default()
        };
        let wanted: Option<BTreeSet<&str>> = match scope {
            SourceScope::Paths { paths } => Some(paths.iter().map(String::as_str).collect()),
            _ => None,
        };
        for (file, agent) in entries {
            if agent {
                if !file.binary {
                    corpus.agent_files.push(file);
                }
                continue;
            }
            let in_scope = match scope {
                SourceScope::WholeProject => true,
                // The README counts even when it is not named `.md`.
                SourceScope::DocumentationOnly => {
                    file.markdown
                        || !file.path.contains('/')
                            && file.path.to_lowercase().starts_with("readme")
                }
                // A file, or every file under a folder.
                SourceScope::Paths { .. } => wanted.as_ref().is_some_and(|w| {
                    w.contains(file.path.as_str())
                        || w.iter().any(|p| {
                            file.path.starts_with(p) && file.path[p.len()..].starts_with('/')
                        })
                }),
            };
            if in_scope {
                corpus.files.insert(file.path.clone(), file);
            } else {
                corpus.outside_scope.insert(file.path.clone());
            }
        }
        corpus
    }

    /// What `path` is to a generation: citable, or why not.
    pub fn status(&self, path: &str, agent_names: &[String]) -> PathStatus<'_> {
        if let Some(f) = self.files.get(path) {
            return PathStatus::Citable(f);
        }
        if is_secret(path) {
            PathStatus::Secret
        } else if is_agent_file(path, agent_names) {
            PathStatus::Agent
        } else if self.outside_scope.contains(path) {
            PathStatus::OutOfScope
        } else {
            PathStatus::Unknown
        }
    }

    /// The map of the project for the prompt: root files, then each top-level folder with its
    /// counts, its files and its subfolders summarized, at most [`MAX_MAP_LINES`] lines.
    pub fn map(&self) -> String {
        let mut by_dir: BTreeMap<&str, Vec<&CorpusFile>> = BTreeMap::new();
        for f in self.files.values() {
            let dir = f.path.rfind('/').map_or("", |i| &f.path[..i]);
            by_dir.entry(dir).or_default().push(f);
        }
        // Totals per folder, every ancestor counted.
        let mut totals: BTreeMap<String, (u64, u64, BTreeSet<String>)> = BTreeMap::new();
        for f in self.files.values() {
            let parts: Vec<&str> = f.path.split('/').collect();
            for depth in 1..parts.len() {
                let dir = parts[..depth].join("/");
                let e = totals.entry(dir).or_default();
                e.0 += 1;
                e.1 += f.size;
                if depth + 1 < parts.len() {
                    e.2.insert(parts[depth].to_owned());
                }
            }
        }
        let mut lines: Vec<String> = Vec::new();
        let describe = |f: &CorpusFile| {
            let mut what = vec![format_size(f.size)];
            if f.binary {
                what.push("binary: name only".to_owned());
            } else if let Some(l) = f.language {
                what.push(l.to_owned());
            }
            if f.large {
                what.push("large: read parts of it".to_owned());
            }
            format!("{} ({})", f.path, what.join(", "))
        };
        let summary = |dir: &str, t: &(u64, u64, BTreeSet<String>)| {
            let folders = if t.2.is_empty() {
                String::new()
            } else {
                format!("{} folders, ", t.2.len())
            };
            format!("{dir}/ ({folders}{} files, {})", t.0, format_size(t.1))
        };
        for f in by_dir.get("").into_iter().flatten() {
            lines.push(describe(f));
        }
        let top: Vec<&String> = totals.keys().filter(|d| !d.contains('/')).collect();
        for dir in top {
            let t = &totals[dir];
            if lines.len() >= MAX_MAP_LINES {
                lines.push(summary(dir, t));
                continue;
            }
            lines.push(summary(dir, t));
            let files = by_dir.get(dir.as_str()).map_or(&[][..], Vec::as_slice);
            for f in files.iter().take(MAX_FILES_PER_FOLDER) {
                lines.push(format!("  {}", describe(f)));
            }
            if files.len() > MAX_FILES_PER_FOLDER {
                lines.push(format!(
                    "  … {} more files in {dir}/",
                    files.len() - MAX_FILES_PER_FOLDER
                ));
            }
            for sub in &t.2 {
                let path = format!("{dir}/{sub}");
                if let Some(st) = totals.get(&path) {
                    let sub_files = by_dir.get(path.as_str()).map_or(0, Vec::len);
                    // A small folder of files only is listed; anything else is summarized.
                    if st.2.is_empty() && sub_files <= 6 && lines.len() + sub_files < MAX_MAP_LINES
                    {
                        for f in by_dir.get(path.as_str()).into_iter().flatten() {
                            lines.push(format!("  {}", describe(f)));
                        }
                    } else {
                        lines.push(format!("  {}", summary(&path, st)));
                    }
                }
            }
        }
        if lines.len() > MAX_MAP_LINES + 40 {
            let rest = lines.len() - MAX_MAP_LINES;
            lines.truncate(MAX_MAP_LINES);
            lines.push(format!(
                "… {rest} more lines: list the folders with your tools"
            ));
        }
        if self.truncated {
            lines.push("(The project is very large: this map covers the files seen.)".to_owned());
        }
        lines.join("\n")
    }

    /// The anchor files inlined with line numbers, and what was inlined.
    pub fn anchors_text(&self, root: &Path, anchors: &[String]) -> (String, Vec<Inlined>) {
        let mut out = String::new();
        let mut inlined = Vec::new();
        let mut budget = ANCHOR_TOTAL_BYTES;
        for path in anchors {
            let Some(f) = self.files.get(path) else {
                continue;
            };
            if f.binary || budget < 512 {
                continue;
            }
            let Some(text) = numbered(root, path, ANCHOR_FILE_BYTES.min(budget)) else {
                continue;
            };
            budget = budget.saturating_sub(text.len());
            out.push_str(&text);
            out.push('\n');
            inlined.push(Inlined {
                path: path.clone(),
                bytes: f.size,
                agent: false,
            });
        }
        (out, inlined)
    }

    /// The agent instruction files inlined (capped), and what was inlined.
    pub fn agent_text(&self, root: &Path) -> (String, Vec<Inlined>) {
        let mut out = String::new();
        let mut inlined = Vec::new();
        let mut budget = AGENT_TOTAL_BYTES;
        for f in &self.agent_files {
            if budget < 512 || f.size == 0 {
                continue;
            }
            let Some(text) = numbered(root, &f.path, AGENT_FILE_BYTES.min(budget)) else {
                continue;
            };
            budget = budget.saturating_sub(text.len());
            out.push_str(&text);
            out.push('\n');
            inlined.push(Inlined {
                path: f.path.clone(),
                bytes: f.size,
                agent: true,
            });
        }
        (out, inlined)
    }
}

pub fn format_size(bytes: u64) -> String {
    // Precision loss is irrelevant for a size label.
    #[allow(clippy::cast_precision_loss)]
    let b = bytes as f64;
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", b / 1024.0)
    } else {
        format!("{:.1} MB", b / (1024.0 * 1024.0))
    }
}

/// Reads a text file of the project (at most 8 MB).
pub fn read_text(root: &Path, path: &str) -> Option<String> {
    let full = root.join(path);
    let meta = std::fs::metadata(&full).ok()?;
    if meta.len() > 8 * 1024 * 1024 {
        return None;
    }
    std::fs::read(full).ok().map(|b| decode_text(&b))
}

/// `## path (lines 1–N of M)` then every line prefixed with its number, cut at `max_bytes`.
pub fn numbered(root: &Path, path: &str, max_bytes: usize) -> Option<String> {
    let text = read_text(root, path)?;
    let lines: Vec<&str> = text.lines().collect();
    let width = lines.len().to_string().len().max(3);
    let mut body = String::new();
    let mut shown = 0;
    for (i, line) in lines.iter().enumerate() {
        let row = format!("{:>width$} | {line}\n", i + 1);
        if body.len() + row.len() > max_bytes {
            break;
        }
        body.push_str(&row);
        shown = i + 1;
    }
    let header = if shown < lines.len() {
        format!(
            "## {path} (lines 1-{shown} of {}; read the rest with your tools)\n",
            lines.len()
        )
    } else {
        format!("## {path} ({} lines)\n", lines.len())
    };
    Some(format!("{header}{body}"))
}

/// The profile block of a prompt.
pub fn profile_block(profile: &ProjectProfile) -> String {
    let list = |items: Vec<String>| {
        if items.is_empty() {
            "none detected".to_owned()
        } else {
            items.join(", ")
        }
    };
    let kinds = list(
        profile
            .kinds
            .iter()
            .map(|k| k.value.label().to_owned())
            .collect(),
    );
    let engines = list(profile.engines.iter().map(|e| e.value.clone()).collect());
    let frameworks = list(profile.frameworks.iter().map(|f| f.value.clone()).collect());
    let languages = list(
        profile
            .languages
            .iter()
            .filter(|l| l.percent >= 1.0)
            .take(6)
            .map(|l| format!("{} {}%", l.name, l.percent))
            .collect(),
    );
    let modules = list(
        profile
            .modules
            .iter()
            .take(16)
            .map(|m| match &m.role {
                Some(r) => format!("{} ({r})", m.path),
                None => m.path.clone(),
            })
            .collect(),
    );
    let build = list(profile.build.iter().map(|b| b.value.clone()).collect());
    let tests = list(profile.tests.iter().map(|t| t.value.clone()).collect());
    let ci = list(profile.ci.iter().map(|c| c.value.clone()).collect());
    let deps = list(profile.dependencies.iter().take(25).cloned().collect());
    let mut out = format!(
        "{}\nKinds: {kinds}. Engines: {engines}. Frameworks: {frameworks}. Languages: {languages}.\nMain modules: {modules}.\nBuild: {build}. Tests: {tests}. CI: {ci}.\nMain dependencies: {deps}.",
        profile.summary
    );
    if !profile.corrections.notes.is_empty() {
        out.push_str(&format!(
            "\nThe developer adds: {}",
            profile.corrections.notes
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::*;
    use crate::profile::tests::tree;
    use crate::profile::walk::walk;

    fn corpus(files: &[(&str, &str)], scope: SourceScope) -> (tempfile::TempDir, Corpus) {
        let dir = tree(files);
        let w = walk(dir.path(), &[], &AtomicBool::new(false));
        let c = Corpus::build(dir.path(), &w, &scope, &["AGENTS.md".to_owned()]);
        (dir, c)
    }

    const FILES: &[(&str, &str)] = &[
        ("README.md", "# Demo\n"),
        ("CLAUDE.md", "# Rules\nBe brief.\n"),
        ("AGENTS.md", "# Agents\n"),
        (".env", "TOKEN=x\n"),
        ("certs/dev.pem", "-----BEGIN-----\n"),
        ("src/main.rs", "fn main() {\n    run();\n}\n"),
        ("assets/logo.png", "PNG\0\0"),
        ("assets/blob", "\0\0\0binary"),
        ("assets/notes", "plain text notes\n"),
        ("docs/guide.md", "# Guide\n"),
        ("dist/bundle.js", "x"),
    ];

    #[test]
    fn agent_files_are_context_and_secrets_absent() {
        let (_d, c) = corpus(FILES, SourceScope::WholeProject);
        let agents: Vec<&str> = c.agent_files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(agents, vec!["AGENTS.md", "CLAUDE.md"]);
        assert!(!c.files.contains_key("CLAUDE.md"));
        assert!(!c.files.contains_key(".env") && !c.files.contains_key("certs/dev.pem"));
        assert!(!c.files.contains_key("dist/bundle.js"));
        let names = ["AGENTS.md".to_owned()];
        assert_eq!(c.status("CLAUDE.md", &names), PathStatus::Agent);
        assert_eq!(c.status(".env", &names), PathStatus::Secret);
        assert_eq!(c.status("nope.rs", &names), PathStatus::Unknown);
        assert!(matches!(
            c.status("src/main.rs", &names),
            PathStatus::Citable(_)
        ));
        let map = c.map();
        assert!(!map.contains(".env") && !map.contains("CLAUDE.md"));
    }

    #[test]
    fn binaries_by_extension_and_sniff() {
        let (_d, c) = corpus(FILES, SourceScope::WholeProject);
        assert!(c.files["assets/logo.png"].binary);
        assert!(c.files["assets/blob"].binary);
        assert!(!c.files["assets/notes"].binary);
        assert!(!c.files["src/main.rs"].binary);
        assert!(c.map().contains("assets/logo.png (5 B, binary: name only)"));
    }

    #[test]
    fn documentation_only_and_paths_scopes() {
        let (_d, c) = corpus(FILES, SourceScope::DocumentationOnly);
        let paths: Vec<&str> = c.files.keys().map(String::as_str).collect();
        assert_eq!(paths, vec!["README.md", "docs/guide.md"]);
        assert_eq!(c.status("src/main.rs", &[]), PathStatus::OutOfScope);
        assert_eq!(
            c.agent_files.len(),
            2,
            "agent files stay context in every scope"
        );
        let (_d, c) = corpus(
            FILES,
            SourceScope::Paths {
                paths: vec!["src/main.rs".into()],
            },
        );
        assert_eq!(c.files.keys().collect::<Vec<_>>(), vec!["src/main.rs"]);
        // A folder brings its files, not a sibling sharing its prefix.
        let (_d, c) = corpus(
            &[
                ("src/save/load.rs", "fn a() {}\n"),
                ("src/save/store.rs", "fn b() {}\n"),
                ("src/saved.rs", "fn c() {}\n"),
            ],
            SourceScope::Paths {
                paths: vec!["src/save".into()],
            },
        );
        assert_eq!(
            c.files.keys().collect::<Vec<_>>(),
            vec!["src/save/load.rs", "src/save/store.rs"]
        );
    }

    #[test]
    fn large_files_and_the_map_caps() {
        let big = "x\n".repeat(600_000);
        let mut files: Vec<(String, String)> = vec![("big.txt".into(), big)];
        for i in 0..600 {
            files.push((
                format!("area{}/sub{}/f{i}.rs", i % 20, i % 50),
                "fn a() {}\n".into(),
            ));
        }
        let refs: Vec<(&str, &str)> = files
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        let (_d, c) = corpus(&refs, SourceScope::WholeProject);
        assert!(c.files["big.txt"].large);
        let map = c.map();
        assert!(map.contains("large: read parts of it"));
        assert!(
            map.lines().count() <= MAX_MAP_LINES + 41,
            "{}",
            map.lines().count()
        );
        assert!(map.contains("area0/ ("), "{map}");
    }

    #[test]
    fn anchors_are_numbered_and_capped() {
        let (d, c) = corpus(FILES, SourceScope::WholeProject);
        let (text, inlined) =
            c.anchors_text(d.path(), &["src/main.rs".into(), "assets/logo.png".into()]);
        assert!(
            text.starts_with("## src/main.rs (3 lines)\n  1 | fn main() {\n  2 |     run();\n")
        );
        assert_eq!(inlined.len(), 1);
        let (text, inlined) = c.agent_text(d.path());
        assert!(text.contains("## CLAUDE.md (2 lines)"));
        assert!(inlined.iter().all(|i| i.agent));
        let long = "line\n".repeat(20_000);
        let dir = tree(&[("big.rs", &long)]);
        let n = numbered(dir.path(), "big.rs", 1000).unwrap();
        assert!(n.len() <= 1100);
        assert!(n.starts_with("## big.rs (lines 1-"));
        assert!(n.contains("of 20000; read the rest with your tools"));
    }
}
