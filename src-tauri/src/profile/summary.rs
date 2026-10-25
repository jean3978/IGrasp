//! The documentation facts and the one-line summary of a profile: what the card shows first and
//! what every learning prompt opens with.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::walk::Walk;
use super::{Confidence, ProjectKind, ProjectProfile};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DocsFacts {
    /// The root README, when there is one.
    pub readme: Option<String>,
    /// `docs/features/*.md` (or `docs/feature/`), the feature pages.
    pub feature_pages: Vec<String>,
    /// The folder of the architecture decision records, when there is one.
    pub adr_dir: Option<String>,
    pub adrs: u32,
    /// An architecture page (`docs/architecture.md`, `ARCHITECTURE.md`), when there is one.
    pub architecture: Option<String>,
    /// Other subfolders of `docs/`.
    pub docs_dirs: Vec<String>,
    pub markdown_files: u64,
}

const ADR_DIRS: &[&str] = &[
    "docs/decisions",
    "docs/adr",
    "docs/adrs",
    "docs/architecture/decisions",
    "doc/adr",
    "adr",
    "adrs",
];

pub fn docs_facts(walk: &Walk) -> DocsFacts {
    let md = |p: &str| {
        let l = p.to_lowercase();
        l.ends_with(".md") || l.ends_with(".markdown")
    };
    let readme = walk
        .files
        .iter()
        .find(|f| f.depth() == 0 && f.name.starts_with("readme"))
        .map(|f| f.path.clone());
    let lower_dir = |f: &super::walk::FileFact| f.dir().to_lowercase();
    let feature_pages: Vec<String> = walk
        .files
        .iter()
        .filter(|f| {
            md(&f.path) && matches!(lower_dir(f).as_str(), "docs/features" | "docs/feature")
        })
        .map(|f| f.path.clone())
        .collect();
    let adr_dir = walk.files.iter().find_map(|f| {
        let dir = lower_dir(f);
        (md(&f.path) && ADR_DIRS.contains(&dir.as_str())).then(|| f.dir().to_owned())
    });
    let adrs = adr_dir.as_deref().map_or(0, |d| {
        walk.files
            .iter()
            .filter(|f| f.dir() == d && md(&f.path) && !f.name.starts_with("readme"))
            .count()
    });
    let architecture = walk
        .files
        .iter()
        .find(|f| {
            matches!(
                f.path.to_lowercase().as_str(),
                "docs/architecture.md" | "architecture.md" | "doc/architecture.md"
            )
        })
        .map(|f| f.path.clone());
    let mut docs_dirs: Vec<String> = walk
        .files
        .iter()
        .filter(|f| md(&f.path) && f.path.to_lowercase().starts_with("docs/") && f.depth() >= 2)
        .map(|f| f.path.split('/').take(2).collect::<Vec<_>>().join("/"))
        .filter(|d| Some(d) != adr_dir.as_ref() && !d.eq_ignore_ascii_case("docs/features"))
        .collect();
    docs_dirs.dedup();
    docs_dirs.sort();
    docs_dirs.dedup();
    DocsFacts {
        readme,
        feature_pages,
        adr_dir,
        adrs: u32::try_from(adrs).unwrap_or(u32::MAX),
        architecture,
        docs_dirs,
        markdown_files: walk.files.iter().filter(|f| md(&f.path)).count() as u64,
    }
}

/// The frameworks that are the shell of a kind ("Tauri desktop app").
fn shell_of(kind: ProjectKind, frameworks: &[&str]) -> Option<String> {
    let shells: &[&str] = match kind {
        ProjectKind::Desktop => &["Tauri", "Electron", "WPF", "WinUI", "Avalonia", "Qt", "GTK"],
        ProjectKind::Mobile => &["Flutter", "React Native", ".NET MAUI", "Android"],
        ProjectKind::WebFrontend => &["Next.js", "Nuxt", "SvelteKit", "Remix", "Astro"],
        ProjectKind::WebBackend | ProjectKind::Service => &[
            "Django",
            "FastAPI",
            "Flask",
            "Spring Boot",
            "ASP.NET Core",
            "Express",
            "NestJS",
            "Ruby on Rails",
            "Laravel",
            "Axum",
            "Actix Web",
            "Gin",
            "gRPC",
        ],
        ProjectKind::Documentation => &["MkDocs", "Docusaurus", "mdBook"],
        _ => &[],
    };
    shells
        .iter()
        .find(|s| frameworks.contains(s))
        .map(|s| (*s).to_owned())
}

/// "A, B and C".
pub fn and_list(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [one] => one.clone(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    }
}

/// "Tauri desktop app in Rust and TypeScript (React), also a monorepo, tested with Vitest and
/// cargo test."
pub fn summary(p: &ProjectProfile) -> String {
    let Some(first) = p.kinds.first() else {
        return format!("{}: a project.", p.name);
    };
    let frameworks: Vec<&str> = p.frameworks.iter().map(|f| f.value.as_str()).collect();
    let mut head = match (first.value, p.engines.first()) {
        (ProjectKind::Game, Some(engine)) => format!("{} game", engine.value),
        (kind, _) => match shell_of(kind, &frameworks) {
            Some(shell) => format!("{shell} {}", kind.label()),
            None => kind.label().to_owned(),
        },
    };
    let langs: Vec<String> = p
        .languages
        .iter()
        .filter(|l| l.programming && l.percent >= 5.0)
        .take(3)
        .map(|l| l.name.clone())
        .collect();
    if !langs.is_empty() {
        head.push_str(&format!(" in {}", and_list(&langs)));
    }
    let lead = head.clone();
    let others: Vec<String> = p
        .frameworks
        .iter()
        .filter(|f| f.confidence == Confidence::High && !lead.contains(&f.value))
        .take(3)
        .map(|f| f.value.clone())
        .collect();
    if !others.is_empty() {
        head.push_str(&format!(" ({})", others.join(", ")));
    }
    let also: Vec<String> = p
        .kinds
        .iter()
        .skip(1)
        .filter(|k| k.confidence == Confidence::High)
        .take(2)
        .map(|k| k.value.label().to_owned())
        .collect();
    if !also.is_empty() {
        head.push_str(&format!(", also a {}", and_list(&also)));
    }
    let tests: Vec<String> = p.tests.iter().take(3).map(|t| t.value.clone()).collect();
    if !tests.is_empty() {
        head.push_str(&format!(", tested with {}", and_list(&tests)));
    }
    let article = if head.starts_with(['A', 'E', 'I', 'O', 'U', 'a', 'e', 'i', 'o', 'u']) {
        "an"
    } else {
        "a"
    };
    format!("{}: {article} {head}.", p.name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::walk::FileFact;

    #[test]
    fn docs_facts_find_readme_features_adrs_and_architecture() {
        let w = Walk::from_files(
            [
                "README.md",
                "docs/architecture.md",
                "docs/features/quiz.md",
                "docs/features/search.md",
                "docs/decisions/0001-x.md",
                "docs/decisions/README.md",
                "docs/plan/phase-1.md",
                "src/a.rs",
            ]
            .iter()
            .map(|p| FileFact::new(p, 1))
            .collect(),
        );
        let d = docs_facts(&w);
        assert_eq!(d.readme.as_deref(), Some("README.md"));
        assert_eq!(d.feature_pages.len(), 2);
        assert_eq!(d.adr_dir.as_deref(), Some("docs/decisions"));
        assert_eq!(d.adrs, 1);
        assert_eq!(d.architecture.as_deref(), Some("docs/architecture.md"));
        assert_eq!(d.docs_dirs, vec!["docs/plan".to_owned()]);
        assert_eq!(d.markdown_files, 7);
    }

    #[test]
    fn and_list_joins() {
        let s = |v: &[&str]| and_list(&v.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>());
        assert_eq!(s(&[]), "");
        assert_eq!(s(&["a"]), "a");
        assert_eq!(s(&["a", "b", "c"]), "a, b and c");
    }
}
