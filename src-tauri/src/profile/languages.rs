//! Languages by file count and bytes, from the extension table. Generated and vendored files do
//! not count: they say nothing about what the project is written in.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::walk::{FileFact, Walk};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LanguageShare {
    pub name: String,
    pub files: u64,
    pub bytes: u64,
    /// Share of the bytes of every counted language, 0–100, one decimal.
    pub percent: f64,
    /// A programming language (the summary names these), not markup or styles.
    pub programming: bool,
}

/// `(extension, language, programming)`. Data formats (JSON, YAML, TOML) are not languages here.
const EXTENSIONS: &[(&str, &str, bool)] = &[
    ("rs", "Rust", true),
    ("ts", "TypeScript", true),
    ("tsx", "TypeScript", true),
    ("mts", "TypeScript", true),
    ("cts", "TypeScript", true),
    ("js", "JavaScript", true),
    ("jsx", "JavaScript", true),
    ("mjs", "JavaScript", true),
    ("cjs", "JavaScript", true),
    ("py", "Python", true),
    ("pyi", "Python", true),
    ("ipynb", "Jupyter Notebook", true),
    ("cs", "C#", true),
    ("fs", "F#", true),
    ("vb", "Visual Basic", true),
    ("cpp", "C++", true),
    ("cc", "C++", true),
    ("cxx", "C++", true),
    ("hpp", "C++", true),
    ("hh", "C++", true),
    ("hxx", "C++", true),
    ("inl", "C++", true),
    ("c", "C", true),
    ("h", "C", true),
    ("m", "Objective-C", true),
    ("mm", "Objective-C++", true),
    ("go", "Go", true),
    ("java", "Java", true),
    ("kt", "Kotlin", true),
    ("kts", "Kotlin", true),
    ("scala", "Scala", true),
    ("groovy", "Groovy", true),
    ("gradle", "Groovy", true),
    ("swift", "Swift", true),
    ("dart", "Dart", true),
    ("gd", "GDScript", true),
    ("rb", "Ruby", true),
    ("php", "PHP", true),
    ("lua", "Lua", true),
    ("luau", "Luau", true),
    ("ex", "Elixir", true),
    ("exs", "Elixir", true),
    ("erl", "Erlang", true),
    ("hs", "Haskell", true),
    ("ml", "OCaml", true),
    ("clj", "Clojure", true),
    ("zig", "Zig", true),
    ("nim", "Nim", true),
    ("jl", "Julia", true),
    ("r", "R", true),
    ("pl", "Perl", true),
    ("sh", "Shell", true),
    ("bash", "Shell", true),
    ("zsh", "Shell", true),
    ("ps1", "PowerShell", true),
    ("psm1", "PowerShell", true),
    ("bat", "Batchfile", true),
    ("cmd", "Batchfile", true),
    ("sql", "SQL", true),
    ("hlsl", "HLSL", true),
    ("glsl", "GLSL", true),
    ("vert", "GLSL", true),
    ("frag", "GLSL", true),
    ("comp", "GLSL", true),
    ("wgsl", "WGSL", true),
    ("shader", "ShaderLab", true),
    ("cginc", "HLSL", true),
    ("usf", "HLSL", true),
    ("ush", "HLSL", true),
    ("gdshader", "Godot Shading Language", true),
    ("metal", "Metal", true),
    ("tf", "HCL", true),
    ("hcl", "HCL", true),
    ("nix", "Nix", true),
    ("cmake", "CMake", true),
    ("proto", "Protocol Buffers", true),
    ("graphql", "GraphQL", true),
    ("gql", "GraphQL", true),
    ("sol", "Solidity", true),
    ("vue", "Vue", true),
    ("svelte", "Svelte", true),
    ("astro", "Astro", true),
    ("html", "HTML", false),
    ("htm", "HTML", false),
    ("css", "CSS", false),
    ("scss", "SCSS", false),
    ("sass", "Sass", false),
    ("less", "Less", false),
    ("md", "Markdown", false),
    ("markdown", "Markdown", false),
    ("mdx", "MDX", false),
    ("rst", "reStructuredText", false),
    ("tex", "TeX", false),
    ("tscn", "Godot Scene", false),
    ("tres", "Godot Resource", false),
    ("xaml", "XAML", false),
];

const BY_NAME: &[(&str, &str, bool)] = &[
    ("makefile", "Makefile", true),
    ("cmakelists.txt", "CMake", true),
    ("dockerfile", "Dockerfile", true),
    ("justfile", "Just", true),
];

/// Folders of generated or vendored files, by name of any component.
const GENERATED_DIRS: &[&str] = &[
    "dist",
    "build",
    "target",
    "vendor",
    "out",
    "obj",
    "generated",
    "__generated__",
    "third_party",
    "thirdparty",
    "external",
    "intermediate",
    "binaries",
    "deriveddatacache",
    "saved",
    ".godot",
    ".import",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    ".next",
    ".nuxt",
];

/// Generated or vendored: a generated folder anywhere on the path, minified or `*.generated.*`
/// files, lock files.
pub fn is_generated(path: &str) -> bool {
    let lower = path.to_lowercase();
    let mut parts = lower.split('/').peekable();
    while let Some(part) = parts.next() {
        // Only folders count (a file named `build` is a script).
        if parts.peek().is_some() && GENERATED_DIRS.contains(&part) {
            return true;
        }
    }
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    name.contains(".min.")
        || name.contains(".generated.")
        || name.ends_with(".g.dart")
        || name.ends_with(".designer.cs")
        || name.ends_with(".lock")
        || name == "package-lock.json"
        || name == "pnpm-lock.yaml"
}

/// The language of a file and whether it is a programming language.
pub fn language_of(f: &FileFact) -> Option<(&'static str, bool)> {
    BY_NAME
        .iter()
        .find(|(n, _, _)| *n == f.name)
        .or_else(|| EXTENSIONS.iter().find(|(e, _, _)| *e == f.ext))
        .map(|(_, l, p)| (*l, *p))
}

/// Shares by bytes, largest first, of every language with at least one file.
pub fn shares(walk: &Walk) -> Vec<LanguageShare> {
    let mut by: BTreeMap<&'static str, (u64, u64, bool)> = BTreeMap::new();
    for f in &walk.files {
        if is_generated(&f.path) {
            continue;
        }
        if let Some((lang, programming)) = language_of(f) {
            let e = by.entry(lang).or_insert((0, 0, programming));
            e.0 += 1;
            e.1 += f.size;
        }
    }
    let total: u64 = by.values().map(|v| v.1).sum();
    let mut out: Vec<LanguageShare> = by
        .into_iter()
        .map(|(name, (files, bytes, programming))| LanguageShare {
            name: name.to_owned(),
            files,
            bytes,
            percent: if total == 0 {
                0.0
            } else {
                // Precision loss is irrelevant for a one-decimal share.
                #[allow(clippy::cast_precision_loss)]
                let p = (bytes as f64 * 1000.0 / total as f64).round() / 10.0;
                p
            },
            programming,
        })
        .collect();
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes).then(b.files.cmp(&a.files)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_by_bytes_and_skips_generated() {
        let w = Walk::from_files(vec![
            FileFact::new("src/a.rs", 300),
            FileFact::new("src/b.ts", 100),
            FileFact::new("src/c.tsx", 100),
            FileFact::new("dist/bundle.js", 10_000),
            FileFact::new("src/x.min.js", 10_000),
            FileFact::new("src/ipc/generated/T.ts", 10_000),
            FileFact::new("README.md", 500),
            FileFact::new("Makefile", 0),
            FileFact::new("data.json", 9_999),
        ]);
        let s = shares(&w);
        let names: Vec<&str> = s.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["Markdown", "Rust", "TypeScript", "Makefile"]);
        let ts = &s[2];
        assert_eq!((ts.files, ts.bytes), (2, 200));
        assert!((ts.percent - 20.0).abs() < f64::EPSILON);
        assert!(!s[0].programming);
    }

    #[test]
    fn generated_paths() {
        assert!(is_generated("target/debug/x.rs"));
        assert!(is_generated("web/node/dist/a.js"));
        assert!(is_generated("Cargo.lock"));
        assert!(!is_generated("scripts/build"));
        assert!(!is_generated("src/builder.rs"));
    }
}
