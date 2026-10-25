//! Subject proposals, built locally from the profile and the corpus (no AI): every subject is
//! phrased about this project, carries the anchor files a generation starts from and a measure
//! of the material behind it. Subjects without enough material are not proposed. The quiz shows
//! them as chips; the tutorials will show them as cards.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::corpus::{Corpus, CorpusFile};
use crate::profile::{ProjectKind, ProjectProfile};

/// How much the project has to say about a subject.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Material {
    Some,
    Rich,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Subject {
    /// Stable within a folder: `overview`, `module:src/ai`, `feature:docs/features/quiz.md`, …
    pub id: String,
    /// Phrased about this project: "How src-tauri/src/ai works".
    pub title: String,
    /// What the generator should focus on (sent in the prompt).
    pub focus: String,
    /// The files a generation starts from (inlined in the prompt), most relevant first.
    pub anchors: Vec<String>,
    pub material: Material,
    /// Text files and bytes behind the subject.
    pub files: u32,
    pub bytes: u64,
    /// Some of the material is documentation (shown under "Documentation only").
    pub has_docs: bool,
}

/// Below this, a subject is not proposed.
pub const MIN_FILES: u32 = 2;
pub const MIN_BYTES: u64 = 2 * 1024;
/// From this, the material is rich.
pub const RICH_BYTES: u64 = 40 * 1024;
/// Anchors per subject at most.
pub const MAX_ANCHORS: usize = 5;
/// Module subjects at most.
const MAX_MODULE_SUBJECTS: usize = 8;
const MAX_FEATURE_SUBJECTS: usize = 8;

/// Words of a feature page name that say nothing about the code.
const STOP_WORDS: &[&str] = &["and", "the", "for", "with", "how", "its", "our"];

/// Entry files of a module, by lower-case name, in order of preference.
const ENTRY_NAMES: &[&str] = &[
    "mod.rs",
    "lib.rs",
    "main.rs",
    "index.ts",
    "index.tsx",
    "index.js",
    "main.ts",
    "main.tsx",
    "main.go",
    "__init__.py",
    "main.py",
    "app.py",
    "app.tsx",
    "app.ts",
    "main.gd",
    "main.cs",
    "program.cs",
    "main.cpp",
    "main.c",
    "build.cs",
];

fn humanize(stem: &str) -> String {
    let words: Vec<String> = stem
        .split(['-', '_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| match w.to_lowercase().as_str() {
            "ai" | "ui" | "ipc" | "api" | "cli" | "ci" | "adr" | "ux" | "gpu" | "io" => {
                w.to_uppercase()
            }
            _ => w.to_owned(),
        })
        .collect();
    let mut s = words.join(" ");
    if let Some(first) = s.get(0..1) {
        s = first.to_uppercase() + &s[1..];
    }
    s
}

fn stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').map_or(name, |(s, _)| s)
}

fn is_test_path(path: &str) -> bool {
    let l = path.to_lowercase();
    l.contains("/test")
        || l.starts_with("test")
        || l.contains(".test.")
        || l.contains(".spec.")
        || l.contains("_test.")
        || l.contains("/e2e/")
        || l.starts_with("e2e/")
}

/// Text files of the corpus under `dir`.
fn text_under<'a>(corpus: &'a Corpus, dir: &'a str) -> impl Iterator<Item = &'a CorpusFile> + 'a {
    corpus.files.values().filter(move |f| {
        !f.binary && f.path.starts_with(dir) && f.path[dir.len()..].starts_with('/')
    })
}

/// Up to [`MAX_ANCHORS`] anchors among `files`: entry files first, then the largest text files
/// of reasonable size (tests last).
fn pick_anchors<'a>(files: impl Iterator<Item = &'a CorpusFile>) -> Vec<String> {
    let mut files: Vec<&CorpusFile> = files.filter(|f| !f.binary && f.size > 0).collect();
    files.sort_by_key(|f| {
        let name = f.path.rsplit('/').next().unwrap_or(&f.path).to_lowercase();
        let entry = ENTRY_NAMES
            .iter()
            .position(|n| *n == name)
            .unwrap_or(ENTRY_NAMES.len());
        let too_big = f.size > 48 * 1024;
        // Code and docs explain a subject better than styles, data and configuration.
        let secondary = f
            .language
            .is_none_or(|l| matches!(l, "CSS" | "SCSS" | "HTML" | "Less" | "Sass"));
        (
            is_test_path(&f.path),
            entry,
            secondary,
            too_big,
            std::cmp::Reverse(f.size),
        )
    });
    files
        .into_iter()
        .take(MAX_ANCHORS)
        .map(|f| f.path.clone())
        .collect()
}

struct Builder<'a> {
    corpus: &'a Corpus,
    out: Vec<Subject>,
}

impl Builder<'_> {
    fn add(
        &mut self,
        id: String,
        title: String,
        focus: String,
        anchors: Vec<String>,
        material: &[&CorpusFile],
    ) {
        let files = u32::try_from(material.len()).unwrap_or(u32::MAX);
        let bytes: u64 = material.iter().map(|f| f.size).sum();
        let anchors: Vec<String> = anchors
            .into_iter()
            .filter(|a| self.corpus.files.get(a).is_some_and(|f| !f.binary))
            .collect();
        if files < MIN_FILES || bytes < MIN_BYTES || anchors.is_empty() {
            return;
        }
        if self.out.iter().any(|s| s.id == id) {
            return;
        }
        self.out.push(Subject {
            id,
            title,
            focus,
            anchors,
            material: if bytes >= RICH_BYTES {
                Material::Rich
            } else {
                Material::Some
            },
            files,
            bytes,
            has_docs: material.iter().any(|f| f.markdown),
        });
    }
}

/// The subjects of a project, the broadest first.
pub fn propose(profile: &ProjectProfile, corpus: &Corpus) -> Vec<Subject> {
    let name = profile.name.as_str();
    let mut b = Builder {
        corpus,
        out: Vec::new(),
    };
    let text: Vec<&CorpusFile> = corpus.files.values().filter(|f| !f.binary).collect();
    let find = |pred: &dyn Fn(&CorpusFile) -> bool| -> Vec<&CorpusFile> {
        text.iter().copied().filter(|f| pred(f)).collect()
    };

    // The big picture: README, architecture, the main manifest, the largest module's entry.
    {
        let mut anchors: Vec<String> = Vec::new();
        anchors.extend(profile.docs.readme.clone());
        anchors.extend(profile.docs.architecture.clone());
        for m in [
            "package.json",
            "Cargo.toml",
            "pyproject.toml",
            "go.mod",
            "pubspec.yaml",
            "project.godot",
        ] {
            if corpus.files.contains_key(m) {
                anchors.push(m.to_owned());
            }
        }
        if let Some(module) = profile.modules.first() {
            anchors.extend(
                pick_anchors(text_under(corpus, &module.path))
                    .into_iter()
                    .take(1),
            );
        }
        anchors.truncate(MAX_ANCHORS);
        let material: Vec<&CorpusFile> =
            anchors.iter().filter_map(|a| corpus.files.get(a)).collect();
        let material = if material.len() >= 2 {
            material
        } else {
            text.clone()
        };
        b.add(
            "overview".into(),
            format!("How {name} fits together"),
            format!("the big picture of {name}: what it does, its main parts and how they connect"),
            anchors,
            &material,
        );
    }

    // Domain subjects from the engines and frameworks.
    let engines: Vec<&str> = profile.engines.iter().map(|e| e.value.as_str()).collect();
    let frameworks: Vec<&str> = profile
        .frameworks
        .iter()
        .map(|f| f.value.as_str())
        .collect();
    let starts = |prefix: &str| engines.iter().any(|e| e.starts_with(prefix));
    let mut domain = |id: &str, title: String, focus: String, files: Vec<&CorpusFile>| {
        let anchors = pick_anchors(files.iter().copied());
        b.add(format!("domain:{id}"), title, focus, anchors, &files);
    };
    if starts("Godot") {
        domain(
            "godot",
            format!("Scenes, nodes and signals in {name}"),
            "how this game's scenes are composed, which scripts drive which nodes, and how signals connect them".into(),
            find(&|f| matches!(f.path.rsplit('.').next(), Some("gd" | "tscn" | "cs"))),
        );
    }
    if starts("Unity") {
        domain(
            "unity",
            format!("MonoBehaviours, scenes and assets in {name}"),
            "how this game's scripts, components, scenes and ScriptableObjects fit together".into(),
            find(&|f| f.path.ends_with(".cs") || f.path.ends_with(".asmdef")),
        );
    }
    if starts("Unreal") {
        domain(
            "unreal",
            format!("Actors, components and modules in {name}"),
            "this game's gameplay framework: its Actors, Components, GameMode and modules, and how they interact".into(),
            find(&|f| {
                let l = f.path.to_lowercase();
                l.ends_with(".h") || l.ends_with(".cpp") || l.ends_with(".build.cs") || l.ends_with(".ini")
            }),
        );
    }
    if starts("Bevy") {
        domain(
            "bevy",
            format!("Systems, components and resources in {name}"),
            "how this game's ECS is organised: its plugins, systems, components, resources and schedules".into(),
            find(&|f| f.path.ends_with(".rs")),
        );
    }
    if frameworks.contains(&"Tauri") || frameworks.contains(&"Electron") {
        domain(
            "ipc",
            format!("How {name}'s UI talks to its backend"),
            "the boundary between the user interface and the native backend: the commands, events and types that cross it".into(),
            find(&|f| {
                let l = f.path.to_lowercase();
                (l.contains("ipc") || l.contains("command") || l.contains("preload") || l.contains("bridge"))
                    && !is_test_path(&l)
            }),
        );
    }
    if profile
        .kinds
        .iter()
        .any(|k| matches!(k.value, ProjectKind::WebBackend | ProjectKind::Service))
    {
        domain(
            "api",
            format!("The API of {name}"),
            "the routes or RPCs this service exposes, how a request is handled, and where the data comes from".into(),
            find(&|f| {
                let l = f.path.to_lowercase();
                (l.contains("route") || l.contains("handler") || l.contains("controller") || l.contains("api") || l.ends_with(".proto") || l.contains("urls.py") || l.contains("views"))
                    && !is_test_path(&l)
            }),
        );
    }

    // The main modules (not tests, docs or assets).
    let mut modules = 0;
    for m in &profile.modules {
        if modules >= MAX_MODULE_SUBJECTS {
            break;
        }
        if matches!(m.role.as_deref(), Some("tests" | "docs" | "assets")) {
            continue;
        }
        let files: Vec<&CorpusFile> = text_under(corpus, &m.path).collect();
        let before = b.out.len();
        b.add(
            format!("module:{}", m.path),
            format!("How {} works", m.path),
            format!("the module {} of {name}: what it is responsible for, its main types and functions, and how the rest of the project uses it", m.path),
            pick_anchors(files.iter().copied()),
            &files,
        );
        if b.out.len() > before {
            modules += 1;
        }
    }

    // Feature pages: each with the code that shares its name.
    for page in profile.docs.feature_pages.iter().take(MAX_FEATURE_SUBJECTS) {
        let s = stem(page).to_lowercase();
        let words: Vec<&str> = s
            .split(['-', '_'])
            .filter(|w| w.len() >= 3 && !STOP_WORDS.contains(w))
            .collect();
        // The files whose path segments start with the most words of the page's name.
        let score = |f: &CorpusFile| {
            let l = f.path.to_lowercase();
            let segments: Vec<&str> = l.split(['/', '.', '-', '_']).collect();
            words
                .iter()
                .filter(|w| segments.iter().any(|s| s.starts_with(*w)))
                .count()
        };
        let candidates: Vec<(&CorpusFile, usize)> = text
            .iter()
            .copied()
            .filter(|f| !f.markdown && !is_test_path(&f.path))
            .map(|f| (f, score(f)))
            .filter(|(_, n)| *n > 0)
            .collect();
        let best = candidates.iter().map(|(_, n)| *n).max().unwrap_or(0);
        let mut related: Vec<&CorpusFile> = candidates
            .into_iter()
            .filter(|(_, n)| *n == best)
            .map(|(f, _)| f)
            .collect();
        related.sort_by_key(|f| std::cmp::Reverse(f.size));
        related.truncate(12);
        let mut anchors = vec![page.clone()];
        anchors.extend(
            pick_anchors(related.iter().copied())
                .into_iter()
                .take(MAX_ANCHORS - 1),
        );
        let mut material = related.clone();
        if let Some(f) = corpus.files.get(page) {
            material.push(f);
        }
        b.add(
            format!("feature:{page}"),
            format!("The {} feature of {name}", humanize(stem(page)).to_lowercase().replace("ai ", "AI ")),
            format!("the feature described in {page}: how it works end to end in the code, not only what the page says"),
            anchors,
            &material,
        );
    }

    // Decisions.
    if let Some(dir) = &profile.docs.adr_dir
        && profile.docs.adrs >= 3
    {
        let adrs: Vec<&CorpusFile> = text_under(corpus, dir).collect();
        let anchors: Vec<String> = adrs
            .iter()
            .take(MAX_ANCHORS)
            .map(|f| f.path.clone())
            .collect();
        b.add(
            "decisions".into(),
            format!("Why {name} is built this way"),
            format!("the architecture decisions recorded in {dir}: what was chosen, what was rejected, and where the code follows them"),
            anchors,
            &adrs,
        );
    }

    // Build, test and ship.
    if !profile.build.is_empty() || !profile.ci.is_empty() {
        let files: Vec<&CorpusFile> = find(&|f| {
            let l = f.path.to_lowercase();
            l.starts_with(".github/workflows/")
                || l.starts_with(".gitlab-ci")
                || l.starts_with(".circleci/")
                || matches!(
                    l.rsplit('/').next().unwrap_or(""),
                    "makefile"
                        | "justfile"
                        | "package.json"
                        | "cargo.toml"
                        | "build.gradle"
                        | "build.gradle.kts"
                        | "cmakelists.txt"
                        | "dockerfile"
                        | "pyproject.toml"
                        | "tauri.conf.json"
                        | "export_presets.cfg"
                        | "playwright.config.ts"
                        | "vite.config.ts"
                )
                || l.starts_with("scripts/")
        });
        let mut anchors: Vec<String> = files
            .iter()
            .filter(|f| f.path.starts_with(".github/workflows/"))
            .map(|f| f.path.clone())
            .take(2)
            .collect();
        anchors.extend(pick_anchors(
            files
                .iter()
                .copied()
                .filter(|f| !f.path.starts_with(".github/")),
        ));
        anchors.truncate(MAX_ANCHORS);
        b.add(
            "build".into(),
            format!("How {name} is built, tested and shipped"),
            format!(
                "{name}'s scripts, build configuration, CI workflows, packaging and release process"
            ),
            anchors,
            &files,
        );
    }

    // Tests.
    if !profile.tests.is_empty() {
        let files: Vec<&CorpusFile> = find(&|f| is_test_path(&f.path) && !f.markdown);
        let mut sorted = files.clone();
        sorted.sort_by_key(|f| std::cmp::Reverse(f.size));
        let anchors: Vec<String> = sorted
            .iter()
            .filter(|f| f.size < 48 * 1024)
            .take(MAX_ANCHORS)
            .map(|f| f.path.clone())
            .collect();
        b.add(
            "tests".into(),
            format!("How {name} is tested"),
            format!("what {name}'s tests cover, how they are organised, and the helpers and fixtures they share"),
            anchors,
            &files,
        );
    }

    // Dependencies.
    if profile.dependencies.len() >= 5 {
        let manifests: BTreeSet<&str> = [
            "package.json",
            "Cargo.toml",
            "pyproject.toml",
            "go.mod",
            "pubspec.yaml",
            "requirements.txt",
            "Packages/manifest.json",
        ]
        .into_iter()
        .collect();
        let files: Vec<&CorpusFile> = find(&|f| {
            manifests
                .iter()
                .any(|m| f.path == *m || f.path.ends_with(&format!("/{m}")))
        });
        let anchors: Vec<String> = files
            .iter()
            .take(MAX_ANCHORS)
            .map(|f| f.path.clone())
            .collect();
        // The manifests alone are thin: the material is what uses the dependencies.
        let material: Vec<&CorpusFile> = if files.is_empty() {
            Vec::new()
        } else {
            text.clone()
        };
        b.add(
            "dependencies".into(),
            format!("The dependencies {name} relies on"),
            format!("the important dependencies of {name}, where it uses them, how they are wrapped or configured, and what would break without them"),
            anchors,
            &material,
        );
    }
    b.out
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::*;
    use crate::learning::corpus::SourceScope;
    use crate::profile::{build, tests::tree};

    fn subjects(files: &[(&str, &str)]) -> Vec<Subject> {
        let dir = tree(files);
        let (profile, walk) = build(dir.path(), &[], &AtomicBool::new(false));
        let corpus = Corpus::build(dir.path(), &walk, &SourceScope::WholeProject, &[]);
        propose(&profile, &corpus)
    }

    fn ids(s: &[Subject]) -> Vec<&str> {
        s.iter().map(|s| s.id.as_str()).collect()
    }

    fn code(n: usize) -> String {
        "pub fn step() { let total = compute(); store(total); }\n".repeat(n)
    }

    #[test]
    fn a_godot_game_gets_its_domain_subject() {
        let gd = code(40);
        let s = subjects(&[
            (
                "project.godot",
                "config/name=\"Dodge\"\nconfig/features=PackedStringArray(\"4.3\")\n",
            ),
            ("README.md", &"Dodge the creeps.\n".repeat(80)),
            ("player/player.gd", &gd),
            ("player/player.tscn", &gd),
            ("mobs/mob.gd", &gd),
            ("main.gd", &gd),
        ]);
        assert!(ids(&s).contains(&"domain:godot"), "{:?}", ids(&s));
        let godot = s.iter().find(|s| s.id == "domain:godot").unwrap();
        assert_eq!(godot.title, "Scenes, nodes and signals in Dodge");
        assert!(godot.anchors.iter().all(|a| !a.ends_with(".png")));
        assert_eq!(s[0].id, "overview");
    }

    #[test]
    fn modules_features_decisions_build_and_tests() {
        let rs = code(80);
        let s = subjects(&[
            (
                "package.json",
                r#"{"name":"app","scripts":{"test":"vitest"},"devDependencies":{"vitest":"4"}}"#,
            ),
            ("README.md", &"An app.\n".repeat(60)),
            ("docs/architecture.md", &"Layers.\n".repeat(60)),
            (
                "docs/features/search.md",
                &"Search works like this.\n".repeat(40),
            ),
            ("docs/decisions/0001-a.md", &"Decision A.\n".repeat(80)),
            ("docs/decisions/0002-b.md", &"Decision B.\n".repeat(80)),
            ("docs/decisions/0003-c.md", &"Decision C.\n".repeat(80)),
            ("src/search/index.ts", &rs),
            ("src/search/matcher.ts", &rs),
            ("src/search/matcher.test.ts", &rs),
            ("src/tests/helpers.test.ts", &rs),
            (".github/workflows/ci.yml", &"run: npm test\n".repeat(200)),
            ("Makefile", &"build:\n\tnpm run build\n".repeat(100)),
        ]);
        let found = ids(&s);
        for id in [
            "overview",
            "module:src/search",
            "feature:docs/features/search.md",
            "decisions",
            "build",
            "tests",
        ] {
            assert!(found.contains(&id), "{id} in {found:?}");
        }
        let module = s.iter().find(|s| s.id == "module:src/search").unwrap();
        assert_eq!(
            module.anchors[0], "src/search/index.ts",
            "the entry file first"
        );
        assert_eq!(
            module.anchors.last().unwrap(),
            "src/search/matcher.test.ts",
            "tests last"
        );
        let feature = s.iter().find(|s| s.id.starts_with("feature:")).unwrap();
        assert_eq!(feature.title, "The search feature of app");
        assert!(
            feature
                .anchors
                .contains(&"src/search/matcher.ts".to_owned())
        );
        assert!(feature.has_docs);
        assert!(!module.has_docs);
        // Every anchor is a text file of the corpus.
        for subject in &s {
            assert!(!subject.anchors.is_empty());
        }
    }

    #[test]
    fn no_subject_without_material() {
        let s = subjects(&[("README.md", "# Tiny\n"), ("main.py", "print(1)\n")]);
        assert!(s.is_empty(), "{:?}", ids(&s));
    }

    #[test]
    fn dogfooding_the_repository() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let (profile, walk) = build(&root, &[], &AtomicBool::new(false));
        let corpus = Corpus::build(&root, &walk, &SourceScope::WholeProject, &[]);
        let s = propose(&profile, &corpus);
        for subject in &s {
            println!("{} | {} | {:?}", subject.id, subject.title, subject.anchors);
        }
        let found = ids(&s);
        for id in [
            "overview",
            "domain:ipc",
            "module:src-tauri/src/ai",
            "decisions",
            "build",
            "tests",
        ] {
            assert!(found.contains(&id), "{id} in {found:?}");
        }
        assert!(
            s.iter()
                .flat_map(|s| &s.anchors)
                .all(|a| !a.eq_ignore_ascii_case("CLAUDE.md")),
            "agent files are never anchors"
        );
    }

    #[test]
    fn humanized_titles() {
        assert_eq!(humanize("ai-chat"), "AI chat");
        assert_eq!(humanize("markdown-preview"), "Markdown preview");
    }
}
