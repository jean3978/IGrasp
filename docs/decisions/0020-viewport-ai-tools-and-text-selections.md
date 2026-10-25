# 0020 — AI tools on the document view, selections sent as text, a chat with its own look

- Status: Accepted
- Date: 2026-10-24
- Supersedes in part: [0018](0018-region-capture-by-dom-rendering.md) (the screenshot)

## Context

The first version of the Phase 3 chat was reviewed by the maintainer (feedback on the 0.3.0
UI):

- the AI buttons sat on the window toolbar, far from what they act on;
- asking about a passage meant drawing a rectangle; there was no way to highlight text like in
  an editor;
- a region went to the model as a screenshot, while the maintainer wants the text;
- the chat looked like the rest of the app (all blue) and like a plain text box rather than a
  chat: answers appeared character by character, the model picker sat in the message area, and
  nothing recalled what the message was about;
- tooltips of the chat were drawn behind it.

## Decision

- **A toolbar over the view** (`features/ai/ViewportToolbar.tsx`), top-right corner of every
  tab and of the empty area when no tab is open, so the chat always has a button (and the focus
  a place to return to): AI Chat, **Ask About Selected Text** (text mode, `Ctrl+Alt+S`) and
  **Ask About a Region** (`Ctrl+Alt+R`), the last two enabled in markdown and code tabs. The
  window toolbar has no AI control any more; the View menu and the shortcuts still reach them.
  In review mode the toolbar moves to the bottom-right corner so the review bar keeps its Apply
  button.
- **Text mode**: a sticky mode (pressed button, `cursor: text`, the chat's colour for the
  selection). A selection pressed in the active tab is attached when the mouse is released,
  wherever (over the chat, the sidebar); Escape outside the chat, or opening another file,
  leaves the mode. The lines come from the blocks (`data-line`) or code rows under the
  selection's line boxes, as for a region.
- **Highlighted text is narrowed** to the source lines that hold it (`narrowToSelection`): the
  rendered text is looked up in the block's source without its markup, at the occurrence
  nearest to where it was highlighted, so a few lines of a long list or paragraph are those
  lines, not the block. When it cannot be found, the block's lines are sent.
- **Selections go as text only.** `AiCapture` gains `selection`, the text exactly as
  highlighted; the provider's prompt quotes it as the selection, then the source of the lines it
  is in as context. A region has no `selection` and sends the source of the blocks it covers.
  No screenshot is taken:
  `modern-screenshot` and `features/capture/screenshot.ts` are removed. The gateway still
  accepts images (`AiStartRequest.images`) for a later feature.
- **The selection stays visible** while the chat is open: line boxes (and the dragged rectangle)
  are kept in the scroll container's content coordinates and painted in a layer inside it, so
  they scroll with the text and survive the focus moving to the chat. Closing the chat, another
  tab, or a change of the file clears them.
- **The chat opens next to the selection** (`rectNear` in `stores/aiPanel.ts`): right, left,
  below or above at its size, else narrower or shorter down to its minimum, else the default
  corner. It never covers the selection when there is room for its minimum size.
- **One line recalls the selection** under the header ("Selection · lines 3–7 · Start of the
  text…", ✕ drops it), and **quick actions** (Rewrite, Shorten, Expand, Fix grammar, Make a
  table, Make a diagram, Explain) send one message each with the selection attached. Their
  instructions ask for an edit of the file (so it goes through the permission settings and the
  inline review) except Explain, which answers in the chat, and state the scope strictly: one
  edit replacing exactly the highlighted text, every other character unchanged (Make a diagram
  only inserts). The model is asked, not forced; the review shows anything outside. The
  transcript shows the action's name, not the instruction.
- **An answer shows in one piece** when it is complete, rendered with the preview's sanitized
  markdown pipeline (tables, code, Mermaid; links resolved like the preview's) in a render cache
  of its own (answers never push the documents' renders out); until then an animated "…"
  (static under `prefers-reduced-motion`) says the provider is writing. The stream is still
  received: a Stop keeps what arrived, and while a permission or confirmation card waits the
  text so far is shown, since it explains what is asked.
- **The chat has its own look**: `--ai-*` tokens in each theme (a warm orange accent, warm
  surfaces, chat bubbles, a bloom made of layered shadows); High Contrast keeps black surfaces
  with orange outlines and no glow. The model picker and a one-line status (version, account,
  session, tokens) move to the header.
- **The model picker lists only what the provider offers**, with no custom id (a typed id
  squeezed the header and could name a model the account cannot use). The Claude provider asks
  the CLI, once per CLI version and logged-in account (listing starts a whole CLI session, so it
  is not repeated at every status check): it starts `claude -p` in stream-json mode from the temporary
  folder, sends the `initialize` control request (no message, no token) and keeps the `models`
  of its answer (`AiModel` gains `description`). `default` maps to no `--model` flag.
- **Tooltips and menus** are layered above every floating panel (`z-index` 4800 and 4700, the
  chat being 4400, below the splash).

## Consequences

- Tokens are still spent only by Send, a quick action, Start on the confirmation card and
  "Start a new conversation from here": the tools only attach a selection.
- The orange accent is a theme choice for the AI chat, not a provider name in code: the
  frontend stays provider-neutral (the neutrality test is unchanged).
- A model that reads images no longer receives one from a region; tables and diagrams are
  understood from their source.
- Text mode uses the webview's own selection, so it covers what the user can select: the
  rendered text of the preview and the code viewer's lines.
