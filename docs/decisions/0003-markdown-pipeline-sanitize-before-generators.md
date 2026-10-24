# 0003 — Markdown pipeline: sanitize before the trusted generators

- Status: Accepted
- Date: 2026-10-23

## Context

Markdown files may contain raw HTML, and AI agents write them. The preview must render GitHub
Flavored Markdown, GitHub alerts, front matter, math (KaTeX) and highlighted code (Shiki). KaTeX
and Shiki produce markup with inline `style` attributes and specific class names, which a
sanitizer would normally strip.

## Decision

- One unified pipeline: `remark-parse` → `remark-gfm` → `remark-frontmatter` (front matter is
  extracted into a card and removed from the document) → `remark-math` → `remark-rehype` →
  `rehype-raw` (parse inline HTML) → `rehype-github-alerts` → **`rehype-sanitize`** →
  `rehype-slug` → KaTeX → Shiki → React (`hast-util-to-jsx-runtime`).
- **Sanitize first, then run the trusted generators.** User HTML is cleaned by an explicit schema
  (GitHub's defaults plus `video`/`source`, alert markup and a few attributes): no `script`,
  `iframe`, `style` attribute, event handler or `javascript:` URL can pass. KaTeX and Shiki run
  afterwards on the sanitized tree, so their own inline styles are kept.
- Alert icons are React components, so no SVG has to be allowed through the sanitizer.
- Remote images and videos must use `https:`; plain `http:` sources are dropped (privacy and
  mixed content). Relative paths are resolved to files under the opened folder.
- Every id gets the `user-content-` prefix exactly once (by the sanitizer for footnotes and by
  `rehype-slug` for headings), so a document cannot clobber ids of the app. Anchor links `#x` are
  resolved to `user-content-x`.
- Content Security Policy: `script-src 'self'` (no inline scripts), but `style-src 'self'
  'unsafe-inline'` because KaTeX, Shiki and Mermaid emit inline styles. Tauri's automatic style
  nonce is disabled (`dangerousDisableAssetCspModification: ["style-src"]`): a nonce would make
  the webview ignore `'unsafe-inline'`. Scripts stay hash-protected by Tauri.
- Rendering runs outside React's render (an effect with cancellation), results are cached per
  content, and files above 2 MB are shown as plain text. The processor can move to a Web Worker
  later without changing the hook's interface.

## Consequences

- Style injection from user HTML is impossible because the attribute is removed before any
  trusted output exists; allowing inline styles in the CSP only benefits trusted generators.
- New HTML features must be added to the sanitize schema deliberately.
