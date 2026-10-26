//! The Academy's subject cards (ADR 0028), built locally from the corrected project profile, the
//! corpus and the quiz's subject detection: no AI, no token. Two kinds of families:
//!
//! - **universal** families any project can have (The Big Picture, Tech Stack, Architecture
//!   Tour, Feature Deep Dive, Trace It, Dependencies, Build Run Test Ship, Conventions and
//!   Patterns, Decisions, Your First Contribution, Project Story, Glossary);
//! - **domain** families from the profile's kinds and engines (games, web, mobile, services,
//!   libraries / CLIs / desktop apps, data / ML / infrastructure / embedded), one card per topic
//!   the project has files about.
//!
//! A card is offered only when the project has enough material for it, and its title and blurb
//! are phrased about this project (its name, its files), never a bare family name. The domains
//! the reader may lack ("I'm new to …") come from the same detection.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::learning::corpus::{Corpus, CorpusFile};
use crate::learning::subjects::{
    MIN_BYTES, MIN_FILES, Material, RICH_BYTES, Subject, SubjectGroup, is_metadata, is_test_path,
    path_has, pick_anchors,
};
use crate::profile::{ProjectKind, ProjectProfile};

/// Cards at most.
pub const MAX_CARDS: usize = 24;
/// Picks of a card at most (features of a Deep Dive, actions of a Trace It).
pub const MAX_PICKS: usize = 6;
/// Anchors of a card at most.
const MAX_ANCHORS: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FamilyKind {
    Universal,
    Domain,
    /// Proposed by the AI ("Suggest more subjects"), kept with the folder.
    Suggested,
}

/// One option of a card that needs a pick (a feature to dive into, an action to trace).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SubjectPick {
    pub id: String,
    /// "The quiz", "A file changes on disk".
    pub title: String,
    pub anchors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TutorialSubject {
    /// Stable within a folder: `family:big-picture`, `domain:web:auth`, `suggested:3`.
    pub id: String,
    pub kind: FamilyKind,
    /// The family's name, for grouping: "The Big Picture", "Web", "Suggested".
    pub family: String,
    /// Phrased about this project: "How igrasp fits together, in 5 minutes".
    pub title: String,
    /// One line: what the tutorial covers here.
    pub blurb: String,
    /// What the generator focuses on (sent in the prompt).
    pub focus: String,
    /// The files the generator starts from (inlined), most relevant first.
    pub anchors: Vec<String>,
    pub material: Material,
    /// A card that needs a pick (Feature Deep Dive, Trace It): its options.
    pub picks: Vec<SubjectPick>,
    /// The domain this card teaches, pre-filling "I'm new to…" when chosen.
    pub domain: Option<String>,
    /// The role a suggested card was written for ("Level designer"); absent on the local cards
    /// and on suggestions made before roles (for developers).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub for_role: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TutorialSubjects {
    pub cards: Vec<TutorialSubject>,
    /// Domains the reader may lack, for "I'm new to…": engines, frameworks, domain topics.
    pub domains: Vec<String>,
    /// Too little material for any tutorial (an empty or binary-only folder).
    pub too_thin: bool,
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// "from `a`, `b`" for a blurb: where the tutorial starts, so a card names the project's files.
fn from_files(anchors: &[String]) -> String {
    let short = |a: &String| {
        // `mod.rs` and `mod.rs` say nothing: name the folder too when the names repeat.
        let same = anchors
            .iter()
            .take(2)
            .filter(|b| file_name(b) == file_name(a))
            .count()
            > 1;
        if same {
            let mut parts: Vec<&str> = a.rsplit('/').take(2).collect();
            parts.reverse();
            parts.join("/")
        } else {
            file_name(a).to_owned()
        }
    };
    let names: Vec<String> = anchors
        .iter()
        .take(2)
        .map(|a| format!("`{}`", short(a)))
        .collect();
    match names.as_slice() {
        [] => String::new(),
        [one] => format!(", from {one}"),
        [a, b, ..] => format!(", from {a} and {b}"),
    }
}

fn material_of(files: &[&CorpusFile]) -> Option<Material> {
    let n = u32::try_from(files.len()).unwrap_or(u32::MAX);
    let bytes: u64 = files.iter().map(|f| f.size).sum();
    if n < MIN_FILES || bytes < MIN_BYTES {
        return None;
    }
    Some(if bytes >= RICH_BYTES {
        Material::Rich
    } else {
        Material::Some
    })
}

/// A domain topic: shown when the project has files whose path words match.
struct Topic {
    id: &'static str,
    /// The topic in a sentence: `{name}` is the project's name.
    title: &'static str,
    /// What the generator focuses on.
    focus: &'static str,
    /// The domain for "I'm new to…" (`{engine}` is the game's engine, or "game").
    gap: &'static str,
    words: &'static [&'static str],
    /// File extensions that count as material on their own (shaders, scenes, protos).
    extensions: &'static [&'static str],
}

struct Domain {
    id: &'static str,
    family: &'static str,
    topics: &'static [Topic],
}

const GAMES: Domain = Domain {
    id: "game",
    family: "Games",
    topics: &[
        Topic {
            id: "loop",
            title: "The game loop and tick order in {name}",
            focus: "what runs every frame in {name}, in which order (update, physics, late or post steps), and which objects tick",
            gap: "{engine} game loops",
            words: &["tick", "update", "loop", "process", "frame", "timer"],
            extensions: &[],
        },
        Topic {
            id: "input",
            title: "How {name} reads player input",
            focus: "how {name} maps devices to actions, where input is read and routed, and how it reaches the player or the UI",
            gap: "{engine} input",
            words: &[
                "input",
                "controls",
                "keybind",
                "gamepad",
                "action",
                "controller",
            ],
            extensions: &[],
        },
        Topic {
            id: "player",
            title: "The player in {name}",
            focus: "how {name}'s player character or pawn is built: its components or nodes, its state and how it is controlled",
            gap: "{engine} characters",
            words: &["player", "character", "pawn", "hero"],
            extensions: &[],
        },
        Topic {
            id: "rendering",
            title: "Rendering, materials and shaders in {name}",
            focus: "how {name} draws things: its materials and shaders, lighting and post-processing, as its files show them",
            gap: "{engine} materials and shaders",
            words: &[
                "material",
                "shader",
                "render",
                "lighting",
                "postprocess",
                "vfx",
            ],
            extensions: &[
                "gdshader", "shader", "hlsl", "glsl", "usf", "ush", "wgsl", "compute",
            ],
        },
        Topic {
            id: "assets",
            title: "How {name}'s content and assets are organised",
            focus: "the asset pipeline and content layout of {name}: where assets live, how they are imported and referenced (binary assets by name and folder only)",
            gap: "{engine} asset pipelines",
            words: &[
                "asset", "content", "import", "resource", "prefab", "pipeline",
            ],
            extensions: &["tres", "asset", "uasset"],
        },
        Topic {
            id: "levels",
            title: "Levels and scenes in {name}",
            focus: "how {name}'s levels, maps or scenes are built and loaded, and what each one holds",
            gap: "{engine} scenes and levels",
            words: &["level", "map", "world", "scene", "stage", "tilemap"],
            extensions: &["tscn", "unity", "umap"],
        },
        Topic {
            id: "networking",
            title: "Networking and replication in {name}",
            focus: "how {name} synchronizes state over the network: what is replicated, what runs on the server or the client, the RPCs and their authority",
            gap: "{engine} networking and replication",
            words: &[
                "replication",
                "replicated",
                "multiplayer",
                "netcode",
                "rpc",
                "network",
                "server",
                "lobby",
            ],
            extensions: &[],
        },
        Topic {
            id: "save",
            title: "Saving and loading in {name}",
            focus: "what {name} saves, where and in which format, and how a save is loaded back",
            gap: "{engine} save systems",
            words: &["save", "savegame", "load", "checkpoint", "persistence"],
            extensions: &[],
        },
        Topic {
            id: "ui",
            title: "{name}'s menus and HUD",
            focus: "how {name}'s UI is built: its menus, HUD and widgets, and how they read game state",
            gap: "{engine} UI",
            words: &["ui", "hud", "menu", "widget", "gui"],
            extensions: &[],
        },
        Topic {
            id: "ai",
            title: "How {name}'s AI decides",
            focus: "how {name}'s non-player characters decide what to do: behaviour trees, state machines, navigation and perception as the project implements them",
            gap: "{engine} AI and behaviour trees",
            words: &[
                "ai",
                "behavior",
                "behaviour",
                "blackboard",
                "navmesh",
                "pathfinding",
                "fsm",
                "enemy",
                "npc",
            ],
            extensions: &[],
        },
        Topic {
            id: "physics",
            title: "Physics and collisions in {name}",
            focus: "how {name} uses physics: bodies, collision layers and the responses to a hit",
            gap: "{engine} physics",
            words: &["physics", "collision", "rigidbody", "collider", "hitbox"],
            extensions: &[],
        },
        Topic {
            id: "audio",
            title: "Sound and music in {name}",
            focus: "how {name} plays sound and music: buses, cues and what triggers them",
            gap: "{engine} audio",
            words: &["audio", "sound", "music", "sfx"],
            extensions: &[],
        },
        Topic {
            id: "targets",
            title: "{name}'s platforms and build targets",
            focus: "the platforms {name} ships to and how each build is configured",
            gap: "{engine} builds and platforms",
            words: &["export", "target", "platform", "build", "presets"],
            extensions: &["cfg"],
        },
        Topic {
            id: "performance",
            title: "Performance budgets in {name}",
            focus: "where {name} cares about performance: pooling, LODs, profiling hooks and budgets, as the code shows them",
            gap: "{engine} performance",
            words: &[
                "pool",
                "pooling",
                "profiler",
                "perf",
                "budget",
                "lod",
                "optimization",
            ],
            extensions: &[],
        },
    ],
};

const WEB: Domain = Domain {
    id: "web",
    family: "Web",
    topics: &[
        Topic {
            id: "routing",
            title: "How {name} routes a URL to its code",
            focus: "{name}'s routes: how a URL or path reaches its page or handler, and the conventions of the router",
            gap: "web routing",
            words: &["route", "router", "routes", "urls", "pages", "app"],
            extensions: &[],
        },
        Topic {
            id: "rendering",
            title: "{name}'s rendering strategy",
            focus: "where {name} renders (server, static, client), what each page does at build or request time, and why",
            gap: "server and client rendering",
            words: &[
                "ssr", "ssg", "render", "layout", "page", "hydrate", "loader",
            ],
            extensions: &[],
        },
        Topic {
            id: "state",
            title: "State management in {name}",
            focus: "where {name}'s client state lives, who changes it and how it reaches the components",
            gap: "front-end state management",
            words: &[
                "store", "state", "redux", "zustand", "context", "signal", "slice",
            ],
            extensions: &[],
        },
        Topic {
            id: "api",
            title: "{name}'s API and its contracts",
            focus: "the endpoints {name} exposes or calls, their request and response shapes, and how both sides agree on them",
            gap: "API design",
            words: &[
                "api",
                "endpoint",
                "controller",
                "handler",
                "schema",
                "openapi",
                "client",
            ],
            extensions: &["proto", "graphql"],
        },
        Topic {
            id: "auth",
            title: "Authentication and authorization in {name}",
            focus: "how {name} knows who the user is and what they may do: login, sessions or tokens, and where access is checked",
            gap: "web authentication",
            words: &[
                "auth",
                "login",
                "session",
                "token",
                "jwt",
                "oauth",
                "permission",
                "user",
            ],
            extensions: &[],
        },
        Topic {
            id: "security",
            title: "How {name} handles web security",
            focus: "how {name} validates input, escapes output, protects against CSRF and XSS, sets CORS and CSP, and keeps its secrets",
            gap: "web security",
            words: &[
                "security",
                "csrf",
                "xss",
                "sanitize",
                "csp",
                "cors",
                "validation",
                "validator",
                "secret",
            ],
            extensions: &[],
        },
        Topic {
            id: "data",
            title: "Data access and migrations in {name}",
            focus: "how {name} talks to its database: models, queries or ORM, migrations and transactions",
            gap: "ORMs and migrations",
            words: &[
                "db",
                "database",
                "model",
                "orm",
                "migration",
                "repository",
                "sql",
                "prisma",
            ],
            extensions: &["sql"],
        },
        Topic {
            id: "caching",
            title: "Caching in {name}",
            focus: "what {name} caches, where, for how long, and how it is invalidated",
            gap: "web caching",
            words: &["cache", "caching", "redis", "memo"],
            extensions: &[],
        },
        Topic {
            id: "jobs",
            title: "Background jobs in {name}",
            focus: "the work {name} does outside a request: jobs, queues, schedules and workers",
            gap: "background jobs",
            words: &[
                "job",
                "worker",
                "queue",
                "task",
                "celery",
                "cron",
                "scheduler",
            ],
            extensions: &[],
        },
        Topic {
            id: "observability",
            title: "Logging and monitoring in {name}",
            focus: "what {name} logs, measures and traces, and how a problem in production is found",
            gap: "observability",
            words: &[
                "log",
                "logging",
                "logger",
                "metrics",
                "tracing",
                "sentry",
                "telemetry",
            ],
            extensions: &[],
        },
        Topic {
            id: "deployment",
            title: "How {name} is deployed",
            focus: "how {name} is packaged and deployed: containers, environments, configuration per environment",
            gap: "deployment",
            words: &[
                "docker",
                "dockerfile",
                "deploy",
                "k8s",
                "helm",
                "compose",
                "vercel",
                "netlify",
            ],
            extensions: &[],
        },
    ],
};

const MOBILE: Domain = Domain {
    id: "mobile",
    family: "Mobile",
    topics: &[
        Topic {
            id: "navigation",
            title: "{name}'s screens and navigation",
            focus: "how {name} is organised in screens and how navigation between them works",
            gap: "mobile navigation",
            words: &["navigation", "router", "route", "screen", "screens", "page"],
            extensions: &[],
        },
        Topic {
            id: "bridges",
            title: "Native code and platform bridges in {name}",
            focus: "where {name} talks to the platform: native modules, channels, plugins, and the iOS and Android specific code",
            gap: "mobile platform bridges",
            words: &[
                "native", "bridge", "plugin", "channel", "platform", "ios", "android",
            ],
            extensions: &["swift", "kt", "m"],
        },
        Topic {
            id: "offline",
            title: "Offline data and sync in {name}",
            focus: "what {name} keeps on the device, how it syncs with the server and resolves conflicts",
            gap: "offline-first mobile apps",
            words: &[
                "offline",
                "sync",
                "storage",
                "cache",
                "database",
                "repository",
            ],
            extensions: &[],
        },
        Topic {
            id: "permissions",
            title: "Permissions in {name}",
            focus: "which device permissions {name} asks for, when and how a refusal is handled",
            gap: "mobile permissions",
            words: &["permission", "permissions", "manifest", "plist"],
            extensions: &[],
        },
        Topic {
            id: "push",
            title: "Push notifications in {name}",
            focus: "how {name} registers for, receives and shows push notifications",
            gap: "push notifications",
            words: &["push", "notification", "fcm", "apns", "messaging"],
            extensions: &[],
        },
        Topic {
            id: "lifecycle",
            title: "The app lifecycle in {name}",
            focus: "what {name} does when it starts, goes to the background and comes back",
            gap: "mobile app lifecycles",
            words: &["lifecycle", "appstate", "main", "startup", "splash"],
            extensions: &[],
        },
        Topic {
            id: "release",
            title: "How {name} reaches the stores",
            focus: "how {name} is built, signed and released to the stores",
            gap: "mobile releases",
            words: &[
                "fastlane", "release", "signing", "gradle", "podfile", "store",
            ],
            extensions: &[],
        },
    ],
};

const SERVICES: Domain = Domain {
    id: "service",
    family: "Services and back ends",
    topics: &[
        Topic {
            id: "boundaries",
            title: "{name}'s service boundaries",
            focus: "the services {name} is made of or talks to, what each owns, and the contracts between them",
            gap: "service-oriented architecture",
            words: &[
                "service", "services", "api", "grpc", "proto", "client", "gateway",
            ],
            extensions: &["proto"],
        },
        Topic {
            id: "messaging",
            title: "Messages and events in {name}",
            focus: "the messages, queues and events {name} produces and consumes, and their delivery guarantees",
            gap: "messaging and event-driven systems",
            words: &[
                "queue", "kafka", "rabbit", "pubsub", "event", "message", "bus", "consumer",
            ],
            extensions: &[],
        },
        Topic {
            id: "persistence",
            title: "Persistence in {name}",
            focus: "what {name} stores, in which database, through which layer, and how the schema evolves",
            gap: "persistence",
            words: &[
                "db",
                "database",
                "store",
                "storage",
                "repository",
                "migration",
                "sql",
            ],
            extensions: &["sql"],
        },
        Topic {
            id: "config",
            title: "Configuration and secrets in {name}",
            focus: "where {name}'s configuration and secrets come from, their defaults and how they are validated",
            gap: "configuration and secrets management",
            words: &["config", "settings", "env", "secret", "vault", "options"],
            extensions: &[],
        },
        Topic {
            id: "resilience",
            title: "How {name} copes with failures",
            focus: "timeouts, retries, circuit breakers and fallbacks in {name}",
            gap: "resilience patterns",
            words: &[
                "retry", "circuit", "timeout", "backoff", "fallback", "health",
            ],
            extensions: &[],
        },
        Topic {
            id: "observability",
            title: "Observability in {name}",
            focus: "how {name} logs, measures and traces its work",
            gap: "observability",
            words: &["log", "logging", "metrics", "tracing", "telemetry", "otel"],
            extensions: &[],
        },
    ],
};

const SOFTWARE: Domain = Domain {
    id: "software",
    family: "Libraries, CLIs and desktop apps",
    topics: &[
        Topic {
            id: "api",
            title: "{name}'s public API",
            focus: "what {name} exposes to its users or other code, how it is organised and what is kept private",
            gap: "library API design",
            words: &["lib", "api", "exports", "index", "public", "mod"],
            extensions: &[],
        },
        Topic {
            id: "extension",
            title: "Extension points in {name}",
            focus: "where {name} can be extended: traits, interfaces, plugins, providers, registries, hooks",
            gap: "plugin architectures",
            words: &[
                "plugin",
                "extension",
                "hook",
                "provider",
                "providers",
                "registry",
                "trait",
            ],
            extensions: &[],
        },
        Topic {
            id: "commands",
            title: "{name}'s command structure",
            focus: "how {name}'s commands are declared, parsed and dispatched to their code",
            gap: "command-line interfaces",
            words: &["command", "commands", "cmd", "cli", "args", "subcommand"],
            extensions: &[],
        },
        Topic {
            id: "ipc",
            title: "IPC between {name}'s UI and its backend",
            focus: "the commands, events and types that cross {name}'s process boundary, and what each side owns",
            gap: "desktop IPC",
            words: &[
                "ipc", "invoke", "bridge", "preload", "command", "commands", "event",
            ],
            extensions: &[],
        },
        Topic {
            id: "packaging",
            title: "How {name} is packaged and distributed",
            focus: "how {name} is built for each platform, packaged, signed and released",
            gap: "packaging and distribution",
            words: &[
                "release",
                "package",
                "bundle",
                "installer",
                "dist",
                "workflows",
                "packaging",
            ],
            extensions: &[],
        },
    ],
};

const DATA_INFRA: Domain = Domain {
    id: "data",
    family: "Data, ML, infrastructure and embedded",
    topics: &[
        Topic {
            id: "pipelines",
            title: "{name}'s data pipelines",
            focus: "how data flows through {name}: sources, transformations, schedules and outputs",
            gap: "data pipelines",
            words: &[
                "pipeline",
                "etl",
                "dag",
                "airflow",
                "transform",
                "ingest",
                "dbt",
            ],
            extensions: &[],
        },
        Topic {
            id: "models",
            title: "Models and training in {name}",
            focus: "the models {name} trains or serves, their data, training loop and evaluation",
            gap: "machine learning workflows",
            words: &[
                "model",
                "train",
                "training",
                "dataset",
                "eval",
                "inference",
                "notebook",
            ],
            extensions: &["ipynb"],
        },
        Topic {
            id: "iac",
            title: "{name}'s infrastructure as code",
            focus: "the infrastructure {name} declares: resources, modules, state and how changes are applied",
            gap: "infrastructure as code",
            words: &[
                "terraform",
                "helm",
                "k8s",
                "kubernetes",
                "ansible",
                "pulumi",
                "chart",
            ],
            extensions: &["tf", "hcl"],
        },
        Topic {
            id: "environments",
            title: "Environments in {name}",
            focus: "the environments {name} knows (development, staging, production) and what differs between them",
            gap: "deployment environments",
            words: &[
                "env",
                "environment",
                "environments",
                "staging",
                "prod",
                "production",
                "dev",
            ],
            extensions: &[],
        },
        Topic {
            id: "hardware",
            title: "Hardware abstraction and drivers in {name}",
            focus: "how {name} talks to its hardware: the HAL, drivers, registers and board configuration",
            gap: "embedded hardware abstraction",
            words: &[
                "hal",
                "driver",
                "drivers",
                "gpio",
                "register",
                "board",
                "bsp",
                "peripheral",
            ],
            extensions: &[],
        },
    ],
};

/// The universal families' names, in display order.
pub const UNIVERSAL: &[(&str, &str)] = &[
    ("big-picture", "The Big Picture"),
    ("stack", "Tech Stack, as used here"),
    ("architecture", "Architecture Tour"),
    ("deep-dive", "Feature Deep Dive"),
    ("trace-it", "Trace It"),
    ("dependencies", "Dependencies"),
    ("build", "Build, Run, Test, Ship"),
    ("conventions", "Conventions and Patterns"),
    ("decisions", "Decisions"),
    ("first-contribution", "Your First Contribution"),
    ("project-story", "Project Story"),
    ("glossary", "Glossary"),
];

/// What each family asks the generator to do (the outline prompt's family focus).
pub fn family_focus(family_id: &str) -> Option<&'static str> {
    Some(match family_id {
        "big-picture" => {
            "The Big Picture: what this project does, its main parts and how they fit, in about five minutes. Stay at the level of folders, modules and entry points; one chapter per main part at most."
        }
        "stack" => {
            "Tech Stack, as used here: each language, engine, framework and tool this project uses, why it is there, where in the code it is wired and configured, and what this project does on top of it. Never a generic introduction to a technology."
        }
        "architecture" => {
            "Architecture Tour: the layers, modules and boundaries of this project, what each owns, and how data flows between them (follow real calls and messages)."
        }
        "deep-dive" => {
            "Feature Deep Dive: pick the feature named below and follow it end to end through this project: the entry point, the parts involved, the data, the edge cases and the tests."
        }
        "trace-it" => {
            "Trace It: follow the one action named below through this project's code, step by step, from its trigger to its visible result, naming each file and function it passes through."
        }
        "dependencies" => {
            "Dependencies: the important dependencies of this project, where it uses each one, how it wraps or configures them, and what would break without them."
        }
        "build" => {
            "Build, Run, Test, Ship: this project's scripts, build configurations, test suites, CI workflows, packaging, platforms and release process, as its files define them."
        }
        "conventions" => {
            "Conventions and Patterns: how things are done here: naming, error handling, state, testing style, code organisation, the recurring patterns and the traps to avoid, each shown in real files."
        }
        "decisions" => {
            "Decisions: the project's decision records (or design docs) told as a story: what was chosen, what was rejected and why, and where the code follows each decision."
        }
        "first-contribution" => {
            "Your First Contribution: where a change of a given kind goes in this project, a realistic first change in this codebase, and how to verify it (the tests and checks to run)."
        }
        "project-story" => {
            "Project Story: how this project evolved, from its changelog, release notes and dated decisions: the phases, the turning points and what each one added (the commit history is not available)."
        }
        "glossary" => {
            "Glossary: this project's own vocabulary and domain terms, each defined as this project uses it, with the file that shows it. Prefer match and quick check steps."
        }
        _ => return None,
    })
}

struct Cards<'a> {
    corpus: &'a Corpus,
    out: Vec<TutorialSubject>,
}

impl Cards<'_> {
    fn anchors(&self, list: impl IntoIterator<Item = String>) -> Vec<String> {
        let mut seen = BTreeSet::new();
        list.into_iter()
            .filter(|a| self.corpus.files.get(a).is_some_and(|f| !f.binary))
            .filter(|a| seen.insert(a.clone()))
            .take(MAX_ANCHORS)
            .collect()
    }

    #[allow(clippy::too_many_arguments)] // What a card is made of.
    fn universal(
        &mut self,
        id: &str,
        title: String,
        blurb: &str,
        anchors: Vec<String>,
        material: Material,
        picks: Vec<SubjectPick>,
    ) {
        let anchors = self.anchors(anchors);
        if anchors.is_empty() && picks.is_empty() {
            return;
        }
        let family = UNIVERSAL
            .iter()
            .find(|(f, _)| *f == id)
            .map_or(id, |(_, n)| *n);
        self.out.push(TutorialSubject {
            id: format!("family:{id}"),
            kind: FamilyKind::Universal,
            family: family.to_owned(),
            title,
            blurb: format!("{blurb}{}", from_files(&anchors)),
            focus: family_focus(id).unwrap_or_default().to_owned(),
            anchors,
            material,
            picks,
            domain: None,
            for_role: None,
        });
    }
}

/// The main manifests of the project, at the root.
fn manifests(corpus: &Corpus) -> Vec<String> {
    [
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "go.mod",
        "pubspec.yaml",
        "project.godot",
        "Packages/manifest.json",
        "requirements.txt",
        "build.gradle",
        "build.gradle.kts",
        "pom.xml",
        "composer.json",
        "Gemfile",
        "CMakeLists.txt",
        "platformio.ini",
        "src-tauri/Cargo.toml",
    ]
    .into_iter()
    .filter(|m| corpus.files.contains_key(*m))
    .map(str::to_owned)
    .chain(
        corpus
            .files
            .keys()
            .filter(|p| {
                let l = p.to_lowercase();
                !p.contains('/') && (l.ends_with(".uproject") || l.ends_with(".csproj"))
            })
            .cloned(),
    )
    .collect()
}

fn find_named<'a>(corpus: &'a Corpus, names: &[&str]) -> Vec<&'a CorpusFile> {
    corpus
        .files
        .values()
        .filter(|f| {
            !f.binary && {
                let n = file_name(&f.path).to_lowercase();
                names.iter().any(|w| n == *w)
            }
        })
        .collect()
}

/// The actions a Trace It card offers, from the kinds of the project and its features.
fn trace_picks(
    profile: &ProjectProfile,
    corpus: &Corpus,
    features: &[&Subject],
    entries: &[String],
) -> Vec<SubjectPick> {
    let kinds: Vec<ProjectKind> = profile.kinds.iter().map(|k| k.value).collect();
    let has = |k: ProjectKind| kinds.contains(&k);
    let code: Vec<&CorpusFile> = corpus
        .files
        .values()
        .filter(|f| !f.binary && !f.markdown && !is_test_path(&f.path) && !is_metadata(&f.path))
        .collect();
    let mut picks = Vec::new();
    let mut action = |id: &str, title: &str, words: &[&str]| {
        let files: Vec<&CorpusFile> = code
            .iter()
            .copied()
            .filter(|f| path_has(&f.path, words))
            .collect();
        if files.is_empty() {
            return;
        }
        let mut anchors = pick_anchors(files.iter().copied());
        anchors.truncate(3);
        anchors.extend(entries.iter().take(1).cloned());
        picks.push(SubjectPick {
            id: format!("action:{id}"),
            title: title.to_owned(),
            anchors,
        });
    };
    if has(ProjectKind::WebBackend) || has(ProjectKind::Service) {
        action(
            "request",
            "A request reaches the server",
            &[
                "route",
                "router",
                "handler",
                "controller",
                "api",
                "endpoint",
                "views",
            ],
        );
    }
    if has(ProjectKind::WebFrontend) {
        action(
            "page",
            "A page loads in the browser",
            &["page", "pages", "app", "route", "router", "layout"],
        );
    }
    if has(ProjectKind::Game) {
        action(
            "input",
            "The player presses a button",
            &["input", "player", "controller", "pawn", "character"],
        );
    }
    if has(ProjectKind::Cli) {
        action(
            "command",
            "A command runs from the terminal",
            &["command", "commands", "cmd", "cli", "main"],
        );
    }
    if has(ProjectKind::Desktop) {
        action(
            "ipc",
            "A click in the UI reaches the backend",
            &["ipc", "invoke", "command", "commands", "bridge", "preload"],
        );
    }
    if has(ProjectKind::Mobile) {
        action(
            "tap",
            "A tap on a screen",
            &["screen", "screens", "view", "page", "widget"],
        );
    }
    action(
        "watch",
        "A file changes on disk",
        &["watcher", "watch", "notify", "fsevents"],
    );
    action(
        "message",
        "A message arrives on a queue",
        &["consumer", "subscriber", "listener", "queue", "kafka"],
    );
    for f in features.iter().take(MAX_PICKS) {
        picks.push(SubjectPick {
            id: format!("use:{}", f.id),
            title: format!("Using {}", f.title.to_lowercase()),
            anchors: f.anchors.clone(),
        });
    }
    let mut seen = BTreeSet::new();
    picks.retain(|p| seen.insert(p.title.clone()));
    picks.truncate(MAX_PICKS);
    picks
}

/// The domains of the project's kinds and engines.
fn domains_of(profile: &ProjectProfile) -> Vec<&'static Domain> {
    let kinds: Vec<ProjectKind> = profile.kinds.iter().map(|k| k.value).collect();
    let has = |k: ProjectKind| kinds.contains(&k);
    let mut out: Vec<&'static Domain> = Vec::new();
    if has(ProjectKind::Game) || !profile.engines.is_empty() {
        out.push(&GAMES);
    }
    if has(ProjectKind::WebFrontend) || has(ProjectKind::WebBackend) {
        out.push(&WEB);
    }
    if has(ProjectKind::Mobile) {
        out.push(&MOBILE);
    }
    if has(ProjectKind::Service) || has(ProjectKind::WebBackend) {
        out.push(&SERVICES);
    }
    if has(ProjectKind::Library) || has(ProjectKind::Cli) || has(ProjectKind::Desktop) {
        out.push(&SOFTWARE);
    }
    if has(ProjectKind::DataMl) || has(ProjectKind::Infrastructure) || has(ProjectKind::Embedded) {
        out.push(&DATA_INFRA);
    }
    out
}

/// "Godot" for "Godot 4.3", "Unreal" for "Unreal Engine 5.4".
fn engine_word(profile: &ProjectProfile) -> String {
    profile
        .engines
        .first()
        .and_then(|e| e.value.split_whitespace().next())
        .map_or_else(|| "game".to_owned(), str::to_owned)
}

/// The subject cards and domains of a project. `subjects` is the quiz's detection
/// (`subjects::propose`) on the same corpus.
pub fn build(profile: &ProjectProfile, corpus: &Corpus, subjects: &[Subject]) -> TutorialSubjects {
    let name = profile.name.as_str();
    let text: Vec<&CorpusFile> = corpus
        .files
        .values()
        .filter(|f| !f.binary && !is_metadata(&f.path))
        .collect();
    let total_bytes: u64 = text.iter().map(|f| f.size).sum();
    let too_thin = text.len() < MIN_FILES as usize || total_bytes < MIN_BYTES;
    if too_thin {
        return TutorialSubjects {
            cards: Vec::new(),
            domains: Vec::new(),
            too_thin: true,
        };
    }
    let overall = if total_bytes >= RICH_BYTES {
        Material::Rich
    } else {
        Material::Some
    };
    let subject = |id: &str| subjects.iter().find(|s| s.id == id);
    let features: Vec<&Subject> = subjects
        .iter()
        .filter(|s| s.group == SubjectGroup::Feature)
        .collect();
    let manifests = manifests(corpus);
    let readme = profile.docs.readme.clone();
    let architecture = profile.docs.architecture.clone();
    let entries: Vec<String> = subject("concept:architecture")
        .map(|s| {
            s.anchors
                .iter()
                .filter(|a| !a.ends_with(".md") && !manifests.contains(a))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    let code_files = text.iter().filter(|f| !f.markdown).count();
    let mut c = Cards {
        corpus,
        out: Vec::new(),
    };

    // The Big Picture.
    c.universal(
        "big-picture",
        format!("How {name} fits together, in 5 minutes"),
        &format!("What {name} does and its main parts"),
        readme
            .iter()
            .chain(architecture.iter())
            .chain(manifests.iter().take(1))
            .chain(entries.iter())
            .cloned()
            .collect(),
        overall,
        Vec::new(),
    );

    // Tech Stack.
    let stack: Vec<String> = profile
        .engines
        .iter()
        .map(|e| e.value.clone())
        .chain(profile.frameworks.iter().map(|f| f.value.clone()))
        .chain(
            profile
                .languages
                .iter()
                .filter(|l| l.programming)
                .take(3)
                .map(|l| l.name.clone()),
        )
        .collect();
    if !stack.is_empty() && code_files > 0 && (stack.len() > 1 || !manifests.is_empty()) {
        c.universal(
            "stack",
            format!("{name}'s tech stack, as used here"),
            &format!(
                "Why {name} uses {} and where",
                stack.iter().take(4).cloned().collect::<Vec<_>>().join(", ")
            ),
            manifests.iter().chain(entries.iter()).cloned().collect(),
            subject("concept:stack").map_or(overall, |s| s.material),
            Vec::new(),
        );
    }

    // Architecture Tour.
    if profile.modules.len() >= 2 || architecture.is_some() {
        let module_anchors: Vec<String> = profile
            .modules
            .iter()
            .take(4)
            .flat_map(|m| {
                pick_anchors(corpus.files.values().filter(|f| {
                    f.path.starts_with(&m.path) && f.path[m.path.len()..].starts_with('/')
                }))
                .into_iter()
                .take(1)
            })
            .collect();
        let parts: Vec<String> = profile
            .modules
            .iter()
            .take(3)
            .map(|m| format!("`{}`", m.name))
            .collect();
        c.universal(
            "architecture",
            format!("A tour of {name}'s architecture"),
            &if parts.is_empty() {
                format!("The layers and boundaries of {name}")
            } else {
                format!("How {} and the other parts talk", parts.join(", "))
            },
            architecture
                .iter()
                .cloned()
                .chain(module_anchors)
                .chain(entries.iter().cloned())
                .collect(),
            subject("concept:architecture").map_or(overall, |s| s.material),
            Vec::new(),
        );
    }

    // Feature Deep Dive.
    if !features.is_empty() {
        let picks: Vec<SubjectPick> = features
            .iter()
            .take(MAX_PICKS)
            .map(|f| SubjectPick {
                id: f.id.clone(),
                title: f.title.clone(),
                anchors: f.anchors.clone(),
            })
            .collect();
        let names: Vec<String> = features
            .iter()
            .take(3)
            .map(|f| f.title.to_lowercase())
            .collect();
        c.universal(
            "deep-dive",
            format!("Deep dive into one feature of {name}"),
            &format!("End to end: {}…", names.join(", ")),
            Vec::new(),
            features.iter().map(|f| f.material).max().unwrap_or(overall),
            picks,
        );
    }

    // Trace It.
    let picks = trace_picks(profile, corpus, &features, &entries);
    if !picks.is_empty() {
        c.universal(
            "trace-it",
            format!("Trace one action through {name}"),
            &format!(
                "Step by step: {}",
                picks
                    .iter()
                    .take(2)
                    .map(|p| p.title.clone())
                    .collect::<Vec<_>>()
                    .join(" or ")
            ),
            Vec::new(),
            overall,
            picks,
        );
    }

    // Dependencies.
    if profile.dependencies.len() >= 3 && !manifests.is_empty() {
        c.universal(
            "dependencies",
            format!("The dependencies {name} relies on"),
            &format!(
                "Where {name} uses {} and what would break without them",
                profile
                    .dependencies
                    .iter()
                    .take(3)
                    .map(|d| format!("`{d}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            manifests.clone(),
            overall,
            Vec::new(),
        );
    }

    // Build, Run, Test, Ship.
    if let Some(s) = subject("concept:build").or_else(|| subject("concept:testing")) {
        let mut anchors = s.anchors.clone();
        if let Some(t) = subject("concept:testing") {
            anchors.extend(t.anchors.iter().take(2).cloned());
        }
        c.universal(
            "build",
            format!("How {name} is built, tested and shipped"),
            &format!("The scripts, checks and release of {name}"),
            anchors,
            s.material,
            Vec::new(),
        );
    }

    // Conventions and Patterns.
    if profile.modules.len() >= 2 && text.len() >= 20 {
        let configs = find_named(
            corpus,
            &[
                "eslint.config.js",
                "eslint.config.mjs",
                ".eslintrc.json",
                ".eslintrc.js",
                ".prettierrc",
                ".prettierrc.json",
                "rustfmt.toml",
                "clippy.toml",
                ".editorconfig",
                "contributing.md",
                ".rubocop.yml",
                "ruff.toml",
                ".golangci.yml",
                "tsconfig.json",
                "analysis_options.yaml",
            ],
        );
        let mut anchors: Vec<String> = configs.iter().map(|f| f.path.clone()).collect();
        anchors.extend(
            subject("concept:patterns")
                .or_else(|| subject("concept:errors"))
                .map(|s| s.anchors.clone())
                .unwrap_or_default(),
        );
        c.universal(
            "conventions",
            format!("How things are done in {name}"),
            &format!("Naming, errors, state and the traps of {name}"),
            anchors,
            overall,
            Vec::new(),
        );
    }

    // Decisions.
    if let Some(s) = subject("concept:decisions") {
        // The newest decisions first: they say where the project is now.
        let mut records: Vec<String> = profile
            .docs
            .adr_dir
            .as_deref()
            .map(|dir| {
                corpus
                    .files
                    .keys()
                    .filter(|p| {
                        p.starts_with(dir)
                            && p[dir.len()..].starts_with('/')
                            && !file_name(p).eq_ignore_ascii_case("readme.md")
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        records.sort();
        records.reverse();
        let anchors = if records.is_empty() {
            s.anchors.clone()
        } else {
            records
        };
        c.universal(
            "decisions",
            format!("The decisions that shaped {name}"),
            &format!("{} decision records as a story", profile.docs.adrs),
            anchors,
            s.material,
            Vec::new(),
        );
    }

    // Your First Contribution.
    let contributing = find_named(corpus, &["contributing.md"]);
    let tests = subject("concept:testing");
    if !contributing.is_empty() || (subject("concept:build").is_some() && tests.is_some()) {
        let anchors: Vec<String> = contributing
            .iter()
            .map(|f| f.path.clone())
            .chain(tests.iter().flat_map(|t| t.anchors.iter().take(2).cloned()))
            .chain(entries.iter().take(1).cloned())
            .collect();
        c.universal(
            "first-contribution",
            format!("Your first change to {name}"),
            &format!("Where a change goes in {name} and how to verify it"),
            anchors,
            overall,
            Vec::new(),
        );
    }

    // Project Story.
    let history = find_named(
        corpus,
        &[
            "changelog.md",
            "history.md",
            "releases.md",
            "release-notes.md",
            "news.md",
        ],
    );
    if profile.repository && (!history.is_empty() || profile.docs.adrs >= 3) {
        let anchors: Vec<String> = history
            .iter()
            .map(|f| f.path.clone())
            .chain(
                subject("concept:decisions")
                    .map(|s| s.anchors.clone())
                    .unwrap_or_default(),
            )
            .collect();
        c.universal(
            "project-story",
            format!("The story of {name} so far"),
            &format!("How {name} evolved, from its changelog and decisions"),
            anchors,
            overall,
            Vec::new(),
        );
    }

    // Glossary.
    if overall == Material::Rich {
        let mut anchors: Vec<String> = readme.iter().chain(architecture.iter()).cloned().collect();
        anchors.extend(profile.docs.feature_pages.iter().take(3).cloned());
        c.universal(
            "glossary",
            format!("{name}'s own vocabulary"),
            &format!("The terms {name} uses, as flip cards"),
            anchors,
            overall,
            Vec::new(),
        );
    }
    let mut cards = c.out;

    // Domain families.
    let engine = engine_word(profile);
    let code: Vec<&CorpusFile> = text
        .iter()
        .copied()
        .filter(|f| !is_test_path(&f.path))
        .collect();
    let mut domain_cards: Vec<(u64, TutorialSubject)> = Vec::new();
    let mut gaps: Vec<String> = Vec::new();
    let kinds: Vec<ProjectKind> = profile.kinds.iter().map(|k| k.value).collect();
    for d in domains_of(profile) {
        for t in d.topics {
            // A desktop app has no public API or command line of its own unless it is also a
            // library or a CLI.
            let needs = match (d.id, t.id) {
                ("software", "api") => Some(ProjectKind::Library),
                ("software", "commands") => Some(ProjectKind::Cli),
                ("software", "ipc") => Some(ProjectKind::Desktop),
                _ => None,
            };
            if needs.is_some_and(|k| !kinds.contains(&k)) {
                continue;
            }
            let files: Vec<&CorpusFile> = code
                .iter()
                .copied()
                .filter(|f| {
                    let ext = f.path.rsplit('.').next().unwrap_or("").to_lowercase();
                    (!f.markdown && path_has(&f.path, t.words))
                        || t.extensions.contains(&ext.as_str())
                })
                .collect();
            let Some(material) = material_of(&files) else {
                continue;
            };
            let anchors = pick_anchors(files.iter().copied());
            if anchors.is_empty() {
                continue;
            }
            let bytes: u64 = files.iter().map(|f| f.size).sum();
            let gap = t.gap.replace("{engine}", &engine);
            gaps.push(gap.clone());
            let what = t.focus.replace("{name}", name);
            domain_cards.push((
                bytes,
                TutorialSubject {
                    id: format!("domain:{}:{}", d.id, t.id),
                    kind: FamilyKind::Domain,
                    family: d.family.to_owned(),
                    title: t.title.replace("{name}", name),
                    blurb: format!(
                        "{}{}",
                        capitalize(what.split(':').next().unwrap_or(&what)),
                        from_files(&anchors)
                    ),
                    focus: what,
                    anchors,
                    material,
                    picks: Vec::new(),
                    domain: Some(gap),
                    for_role: None,
                },
            ));
        }
    }
    // The engine's own model, from the quiz's detection, leads the game cards.
    for s in subjects.iter().filter(|s| s.id.starts_with("domain:")) {
        if matches!(s.id.as_str(), "domain:api" | "domain:ipc") {
            continue;
        }
        let gap = s.title.clone();
        gaps.insert(0, gap.clone());
        domain_cards.push((
            u64::MAX,
            TutorialSubject {
                id: format!("domain:game:{}", s.id.trim_start_matches("domain:")),
                kind: FamilyKind::Domain,
                family: GAMES.family.to_owned(),
                title: format!("{}, as {name} uses them", s.title),
                blurb: format!("{}{}", capitalize(&s.focus), from_files(&s.anchors)),
                focus: s.focus.clone(),
                anchors: s.anchors.clone(),
                material: s.material,
                picks: Vec::new(),
                domain: Some(gap),
                for_role: None,
            },
        ));
    }
    domain_cards.sort_by_key(|(bytes, _)| std::cmp::Reverse(*bytes));
    let room = MAX_CARDS.saturating_sub(cards.len());
    cards.extend(domain_cards.into_iter().take(room).map(|(_, c)| c));

    // "I'm new to …": the engines and frameworks first, then the topics with material.
    let mut domains: Vec<String> = profile
        .engines
        .iter()
        .chain(profile.frameworks.iter())
        .map(|e| e.value.clone())
        .collect();
    domains.extend(gaps);
    let mut seen = BTreeSet::new();
    domains.retain(|d| seen.insert(d.to_lowercase()));
    domains.truncate(16);

    TutorialSubjects {
        cards,
        domains,
        too_thin: false,
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next().map_or_else(String::new, |f| {
        f.to_uppercase().collect::<String>() + c.as_str()
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::*;
    use crate::learning::corpus::SourceScope;
    use crate::learning::subjects::propose;
    use crate::profile::{build as build_profile, tests::tree};

    fn cards_of(files: &[(&str, &str)]) -> TutorialSubjects {
        let dir = tree(files);
        let (profile, walk) = build_profile(dir.path(), &[], &AtomicBool::new(false));
        let corpus = Corpus::build(dir.path(), &walk, &SourceScope::WholeProject, &[]);
        let subjects = propose(&profile, &corpus);
        build(&profile, &corpus, &subjects)
    }

    fn ids(s: &TutorialSubjects) -> Vec<&str> {
        s.cards.iter().map(|c| c.id.as_str()).collect()
    }

    fn code(n: usize) -> String {
        (0..n)
            .map(|i| format!("pub fn function_{i}() -> u32 {{ {i} }}\n"))
            .collect()
    }

    #[test]
    fn an_empty_or_binary_folder_is_too_thin() {
        let s = cards_of(&[]);
        assert!(s.too_thin && s.cards.is_empty());
        let s = cards_of(&[("logo.png", "\u{0}\u{1}\u{2}")]);
        assert!(s.too_thin);
    }

    #[test]
    fn a_docs_only_folder_offers_the_big_picture_and_no_domain() {
        let page = "Orbit explains how the scheduler works. ".repeat(80);
        let s = cards_of(&[
            ("README.md", "# Orbit\n\nOrbit is a handbook.\n"),
            ("docs/intro.md", &page),
            ("docs/guide.md", &page),
        ]);
        assert!(!s.too_thin);
        assert!(ids(&s).contains(&"family:big-picture"), "{:?}", ids(&s));
        assert!(!ids(&s).iter().any(|i| i.starts_with("domain:")));
        assert!(!ids(&s).contains(&"family:trace-it"));
        // Never a bare family name: every title is phrased about the project.
        for c in &s.cards {
            assert!(!UNIVERSAL.iter().any(|(_, n)| c.title == *n), "{}", c.title);
            assert!(c.title.split_whitespace().count() >= 4, "{}", c.title);
        }
    }

    #[test]
    fn a_godot_game_offers_games_cards_and_not_web() {
        let gd = code(60).replace("pub fn", "func");
        let s = cards_of(&[
            (
                "project.godot",
                "config_version=5\n[application]\nconfig/name=\"Platformer\"\nrun/main_scene=\"res://game.tscn\"\n[rendering]\n",
            ),
            ("README.md", "# Platformer\n\nA small game.\n"),
            ("player/player.gd", &gd),
            ("player/player_input.gd", &gd),
            ("player/player.tscn", &"[node name=\"Player\"]\n".repeat(80)),
            ("level/level.tscn", &"[node name=\"Level\"]\n".repeat(80)),
            ("level/level.gd", &gd),
            ("gui/pause_menu.gd", &gd),
            ("gui/hud.gd", &gd),
        ]);
        let ids = ids(&s);
        assert!(ids.iter().any(|i| i.starts_with("domain:game:")), "{ids:?}");
        assert!(ids.contains(&"domain:game:player"), "{ids:?}");
        assert!(!ids.iter().any(|i| i.starts_with("domain:web:")));
        assert!(
            s.domains.iter().any(|d| d.starts_with("Godot")),
            "{:?}",
            s.domains
        );
        let player = s
            .cards
            .iter()
            .find(|c| c.id == "domain:game:player")
            .unwrap();
        assert!(player.title.contains("Platformer"));
        assert!(player.domain.as_deref().unwrap().contains("Godot"));
        assert!(
            player
                .anchors
                .iter()
                .all(|a| a.ends_with(".gd") || a.ends_with(".tscn"))
        );
        let trace = s.cards.iter().find(|c| c.id == "family:trace-it").unwrap();
        assert!(
            trace
                .picks
                .iter()
                .any(|p| p.title == "The player presses a button")
        );
    }

    #[test]
    fn a_web_back_end_offers_web_security_and_a_request_to_trace() {
        let py = code(60)
            .replace("pub fn", "def")
            .replace(" -> u32 {", ":  #")
            .replace('}', "");
        let s = cards_of(&[
            (
                "pyproject.toml",
                "[project]\nname = \"shop\"\ndependencies = [\"fastapi\", \"sqlalchemy\", \"pydantic\", \"passlib\"]\n",
            ),
            ("README.md", "# Shop\n\nA web shop.\n"),
            (
                "app/main.py",
                "from fastapi import FastAPI\napp = FastAPI()\n",
            ),
            ("app/api/routes/login.py", &py),
            ("app/api/routes/items.py", &py),
            ("app/core/security.py", &py),
            ("app/core/auth.py", &py),
            ("app/models.py", &py),
            ("app/db/session.py", &py),
        ]);
        let ids = ids(&s);
        assert!(ids.contains(&"domain:web:auth"), "{ids:?}");
        assert!(ids.contains(&"family:dependencies"), "{ids:?}");
        assert!(s.domains.iter().any(|d| d == "web authentication"));
        let trace = s.cards.iter().find(|c| c.id == "family:trace-it").unwrap();
        assert_eq!(trace.picks[0].title, "A request reaches the server");
        assert!(trace.picks[0].anchors.iter().any(|a| a.contains("routes")));
    }

    #[test]
    fn cards_are_capped_and_universal_first() {
        let s = cards_of(&[("README.md", "# X\n"), ("src/main.rs", &code(200))]);
        assert!(s.cards.len() <= MAX_CARDS);
        let first_domain = s.cards.iter().position(|c| c.kind == FamilyKind::Domain);
        let last_universal = s
            .cards
            .iter()
            .rposition(|c| c.kind == FamilyKind::Universal);
        if let (Some(d), Some(u)) = (first_domain, last_universal) {
            assert!(u < d);
        }
        for c in &s.cards {
            assert!(!c.anchors.is_empty() || !c.picks.is_empty(), "{}", c.id);
        }
    }

    /// This repository: the universal families a maintained desktop app has.
    #[test]
    fn dogfooding_the_repository() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let root = dunce::canonicalize(root).unwrap();
        let (profile, walk) = build_profile(&root, &[], &AtomicBool::new(false));
        let corpus = Corpus::build(
            &root,
            &walk,
            &SourceScope::WholeProject,
            &["CLAUDE.md".into()],
        );
        let subjects = propose(&profile, &corpus);
        let s = build(&profile, &corpus, &subjects);
        let ids = ids(&s);
        for id in [
            "family:big-picture",
            "family:stack",
            "family:architecture",
            "family:deep-dive",
            "family:trace-it",
            "family:build",
            "family:decisions",
            "family:first-contribution",
            "family:glossary",
        ] {
            assert!(ids.contains(&id), "{id} missing from {ids:?}");
        }
        assert!(ids.contains(&"domain:software:ipc"), "{ids:?}");
        let trace = s.cards.iter().find(|c| c.id == "family:trace-it").unwrap();
        assert!(
            trace
                .picks
                .iter()
                .any(|p| p.title == "A file changes on disk")
        );
        for c in &s.cards {
            assert!(c.title.contains(&profile.name), "{}", c.title);
            assert!(
                c.anchors.iter().all(|a| a != "CLAUDE.md"),
                "agent files are never anchors"
            );
        }
    }
}
