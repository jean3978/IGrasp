//! The main modules or areas of a project, from its folder layout and workspaces: workspace
//! members, engine modules and plugins, Unity assemblies, Godot add-ons and scene folders, the
//! children of the usual source folders, and folders that hold their own manifest. Each comes
//! with a role hint from its name, ordered by size.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::languages::{is_generated, language_of};
use super::manifests::{Manifests, is_manifest};
use super::walk::Walk;

/// Modules listed at most.
pub const MAX_MODULES: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Module {
    pub name: String,
    /// Root-relative folder.
    pub path: String,
    /// What the name suggests: `ui`, `api`, `commands`, `tests`, `docs`, `infra`, `assets`, …
    pub role: Option<String>,
    pub files: u64,
    pub bytes: u64,
}

/// Folders whose children are the modules.
const CONTAINERS: &[&str] = &[
    "src",
    "lib",
    "app",
    "apps",
    "packages",
    "services",
    "crates",
    "cmd",
    "internal",
    "pkg",
    "modules",
    "source",
    "libs",
    "plugins",
    "addons",
    "projects",
    "components",
];

const ROLES: &[(&[&str], &str)] = &[
    (&["commands", "cmd", "cli"], "commands"),
    (
        &[
            "ipc",
            "api",
            "rpc",
            "proto",
            "routes",
            "handlers",
            "controllers",
        ],
        "api",
    ),
    (
        &[
            "ui",
            "components",
            "features",
            "views",
            "pages",
            "screens",
            "widgets",
            "frontend",
            "web",
            "client",
        ],
        "ui",
    ),
    (
        &[
            "tests",
            "test",
            "e2e",
            "spec",
            "specs",
            "__tests__",
            "testing",
        ],
        "tests",
    ),
    (&["docs", "doc", "documentation"], "docs"),
    (
        &[
            "infra",
            "deploy",
            "k8s",
            "terraform",
            "helm",
            "ops",
            "docker",
        ],
        "infra",
    ),
    (
        &[
            "assets",
            "content",
            "resources",
            "art",
            "sprites",
            "audio",
            "sounds",
            "textures",
            "models",
            "fonts",
            "images",
        ],
        "assets",
    ),
    (&["scripts", "tools", "tooling", "build"], "tooling"),
    (
        &["core", "engine", "domain", "kernel", "common", "shared"],
        "core",
    ),
    (&["stores", "state", "store", "redux"], "state"),
    (&["server", "backend", "services", "service"], "backend"),
    (
        &["db", "database", "migrations", "storage", "persistence"],
        "data",
    ),
];

pub fn role_of(name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    ROLES
        .iter()
        .find(|(names, _)| names.contains(&lower.as_str()))
        .map(|(_, role)| (*role).to_owned())
}

fn last(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// The child folders of `dir` that hold at least one file.
fn children(dirs: &BTreeSet<String>, dir: &str) -> Vec<String> {
    dirs.iter()
        .filter(|d| d.rfind('/').map_or("", |i| &d[..i]) == dir)
        .cloned()
        .collect()
}

/// Expands a workspace member pattern (`packages/*`, `crates/core`) against the folders.
fn expand(dirs: &BTreeSet<String>, pattern: &str) -> Vec<String> {
    let pattern = pattern.trim_end_matches('/');
    if let Some(base) = pattern
        .strip_suffix("/**")
        .or_else(|| pattern.strip_suffix("/*"))
    {
        return children(dirs, base);
    }
    if pattern.contains('*') {
        return Vec::new();
    }
    if dirs.contains(pattern) {
        vec![pattern.to_owned()]
    } else {
        Vec::new()
    }
}

pub fn modules(walk: &Walk, manifests: &Manifests) -> Vec<Module> {
    let totals = walk.folder_totals();
    let dirs: BTreeSet<String> = totals
        .keys()
        .filter(|d| !d.is_empty() && !is_generated(&format!("{d}/x")))
        .cloned()
        .collect();
    let mut candidates: BTreeMap<String, String> = BTreeMap::new();
    let add = |candidates: &mut BTreeMap<String, String>, path: &str, name: &str| {
        if dirs.contains(path) && !path.split('/').any(|s| s.starts_with('.')) {
            candidates
                .entry(path.to_owned())
                .or_insert_with(|| name.to_owned());
        }
    };

    for pattern in &manifests.workspace_members {
        for dir in expand(&dirs, pattern) {
            add(&mut candidates, &dir, last(&dir));
        }
    }
    // Unreal modules and plugins.
    for base in ["Source", "Plugins"] {
        for dir in children(&dirs, base) {
            add(&mut candidates, &dir, last(&dir));
        }
    }
    // Unity assemblies, and the script folders.
    for f in walk.with_ext("asmdef") {
        add(&mut candidates, f.dir(), f.name.trim_end_matches(".asmdef"));
    }
    for dir in children(&dirs, "Assets/Scripts") {
        add(&mut candidates, &dir, last(&dir));
    }
    // Godot: top-level folders with scenes or scripts.
    if manifests.godot.is_some() {
        for f in walk
            .files
            .iter()
            .filter(|f| matches!(f.ext.as_str(), "tscn" | "gd") && f.depth() >= 1)
        {
            let top = f.path.split('/').next().unwrap_or_default();
            add(&mut candidates, top, top);
        }
    }
    // Folders with their own manifest, and the children of their source folders.
    let manifest_dirs: BTreeSet<&str> = walk
        .files
        .iter()
        .filter(|f| is_manifest(f) && (1..=2).contains(&f.depth()))
        .map(|f| f.dir())
        .collect();
    for dir in &manifest_dirs {
        add(&mut candidates, dir, last(dir));
    }
    for base in std::iter::once("").chain(manifest_dirs.iter().copied()) {
        for container in CONTAINERS {
            let dir = if base.is_empty() {
                (*container).to_owned()
            } else {
                format!("{base}/{container}")
            };
            for child in children(&dirs, &dir) {
                add(&mut candidates, &child, last(&child));
            }
        }
    }
    // Nothing found: the top-level folders that hold code.
    if candidates.is_empty() {
        for dir in children(&dirs, "") {
            let has_code = walk
                .under(&dir)
                .any(|f| language_of(f).is_some_and(|(_, programming)| programming));
            if has_code {
                add(&mut candidates, &dir, &dir);
            }
        }
    }

    // A candidate holding two others is a container, not a module.
    let paths: Vec<String> = candidates.keys().cloned().collect();
    candidates.retain(|path, _| {
        paths
            .iter()
            .filter(|p| {
                p.len() > path.len()
                    && p.starts_with(path.as_str())
                    && p[path.len()..].starts_with('/')
            })
            .count()
            < 2
    });
    let mut out: Vec<Module> = candidates
        .into_iter()
        .map(|(path, name)| {
            let (files, bytes) = totals.get(&path).copied().unwrap_or_default();
            Module {
                role: role_of(last(&path)),
                name,
                path,
                files,
                bytes,
            }
        })
        .collect();
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes).then(a.path.cmp(&b.path)));
    out.truncate(MAX_MODULES);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::walk::FileFact;

    fn walk(files: &[(&str, u64)]) -> Walk {
        Walk::from_files(files.iter().map(|(p, s)| FileFact::new(p, *s)).collect())
    }

    #[test]
    fn source_folders_and_manifest_crates() {
        let w = walk(&[
            ("src/features/quiz/Quiz.tsx", 500),
            ("src/stores/quiz.ts", 300),
            ("src/main.tsx", 10),
            ("src-tauri/Cargo.toml", 10),
            ("src-tauri/src/ai/gateway.rs", 900),
            ("src-tauri/src/profile/mod.rs", 400),
            ("docs/a.md", 5),
        ]);
        let m = modules(&w, &Manifests::default());
        let paths: Vec<&str> = m.iter().map(|m| m.path.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                "src-tauri/src/ai",
                "src/features",
                "src-tauri/src/profile",
                "src/stores"
            ]
        );
        assert_eq!(m[1].role.as_deref(), Some("ui"));
        assert_eq!(m[3].role.as_deref(), Some("state"));
    }

    #[test]
    fn workspace_members_and_engine_modules() {
        let w = walk(&[
            ("packages/web/src/a.ts", 10),
            ("packages/api/src/b.ts", 20),
            ("Source/Ship/Ship.cpp", 50),
            ("Plugins/Weather/Weather.uplugin", 1),
        ]);
        let mut man = Manifests::default();
        man.workspace_members.push("packages/*".into());
        let m = modules(&w, &man);
        let names: Vec<&str> = m.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec!["Ship", "api", "web", "Weather"]);
    }

    #[test]
    fn falls_back_to_top_level_code_folders() {
        let w = walk(&[("game/player.lua", 10), ("art/x.png", 99), ("main.lua", 1)]);
        let m = modules(&w, &Manifests::default());
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].path, "game");
    }
}
