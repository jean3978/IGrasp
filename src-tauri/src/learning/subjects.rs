//! Subject proposals, built locally from the profile and the corpus (no AI). Two groups: the
//! **global** concepts of software the project shows it implements (architecture, tech stack,
//! security, data, patterns, …) and its **features** (from feature pages, feature folders, a
//! game's own folders, and common features recognised by the words of the paths). Titles are
//! concepts, never folder paths; every subject carries the anchor files a generation starts from
//! and a measure of the material behind it, and is not proposed without enough material. The
//! quiz shows them as grouped chips; the tutorials will show them as cards.

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

/// Where a subject shows on the quiz home.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SubjectGroup {
    /// A concept across the project: architecture, security, patterns, …
    Global,
    /// Something the project does: a feature, a game system.
    Feature,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Subject {
    /// Stable within a folder: `concept:security`, `feature:docs/features/quiz.md`, …
    pub id: String,
    pub group: SubjectGroup,
    /// A concept or a feature, never a path: "Security", "NPCs", "Markdown preview".
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
/// Feature subjects at most.
const MAX_FEATURE_SUBJECTS: usize = 12;

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

pub(crate) fn humanize(stem: &str) -> String {
    let words: Vec<String> = stem
        .split(['-', '_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| match w.to_lowercase().as_str() {
            "ai" | "ui" | "ipc" | "api" | "cli" | "ci" | "adr" | "ux" | "gpu" | "io" | "gui"
            | "hud" | "npc" | "fps" => w.to_uppercase(),
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

/// Engine bookkeeping next to the real files (Godot's `.import` and `.uid`, Unity's `.meta`):
/// never material, never an anchor.
pub(crate) fn is_metadata(path: &str) -> bool {
    let l = path.to_lowercase();
    l.ends_with(".import") || l.ends_with(".uid") || l.ends_with(".meta")
}

pub(crate) fn is_test_path(path: &str) -> bool {
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
        !f.binary
            && !is_metadata(&f.path)
            && f.path.starts_with(dir)
            && f.path[dir.len()..].starts_with('/')
    })
}

/// Up to [`MAX_ANCHORS`] anchors among `files`: entry files first, then the largest text files
/// of reasonable size (tests last).
pub fn pick_anchors<'a>(files: impl Iterator<Item = &'a CorpusFile>) -> Vec<String> {
    let mut files: Vec<&CorpusFile> = files
        .filter(|f| !f.binary && f.size > 0 && !is_metadata(&f.path))
        .collect();
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
    /// The files of each feature proposed so far (a feature mostly made of them is the same).
    claimed: Vec<BTreeSet<String>>,
}

impl Builder<'_> {
    #[allow(clippy::too_many_arguments)]
    fn add(
        &mut self,
        group: SubjectGroup,
        id: String,
        title: String,
        focus: String,
        anchors: Vec<String>,
        material: &[&CorpusFile],
    ) -> bool {
        let files = u32::try_from(material.len()).unwrap_or(u32::MAX);
        let bytes: u64 = material.iter().map(|f| f.size).sum();
        let anchors: Vec<String> = anchors
            .into_iter()
            .filter(|a| self.corpus.files.get(a).is_some_and(|f| !f.binary))
            .collect();
        if files < MIN_FILES || bytes < MIN_BYTES || anchors.is_empty() {
            return false;
        }
        if group == SubjectGroup::Feature {
            let set: BTreeSet<String> = material.iter().map(|f| f.path.clone()).collect();
            let same = self
                .claimed
                .iter()
                .any(|c| c.intersection(&set).count() * 5 >= set.len() * 4);
            if same {
                return false;
            }
        }
        let key = title.to_lowercase();
        if self
            .out
            .iter()
            .any(|s| s.id == id || s.title.to_lowercase() == key)
        {
            return false;
        }
        if group == SubjectGroup::Feature {
            self.claimed
                .push(material.iter().map(|f| f.path.clone()).collect());
        }
        self.out.push(Subject {
            id,
            group,
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
        true
    }

    fn features(&self) -> usize {
        self.out
            .iter()
            .filter(|s| s.group == SubjectGroup::Feature)
            .count()
    }
}

/// The words of a path: lower case, split on separators and camelCase boundaries
/// (`Scripts/PlayerController.cs` → `scripts`, `player`, `controller`, `cs`).
fn words_of(path: &str) -> Vec<String> {
    let mut out = Vec::new();
    for part in path.split(['/', '\\', '.', '-', '_', ' ']) {
        let mut word = String::new();
        let mut prev_lower = false;
        for c in part.chars() {
            if c.is_uppercase() && prev_lower && !word.is_empty() {
                out.push(std::mem::take(&mut word).to_lowercase());
            }
            prev_lower = c.is_lowercase() || c.is_ascii_digit();
            word.push(c);
        }
        if !word.is_empty() {
            out.push(word.to_lowercase());
        }
    }
    out
}

/// Whether a word of the path is one of `words` (or its plural).
pub(crate) fn path_has(path: &str, words: &[&str]) -> bool {
    words_of(path).iter().any(|t| {
        words.iter().any(|w| {
            t == w
                || t.strip_suffix('s').is_some_and(|s| s == *w)
                || t.strip_suffix("es").is_some_and(|s| s == *w)
        })
    })
}

/// A concept of software, proposed when the project has files about it.
struct Concept {
    id: &'static str,
    title: &'static str,
    /// `{name}` is the project's name.
    focus: &'static str,
    /// Path words that show where the project implements it.
    words: &'static [&'static str],
}

const CONCEPTS: &[Concept] = &[
    Concept {
        id: "security",
        title: "Security",
        focus: "how {name} protects itself and its users: what it trusts and what it does not, where input is validated or sanitized, how access is checked, and how secrets and permissions are handled",
        words: &[
            "security",
            "auth",
            "authentication",
            "authorization",
            "permission",
            "policy",
            "guard",
            "sanitize",
            "sanitizer",
            "csp",
            "crypto",
            "encryption",
            "token",
            "jwt",
            "oauth",
            "login",
            "acl",
            "rbac",
            "trust",
            "allowlist",
            "denylist",
            "csrf",
            "xss",
        ],
    },
    Concept {
        id: "data",
        title: "Data and storage",
        focus: "how {name} models, stores and loads its data: the main data structures, where state is persisted, the formats used, and how data flows between storage and the rest",
        words: &[
            "db",
            "database",
            "model",
            "schema",
            "migration",
            "storage",
            "repository",
            "persistence",
            "cache",
            "serialization",
            "serializer",
            "appdata",
            "sql",
            "orm",
            "entity",
            "dao",
        ],
    },
    Concept {
        id: "state",
        title: "State management",
        focus: "how {name} holds and changes its application state: where state lives, who may change it, how changes propagate to the rest, and why it is organised this way",
        words: &[
            "store", "state", "reducer", "redux", "zustand", "context", "signal", "atom", "slice",
        ],
    },
    Concept {
        id: "patterns",
        title: "Design patterns",
        focus: "the recurring design patterns {name} uses (abstractions behind traits or interfaces, providers, registries, events, commands, adapters, …): where each appears, what problem it solves here, and its trade-offs",
        words: &[
            "provider",
            "factory",
            "adapter",
            "registry",
            "plugin",
            "observer",
            "strategy",
            "visitor",
            "builder",
            "manager",
            "service",
            "middleware",
            "handler",
            "command",
            "event",
            "bus",
            "gateway",
            "trait",
            "interface",
            "mediator",
            "facade",
            "pipeline",
        ],
    },
    Concept {
        id: "errors",
        title: "Error handling",
        focus: "how {name} reports, propagates and recovers from errors: its error types, where failures are caught, what the user sees, and what is retried or logged",
        words: &[
            "error",
            "exception",
            "failure",
            "retry",
            "panic",
            "recover",
            "fallback",
        ],
    },
    Concept {
        id: "concurrency",
        title: "Concurrency and background work",
        focus: "what {name} does in parallel or in the background: threads, async tasks, workers or jobs, how they communicate and are cancelled, and how shared state is protected",
        words: &[
            "thread",
            "async",
            "worker",
            "queue",
            "job",
            "task",
            "channel",
            "scheduler",
            "concurrency",
            "parallel",
            "watcher",
            "pool",
            "mutex",
        ],
    },
    Concept {
        id: "ui",
        title: "User interface",
        focus: "how {name}'s user interface is built: its main views and components, how they get their data, how user actions flow, and the conventions for layout and styling",
        words: &[
            "ui",
            "view",
            "component",
            "screen",
            "widget",
            "page",
            "layout",
            "gui",
            "hud",
            "menu",
            "dialog",
            "panel",
            "frontend",
            "theme",
            "style",
        ],
    },
    Concept {
        id: "networking",
        title: "Networking and communication",
        focus: "how {name} talks over the network or across process boundaries: its clients, servers, protocols and messages, and how failures and latency are handled",
        words: &[
            "net",
            "network",
            "http",
            "client",
            "server",
            "socket",
            "websocket",
            "rpc",
            "grpc",
            "fetch",
            "request",
            "response",
            "multiplayer",
            "ipc",
            "protocol",
        ],
    },
    Concept {
        id: "config",
        title: "Configuration and settings",
        focus: "how {name} is configured: where settings and options come from, their defaults, how they are validated and applied, and which ones change behaviour the most",
        words: &[
            "config",
            "configuration",
            "settings",
            "options",
            "preferences",
            "env",
            "defaults",
        ],
    },
    Concept {
        id: "logging",
        title: "Logging and diagnostics",
        focus: "how {name} logs, traces and reports what happens: what is logged where, the levels used, and how a developer diagnoses a problem",
        words: &[
            "log",
            "logger",
            "logging",
            "telemetry",
            "trace",
            "tracing",
            "metrics",
            "diagnostics",
        ],
    },
];

/// Folders whose subfolders are features (`src/features/quiz`, `Scripts/Systems/Combat`).
const FEATURE_PARENTS: &[&str] = &[
    "features",
    "feature",
    "modules",
    "systems",
    "gameplay",
    "scenes",
    "entities",
    "actors",
    "characters",
    "plugins",
    "screens",
    "pages",
    "domains",
    "apps",
];

/// Folder names that say nothing about a feature.
const GENERIC_FOLDERS: &[&str] = &[
    "src",
    "lib",
    "app",
    "source",
    "sources",
    "assets",
    "scripts",
    "test",
    "tests",
    "spec",
    "docs",
    "doc",
    "build",
    "dist",
    "out",
    "target",
    "config",
    "configs",
    "resources",
    "res",
    "addons",
    "vendor",
    "third_party",
    "thirdparty",
    "tools",
    "tool",
    "utils",
    "util",
    "common",
    "shared",
    "core",
    "public",
    "static",
    "bin",
    "include",
    "packages",
    "node_modules",
    "screenshots",
    "images",
    "img",
    "fonts",
    "audio",
    "sounds",
    "music",
    "textures",
    "materials",
    "models",
    "sprites",
    "art",
    "shaders",
    "prefabs",
    "content",
    "data",
    "e2e",
    "examples",
    "example",
    "samples",
    "fixtures",
    "generated",
    "types",
    "styles",
    "css",
    "locales",
    "i18n",
    "plan",
    "decisions",
    "github",
    "ci",
    "editor",
    "internal",
    "pkg",
    "cmd",
];

/// Common features, found by the words of the paths that implement them.
const FEATURE_WORDS: &[(&str, &str, &[&str])] = &[
    ("player", "Player", &["player"]),
    ("npc", "NPCs", &["npc", "villager", "ally", "companion"]),
    (
        "enemies",
        "Enemies",
        &["enemy", "enemie", "mob", "monster", "boss"],
    ),
    (
        "ai-behaviour",
        "AI behaviour",
        &[
            "behavior",
            "behaviour",
            "pathfinding",
            "navmesh",
            "fsm",
            "blackboard",
            "steering",
        ],
    ),
    (
        "combat",
        "Combat",
        &[
            "combat",
            "weapon",
            "damage",
            "attack",
            "gun",
            "bullet",
            "projectile",
            "health",
        ],
    ),
    (
        "inventory",
        "Inventory and items",
        &["inventory", "loot", "pickup"],
    ),
    (
        "dialogue",
        "Dialogue",
        &["dialogue", "conversation", "subtitle"],
    ),
    ("quests", "Quests", &["quest", "mission", "objective"]),
    (
        "saving",
        "Saving and loading",
        &["save", "savegame", "savedata", "saving", "checkpoint"],
    ),
    (
        "input",
        "Input and controls",
        &[
            "input", "controls", "keybind", "keymap", "shortcut", "gamepad",
        ],
    ),
    ("camera", "Camera", &["camera"]),
    (
        "physics",
        "Physics and collisions",
        &["physics", "collision", "rigidbody", "collider"],
    ),
    (
        "audio",
        "Sound and music",
        &["sfx", "audio", "sound", "music"],
    ),
    (
        "animation",
        "Animation",
        &["animation", "animator", "tween", "anim"],
    ),
    (
        "levels",
        "Levels and worlds",
        &["level", "world", "stage", "tilemap"],
    ),
    ("spawning", "Spawning", &["spawn", "spawner", "wave"]),
    (
        "multiplayer",
        "Multiplayer",
        &[
            "multiplayer",
            "netcode",
            "lobby",
            "matchmaking",
            "splitscreen",
        ],
    ),
    (
        "search",
        "Search",
        &["search", "finder", "matcher", "fuzzy"],
    ),
    (
        "notifications",
        "Notifications",
        &["notification", "toast", "alert"],
    ),
    (
        "payments",
        "Payments",
        &["payment", "billing", "checkout", "invoice"],
    ),
    ("uploads", "File uploads", &["upload"]),
    ("export", "Export", &["export", "exporter"]),
    ("editor", "Editing", &["editor", "edit"]),
    ("chat", "Chat", &["chat", "message", "conversation"]),
    ("themes", "Themes", &["theme"]),
    (
        "localization",
        "Localization",
        &["i18n", "l10n", "locale", "translation", "localization"],
    ),
    ("analytics", "Analytics", &["analytics", "tracking"]),
    (
        "onboarding",
        "Onboarding",
        &["onboarding", "tutorial", "welcome"],
    ),
    ("history", "History and undo", &["history", "undo", "redo"]),
    (
        "preview",
        "Preview and rendering",
        &["preview", "render", "renderer"],
    ),
    ("diff", "Diffs and review", &["diff", "review"]),
];

/// The subjects of a project: the global concepts first, then its features.
pub fn propose(profile: &ProjectProfile, corpus: &Corpus) -> Vec<Subject> {
    let name = profile.name.as_str();
    let mut b = Builder {
        corpus,
        out: Vec::new(),
        claimed: Vec::new(),
    };
    let text: Vec<&CorpusFile> = corpus
        .files
        .values()
        .filter(|f| !f.binary && !is_metadata(&f.path))
        .collect();
    let code: Vec<&CorpusFile> = text
        .iter()
        .copied()
        .filter(|f| !f.markdown && !is_test_path(&f.path))
        // Stylesheets name design tokens and themes, not the concepts of the code.
        .filter(|f| {
            !f.language
                .is_some_and(|l| matches!(l, "CSS" | "SCSS" | "Sass" | "Less"))
        })
        .collect();
    let find = |pred: &dyn Fn(&CorpusFile) -> bool| -> Vec<&CorpusFile> {
        text.iter().copied().filter(|f| pred(f)).collect()
    };
    let fill = |s: &str| s.replace("{name}", name);

    // Architecture: README, architecture, the main manifest, the program's entry points.
    let manifests: Vec<String> = [
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "go.mod",
        "pubspec.yaml",
        "project.godot",
        "Packages/manifest.json",
        "requirements.txt",
    ]
    .into_iter()
    .filter(|m| corpus.files.contains_key(*m))
    .map(str::to_owned)
    .collect();
    let mut entries: Vec<&CorpusFile> = code
        .iter()
        .copied()
        .filter(|f| {
            let file = f.path.rsplit('/').next().unwrap_or(&f.path).to_lowercase();
            f.path.matches('/').count() <= 2
                && ["main.", "lib.rs", "index.", "app.", "program.cs", "game."]
                    .iter()
                    .any(|p| file.starts_with(p))
                && f.language.is_some_and(|l| l != "CSS" && l != "HTML")
        })
        .collect();
    entries.sort_by_key(|f| (f.path.matches('/').count(), f.path.clone()));
    let entry_paths: Vec<String> = {
        // One per top-level folder: a Tauri app's `src/` and `src-tauri/`.
        let mut tops = BTreeSet::new();
        let mut out: Vec<String> = entries
            .iter()
            .filter(|f| tops.insert(f.path.split('/').next().unwrap_or_default()))
            .take(2)
            .map(|f| f.path.clone())
            .collect();
        if out.is_empty()
            && let Some(module) = profile.modules.first()
        {
            out.extend(
                pick_anchors(text_under(corpus, &module.path))
                    .into_iter()
                    .take(1),
            );
        }
        out
    };
    {
        let mut anchors: Vec<String> = Vec::new();
        anchors.extend(profile.docs.readme.clone());
        anchors.extend(profile.docs.architecture.clone());
        anchors.extend(manifests.iter().take(1).cloned());
        anchors.extend(entry_paths.iter().cloned());
        anchors.truncate(MAX_ANCHORS);
        let material: Vec<&CorpusFile> =
            anchors.iter().filter_map(|a| corpus.files.get(a)).collect();
        let material = if material.len() >= 2 {
            material
        } else {
            text.clone()
        };
        b.add(
            SubjectGroup::Global,
            "concept:architecture".into(),
            "Architecture".into(),
            fill("the architecture of {name}: what it does, its main parts and their responsibilities, how they communicate, and the boundaries between them"),
            anchors,
            &material,
        );
    }

    // Tech stack: the engines, frameworks and languages, and where the code relies on them.
    {
        let mut stack: Vec<String> = profile.engines.iter().map(|e| e.value.clone()).collect();
        stack.extend(profile.frameworks.iter().map(|f| f.value.clone()));
        stack.extend(
            profile
                .languages
                .iter()
                .filter(|l| l.programming)
                .take(3)
                .map(|l| l.name.clone()),
        );
        if !stack.is_empty() && !code.is_empty() {
            let mut anchors = manifests.clone();
            anchors.extend(entry_paths.iter().cloned());
            anchors.truncate(MAX_ANCHORS);
            b.add(
                SubjectGroup::Global,
                "concept:stack".into(),
                "Tech stack".into(),
                format!(
                    "the technologies {name} is built with ({}): why each one is there, where the code relies on it, how they are wired together and configured",
                    stack.join(", ")
                ),
                anchors,
                &text,
            );
        }
    }

    // The engine's or framework's own model, applied to this project.
    let engines: Vec<&str> = profile.engines.iter().map(|e| e.value.as_str()).collect();
    let frameworks: Vec<&str> = profile
        .frameworks
        .iter()
        .map(|f| f.value.as_str())
        .collect();
    let starts = |prefix: &str| engines.iter().any(|e| e.starts_with(prefix));
    {
        let mut domain = |id: &str, title: &str, focus: &str, files: Vec<&CorpusFile>| {
            let anchors = pick_anchors(files.iter().copied());
            b.add(
                SubjectGroup::Global,
                format!("domain:{id}"),
                title.to_owned(),
                fill(focus),
                anchors,
                &files,
            );
        };
        if starts("Godot") {
            domain(
                "godot",
                "Godot scenes, nodes and signals",
                "how {name}'s scenes are composed, which scripts drive which nodes, and how signals connect them",
                find(&|f| matches!(f.path.rsplit('.').next(), Some("gd" | "tscn" | "cs"))),
            );
        }
        if starts("Unity") {
            domain(
                "unity",
                "Unity components, scenes and assets",
                "how {name}'s MonoBehaviours, components, scenes and ScriptableObjects fit together",
                find(&|f| f.path.ends_with(".cs") || f.path.ends_with(".asmdef")),
            );
        }
        if starts("Unreal") {
            domain(
                "unreal",
                "Unreal gameplay framework",
                "{name}'s Actors, Components, GameMode and modules, and how they interact",
                find(&|f| {
                    let l = f.path.to_lowercase();
                    l.ends_with(".h")
                        || l.ends_with(".cpp")
                        || l.ends_with(".build.cs")
                        || l.ends_with(".ini")
                }),
            );
        }
        if starts("Bevy") {
            domain(
                "bevy",
                "Bevy systems, components and resources",
                "how {name}'s ECS is organised: its plugins, systems, components, resources and schedules",
                find(&|f| f.path.ends_with(".rs")),
            );
        }
        if frameworks.contains(&"Tauri") || frameworks.contains(&"Electron") {
            domain(
                "ipc",
                "UI and backend boundary",
                "the boundary between {name}'s user interface and its native backend: the commands, events and types that cross it, and what each side is responsible for",
                find(&|f| {
                    path_has(&f.path, &["ipc", "command", "preload", "bridge", "invoke"])
                        && !is_test_path(&f.path)
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
                "API design",
                "the routes or RPCs {name} exposes, how a request is handled end to end, and where the data comes from",
                find(&|f| {
                    let l = f.path.to_lowercase();
                    (path_has(
                        &l,
                        &[
                            "route",
                            "handler",
                            "controller",
                            "api",
                            "endpoint",
                            "views",
                            "urls",
                        ],
                    ) || l.ends_with(".proto"))
                        && !is_test_path(&l)
                }),
            );
        }
    }

    // The concepts the code shows it implements.
    for c in CONCEPTS {
        let files: Vec<&CorpusFile> = code
            .iter()
            .copied()
            .filter(|f| path_has(&f.path, c.words))
            .collect();
        b.add(
            SubjectGroup::Global,
            format!("concept:{}", c.id),
            c.title.to_owned(),
            fill(c.focus),
            pick_anchors(files.iter().copied()),
            &files,
        );
    }

    // Decisions, build and tests.
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
            SubjectGroup::Global,
            "concept:decisions".into(),
            "Design decisions".into(),
            format!("the decisions recorded in {dir}: what {name} chose, what it rejected, and where the code follows them"),
            anchors,
            &adrs,
        );
    }
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
            SubjectGroup::Global,
            "concept:build".into(),
            "Build, CI and release".into(),
            format!("how {name} is built, checked in CI, packaged and released: the scripts, the build configuration and the workflows"),
            anchors,
            &files,
        );
    }
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
            SubjectGroup::Global,
            "concept:testing".into(),
            "Testing strategy".into(),
            format!("what {name}'s tests cover and what they do not, how they are organised, and the helpers, fixtures and mocks they share"),
            anchors,
            &files,
        );
    }

    // Features. 1) Feature pages, each with the code that shares its name.
    for page in &profile.docs.feature_pages {
        if b.features() >= MAX_FEATURE_SUBJECTS {
            break;
        }
        let s = stem(page).to_lowercase();
        let words: Vec<&str> = s
            .split(['-', '_'])
            .filter(|w| w.len() >= 3 && !STOP_WORDS.contains(w))
            .collect();
        let score = |f: &CorpusFile| {
            let segments = words_of(&f.path);
            words
                .iter()
                .filter(|w| segments.iter().any(|s| s.starts_with(*w)))
                .count()
        };
        let candidates: Vec<(&CorpusFile, usize)> = code
            .iter()
            .copied()
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
        let title = humanize(stem(page));
        b.add(
            SubjectGroup::Feature,
            format!("feature:{page}"),
            title.clone(),
            format!("the {} feature of {name} as described in {page}: how it works end to end in the code, the parts involved and how they collaborate", title.to_lowercase()),
            anchors,
            &material,
        );
    }

    // 2) Feature folders (`src/features/quiz`), and a game's own top-level folders (`player/`).
    let game = profile.kinds.iter().any(|k| k.value == ProjectKind::Game);
    let mut folders: Vec<String> = Vec::new();
    for f in &code {
        let segments: Vec<&str> = f.path.split('/').collect();
        if segments.len() < 2 {
            continue;
        }
        for i in 0..segments.len() - 1 {
            let parent = segments[i].to_lowercase();
            let is_feature_dir =
                FEATURE_PARENTS.contains(&parent.as_str()) && i + 2 < segments.len();
            let folder = if is_feature_dir {
                segments[..=i + 1].join("/")
            } else if game && i == 0 && segments.len() > 1 {
                segments[0].to_owned()
            } else {
                continue;
            };
            let last = folder.rsplit('/').next().unwrap_or(&folder).to_lowercase();
            if !GENERIC_FOLDERS.contains(&last.as_str()) && !folders.contains(&folder) {
                folders.push(folder);
            }
        }
    }
    // The folders with the most code first.
    let size_of = |dir: &str| -> u64 { text_under(corpus, dir).map(|f| f.size).sum() };
    folders.sort_by_key(|d| std::cmp::Reverse(size_of(d)));
    for dir in folders {
        if b.features() >= MAX_FEATURE_SUBJECTS {
            break;
        }
        let files: Vec<&CorpusFile> = text_under(corpus, &dir).collect();
        let last = dir.rsplit('/').next().unwrap_or(&dir);
        let title = humanize(last);
        b.add(
            SubjectGroup::Feature,
            format!("feature:{dir}"),
            title.clone(),
            format!("how {} works in {name} (the code in {dir}): what it is responsible for, its main types and flow, and how it connects to the rest", title.to_lowercase()),
            pick_anchors(files.iter().copied()),
            &files,
        );
    }

    // 3) Common features, by the words of the paths that implement them.
    let mut found: Vec<(&str, &str, Vec<&CorpusFile>)> = FEATURE_WORDS
        .iter()
        .map(|(id, title, words)| {
            let files: Vec<&CorpusFile> = code
                .iter()
                .copied()
                .filter(|f| path_has(&f.path, words))
                .collect();
            (*id, *title, files)
        })
        .collect();
    found.sort_by_key(|(_, _, files)| std::cmp::Reverse(files.iter().map(|f| f.size).sum::<u64>()));
    for (id, title, files) in found {
        if b.features() >= MAX_FEATURE_SUBJECTS {
            break;
        }
        b.add(
            SubjectGroup::Feature,
            format!("feature:{id}"),
            title.to_owned(),
            format!("how {} works in {name}: the parts that implement it, the flow from trigger to result, and how it connects to the rest", title.to_lowercase()),
            pick_anchors(files.iter().copied()),
            &files,
        );
    }
    b.out
}

/// The anchors of a subject the developer typed: the files whose path words match the words of
/// the subject (most matches first), else nothing (the default anchors then apply).
pub fn custom_anchors(corpus: &Corpus, subject: &str) -> Vec<String> {
    let words: Vec<String> = subject
        .split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|w| w.len() >= 3 && !STOP_WORDS.contains(&w.as_str()))
        .collect();
    if words.is_empty() {
        return Vec::new();
    }
    let refs: Vec<&str> = words.iter().map(String::as_str).collect();
    let mut matched: Vec<(&CorpusFile, usize)> = corpus
        .files
        .values()
        .filter(|f| !f.binary)
        .map(|f| {
            let path = words_of(&f.path);
            let n = refs
                .iter()
                .filter(|w| {
                    path.iter()
                        .any(|p| p == *w || p.strip_suffix('s') == Some(*w))
                })
                .count();
            (f, n)
        })
        .filter(|(_, n)| *n > 0)
        .collect();
    let best = matched.iter().map(|(_, n)| *n).max().unwrap_or(0);
    matched.retain(|(_, n)| *n == best);
    pick_anchors(matched.into_iter().map(|(f, _)| f))
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
            ("mobs/mob_spawner.gd", &gd),
            ("main.gd", &gd),
        ]);
        assert!(ids(&s).contains(&"domain:godot"), "{:?}", ids(&s));
        let godot = s.iter().find(|s| s.id == "domain:godot").unwrap();
        assert_eq!(godot.title, "Godot scenes, nodes and signals");
        assert_eq!(godot.group, SubjectGroup::Global);
        assert!(godot.anchors.iter().all(|a| !a.ends_with(".png")));
        assert_eq!(s[0].id, "concept:architecture");
        // A game's own folders are its features; the same files are not proposed twice.
        let features: Vec<&str> = s
            .iter()
            .filter(|s| s.group == SubjectGroup::Feature)
            .map(|s| s.title.as_str())
            .collect();
        assert!(features.contains(&"Player"), "{features:?}");
        assert!(features.contains(&"Mobs"), "{features:?}");
        assert!(!features.contains(&"Enemies"), "{features:?}");
    }

    #[test]
    fn concepts_and_features_have_names_not_paths() {
        let ts = code(60);
        let s = subjects(&[
            (
                "package.json",
                r#"{"name":"shop","dependencies":{"react":"19"}}"#,
            ),
            ("README.md", &"A shop.\n".repeat(60)),
            ("src/main.tsx", &ts),
            ("src/auth/login.ts", &ts),
            ("src/auth/sessionGuard.ts", &ts),
            ("src/features/cart/Cart.tsx", &ts),
            ("src/features/cart/cartStore.ts", &ts),
            ("src/features/checkout/Checkout.tsx", &ts),
            ("src/features/checkout/payment.ts", &ts),
            ("src/db/schema.ts", &ts),
            ("src/db/migrations.ts", &ts),
            ("src/styles/tokens.css", &ts),
            ("src/styles/theme.css", &ts),
        ]);
        let titles: Vec<(&str, SubjectGroup)> =
            s.iter().map(|s| (s.title.as_str(), s.group)).collect();
        for t in ["Architecture", "Tech stack", "Security", "Data and storage"] {
            assert!(
                titles.contains(&(t, SubjectGroup::Global)),
                "{t} in {titles:?}"
            );
        }
        for t in ["Cart", "Checkout"] {
            assert!(
                titles.contains(&(t, SubjectGroup::Feature)),
                "{t} in {titles:?}"
            );
        }
        assert!(s.iter().all(|s| !s.title.contains('/')), "{titles:?}");
        let security = s.iter().find(|s| s.id == "concept:security").unwrap();
        assert!(
            security.anchors.iter().all(|a| !a.ends_with(".css")),
            "design tokens are not security: {:?}",
            security.anchors
        );
        // A typed subject starts from the files its words name.
        let dir = tree(&[("src/save/saveGame.ts", &ts), ("src/main.ts", &ts)]);
        let (_, walk) = build(dir.path(), &[], &AtomicBool::new(false));
        let corpus = Corpus::build(dir.path(), &walk, &SourceScope::WholeProject, &[]);
        assert_eq!(
            custom_anchors(&corpus, "How saving the game works"),
            vec!["src/save/saveGame.ts".to_owned()]
        );
        assert!(custom_anchors(&corpus, "the").is_empty());
        assert_eq!(
            words_of("Scripts/PlayerController.cs"),
            ["scripts", "player", "controller", "cs"]
        );
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
            "concept:architecture",
            "feature:docs/features/search.md",
            "concept:decisions",
            "concept:build",
            "concept:testing",
        ] {
            assert!(found.contains(&id), "{id} in {found:?}");
        }
        let feature = s.iter().find(|s| s.id.starts_with("feature:")).unwrap();
        assert_eq!(feature.title, "Search");
        assert_eq!(feature.anchors[0], "docs/features/search.md");
        assert!(
            feature
                .anchors
                .contains(&"src/search/matcher.ts".to_owned())
        );
        assert!(feature.has_docs);
        // The keyword feature "Search" is the same subject: proposed once.
        assert_eq!(s.iter().filter(|s| s.title == "Search").count(), 1);
        // pick_anchors: the entry file first, tests last.
        let dir = tree(&[
            ("src/search/index.ts", &rs),
            ("src/search/matcher.ts", &rs),
            ("src/search/matcher.test.ts", &rs),
        ]);
        let (_, walk) = build(dir.path(), &[], &AtomicBool::new(false));
        let corpus = Corpus::build(dir.path(), &walk, &SourceScope::WholeProject, &[]);
        let anchors = pick_anchors(corpus.files.values());
        assert_eq!(anchors[0], "src/search/index.ts", "the entry file first");
        assert_eq!(
            anchors.last().unwrap(),
            "src/search/matcher.test.ts",
            "tests last"
        );
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
            "concept:architecture",
            "concept:stack",
            "domain:ipc",
            "concept:security",
            "concept:decisions",
            "concept:build",
            "concept:testing",
            "feature:docs/features/quiz.md",
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

    /// Prints the subjects of any folder (no AI): `IGRASP_SUBJECTS_ROOT=<folder> cargo test
    /// --manifest-path src-tauri/Cargo.toml print_subjects -- --ignored --nocapture`.
    #[test]
    #[ignore = "prints the subjects of IGRASP_SUBJECTS_ROOT"]
    fn print_subjects() {
        let Some(root) = std::env::var_os("IGRASP_SUBJECTS_ROOT") else {
            return;
        };
        let root = std::path::PathBuf::from(root);
        let (profile, walk) = build(&root, &[], &AtomicBool::new(false));
        let corpus = Corpus::build(&root, &walk, &SourceScope::WholeProject, &[]);
        println!("PROFILE {}", profile.summary);
        let subjects = propose(&profile, &corpus);
        for s in &subjects {
            println!("{:?} | {} | {} | {:?}", s.group, s.id, s.title, s.anchors);
        }
        // The Academy's cards, built on the same detection.
        let cards = crate::learning::tutorial::families::build(&profile, &corpus, &subjects);
        println!("\nACADEMY too_thin={}", cards.too_thin);
        for c in &cards.cards {
            println!(
                "{:?} | {} | {} | {} | {:?} | picks {:?} | gap {:?}",
                c.kind,
                c.id,
                c.title,
                c.blurb,
                c.anchors,
                c.picks.iter().map(|p| &p.title).collect::<Vec<_>>(),
                c.domain
            );
        }
        println!("DOMAINS {:?}", cards.domains);
    }

    #[test]
    fn humanized_titles() {
        assert_eq!(humanize("ai-chat"), "AI chat");
        assert_eq!(humanize("markdown-preview"), "Markdown preview");
    }
}
