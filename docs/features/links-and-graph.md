# Links, broken links, backlinks and outline

## Following links

Every link of the preview is handled by the app (the webview never navigates):

| Link | Behavior |
|---|---|
| `#heading` | Scrolls to the heading and flashes it. A missing heading is flagged. |
| `guide.md`, `../a.md`, `/docs/a.md`, `a.markdown` | Opens the document in the preview tab. `Ctrl+click` or a middle click keeps the tab open. |
| `guide.md#section` | Opens the document, then scrolls to the heading once it is rendered. A missing heading still opens the document, and the link is flagged. |
| `Docs/Guide.md` when the file is `docs/guide.md` | Opens the actual file, flagged in orange: "wrong case" works on Windows but breaks on Linux. |
| `docs/` or `docs` (a folder) | Reveals and expands the folder in the Explorer, and opens its `README.md` when it has one. |
| `src/main.rs`, `Makefile`, `data.json` | Opens the [code viewer](code-viewer.md); `#L12` or `#L12-L20` selects lines. |
| `image.png`, `video.mp4` | Opens with the system viewer or player. |
| `https://…`, `http://…`, `mailto:…` | System browser or mail client. |
| `../../outside.md` (above the folder) | Inert, flagged "outside the opened folder". |
| `file:`, `ftp:` and other schemes | Inert. |

Hovering a link shows its target in the status bar, like a browser. Heading anchors match the
ids the preview generates exactly, or ignoring case.

## Broken links

A link is **broken** when its file does not exist, its heading does not exist in the target, its
path has the wrong case, or it leaves the folder. Broken links get a **red wavy underline**
(orange for wrong case) and a tooltip with the reason: "File not found: docs/old.md", "Heading
not found: #setup in docs/a.md", "Wrong case: the file is docs/guide.md".

The **Broken Links** view (`Ctrl+Shift+L`, or click "⚠ 3 broken links" in the status bar) lists
them all, by document, with the kind of problem, the link text, its target and line. Chips filter
by kind (missing file, missing heading, wrong case, outside folder). Clicking a link opens its
document at that line with the link text highlighted; a row action copies the target path. The
activity bar shows the count.

Nothing is flagged while the folder is still being indexed, and a link to a heading is only
checked once its target document has been parsed: the app never guesses.

## Backlinks

The **Backlinks** section of the right panel lists the documents that link to the active one,
grouped by file, with each link's text, heading and line. Clicking one opens the linking document
at that line. Only markdown-to-markdown links count (source files are not parsed).

## Outline

The **Outline** section of the right panel is the table of contents of the active document,
built from the rendered document itself (so it always matches what you see):

- headings nest by level; a skipped level nests under the nearest higher heading;
- **follow scroll** (on by default) highlights the section at the top of the window and keeps it
  in view;
- the filter box keeps matching headings and their parents; `Ctrl+Shift+O` focuses it;
- chevrons collapse sections (remembered while the document is open); *Collapse all* in the
  header;
- click or Space jumps to the heading and keeps the focus in the outline; Enter jumps and moves
  the focus to the document. ← / → collapse, expand and move between levels.

## The document graph

Broken links, backlinks and Ctrl+T's headings come from the **document graph** that Rust keeps
for the whole folder ([ADR 0009](../decisions/0009-document-graph-in-rust.md)):

- after the folder is indexed, every markdown file is read and parsed (`pulldown-cmark`) on up to
  8 threads: headings with their anchors (GitHub-compatible slugs, the same as the preview's),
  HTML `id` / `name` anchors, and every link with its resolved target;
- when files change, only those files are parsed again, and only the links that point at a
  changed path are checked again, including links to source files and folders that appear or
  vanish;
- the frontend asks for what it shows (links of the open documents, backlinks of the active one,
  the broken links report) and refreshes it when `graph://changed` says it is affected.

Measured on 10,000 documents with 150,000 links (release build): built in about 0.4 s, 50 changed
files updated in about 26 ms, the broken links report in 2 ms.

### Known differences with the preview

The graph parses markdown with `pulldown-cmark` while the preview uses remark. Shared fixtures
(`src/test/fixtures/slugs.json` and `src/test/fixtures/markdown/headings.json`) keep their
headings identical on the cases that matter. Known gaps: headings written as HTML blocks
(`<h2>…</h2>`) get an id in the preview but are not anchors for the graph, and bare-URL autolinks
(`www.example.com`) are not seen as links (they are external anyway).
