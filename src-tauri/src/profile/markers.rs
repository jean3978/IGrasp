//! The detection table: evidence in the folder → a project kind, an engine, a framework or a
//! build, test or CI tool. The table is data and the single place a new ecosystem is added (with
//! a fixture in `profile/tests.rs`); the few rules that need more than one fact (engine
//! versions, "a library unless it has a binary", "a web front end unless a desktop or mobile
//! shell owns the UI") follow the table in [`detect`].

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::LazyLock;

use globset::{Glob, GlobMatcher};

use super::languages::is_generated;
use super::manifests::Manifests;
use super::walk::Walk;
use super::{Confidence, Detected, ProjectKind};

/// What a marker looks for.
#[derive(Debug, Clone, Copy)]
pub enum When {
    /// A file with this lower-case name, anywhere.
    Name(&'static str),
    /// A file whose root-relative path matches this glob (case-insensitive).
    Glob(&'static str),
    /// A file with this lower-case extension, anywhere.
    Ext(&'static str),
    /// A dependency of any manifest; `prefix*` matches by prefix.
    Dep(&'static str),
    /// A word found in content markers (CMake packages, toolchains in a Makefile).
    Content(&'static str),
}

/// What a marker detects.
#[derive(Debug, Clone, Copy)]
pub enum Then {
    Kind(ProjectKind),
    Engine(&'static str),
    Framework(&'static str),
    Build(&'static str),
    Test(&'static str),
    Ci(&'static str),
}

#[derive(Debug, Clone, Copy)]
pub struct Marker {
    pub when: When,
    pub then: Then,
    pub confidence: Confidence,
}

const fn m(when: When, then: Then, confidence: Confidence) -> Marker {
    Marker {
        when,
        then,
        confidence,
    }
}

use Confidence::{High, Low, Medium};
use ProjectKind as K;
use Then::{Build, Ci, Engine, Framework, Kind, Test};
use When::{Content, Dep, Ext, Glob as G, Name};

/// The table. Engines imply the Game kind; frameworks carry their kind in a second row.
pub const MARKERS: &[Marker] = &[
    // Game engines.
    m(Ext("uproject"), Engine("Unreal Engine"), High),
    m(G("**/source/**/*.build.cs"), Engine("Unreal Engine"), High),
    m(G("config/defaultengine.ini"), Engine("Unreal Engine"), High),
    m(G("**/*.uproject"), Build("UnrealBuildTool"), High),
    m(
        G("projectsettings/projectversion.txt"),
        Engine("Unity"),
        High,
    ),
    m(G("packages/manifest.json"), Engine("Unity"), Medium),
    m(Ext("unity"), Engine("Unity"), High),
    m(Ext("asmdef"), Engine("Unity"), Medium),
    m(Name("project.godot"), Engine("Godot"), High),
    m(Ext("tscn"), Engine("Godot"), Medium),
    m(Ext("gd"), Engine("Godot"), Medium),
    m(
        Name("export_presets.cfg"),
        Build("Godot export presets"),
        High,
    ),
    m(Dep("bevy"), Engine("Bevy"), High),
    m(Dep("godot"), Engine("Godot (Rust bindings)"), High),
    m(Dep("macroquad"), Engine("Macroquad"), High),
    m(Dep("ggez"), Engine("ggez"), High),
    m(Dep("pygame"), Engine("Pygame"), High),
    m(Dep("phaser"), Engine("Phaser"), High),
    m(Dep("three"), Framework("three.js"), High),
    m(Dep("monogame.framework*"), Engine("MonoGame"), High),
    // Web front ends.
    m(Dep("react"), Framework("React"), High),
    m(Dep("vue"), Framework("Vue"), High),
    m(Dep("svelte"), Framework("Svelte"), High),
    m(Dep("@angular/core"), Framework("Angular"), High),
    m(Dep("solid-js"), Framework("Solid"), High),
    m(Dep("preact"), Framework("Preact"), High),
    m(G("next.config.*"), Framework("Next.js"), High),
    m(Dep("next"), Framework("Next.js"), High),
    m(G("nuxt.config.*"), Framework("Nuxt"), High),
    m(G("astro.config.*"), Framework("Astro"), High),
    m(G("svelte.config.*"), Framework("SvelteKit"), Medium),
    m(Dep("@sveltejs/kit"), Framework("SvelteKit"), High),
    m(G("remix.config.*"), Framework("Remix"), High),
    m(Dep("@remix-run/react"), Framework("Remix"), High),
    m(G("vite.config.*"), Framework("Vite"), High),
    m(Dep("tailwindcss"), Framework("Tailwind CSS"), Medium),
    // Web back ends and services.
    m(Dep("express"), Framework("Express"), High),
    m(Dep("fastify"), Framework("Fastify"), High),
    m(Dep("koa"), Framework("Koa"), High),
    m(Dep("@nestjs/core"), Framework("NestJS"), High),
    m(Dep("hono"), Framework("Hono"), High),
    m(Dep("django"), Framework("Django"), High),
    m(Dep("fastapi"), Framework("FastAPI"), High),
    m(Dep("flask"), Framework("Flask"), High),
    m(Dep("spring-boot*"), Framework("Spring Boot"), High),
    m(
        Dep("org.springframework.boot"),
        Framework("Spring Boot"),
        High,
    ),
    m(
        Dep("microsoft.net.sdk.web"),
        Framework("ASP.NET Core"),
        High,
    ),
    m(
        Dep("microsoft.aspnetcore*"),
        Framework("ASP.NET Core"),
        High,
    ),
    m(Dep("github.com/gin-gonic/gin"), Framework("Gin"), High),
    m(Dep("github.com/labstack/echo*"), Framework("Echo"), High),
    m(Dep("github.com/gofiber/fiber*"), Framework("Fiber"), High),
    m(Dep("google.golang.org/grpc"), Framework("gRPC"), High),
    m(Dep("tonic"), Framework("gRPC (tonic)"), High),
    m(Dep("actix-web"), Framework("Actix Web"), High),
    m(Dep("axum"), Framework("Axum"), High),
    m(Dep("rocket"), Framework("Rocket"), High),
    m(Dep("rails"), Framework("Ruby on Rails"), High),
    m(Dep("laravel/framework"), Framework("Laravel"), High),
    m(Dep("prisma"), Framework("Prisma"), Medium),
    m(Dep("@prisma/client"), Framework("Prisma"), Medium),
    m(Dep("sqlalchemy"), Framework("SQLAlchemy"), Medium),
    // Desktop.
    m(G("**/tauri.conf.json"), Framework("Tauri"), High),
    m(G("**/tauri.conf.json"), Kind(K::Desktop), High),
    m(Dep("tauri"), Framework("Tauri"), High),
    m(Dep("electron"), Framework("Electron"), High),
    m(Dep("electron"), Kind(K::Desktop), High),
    m(Dep("use-wpf"), Framework("WPF"), High),
    m(Dep("use-wpf"), Kind(K::Desktop), High),
    m(Dep("use-windowsforms"), Framework("Windows Forms"), High),
    m(Dep("use-windowsforms"), Kind(K::Desktop), High),
    m(Dep("avalonia"), Framework("Avalonia"), High),
    m(Dep("avalonia"), Kind(K::Desktop), High),
    m(Dep("microsoft.windowsappsdk"), Framework("WinUI"), High),
    m(Dep("microsoft.windowsappsdk"), Kind(K::Desktop), High),
    m(Content("qt5"), Framework("Qt"), High),
    m(Content("qt6"), Framework("Qt"), High),
    m(Content("qt5"), Kind(K::Desktop), Medium),
    m(Content("qt6"), Kind(K::Desktop), Medium),
    m(Dep("gtk"), Framework("GTK"), High),
    m(Dep("gtk"), Kind(K::Desktop), Medium),
    m(Dep("egui"), Framework("egui"), High),
    // Mobile.
    m(Dep("flutter"), Framework("Flutter"), High),
    m(Dep("flutter"), Kind(K::Mobile), High),
    m(Dep("react-native"), Framework("React Native"), High),
    m(Dep("react-native"), Kind(K::Mobile), High),
    m(Dep("expo"), Framework("Expo"), High),
    m(Dep("com.android.application"), Framework("Android"), High),
    m(Dep("com.android.application"), Kind(K::Mobile), High),
    m(Dep("android.application"), Framework("Android"), High),
    m(Dep("android.application"), Kind(K::Mobile), High),
    m(G("**/androidmanifest.xml"), Kind(K::Mobile), Medium),
    m(Dep("androidx.compose*"), Framework("Jetpack Compose"), High),
    m(Ext("xcodeproj"), Kind(K::Mobile), Low),
    m(G("ios/**/*.swift"), Kind(K::Mobile), Medium),
    m(Dep("use-maui"), Framework(".NET MAUI"), High),
    m(Dep("use-maui"), Kind(K::Mobile), High),
    m(Name("podfile"), Build("CocoaPods"), High),
    // Command-line tools.
    m(Dep("clap"), Kind(K::Cli), High),
    m(Dep("commander"), Kind(K::Cli), Medium),
    m(Dep("yargs"), Kind(K::Cli), Medium),
    m(Dep("typer"), Kind(K::Cli), High),
    m(Dep("click"), Kind(K::Cli), Medium),
    m(Dep("github.com/spf13/cobra"), Kind(K::Cli), High),
    m(Dep("github.com/urfave/cli*"), Kind(K::Cli), High),
    m(Dep("system.commandline"), Kind(K::Cli), High),
    // Infrastructure.
    m(Name("dockerfile"), Kind(K::Infrastructure), Low),
    m(G("**/docker-compose*.yml"), Kind(K::Infrastructure), Low),
    m(G("**/docker-compose*.yaml"), Kind(K::Infrastructure), Low),
    m(G("**/compose.yaml"), Kind(K::Infrastructure), Low),
    m(Ext("tf"), Kind(K::Infrastructure), Medium),
    m(G("**/chart.yaml"), Kind(K::Infrastructure), Medium),
    m(G("**/pulumi.*"), Kind(K::Infrastructure), Medium),
    m(Name("serverless.yml"), Kind(K::Infrastructure), Medium),
    m(Name("cdk.json"), Kind(K::Infrastructure), Medium),
    m(G("ansible/**"), Kind(K::Infrastructure), Medium),
    m(G("k8s/**/*.yaml"), Kind(K::Infrastructure), Medium),
    m(G("kubernetes/**/*.yaml"), Kind(K::Infrastructure), Medium),
    m(Ext("tf"), Framework("Terraform"), High),
    m(G("**/chart.yaml"), Framework("Helm"), High),
    m(Name("dockerfile"), Build("Docker"), High),
    // Data and machine learning.
    m(Ext("ipynb"), Kind(K::DataMl), Medium),
    m(Name("dvc.yaml"), Kind(K::DataMl), High),
    m(Dep("torch"), Kind(K::DataMl), High),
    m(Dep("torch"), Framework("PyTorch"), High),
    m(Dep("tensorflow"), Kind(K::DataMl), High),
    m(Dep("tensorflow"), Framework("TensorFlow"), High),
    m(Dep("scikit-learn"), Kind(K::DataMl), High),
    m(Dep("scikit-learn"), Framework("scikit-learn"), High),
    m(Dep("pandas"), Kind(K::DataMl), Medium),
    m(Dep("pandas"), Framework("pandas"), Medium),
    m(Dep("mlflow"), Framework("MLflow"), High),
    m(Dep("jax"), Framework("JAX"), High),
    m(Dep("jax"), Kind(K::DataMl), High),
    m(G("data/**/*.parquet"), Kind(K::DataMl), Low),
    // Embedded.
    m(Name("platformio.ini"), Kind(K::Embedded), High),
    m(Name("platformio.ini"), Build("PlatformIO"), High),
    m(Name("kconfig"), Kind(K::Embedded), Medium),
    m(Ext("ioc"), Kind(K::Embedded), High),
    m(Content("pico_sdk"), Kind(K::Embedded), High),
    m(Content("zephyr"), Kind(K::Embedded), High),
    m(Content("arm-none-eabi"), Kind(K::Embedded), High),
    m(Dep("embedded-hal"), Kind(K::Embedded), High),
    m(Dep("cortex-m*"), Kind(K::Embedded), High),
    m(Ext("ino"), Kind(K::Embedded), High),
    // Monorepos.
    m(Name("pnpm-workspace.yaml"), Kind(K::Monorepo), High),
    m(Name("nx.json"), Kind(K::Monorepo), High),
    m(Name("turbo.json"), Kind(K::Monorepo), High),
    m(Name("lerna.json"), Kind(K::Monorepo), High),
    m(Name("go.work"), Kind(K::Monorepo), High),
    // Documentation sites.
    m(Name("mkdocs.yml"), Kind(K::Documentation), High),
    m(Name("mkdocs.yml"), Framework("MkDocs"), High),
    m(G("docusaurus.config.*"), Kind(K::Documentation), High),
    m(G("docusaurus.config.*"), Framework("Docusaurus"), High),
    m(Name("book.toml"), Kind(K::Documentation), High),
    m(Name("book.toml"), Framework("mdBook"), High),
    m(Name("conf.py"), Framework("Sphinx"), Low),
    // Build tools.
    m(Name("makefile"), Build("make"), High),
    m(Name("justfile"), Build("just"), High),
    m(Name("cmakelists.txt"), Build("CMake"), High),
    m(Name("build.gradle"), Build("Gradle"), High),
    m(Name("build.gradle.kts"), Build("Gradle"), High),
    m(Name("pom.xml"), Build("Maven"), High),
    m(Ext("sln"), Build("MSBuild"), High),
    m(Ext("csproj"), Build("dotnet"), High),
    m(Name("cargo.toml"), Build("Cargo"), High),
    m(Name("taskfile.yml"), Build("Task"), High),
    m(Name("meson.build"), Build("Meson"), High),
    m(Name("build.bazel"), Build("Bazel"), High),
    m(Name("workspace.bazel"), Build("Bazel"), High),
    m(Name("go.mod"), Build("Go toolchain"), High),
    m(Name("pyproject.toml"), Build("pyproject"), High),
    m(Name("pubspec.yaml"), Build("Dart pub"), High),
    m(Name("gemfile"), Build("Bundler"), High),
    m(Name("composer.json"), Build("Composer"), High),
    m(Dep("vite"), Build("Vite"), High),
    m(Dep("webpack"), Build("webpack"), High),
    // Tests.
    m(Dep("vitest"), Test("Vitest"), High),
    m(Dep("jest"), Test("Jest"), High),
    m(Dep("mocha"), Test("Mocha"), High),
    m(G("**/playwright.config.*"), Test("Playwright"), High),
    m(Dep("@playwright/test"), Test("Playwright"), High),
    m(G("**/cypress.config.*"), Test("Cypress"), High),
    m(Dep("pytest"), Test("pytest"), High),
    m(Name("pytest.ini"), Test("pytest"), High),
    m(Name("conftest.py"), Test("pytest"), High),
    m(G("**/*_test.go"), Test("go test"), High),
    m(G("**/*test.java"), Test("JUnit"), High),
    m(G("**/*tests.java"), Test("JUnit"), High),
    m(Dep("junit*"), Test("JUnit"), High),
    m(Dep("org.junit*"), Test("JUnit"), High),
    m(Dep("xunit"), Test("xUnit"), High),
    m(Dep("nunit"), Test("NUnit"), High),
    m(Dep("mstest.testframework"), Test("MSTest"), High),
    m(
        Dep("com.unity.test-framework"),
        Test("Unity Test Framework"),
        High,
    ),
    m(G("addons/gut/**"), Test("GUT"), High),
    m(G("addons/gdunit4/**"), Test("gdUnit4"), High),
    m(Dep("flutter_test"), Test("flutter test"), High),
    m(Dep("rspec"), Test("RSpec"), High),
    m(Dep("phpunit/phpunit"), Test("PHPUnit"), High),
    m(G("**/*.spec.cpp"), Test("Unreal Automation Spec"), Medium),
    m(G("**/test_*.py"), Test("pytest"), Medium),
    // Continuous integration.
    m(G(".github/workflows/*.yml"), Ci("GitHub Actions"), High),
    m(G(".github/workflows/*.yaml"), Ci("GitHub Actions"), High),
    m(Name(".gitlab-ci.yml"), Ci("GitLab CI"), High),
    m(Name("azure-pipelines.yml"), Ci("Azure Pipelines"), High),
    m(Name("jenkinsfile"), Ci("Jenkins"), High),
    m(G(".circleci/config.yml"), Ci("CircleCI"), High),
    m(Name(".travis.yml"), Ci("Travis CI"), High),
    m(
        Name("bitbucket-pipelines.yml"),
        Ci("Bitbucket Pipelines"),
        High,
    ),
    m(Name("appveyor.yml"), Ci("AppVeyor"), High),
];

/// Kinds of the frameworks that build a user interface for the web.
const WEB_UI: &[&str] = &[
    "React",
    "Vue",
    "Svelte",
    "Angular",
    "Solid",
    "Preact",
    "Next.js",
    "Nuxt",
    "Astro",
    "SvelteKit",
    "Remix",
];
const WEB_BACKEND: &[&str] = &[
    "Express",
    "Fastify",
    "Koa",
    "NestJS",
    "Hono",
    "Django",
    "FastAPI",
    "Flask",
    "Spring Boot",
    "ASP.NET Core",
    "Gin",
    "Echo",
    "Fiber",
    "Actix Web",
    "Axum",
    "Rocket",
    "Ruby on Rails",
    "Laravel",
    "gRPC",
    "gRPC (tonic)",
];

static GLOBS: LazyLock<Vec<Option<GlobMatcher>>> = LazyLock::new(|| {
    MARKERS
        .iter()
        .map(|mk| match mk.when {
            When::Glob(g) => globset::GlobBuilder::new(g)
                .case_insensitive(true)
                .literal_separator(false)
                .build()
                .ok()
                .map(|g: Glob| g.compile_matcher()),
            _ => None,
        })
        .collect()
});

/// Everything the table and the rules detected.
#[derive(Debug, Clone, Default)]
pub struct Detection {
    pub kinds: Vec<Detected<ProjectKind>>,
    pub engines: Vec<Detected<String>>,
    pub frameworks: Vec<Detected<String>>,
    pub build: Vec<Detected<String>>,
    pub tests: Vec<Detected<String>>,
    pub ci: Vec<Detected<String>>,
}

/// Accumulates detections, merging repeats (best confidence, evidence united, at most 5).
struct Acc<T: Ord + Clone> {
    by: BTreeMap<T, (Confidence, Vec<String>)>,
}

impl<T: Ord + Clone> Default for Acc<T> {
    fn default() -> Self {
        Self {
            by: BTreeMap::new(),
        }
    }
}

impl<T: Ord + Clone> Acc<T> {
    fn add(&mut self, value: T, confidence: Confidence, evidence: &str) {
        let e = self.by.entry(value).or_insert((confidence, Vec::new()));
        e.0 = e.0.max(confidence);
        if e.1.len() < 5 && !e.1.iter().any(|p| p == evidence) {
            e.1.push(evidence.to_owned());
        }
    }

    fn remove(&mut self, value: &T) {
        self.by.remove(value);
    }

    fn has(&self, value: &T) -> bool {
        self.by.contains_key(value)
    }

    fn rename(&mut self, from: &T, to: T) {
        if let Some(v) = self.by.remove(from) {
            self.by.insert(to, v);
        }
    }

    /// Ranked: High > Medium > Low, then by evidence count, then by name.
    fn into_ranked(self) -> Vec<Detected<T>> {
        let mut out: Vec<Detected<T>> = self
            .by
            .into_iter()
            .map(|(value, (confidence, evidence))| Detected {
                value,
                confidence,
                evidence,
            })
            .collect();
        out.sort_by(|a, b| {
            b.confidence
                .cmp(&a.confidence)
                .then(b.evidence.len().cmp(&a.evidence.len()))
        });
        out
    }
}

/// The first path matching `pred` (generated folders excluded).
fn find(walk: &Walk, pred: impl Fn(&super::walk::FileFact) -> bool) -> Option<&str> {
    walk.files
        .iter()
        .find(|f| !is_generated(&f.path) && pred(f))
        .map(|f| f.path.as_str())
}

/// Runs the table and the rules over the walk and the manifests.
pub fn detect(root: &Path, walk: &Walk, manifests: &Manifests) -> Detection {
    let mut kinds: Acc<ProjectKind> = Acc::default();
    let mut engines: Acc<String> = Acc::default();
    let mut frameworks: Acc<String> = Acc::default();
    let mut build: Acc<String> = Acc::default();
    let mut tests: Acc<String> = Acc::default();
    let mut ci: Acc<String> = Acc::default();

    for (i, mk) in MARKERS.iter().enumerate() {
        let evidence: Option<String> = match mk.when {
            When::Name(n) => find(walk, |f| f.name == n).map(str::to_owned),
            When::Ext(e) => find(walk, |f| f.ext == e).map(str::to_owned),
            When::Glob(_) => GLOBS[i]
                .as_ref()
                .and_then(|g| find(walk, |f| g.is_match(&f.path)))
                .map(str::to_owned),
            When::Dep(d) => manifests.dep(d).map(|(_, dep)| dep.manifest.clone()),
            When::Content(w) => manifests.content.get(w).cloned(),
        };
        let Some(evidence) = evidence else { continue };
        match mk.then {
            Then::Kind(k) => kinds.add(k, mk.confidence, &evidence),
            Then::Engine(e) => engines.add(e.to_owned(), mk.confidence, &evidence),
            Then::Framework(f) => frameworks.add(f.to_owned(), mk.confidence, &evidence),
            Then::Build(b) => build.add(b.to_owned(), mk.confidence, &evidence),
            Then::Test(t) => tests.add(t.to_owned(), mk.confidence, &evidence),
            Then::Ci(c) => ci.add(c.to_owned(), mk.confidence, &evidence),
        }
    }

    // Engine versions, and Godot's Rust bindings count as Godot.
    let version = |name: &str, v: Option<&str>| match v {
        Some(v) if !v.is_empty() => format!("{name} {v}"),
        _ => name.to_owned(),
    };
    if engines.has(&"Unreal Engine".to_owned()) {
        let v = manifests.unreal.as_ref().and_then(|(_, v)| v.as_deref());
        engines.rename(&"Unreal Engine".to_owned(), version("Unreal Engine", v));
    }
    if engines.has(&"Unity".to_owned()) {
        // `2022.3.10f1` → `2022.3`.
        let v = manifests
            .unity_version
            .as_deref()
            .map(|v| v.split('.').take(2).collect::<Vec<_>>().join("."));
        engines.rename(&"Unity".to_owned(), version("Unity", v.as_deref()));
    }
    if engines.has(&"Godot".to_owned()) {
        let v = manifests.godot.as_ref().and_then(|(_, _, v)| v.as_deref());
        engines.rename(&"Godot".to_owned(), version("Godot", v));
    }
    if engines.has(&"Bevy".to_owned()) {
        let v = manifests
            .deps
            .get("bevy")
            .and_then(|d| d.version.as_deref())
            .map(|v| v.trim_start_matches(['^', '~', '=']));
        engines.rename(&"Bevy".to_owned(), version("Bevy", v));
    }
    // A custom engine: graphics libraries or shaders without a known engine.
    if engines.by.is_empty() {
        let graphics = ["sdl2", "sdl3", "glfw", "raylib", "vulkan", "opengl", "glew"]
            .iter()
            .find_map(|w| manifests.content.get(*w))
            .cloned()
            .or_else(|| {
                ["wgpu", "glium", "sdl2", "raylib", "ash", "vulkano", "sfml"]
                    .iter()
                    .find_map(|d| manifests.deps.get(*d).map(|d| d.manifest.clone()))
            });
        let shader = find(walk, |f| {
            matches!(f.ext.as_str(), "hlsl" | "glsl" | "vert" | "frag" | "wgsl")
        });
        if let Some(evidence) = graphics.as_deref().or(shader) {
            engines.add("Custom engine".to_owned(), Medium, evidence);
            if let Some(s) = shader {
                engines.add("Custom engine".to_owned(), Medium, s);
            }
        }
    }
    for (engine, (confidence, evidence)) in &engines.by {
        let c = if engine == "Custom engine" {
            Medium
        } else {
            *confidence
        };
        for e in evidence {
            kinds.add(K::Game, c, e);
        }
    }

    // A web front end, unless a desktop or mobile shell owns the UI.
    let ui_shell = kinds.has(&K::Desktop) || kinds.has(&K::Mobile);
    for f in WEB_UI {
        if let Some((c, ev)) = frameworks.by.get(*f).cloned() {
            if ui_shell {
                continue;
            }
            for e in &ev {
                kinds.add(K::WebFrontend, c, e);
            }
        }
    }
    // A web back end, or a service when it only exposes an API.
    let api_only = find(walk, |f| {
        f.ext == "proto" || f.name.starts_with("openapi.") || f.name.starts_with("asyncapi.")
    });
    let has_templates = walk.files.iter().any(|f| {
        let p = f.path.to_lowercase();
        p.contains("templates/") || p.contains("static/") || p.contains("views/")
    });
    for f in WEB_BACKEND {
        if let Some((c, ev)) = frameworks.by.get(*f).cloned() {
            let kind = if api_only.is_some() && !has_templates || f.starts_with("gRPC") {
                K::Service
            } else {
                K::WebBackend
            };
            for e in &ev {
                kinds.add(kind, c, e);
            }
        }
    }

    // Libraries and command-line tools from the root manifests.
    let app_kind = [
        K::Game,
        K::WebFrontend,
        K::WebBackend,
        K::Service,
        K::Desktop,
        K::Mobile,
    ]
    .iter()
    .any(|k| kinds.has(k));
    if let Some(c) = manifests.cargo.iter().find(|c| !c.path.contains('/')) {
        let main_rs = walk.contains("src/main.rs") || c.bins;
        let lib_rs = walk.contains("src/lib.rs") || c.lib;
        if main_rs && manifests.has("clap") {
            kinds.add(K::Cli, High, &c.path);
        } else if main_rs && !app_kind {
            kinds.add(K::Cli, Medium, &c.path);
        }
        if lib_rs && !main_rs && !app_kind {
            kinds.add(K::Library, High, &c.path);
        }
    }
    if let Some(p) = manifests.packages.iter().find(|p| !p.path.contains('/')) {
        if p.bin {
            kinds.add(K::Cli, High, &p.path);
        }
        if p.exports && !app_kind && !p.workspaces {
            kinds.add(K::Library, Medium, &p.path);
        }
    }
    let python = find(walk, |f| {
        !f.path.contains('/') && (f.name == "pyproject.toml" || f.name == "setup.py")
    });
    if let Some(py) = python
        && !app_kind
        && !kinds.has(&K::DataMl)
    {
        if manifests.python_scripts {
            kinds.add(K::Cli, Medium, py);
        } else {
            kinds.add(K::Library, Medium, py);
        }
    }
    for c in &manifests.csproj {
        match c.output_type.as_deref().map(str::to_lowercase).as_deref() {
            Some("library") if !app_kind => kinds.add(K::Library, Medium, &c.path),
            Some("exe") if !app_kind && !kinds.has(&K::Cli) => {
                kinds.add(K::Cli, Low, &c.path);
            }
            _ => {}
        }
    }
    if let Some(go) = walk.named("go.mod").next()
        && !app_kind
    {
        if manifests.go_main {
            if !kinds.has(&K::Cli) {
                kinds.add(K::Cli, Medium, &go.path);
            }
        } else {
            kinds.add(K::Library, Medium, &go.path);
        }
    }

    // Monorepos: workspaces with several members.
    if manifests.workspace_members.len() >= 2
        || manifests.packages.iter().any(|p| p.workspaces)
        || manifests.cargo.iter().any(|c| c.workspace)
    {
        let evidence = manifests
            .packages
            .iter()
            .find(|p| p.workspaces)
            .map(|p| p.path.clone())
            .or_else(|| {
                manifests
                    .cargo
                    .iter()
                    .find(|c| c.workspace)
                    .map(|c| c.path.clone())
            });
        if let Some(e) = evidence {
            kinds.add(K::Monorepo, High, &e);
        }
    }

    // Infrastructure is High only when the folder is mostly that.
    if kinds.has(&K::Infrastructure) {
        let infra = walk
            .files
            .iter()
            .filter(|f| {
                matches!(f.ext.as_str(), "tf" | "tfvars" | "hcl")
                    || f.name == "dockerfile"
                    || f.path.to_lowercase().contains("helm/")
                    || f.path.to_lowercase().contains("k8s/")
                    || f.path.to_lowercase().contains("ansible/")
            })
            .count();
        let code = walk
            .files
            .iter()
            .filter(|f| {
                super::languages::language_of(f).is_some_and(|(_, p)| p) && !is_generated(&f.path)
            })
            .count();
        if code > 0
            && infra * 2 > code
            && let Some(e) = kinds.by.get_mut(&K::Infrastructure)
        {
            e.0 = High;
        }
    }

    // Documentation: mostly markdown and no code.
    let counted: Vec<_> = walk
        .files
        .iter()
        .filter(|f| !is_generated(&f.path) && !f.name.starts_with('.'))
        .collect();
    let markdown = counted
        .iter()
        .filter(|f| matches!(f.ext.as_str(), "md" | "markdown" | "rst"))
        .count();
    let code = counted
        .iter()
        .filter(|f| super::languages::language_of(f).is_some_and(|(_, p)| p))
        .count();
    if markdown > 0
        && code == 0
        && kinds.by.is_empty()
        && let Some(f) = counted.iter().find(|f| f.ext == "md")
    {
        kinds.add(K::Documentation, High, &f.path);
    }

    // cargo test: a Rust crate with tests.
    if build.has(&"Cargo".to_owned())
        && let Some(e) = rust_tests(root, walk)
    {
        tests.add("cargo test".to_owned(), High, &e);
    }
    // npm scripts.
    if let Some(p) = manifests.packages.iter().find(|p| !p.scripts.is_empty()) {
        build.add("npm scripts".to_owned(), High, &p.path);
    }
    // Unity tests need an assembly referencing the test runner.
    if engines.by.keys().any(|e| e.starts_with("Unity"))
        && let Some(asm) = find(walk, |f| {
            f.ext == "asmdef" && f.path.to_lowercase().contains("test")
        })
    {
        tests.add("Unity Test Framework".to_owned(), High, asm);
    }
    // Three.js or Phaser alone make a web game.
    if kinds.by.is_empty() && frameworks.has(&"three.js".to_owned()) {
        let e = frameworks.by[&"three.js".to_owned()].1[0].clone();
        kinds.add(K::WebFrontend, Medium, &e);
    }
    // Vite is a build tool more than a framework.
    frameworks.remove(&"Vite".to_owned());

    Detection {
        kinds: kinds.into_ranked(),
        engines: engines.into_ranked(),
        frameworks: frameworks.into_ranked(),
        build: build.into_ranked(),
        tests: tests.into_ranked(),
        ci: ci.into_ranked(),
    }
}

/// The first Rust file with a `#[cfg(test)]` module, or a `tests/*.rs` file.
fn rust_tests(root: &Path, walk: &Walk) -> Option<String> {
    if let Some(f) = walk
        .files
        .iter()
        .find(|f| f.ext == "rs" && (f.path.starts_with("tests/") || f.path.contains("/tests/")))
    {
        return Some(f.path.clone());
    }
    walk.with_ext("rs")
        .filter(|f| !is_generated(&f.path) && f.size < 512 * 1024)
        .take(400)
        .find(|f| {
            std::fs::read_to_string(root.join(&f.path))
                .is_ok_and(|t| t.contains("#[cfg(test)]") || t.contains("#[test]"))
        })
        .map(|f| f.path.clone())
}
