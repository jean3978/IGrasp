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

## Review mode (an AI edit)

When the AI proposes an edit to a markdown file inside the folder, the file's tab opens (or comes
to the front, as a preview tab) in **review mode**: the current and the proposed content are
rendered through the same pipeline, and each change is shown in place, the removed blocks in red
then the added blocks in green (a new file is compared with an empty document). The rendered
diff module and its limits are described in
[ADR 0017](../decisions/0017-rendered-markdown-diff-at-block-level.md).

- **Change units**: one per hunk of an `Edit` / `MultiEdit` (hunks in the same paragraph form
  one unit, "2 edits in this paragraph"), one per changed block group of a `Write`. Each unit
  has **Accept** / **Reject** at its top right, then its state with **Undo**. A focused unit
  (`Tab`) takes `A` / `R`; a live region announces each decision.
- **Review bar**: "Claude proposes 3 changes to docs/a.md" (the provider's name), the count decided, **Accept all**
  (accepts the undecided units and answers, `Alt+Shift+A`), **Reject all** (answers at once,
  `Alt+Shift+R`), **Open in chat**, and **Apply** once every unit is decided and one is accepted.
- **Answer**: the accepted hunks (or, for a `Write`, the content composed from the accepted
  blocks) go to the provider, which writes the file; nothing accepted is a rejection. The tab
  leaves review mode at once and the live reload shows the written file; the chat says "Applied
  2 of 3 changes to docs/a.md". A rejected new file closes its tab.
- The chat shows an **Edit card** with **Review in preview**, Accept all and Reject all; with the
  chat closed, the status bar item ("1 edit to review") leads to the review.
- **Fallbacks**: an edit of another file, outside the folder, of a document too large to render,
  or whose text is no longer in the file is shown as a line diff in the chat, accepted or
  rejected as a whole.

## Videos

Videos play inline with the system webview. When a video cannot be played (for example on Linux
without the GStreamer codecs), a card replaces it with an **Open externally** button, which opens
the file with the system's default player. Only media files can be opened this way, never
programs or scripts. The README lists the GStreamer packages to install on Linux.
