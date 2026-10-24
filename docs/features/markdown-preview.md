# Markdown preview

Clicking a file in the Explorer shows it rendered, with a GitHub-like reading style.

## What is rendered

| Feature | Notes |
|---|---|
| GitHub Flavored Markdown | Tables (with column alignment), task lists (read-only checkboxes), footnotes, strikethrough, autolinks. |
| GitHub alerts | `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`, with icons and GitHub colors. |
| Code | Syntax highlighting by [Shiki](https://shiki.style) with GitHub's themes; languages load on demand; unknown languages stay plain. Each block has a language badge and a copy button. |
| Math | `$inline$` and `$$display$$` math with [KaTeX](https://katex.org) (MathML kept for screen readers). Like GitHub, `$5 and $10` stays text. Invalid TeX shows in red instead of breaking the page. |
| Mermaid | See [mermaid.md](mermaid.md). |
| Front matter | YAML front matter is shown as a card above the document: fields, lists as chips, nested objects collapsed, a YAML toggle, and a message for invalid YAML. |
| Inline HTML | Allowed after sanitization (`details`, `summary`, `kbd`, `sup`, `sub`, `video`, …). |
| Images and videos | Relative paths are resolved from the document's folder (a leading `/` means the opened folder). Remote media must use `https:`. |

Files larger than 2 MB are shown as plain text with a notice; files larger than 20 MB are not
opened.

## Safety

AI agents write these files, so the preview treats them as untrusted (see
[ADR 0003](../decisions/0003-markdown-pipeline-sanitize-before-generators.md)):

- HTML is sanitized before any trusted generator runs: no scripts, iframes, `style` attributes,
  event handlers or `javascript:` links.
- Media outside the opened folder is refused, and plain `http:` images are replaced by a
  "blocked insecure image" placeholder.
- Every id gets a `user-content-` prefix, so a document cannot clash with the app's own ids.
- The webview never navigates: every link click is handled by the app.

## Links

| Link | Behavior |
|---|---|
| `#heading` | Scrolls to the heading (or footnote) and flashes it. |
| `https://…`, `mailto:…` | Opens in the system browser or mail client. |
| `other.md`, `../docs/a.md`, `other.md#part` | Opens the file in a tab (scrolled to the heading). |
| `src/main.rs#L10-L20`, folders, media | Code viewer, Explorer, system viewer. |

Broken links are flagged with a wavy underline. The full rules, broken links, backlinks and the
outline are described in [links-and-graph.md](links-and-graph.md).

## Videos

Videos play inline with the system webview. When a video cannot be played (for example on Linux
without the GStreamer codecs), a card replaces it with an **Open externally** button, which opens
the file with the system's default player. Only media files can be opened this way, never
programs or scripts. The README lists the GStreamer packages to install on Linux.
