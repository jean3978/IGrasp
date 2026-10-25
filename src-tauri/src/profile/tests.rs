//! Declarative fixtures: one temp folder per project kind, holding only the files its detection
//! needs (a manifest and a few empty files), then assertions on the profile.

use std::sync::atomic::AtomicBool;

use super::*;

/// A temp folder holding `files` (`(path, content)`).
pub fn tree(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (path, content) in files {
        let p = dir.path().join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }
    dir
}

pub fn profile_of(files: &[(&str, &str)]) -> ProjectProfile {
    let dir = tree(files);
    build(dir.path(), &[], &AtomicBool::new(false)).0
}

fn kinds(p: &ProjectProfile) -> Vec<ProjectKind> {
    p.kinds.iter().map(|k| k.value).collect()
}

fn values(list: &[Detected<String>]) -> Vec<&str> {
    list.iter().map(|d| d.value.as_str()).collect()
}

fn has(list: &[Detected<String>], value: &str) -> bool {
    list.iter().any(|d| d.value == value)
}

fn langs(p: &ProjectProfile) -> Vec<&str> {
    p.languages.iter().map(|l| l.name.as_str()).collect()
}

use ProjectKind as K;

#[test]
fn empty_folder() {
    let p = profile_of(&[]);
    assert_eq!(p.files_seen, 0);
    assert!(p.languages.is_empty());
    assert_eq!(kinds(&p), vec![K::Unknown]);
    assert!(!p.truncated);
}

#[test]
fn ignored_and_dotfiles() {
    let p = profile_of(&[
        (".gitignore", "build/\n"),
        ("build/package.json", r#"{"dependencies":{"react":"19"}}"#),
        ("build/huge.js", &"x".repeat(5000)),
        (".github/workflows/ci.yml", "on: push\n"),
        ("src/lib.rs", "pub fn a() {}\n"),
    ]);
    assert_eq!(p.files_seen, 3);
    assert_eq!(p.languages[0].name, "Rust");
    assert!(
        !has(&p.frameworks, "React"),
        "an ignored manifest does not count"
    );
    assert!(has(&p.ci, "GitHub Actions"));
}

#[test]
fn unreal_game() {
    let p = profile_of(&[
        (
            "Ship.uproject",
            r#"{"EngineAssociation":"5.4","Modules":[{"Name":"Ship"}]}"#,
        ),
        (
            "Source/Ship/Ship.Build.cs",
            "public class Ship : ModuleRules {}",
        ),
        (
            "Source/Ship/ShipPawn.cpp",
            "void AShipPawn::Tick(float DeltaSeconds) { Super::Tick(DeltaSeconds); }",
        ),
        ("Source/Ship/ShipPawn.h", "class AShipPawn {};"),
        ("Config/DefaultEngine.ini", "[/Script/Engine]\n"),
        ("Content/Maps/Main.umap", ""),
    ]);
    assert_eq!(p.kinds[0].value, K::Game);
    assert_eq!(values(&p.engines), vec!["Unreal Engine 5.4"]);
    assert!(has(&p.build, "UnrealBuildTool"));
    assert_eq!(langs(&p)[0], "C++");
    assert_eq!(p.name, "Ship");
}

#[test]
fn unity_game() {
    let p = profile_of(&[
        (
            "ProjectSettings/ProjectVersion.txt",
            "m_EditorVersion: 2022.3.10f1\n",
        ),
        (
            "Packages/manifest.json",
            r#"{"dependencies":{"com.unity.inputsystem":"1.7.0","com.unity.test-framework":"1.1.33","com.unity.modules.ui":"1.0.0"}}"#,
        ),
        ("Assets/Scenes/Main.unity", ""),
        (
            "Assets/Scripts/Player.cs",
            "public class Player : MonoBehaviour {}",
        ),
        ("Assets/Scripts/Game.asmdef", "{}"),
        ("Assets/Tests/Game.Tests.asmdef", "{}"),
    ]);
    assert_eq!(p.kinds[0].value, K::Game);
    assert_eq!(values(&p.engines), vec!["Unity 2022.3"]);
    assert!(has(&p.tests, "Unity Test Framework"));
    assert!(p.dependencies.contains(&"com.unity.inputsystem".to_owned()));
    assert!(
        !p.dependencies
            .iter()
            .any(|d| d.starts_with("com.unity.modules"))
    );
    assert_eq!(langs(&p)[0], "C#");
}

#[test]
fn godot_game() {
    let p = profile_of(&[
        (
            "project.godot",
            "[application]\nconfig/name=\"Dodge the Creeps\"\nconfig/features=PackedStringArray(\"4.3\")\n",
        ),
        ("main.tscn", "[gd_scene]"),
        ("player.gd", "extends Area2D\n"),
        ("export_presets.cfg", ""),
    ]);
    assert_eq!(kinds(&p), vec![K::Game]);
    assert_eq!(values(&p.engines), vec!["Godot 4.3"]);
    assert_eq!(p.name, "Dodge the Creeps");
    assert!(langs(&p).contains(&"GDScript"));
}

#[test]
fn bevy_game() {
    let p = profile_of(&[
        (
            "Cargo.toml",
            "[package]\nname = \"breakout\"\n[dependencies]\nbevy = \"0.15\"\n",
        ),
        ("src/main.rs", "fn main() {}\n"),
    ]);
    assert_eq!(p.kinds[0].value, K::Game);
    assert_eq!(values(&p.engines), vec!["Bevy 0.15"]);
    assert!(!kinds(&p).contains(&K::Library));
}

#[test]
fn custom_engine_cpp() {
    let p = profile_of(&[
        (
            "CMakeLists.txt",
            "project(eng)\nfind_package(SDL2 REQUIRED)\nfind_package(Vulkan)\n",
        ),
        ("src/renderer.cpp", "void draw() {}"),
        ("shaders/lit.frag", "void main() {}"),
    ]);
    assert_eq!(values(&p.engines), vec!["Custom engine"]);
    assert_eq!(p.kinds[0].value, K::Game);
    assert_eq!(p.kinds[0].confidence, Confidence::Medium);
    assert!(has(&p.build, "CMake"));
}

#[test]
fn web_next_react() {
    let p = profile_of(&[
        (
            "package.json",
            r#"{"name":"shop","scripts":{"dev":"next dev"},"dependencies":{"next":"15","react":"19"},"devDependencies":{"jest":"29"}}"#,
        ),
        ("next.config.js", "module.exports = {}"),
        ("app/page.tsx", "export default function Page() {}"),
    ]);
    assert_eq!(p.kinds[0].value, K::WebFrontend);
    assert!(has(&p.frameworks, "Next.js") && has(&p.frameworks, "React"));
    assert!(has(&p.tests, "Jest"));
    assert!(has(&p.build, "npm scripts"));
}

#[test]
fn web_django() {
    let p = profile_of(&[
        (
            "pyproject.toml",
            "[project]\nname = \"blog\"\ndependencies = [\"Django>=5\"]\n",
        ),
        ("blog/settings.py", ""),
        ("blog/templates/base.html", ""),
        ("conftest.py", ""),
    ]);
    assert_eq!(p.kinds[0].value, K::WebBackend);
    assert!(has(&p.frameworks, "Django"));
    assert!(has(&p.tests, "pytest"));
    assert!(!kinds(&p).contains(&K::Library));
}

#[test]
fn web_spring_boot() {
    let p = profile_of(&[
        (
            "build.gradle.kts",
            "plugins { id(\"org.springframework.boot\") version \"3.2.0\" }\ndependencies {\n  implementation(\"org.springframework.boot:spring-boot-starter-web:3.2.0\")\n  testImplementation(\"org.junit.jupiter:junit-jupiter:5.10\")\n}\n",
        ),
        ("src/main/java/app/App.java", "class App {}"),
        ("src/main/resources/templates/index.html", ""),
        ("src/test/java/app/AppTest.java", "class AppTest {}"),
    ]);
    assert_eq!(p.kinds[0].value, K::WebBackend);
    assert!(has(&p.frameworks, "Spring Boot"));
    assert!(has(&p.build, "Gradle") && has(&p.tests, "JUnit"));
}

#[test]
fn service_go_grpc() {
    let p = profile_of(&[
        (
            "go.mod",
            "module example.com/orders\n\nrequire google.golang.org/grpc v1.60.0\n",
        ),
        ("cmd/orders/main.go", "package main\nfunc main() {}\n"),
        ("api/orders.proto", "syntax = \"proto3\";"),
        ("internal/store/store_test.go", "package store\n"),
        ("Dockerfile", "FROM golang"),
    ]);
    assert_eq!(p.kinds[0].value, K::Service);
    assert!(has(&p.frameworks, "gRPC"));
    assert!(has(&p.tests, "go test"));
    assert!(kinds(&p).contains(&K::Infrastructure));
    assert!(!kinds(&p).contains(&K::Library));
}

#[test]
fn mobile_flutter() {
    let p = profile_of(&[
        (
            "pubspec.yaml",
            "name: shop\ndependencies:\n  flutter:\n    sdk: flutter\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n",
        ),
        ("lib/main.dart", "void main() {}"),
        ("android/app/src/main/AndroidManifest.xml", ""),
    ]);
    assert_eq!(p.kinds[0].value, K::Mobile);
    assert!(has(&p.frameworks, "Flutter"));
    assert!(has(&p.tests, "flutter test"));
}

#[test]
fn mobile_react_native() {
    let p = profile_of(&[
        (
            "package.json",
            r#"{"name":"app","dependencies":{"react":"18","react-native":"0.74"}}"#,
        ),
        ("App.tsx", ""),
    ]);
    assert_eq!(p.kinds[0].value, K::Mobile);
    assert!(!kinds(&p).contains(&K::WebFrontend));
    assert!(has(&p.frameworks, "React Native"));
}

#[test]
fn mobile_android_kotlin() {
    let p = profile_of(&[
        ("settings.gradle.kts", "include(\":app\")\n"),
        (
            "app/build.gradle.kts",
            "plugins {\n  id(\"com.android.application\")\n}\ndependencies {\n  implementation(\"androidx.compose.ui:ui:1.6\")\n}\n",
        ),
        ("app/src/main/java/a/MainActivity.kt", "class MainActivity"),
    ]);
    assert_eq!(p.kinds[0].value, K::Mobile);
    assert!(has(&p.frameworks, "Android"));
    assert_eq!(langs(&p)[0], "Kotlin");
}

#[test]
fn desktop_tauri() {
    let p = profile_of(&[
        (
            "package.json",
            r#"{"name":"igrasp","scripts":{"test":"vitest"},"dependencies":{"react":"19","@tauri-apps/api":"2"},"devDependencies":{"vitest":"4","@playwright/test":"1"}}"#,
        ),
        (
            "src-tauri/Cargo.toml",
            "[package]\nname = \"igrasp\"\n[dependencies]\ntauri = \"2\"\n",
        ),
        ("src-tauri/tauri.conf.json", "{}"),
        (
            "src-tauri/src/main.rs",
            "fn main() {}\n#[cfg(test)]\nmod t {}\n",
        ),
        ("src/App.tsx", "export function App() {}"),
        ("playwright.config.ts", ""),
    ]);
    assert_eq!(p.kinds[0].value, K::Desktop);
    assert!(!kinds(&p).contains(&K::WebFrontend));
    assert!(has(&p.frameworks, "Tauri") && has(&p.frameworks, "React"));
    assert!(has(&p.tests, "Vitest") && has(&p.tests, "Playwright") && has(&p.tests, "cargo test"));
}

#[test]
fn desktop_electron() {
    let p = profile_of(&[
        (
            "package.json",
            r#"{"name":"notes","main":"main.js","dependencies":{"vue":"3"},"devDependencies":{"electron":"30"}}"#,
        ),
        ("main.js", ""),
    ]);
    assert_eq!(p.kinds[0].value, K::Desktop);
    assert!(!kinds(&p).contains(&K::Library));
    assert!(has(&p.frameworks, "Electron"));
}

#[test]
fn library_rust() {
    let p = profile_of(&[
        (
            "Cargo.toml",
            "[package]\nname = \"slugs\"\n[dependencies]\nunicode-normalization = \"0.1\"\n",
        ),
        (
            "src/lib.rs",
            "pub fn slug() {}\n#[cfg(test)]\nmod tests {}\n",
        ),
    ]);
    assert_eq!(kinds(&p), vec![K::Library]);
    assert!(has(&p.tests, "cargo test"));
    assert_eq!(p.name, "slugs");
}

#[test]
fn library_python() {
    let p = profile_of(&[
        (
            "pyproject.toml",
            "[project]\nname = \"tinyparse\"\ndependencies = []\n[tool.pytest.ini_options]\n",
        ),
        ("src/tinyparse/__init__.py", ""),
        ("tests/test_parse.py", ""),
    ]);
    assert_eq!(kinds(&p), vec![K::Library]);
    assert!(has(&p.tests, "pytest"));
}

#[test]
fn cli_go_cobra() {
    let p = profile_of(&[
        (
            "go.mod",
            "module example.com/tool\n\nrequire github.com/spf13/cobra v1.8.0\n",
        ),
        ("main.go", "package main\n"),
        ("cmd/root.go", "package cmd\n"),
    ]);
    assert_eq!(kinds(&p), vec![K::Cli]);
}

#[test]
fn data_ml_python() {
    let p = profile_of(&[
        ("requirements.txt", "torch==2.3\npandas\n# comment\n"),
        ("notebooks/explore.ipynb", "{}"),
        ("train.py", ""),
        ("dvc.yaml", ""),
    ]);
    assert_eq!(p.kinds[0].value, K::DataMl);
    assert!(has(&p.frameworks, "PyTorch"));
}

#[test]
fn infra_terraform_helm() {
    let p = profile_of(&[
        ("main.tf", "resource \"x\" \"y\" {}"),
        ("variables.tf", ""),
        ("helm/api/Chart.yaml", "name: api"),
        ("scripts/plan.sh", ""),
    ]);
    assert_eq!(p.kinds[0].value, K::Infrastructure);
    assert_eq!(p.kinds[0].confidence, Confidence::High);
    assert!(has(&p.frameworks, "Terraform") && has(&p.frameworks, "Helm"));
}

#[test]
fn embedded_platformio() {
    let p = profile_of(&[
        ("platformio.ini", "[env:esp32]\n"),
        ("src/main.cpp", "void setup() {}"),
    ]);
    assert_eq!(p.kinds[0].value, K::Embedded);
    assert!(has(&p.build, "PlatformIO"));
}

#[test]
fn monorepo_pnpm_cargo() {
    let p = profile_of(&[
        ("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n"),
        ("package.json", r#"{"name":"mono","private":true}"#),
        (
            "packages/web/package.json",
            r#"{"name":"web","dependencies":{"svelte":"5"}}"#,
        ),
        ("packages/web/src/App.svelte", ""),
        ("Cargo.toml", "[workspace]\nmembers = [\"crates/*\"]\n"),
        ("crates/core/Cargo.toml", "[package]\nname = \"core\"\n"),
        ("crates/core/src/lib.rs", ""),
    ]);
    assert!(kinds(&p).contains(&K::Monorepo));
    assert!(kinds(&p).contains(&K::WebFrontend));
    assert_eq!(p.name, "mono");
}

#[test]
fn documentation_mkdocs() {
    let p = profile_of(&[
        ("mkdocs.yml", "site_name: Handbook\n"),
        ("docs/index.md", "# Handbook\n"),
        ("docs/setup.md", "# Setup\n"),
    ]);
    assert_eq!(kinds(&p), vec![K::Documentation]);
    assert!(has(&p.frameworks, "MkDocs"));
}

#[test]
fn markdown_only_is_documentation() {
    let p = profile_of(&[("README.md", "# x\n"), ("guide/a.md", "# a\n")]);
    assert_eq!(kinds(&p), vec![K::Documentation]);
}

#[test]
fn summaries_read_right() {
    let p = profile_of(&[
        (
            "project.godot",
            "config/name=\"Dodge\"\nconfig/features=PackedStringArray(\"4.3\")\n",
        ),
        ("player.gd", "extends Area2D\n"),
    ]);
    assert_eq!(p.summary, "Dodge: a Godot 4.3 game in GDScript.");
    let p = profile_of(&[
        ("Cargo.toml", "[package]\nname = \"slugs\"\n"),
        (
            "src/lib.rs",
            "pub fn slug() {}\n#[cfg(test)]\nmod tests {}\n",
        ),
    ]);
    assert_eq!(
        p.summary,
        "slugs: a library in Rust, tested with cargo test."
    );
}

#[test]
fn corrections_add_remove_and_stand() {
    let mut p = profile_of(&[
        ("project.godot", "config/name=\"Arena\"\n"),
        ("player.gd", "extends Node\n"),
        ("Dockerfile", "FROM x"),
    ]);
    let mut c = ProfileCorrections {
        add_kinds: vec![K::Service, K::Service],
        remove_kinds: vec![K::Infrastructure],
        add_frameworks: vec!["  Nakama ".into(), "nakama".into()],
        notes: "  This is also a dedicated server.  ".into(),
        ..ProfileCorrections::default()
    };
    c.normalize();
    assert_eq!(c.add_kinds, vec![K::Service]);
    assert_eq!(c.add_frameworks, vec!["Nakama".to_owned()]);
    assert_eq!(c.notes, "This is also a dedicated server.");
    apply_corrections(&mut p, &c);
    assert_eq!(kinds(&p), vec![K::Service, K::Game]);
    assert_eq!(p.kinds[0].evidence, vec![BY_YOU.to_owned()]);
    assert!(has(&p.frameworks, "Nakama"));
    assert!(p.summary.starts_with("Arena: a service"), "{}", p.summary);
    // Removing everything leaves Unknown, never an empty list.
    let c = ProfileCorrections {
        remove_kinds: vec![K::Game, K::Infrastructure],
        ..ProfileCorrections::default()
    };
    let mut p = profile_of(&[("project.godot", ""), ("Dockerfile", "")]);
    apply_corrections(&mut p, &c);
    assert_eq!(kinds(&p), vec![K::Unknown]);
}

/// The mock backend's fixture (`src/ipc/mock/mockProfile.ts` hand-writes this detection).
#[test]
fn the_mock_fixture_profile() {
    let p = profile_of(&[
        (
            "package.json",
            r#"{"name":"igrasp-demo","main":"src/main.ts","bin":{"demo":"src/main.ts"},"scripts":{"build":"tsc","test":"vitest run"},"devDependencies":{"typescript":"^5.9.0","vitest":"^4.0.0"}}"#,
        ),
        (".github/workflows/ci.yml", "name: CI\n"),
        ("Makefile", "build:\n\tnpm run build\n"),
        ("src/main.ts", &"export const x = 1;\n".repeat(20)),
        ("scripts/deploy.sh", "echo deploying\n"),
        ("README.md", "# Demo\n"),
    ]);
    assert_eq!(kinds(&p), vec![K::Cli, K::Library]);
    assert_eq!(values(&p.build), vec!["make", "npm scripts"]);
    assert_eq!(values(&p.tests), vec!["Vitest"]);
    assert_eq!(values(&p.ci), vec!["GitHub Actions"]);
    assert_eq!(p.dependencies, vec!["typescript", "vitest"]);
    let modules: Vec<&str> = p.modules.iter().map(|m| m.path.as_str()).collect();
    assert_eq!(modules, vec!["src", "scripts"]);
}

/// The profile card of IGrasp opened on itself must be right.
#[test]
fn dogfooding_the_repository() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let (p, _) = build(&root, &[], &AtomicBool::new(false));
    assert_eq!(p.kinds[0].value, K::Desktop, "{:?}", p.kinds);
    assert!(!kinds(&p).contains(&K::WebFrontend));
    assert!(has(&p.frameworks, "Tauri") && has(&p.frameworks, "React"));
    let l = langs(&p);
    assert!(l.contains(&"Rust") && l.contains(&"TypeScript"), "{l:?}");
    for t in ["Vitest", "cargo test", "Playwright"] {
        assert!(has(&p.tests, t), "{t}: {:?}", values(&p.tests));
    }
    assert!(has(&p.ci, "GitHub Actions"));
    assert_eq!(p.name, "igrasp");
    assert_eq!(p.docs.architecture.as_deref(), Some("docs/architecture.md"));
    assert!(p.docs.adrs >= 20);
    assert!(p.modules.iter().any(|m| m.path == "src-tauri/src/ai"));
    assert!(p.modules.iter().any(|m| m.path == "src/features"));
    assert!(
        p.summary.starts_with("igrasp: a Tauri desktop app in "),
        "{}",
        p.summary
    );
    println!(
        "{}\n{:?}",
        p.summary,
        p.modules.iter().map(|m| &m.path).collect::<Vec<_>>()
    );
}

/// The walk and the profile of the generated 10k-document project stay under 2 s. Run with
/// `cargo test --release --manifest-path src-tauri/Cargo.toml profile_perf -- --ignored --nocapture`.
#[test]
#[ignore = "performance check"]
fn profile_perf_on_the_large_project() {
    let dir = tempfile::tempdir().unwrap();
    crate::perf::generate(dir.path());
    let started = std::time::Instant::now();
    let (p, walk) = build(dir.path(), &[], &AtomicBool::new(false));
    let elapsed = started.elapsed();
    println!(
        "profile of {} files in {elapsed:?} ({} ms reported)",
        walk.files.len(),
        p.built_ms
    );
    assert!(walk.files.len() >= 10_000);
    assert!(elapsed < std::time::Duration::from_secs(2), "{elapsed:?}");
}
