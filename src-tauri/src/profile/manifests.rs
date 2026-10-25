//! Small, tolerant readers of project manifests: each pulls the handful of facts the detection
//! needs (names, dependency names, workspaces, entry points, engine versions), never a full
//! parse. JSON goes through `serde_json`, TOML through `toml`; YAML, INI-like and XML files are
//! read by line scanning or a regex for the few keys needed. A file that does not parse adds
//! nothing.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value as Json;

use super::languages::is_generated;
use super::walk::{FileFact, Walk};

/// Bytes read of a manifest at most.
pub const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
/// Manifests read at most (a monorepo of hundreds of packages keeps its first ones).
pub const MAX_MANIFESTS: usize = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dep {
    /// The manifest that declares it (root-relative).
    pub manifest: String,
    /// The version text as written, when there is one.
    pub version: Option<String>,
    /// Only a development or test dependency.
    pub dev: bool,
}

/// What a `Cargo.toml` says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CargoFacts {
    pub path: String,
    pub name: Option<String>,
    pub lib: bool,
    pub bins: bool,
    pub workspace: bool,
}

/// What a `package.json` says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PackageFacts {
    pub path: String,
    pub name: Option<String>,
    /// `main`, `module` or `exports`.
    pub exports: bool,
    pub bin: bool,
    pub scripts: Vec<String>,
    pub workspaces: bool,
}

/// What a `*.csproj` says.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CsprojFacts {
    pub path: String,
    pub sdk: Option<String>,
    pub output_type: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Manifests {
    /// Dependency name, lower-case → where it is declared. The first declaration wins.
    pub deps: BTreeMap<String, Dep>,
    /// Declaration order of `deps` (runtime ones first), for the profile's list.
    pub order: Vec<String>,
    pub cargo: Vec<CargoFacts>,
    pub packages: Vec<PackageFacts>,
    pub csproj: Vec<CsprojFacts>,
    /// Workspace member patterns (root-relative globs): Cargo, npm, pnpm, Go, Gradle.
    pub workspace_members: Vec<String>,
    /// `(path, name)` declared by manifests, the root ones first.
    pub names: Vec<(String, String)>,
    /// `EngineAssociation` of the `*.uproject`, and its file.
    pub unreal: Option<(String, Option<String>)>,
    /// Modules and plugins the `*.uproject` names.
    pub unreal_modules: Vec<String>,
    /// `m_EditorVersion` of `ProjectSettings/ProjectVersion.txt`.
    pub unity_version: Option<String>,
    /// `project.godot`: its path, `config/name` and the engine version of `config/features`.
    pub godot: Option<(String, Option<String>, Option<String>)>,
    /// Python entry points (`[project.scripts]`, console scripts).
    pub python_scripts: bool,
    /// Go `main` packages seen in `*.go` files (`package main`).
    pub go_main: bool,
    /// Lower-case words found in content markers (CMake packages, Makefile toolchains).
    pub content: BTreeMap<String, String>,
}

impl Manifests {
    pub fn has(&self, dep: &str) -> bool {
        self.dep(dep).is_some()
    }

    /// A dependency by name; `prefix*` matches by prefix.
    pub fn dep(&self, name: &str) -> Option<(&str, &Dep)> {
        if let Some(prefix) = name.strip_suffix('*') {
            return self
                .deps
                .iter()
                .find(|(k, _)| k.starts_with(prefix))
                .map(|(k, d)| (k.as_str(), d));
        }
        self.deps.get_key_value(name).map(|(k, d)| (k.as_str(), d))
    }

    fn add_dep(&mut self, name: &str, manifest: &str, version: Option<String>, dev: bool) {
        let key = name.trim().to_lowercase();
        if key.is_empty() || key.len() > 120 {
            return;
        }
        if !self.deps.contains_key(&key) {
            self.order.push(key.clone());
            self.deps.insert(
                key,
                Dep {
                    manifest: manifest.to_owned(),
                    version,
                    dev,
                },
            );
        } else if !dev && let Some(d) = self.deps.get_mut(&key) {
            d.dev = false;
        }
    }

    fn add_content(&mut self, word: &str, path: &str) {
        self.content
            .entry(word.to_lowercase())
            .or_insert_with(|| path.to_owned());
    }
}

/// File names read as manifests (lower-case), besides the extensions in [`is_manifest`].
const MANIFEST_NAMES: &[&str] = &[
    "package.json",
    "cargo.toml",
    "pyproject.toml",
    "setup.cfg",
    "setup.py",
    "go.mod",
    "go.work",
    "pubspec.yaml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "pom.xml",
    "gemfile",
    "composer.json",
    "projectversion.txt",
    "manifest.json",
    "project.godot",
    "cmakelists.txt",
    "makefile",
    "pnpm-workspace.yaml",
    "podfile",
    "platformio.ini",
];

pub fn is_manifest(f: &FileFact) -> bool {
    if is_generated(&f.path) {
        return false;
    }
    if f.name == "manifest.json" {
        // Only Unity's package manifest.
        return f.path.ends_with("Packages/manifest.json");
    }
    if f.name == "projectversion.txt" {
        return f.path.ends_with("ProjectSettings/ProjectVersion.txt");
    }
    MANIFEST_NAMES.contains(&f.name.as_str())
        || f.name.starts_with("requirements") && f.ext == "txt"
        || matches!(f.ext.as_str(), "csproj" | "fsproj" | "uproject" | "uplugin")
}

/// Reads the manifests of `walk` under `root`, shallowest first.
pub fn read(root: &Path, walk: &Walk) -> Manifests {
    let mut files: Vec<&FileFact> = walk
        .files
        .iter()
        .filter(|f| is_manifest(f) && f.size <= MAX_MANIFEST_BYTES)
        .collect();
    files.sort_by_key(|f| (f.depth(), f.path.clone()));
    let mut m = Manifests::default();
    for f in files.into_iter().take(MAX_MANIFESTS) {
        let Ok(text) = std::fs::read_to_string(root.join(&f.path)) else {
            continue;
        };
        read_one(&mut m, f, &text);
    }
    go_main(root, walk, &mut m);
    m
}

/// Adds what `text` (the content of `f`) says to `m`.
pub fn read_one(m: &mut Manifests, f: &FileFact, text: &str) {
    let path = f.path.as_str();
    match f.name.as_str() {
        "package.json" => package_json(m, path, text),
        "cargo.toml" => cargo_toml(m, path, text),
        "pyproject.toml" => pyproject(m, path, text),
        "go.mod" => go_mod(m, path, text),
        "go.work" => {
            for line in text.lines() {
                let l = line.trim().trim_start_matches("use").trim();
                if l.starts_with("./") {
                    m.workspace_members
                        .push(join(f.dir(), l.trim_start_matches("./")));
                }
            }
        }
        "pubspec.yaml" => pubspec(m, path, text),
        "build.gradle" | "build.gradle.kts" => gradle(m, path, text),
        "settings.gradle" | "settings.gradle.kts" => {
            for cap in RE_GRADLE_INCLUDE.captures_iter(text) {
                let module = cap[1].trim_start_matches(':').replace(':', "/");
                m.workspace_members.push(join(f.dir(), &module));
            }
        }
        "pom.xml" => {
            for cap in RE_ARTIFACT.captures_iter(text) {
                m.add_dep(&cap[1], path, None, false);
            }
        }
        "gemfile" => {
            for cap in RE_GEM.captures_iter(text) {
                m.add_dep(&cap[1], path, None, false);
            }
        }
        "composer.json" => {
            if let Ok(v) = serde_json::from_str::<Json>(text) {
                for (key, dev) in [("require", false), ("require-dev", true)] {
                    for name in keys(&v, key) {
                        m.add_dep(&name, path, None, dev);
                    }
                }
            }
        }
        "projectversion.txt" => {
            m.unity_version = text
                .lines()
                .find_map(|l| l.strip_prefix("m_EditorVersion:"))
                .map(|v| v.trim().to_owned());
        }
        "manifest.json" => {
            if let Ok(v) = serde_json::from_str::<Json>(text) {
                for name in keys(&v, "dependencies") {
                    m.add_dep(&name, path, None, false);
                }
            }
        }
        "project.godot" => godot(m, path, text),
        "cmakelists.txt" => {
            for cap in RE_CMAKE_PACKAGE.captures_iter(text) {
                m.add_content(&cap[1], path);
            }
            for word in [
                "pico_sdk", "zephyr", "raylib", "sdl2", "sdl3", "glfw", "vulkan", "qt",
            ] {
                if text.to_lowercase().contains(word) {
                    m.add_content(word, path);
                }
            }
        }
        "makefile" => {
            if text.contains("arm-none-eabi") {
                m.add_content("arm-none-eabi", path);
            }
        }
        "pnpm-workspace.yaml" => {
            for line in text.lines() {
                if let Some(item) = line.trim().strip_prefix("- ") {
                    m.workspace_members
                        .push(join(f.dir(), item.trim().trim_matches(['\'', '"'])));
                }
            }
        }
        "podfile" => {
            for cap in RE_POD.captures_iter(text) {
                m.add_dep(&cap[1], path, None, false);
            }
        }
        "setup.py" | "setup.cfg" => {
            if text.contains("console_scripts") || text.contains("entry_points") {
                m.python_scripts = true;
            }
            for cap in RE_PY_REQ_QUOTED.captures_iter(text) {
                m.add_dep(&cap[1], path, None, false);
            }
        }
        _ if f.name.starts_with("requirements") => {
            let dev = f.name.contains("dev") || f.name.contains("test");
            for line in text.lines() {
                let l = line.trim();
                if l.is_empty() || l.starts_with('#') || l.starts_with('-') {
                    continue;
                }
                if let Some(name) = py_name(l) {
                    m.add_dep(&name, path, None, dev);
                }
            }
        }
        _ => match f.ext.as_str() {
            "csproj" | "fsproj" => csproj(m, path, text),
            "uproject" => uproject(m, path, text),
            "uplugin" => {
                let name = f.name.trim_end_matches(".uplugin");
                m.unreal_modules.push(name.to_owned());
            }
            _ => {}
        },
    }
}

static RE_GRADLE_INCLUDE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"["'](:[\w\-:.]+)["']"#).expect("valid regex"));
static RE_ARTIFACT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<artifactId>\s*([\w.\-]+)\s*</artifactId>").expect("valid"));
static RE_GEM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?m)^\s*gem\s+["']([\w\-]+)["']"#).expect("valid regex"));
static RE_POD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?m)^\s*pod\s+["']([\w\-/]+)["']"#).expect("valid regex"));
static RE_CMAKE_PACKAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)find_package\s*\(\s*([\w]+)").expect("valid regex"));
static RE_PY_REQ_QUOTED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"["']([A-Za-z][\w.\-]*)\s*(?:[<>=!~;\[].*?)?["']"#).expect("valid")
});
static RE_GRADLE_PLUGIN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?:id\s*\(?\s*["']([\w.\-]+)["']|apply\s+plugin:\s*["']([\w.\-]+)["']|alias\s*\(\s*libs\.plugins\.([\w.\-]+))"#)
        .expect("valid regex")
});
static RE_GRADLE_DEP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*(\w+)\s*\(?\s*["']([\w.\-]+):([\w.\-]+)(?::([\w.\-]+))?["']"#)
        .expect("valid regex")
});
static RE_CSPROJ_SDK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<Project\s+Sdk="([^"]+)""#).expect("valid regex"));
static RE_CSPROJ_OUTPUT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<OutputType>\s*(\w+)\s*</OutputType>").expect("valid regex"));
static RE_CSPROJ_REF: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"<(?:PackageReference|FrameworkReference)\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?"#,
    )
    .expect("valid regex")
});
static RE_GODOT_FEATURES: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"config/features\s*=\s*PackedStringArray\(([^)]*)\)"#).expect("valid")
});
static RE_GO_PACKAGE_MAIN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^package\s+main\b").expect("valid regex"));

fn join(dir: &str, rel: &str) -> String {
    let rel = rel.trim_end_matches('/');
    if dir.is_empty() {
        rel.to_owned()
    } else {
        format!("{dir}/{rel}")
    }
}

fn keys(v: &Json, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Json::as_object)
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default()
}

/// The package name of a requirement line (`django>=4.2` → `django`).
fn py_name(spec: &str) -> Option<String> {
    let end = spec
        .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
        .unwrap_or(spec.len());
    let name = &spec[..end];
    (!name.is_empty()).then(|| name.to_lowercase())
}

fn package_json(m: &mut Manifests, path: &str, text: &str) {
    let Ok(v) = serde_json::from_str::<Json>(text) else {
        return;
    };
    let name = v.get("name").and_then(Json::as_str).map(str::to_owned);
    if let Some(n) = &name {
        m.names.push((path.to_owned(), n.clone()));
    }
    for (key, dev) in [
        ("dependencies", false),
        ("peerDependencies", false),
        ("devDependencies", true),
    ] {
        if let Some(deps) = v.get(key).and_then(Json::as_object) {
            for (dep, version) in deps {
                m.add_dep(dep, path, version.as_str().map(str::to_owned), dev);
            }
        }
    }
    let dir = path.rfind('/').map_or("", |i| &path[..i]);
    let workspaces = match v.get("workspaces") {
        Some(Json::Array(items)) => items.clone(),
        Some(Json::Object(o)) => o
            .get("packages")
            .and_then(Json::as_array)
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    for w in &workspaces {
        if let Some(w) = w.as_str() {
            m.workspace_members.push(join(dir, w));
        }
    }
    m.packages.push(PackageFacts {
        path: path.to_owned(),
        name,
        exports: ["main", "module", "exports"]
            .iter()
            .any(|k| v.get(k).is_some()),
        bin: v.get("bin").is_some(),
        scripts: keys(&v, "scripts"),
        workspaces: !workspaces.is_empty(),
    });
}

fn cargo_toml(m: &mut Manifests, path: &str, text: &str) {
    let Ok(v) = text.parse::<toml::Table>() else {
        return;
    };
    let name = v
        .get("package")
        .and_then(|p| p.get("name"))
        .and_then(toml::Value::as_str)
        .map(str::to_owned);
    if let Some(n) = &name {
        m.names.push((path.to_owned(), n.clone()));
    }
    let version_of = |d: &toml::Value| match d {
        toml::Value::String(s) => Some(s.clone()),
        toml::Value::Table(t) => t
            .get("version")
            .and_then(toml::Value::as_str)
            .map(str::to_owned),
        _ => None,
    };
    for (key, dev) in [
        ("dependencies", false),
        ("build-dependencies", false),
        ("dev-dependencies", true),
    ] {
        if let Some(deps) = v.get(key).and_then(toml::Value::as_table) {
            for (dep, spec) in deps {
                m.add_dep(dep, path, version_of(spec), dev);
            }
        }
    }
    let dir = path.rfind('/').map_or("", |i| &path[..i]);
    let workspace = v.get("workspace").and_then(toml::Value::as_table);
    if let Some(ws) = workspace {
        if let Some(members) = ws.get("members").and_then(toml::Value::as_array) {
            for member in members.iter().filter_map(toml::Value::as_str) {
                m.workspace_members.push(join(dir, member));
            }
        }
        if let Some(deps) = ws.get("dependencies").and_then(toml::Value::as_table) {
            for (dep, spec) in deps {
                m.add_dep(dep, path, version_of(spec), false);
            }
        }
    }
    m.cargo.push(CargoFacts {
        path: path.to_owned(),
        name,
        lib: v.contains_key("lib"),
        bins: v.contains_key("bin"),
        workspace: workspace.is_some(),
    });
}

fn pyproject(m: &mut Manifests, path: &str, text: &str) {
    let Ok(v) = text.parse::<toml::Table>() else {
        return;
    };
    let project = v.get("project").and_then(toml::Value::as_table);
    if let Some(n) = project
        .and_then(|p| p.get("name"))
        .and_then(toml::Value::as_str)
        .or_else(|| {
            v.get("tool")
                .and_then(|t| t.get("poetry"))
                .and_then(|p| p.get("name"))
                .and_then(toml::Value::as_str)
        })
    {
        m.names.push((path.to_owned(), n.to_owned()));
    }
    if let Some(deps) = project
        .and_then(|p| p.get("dependencies"))
        .and_then(toml::Value::as_array)
    {
        for spec in deps.iter().filter_map(toml::Value::as_str) {
            if let Some(name) = py_name(spec) {
                m.add_dep(&name, path, None, false);
            }
        }
    }
    if let Some(groups) = project
        .and_then(|p| p.get("optional-dependencies"))
        .and_then(toml::Value::as_table)
    {
        for spec in groups
            .values()
            .filter_map(toml::Value::as_array)
            .flatten()
            .filter_map(toml::Value::as_str)
        {
            if let Some(name) = py_name(spec) {
                m.add_dep(&name, path, None, true);
            }
        }
    }
    let poetry = v.get("tool").and_then(|t| t.get("poetry"));
    for (key, dev) in [("dependencies", false), ("dev-dependencies", true)] {
        if let Some(deps) = poetry
            .and_then(|p| p.get(key))
            .and_then(toml::Value::as_table)
        {
            for dep in deps.keys().filter(|k| *k != "python") {
                m.add_dep(dep, path, None, dev);
            }
        }
    }
    if project.is_some_and(|p| p.contains_key("scripts"))
        || poetry.is_some_and(|p| p.get("scripts").is_some())
    {
        m.python_scripts = true;
    }
    if v.get("tool").and_then(|t| t.get("pytest")).is_some() {
        m.add_dep("pytest", path, None, true);
    }
}

fn go_mod(m: &mut Manifests, path: &str, text: &str) {
    let mut in_require = false;
    for line in text.lines() {
        let l = line.trim();
        if let Some(module) = l.strip_prefix("module ") {
            m.names.push((path.to_owned(), module.trim().to_owned()));
        } else if l.starts_with("require (") {
            in_require = true;
        } else if in_require && l == ")" {
            in_require = false;
        } else if in_require || l.starts_with("require ") {
            let spec = l.trim_start_matches("require ").trim();
            let mut parts = spec.split_whitespace();
            if let Some(module) = parts.next() {
                let version = parts.next().map(str::to_owned);
                m.add_dep(module, path, version, false);
            }
        }
    }
}

fn pubspec(m: &mut Manifests, path: &str, text: &str) {
    let mut section: Option<bool> = None;
    for line in text.lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let l = line.trim();
        if indent == 0 {
            section = match l {
                "dependencies:" => Some(false),
                "dev_dependencies:" => Some(true),
                _ => None,
            };
            if let Some(name) = l.strip_prefix("name:") {
                m.names.push((path.to_owned(), name.trim().to_owned()));
            }
        } else if indent == 2
            && let Some(dev) = section
            && let Some((key, _)) = l.split_once(':')
        {
            m.add_dep(key.trim(), path, None, dev);
        }
    }
}

fn gradle(m: &mut Manifests, path: &str, text: &str) {
    for cap in RE_GRADLE_PLUGIN.captures_iter(text) {
        if let Some(id) = cap.get(1).or_else(|| cap.get(2)).or_else(|| cap.get(3)) {
            m.add_dep(id.as_str(), path, None, false);
        }
    }
    for cap in RE_GRADLE_DEP.captures_iter(text) {
        let config = cap[1].to_lowercase();
        let dev = config.contains("test");
        let version = cap.get(4).map(|v| v.as_str().to_owned());
        m.add_dep(&format!("{}:{}", &cap[2], &cap[3]), path, version, dev);
        m.add_dep(&cap[3], path, None, dev);
    }
}

fn csproj(m: &mut Manifests, path: &str, text: &str) {
    for cap in RE_CSPROJ_REF.captures_iter(text) {
        let dev = cap[1].to_lowercase().contains("test");
        m.add_dep(
            &cap[1],
            path,
            cap.get(2).map(|v| v.as_str().to_owned()),
            dev,
        );
    }
    let sdk = RE_CSPROJ_SDK.captures(text).map(|c| c[1].to_owned());
    if let Some(s) = &sdk {
        m.add_dep(s, path, None, false);
    }
    for marker in ["<UseWPF>true", "<UseWindowsForms>true", "<UseMaui>true"] {
        if text.contains(marker) {
            let word = marker.trim_start_matches("<Use").trim_end_matches(">true");
            m.add_dep(&format!("use-{word}"), path, None, false);
        }
    }
    m.csproj.push(CsprojFacts {
        path: path.to_owned(),
        sdk,
        output_type: RE_CSPROJ_OUTPUT.captures(text).map(|c| c[1].to_owned()),
    });
}

fn uproject(m: &mut Manifests, path: &str, text: &str) {
    let Ok(v) = serde_json::from_str::<Json>(text) else {
        m.unreal = Some((path.to_owned(), None));
        return;
    };
    let version = v
        .get("EngineAssociation")
        .and_then(Json::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    m.unreal = Some((path.to_owned(), version));
    let name = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".uproject");
    m.names.push((path.to_owned(), name.to_owned()));
    for key in ["Modules", "Plugins"] {
        for item in v.get(key).and_then(Json::as_array).into_iter().flatten() {
            let enabled = item.get("Enabled").and_then(Json::as_bool).unwrap_or(true);
            if let (Some(name), true) = (item.get("Name").and_then(Json::as_str), enabled) {
                if key == "Modules" {
                    m.unreal_modules.push(name.to_owned());
                } else {
                    m.add_dep(name, path, None, false);
                }
            }
        }
    }
}

fn godot(m: &mut Manifests, path: &str, text: &str) {
    let name = text
        .lines()
        .find_map(|l| l.trim().strip_prefix("config/name="))
        .map(|n| n.trim().trim_matches('"').to_owned());
    if let Some(n) = &name {
        m.names.push((path.to_owned(), n.clone()));
    }
    let version = RE_GODOT_FEATURES.captures(text).and_then(|c| {
        c[1].split(',')
            .map(|s| s.trim().trim_matches('"'))
            .find(|s| s.chars().next().is_some_and(|c| c.is_ascii_digit()))
            .map(str::to_owned)
    });
    m.godot = Some((path.to_owned(), name, version));
}

/// Whether a Go file declares `package main` (a binary). Reads the first few `*.go` files.
fn go_main(root: &Path, walk: &Walk, m: &mut Manifests) {
    if !walk.named("go.mod").any(|_| true) {
        return;
    }
    for f in walk
        .with_ext("go")
        .filter(|f| !is_generated(&f.path))
        .take(200)
    {
        if f.name.ends_with("_test.go") || f.size > MAX_MANIFEST_BYTES {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(root.join(&f.path))
            && RE_GO_PACKAGE_MAIN.is_match(&text)
        {
            m.go_main = true;
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_text(path: &str, text: &str) -> Manifests {
        let mut m = Manifests::default();
        read_one(&mut m, &FileFact::new(path, text.len() as u64), text);
        m
    }

    #[test]
    fn package_json_names_deps_workspaces_and_scripts() {
        let m = read_text(
            "package.json",
            r#"{"name":"app","main":"index.js","workspaces":["packages/*"],
               "scripts":{"build":"x","test":"y"},
               "dependencies":{"react":"^19"},"devDependencies":{"vitest":"4"}}"#,
        );
        assert_eq!(m.names, vec![("package.json".into(), "app".into())]);
        assert!(!m.deps["react"].dev);
        assert!(m.deps["vitest"].dev);
        assert_eq!(m.workspace_members, vec!["packages/*".to_owned()]);
        let p = &m.packages[0];
        assert!(p.exports && p.workspaces);
        assert_eq!(p.scripts, vec!["build".to_owned(), "test".to_owned()]);
    }

    #[test]
    fn cargo_toml_with_workspace_and_versions() {
        let m = read_text(
            "Cargo.toml",
            "[package]\nname = \"game\"\n[dependencies]\nbevy = \"0.15\"\nserde = { version = \"1\" }\n[workspace]\nmembers = [\"crates/*\"]\n[[bin]]\nname = \"x\"\n",
        );
        assert_eq!(m.deps["bevy"].version.as_deref(), Some("0.15"));
        assert_eq!(m.deps["serde"].version.as_deref(), Some("1"));
        assert_eq!(m.workspace_members, vec!["crates/*".to_owned()]);
        assert!(m.cargo[0].bins && m.cargo[0].workspace && !m.cargo[0].lib);
    }

    #[test]
    fn python_go_and_gradle() {
        let m = read_text(
            "pyproject.toml",
            "[project]\nname = \"svc\"\ndependencies = [\"Django>=4.2\", \"celery[redis]\"]\n[project.scripts]\nsvc = \"svc:main\"\n",
        );
        assert!(m.has("django") && m.has("celery") && m.python_scripts);
        let m = read_text(
            "go.mod",
            "module example.com/x\n\nrequire (\n\tgithub.com/spf13/cobra v1.8.0\n\tgoogle.golang.org/grpc v1.6\n)\n",
        );
        assert!(m.has("github.com/spf13/cobra"));
        assert_eq!(
            m.dep("google.golang.org/grpc*").unwrap().0,
            "google.golang.org/grpc"
        );
        let m = read_text(
            "app/build.gradle.kts",
            "plugins {\n  id(\"com.android.application\")\n  kotlin(\"android\")\n}\ndependencies {\n  implementation(\"org.springframework.boot:spring-boot-starter-web:3.2.0\")\n  testImplementation(\"junit:junit:4.13\")\n}\n",
        );
        assert!(m.has("com.android.application"));
        assert!(m.has("spring-boot-starter-web"));
        assert!(m.deps["junit"].dev);
    }

    #[test]
    fn engines() {
        let m = read_text(
            "Ship.uproject",
            r#"{"EngineAssociation":"5.4","Modules":[{"Name":"Ship"}],"Plugins":[{"Name":"OnlineSubsystemSteam","Enabled":true}]}"#,
        );
        assert_eq!(m.unreal, Some(("Ship.uproject".into(), Some("5.4".into()))));
        assert_eq!(m.unreal_modules, vec!["Ship".to_owned()]);
        let m = read_text(
            "project.godot",
            "[application]\nconfig/name=\"Dodge\"\nconfig/features=PackedStringArray(\"4.3\", \"GL Compatibility\")\n",
        );
        assert_eq!(
            m.godot,
            Some((
                "project.godot".into(),
                Some("Dodge".into()),
                Some("4.3".into())
            ))
        );
        let m = read_text(
            "ProjectSettings/ProjectVersion.txt",
            "m_EditorVersion: 2022.3.10f1\nm_EditorVersionWithRevision: x\n",
        );
        assert_eq!(m.unity_version.as_deref(), Some("2022.3.10f1"));
    }

    #[test]
    fn csproj_and_pubspec() {
        let m = read_text(
            "Api/Api.csproj",
            r#"<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup><ItemGroup><PackageReference Include="Serilog" Version="3.0" /></ItemGroup></Project>"#,
        );
        assert!(m.has("microsoft.net.sdk.web") && m.has("serilog"));
        assert_eq!(m.csproj[0].output_type.as_deref(), Some("Exe"));
        let m = read_text(
            "pubspec.yaml",
            "name: shop\ndependencies:\n  flutter:\n    sdk: flutter\n  provider: ^6.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n",
        );
        assert!(m.has("flutter") && m.has("provider"));
        assert!(m.deps["flutter_test"].dev);
    }

    #[test]
    fn broken_files_add_nothing() {
        let m = read_text("package.json", "{ nope");
        assert!(m.deps.is_empty() && m.packages.is_empty());
        let m = read_text("Cargo.toml", "[[[");
        assert!(m.cargo.is_empty());
    }
}
