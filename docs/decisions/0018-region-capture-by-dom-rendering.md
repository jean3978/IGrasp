# 0018 — Region capture by rendering the DOM

- Status: Accepted (Linux verification of asset images pending)
- Date: 2026-10-24

## Context

"Ask about a region" lets the user select a rectangle of the preview (or of a code tab) and send
it to the AI with its source lines and an image of how it is rendered (plan §6.10). The image
matters: tables, diagrams, math and images cannot be understood from markdown alone.

Options (plan §15 Q2):

- **OS-level screenshot** (a Tauri plugin or the platform APIs): captures pixels exactly, but
  needs a new capability, differs per platform, and is not available under Wayland without a
  portal and a permission prompt.
- **Rendering the DOM to a canvas** with `modern-screenshot`: portable, no capability, and it
  captures what the preview shows by construction.

## Decision

Render the DOM (`src/features/capture/`):

- **Selection** (`capture.ts`, `CaptureOverlay.tsx`): a rectangle in client coordinates, by mouse
  drag (at least 24 x 24 px) or by keyboard (arrows from a 200 x 120 rectangle, Shift+arrows
  resize, Enter, Escape).
- **Lines**: markdown blocks carry `data-line`. The capture covers the intersected blocks, from
  the smallest start line to the line before the next block (or the document end). If nothing
  intersects (an image only), the nearest block's line with an empty text. Code tabs use the
  rendered rows (`.code-line[data-index]`), since the viewer is virtualized.
- **Image** (`screenshot.ts`): `domToCanvas` of the scroll container, clipped to the selection
  plus a 12 px margin, a 2 px outline in the accent token around the selection, long edge at most
  1568 px, PNG under 1.5 MB, otherwise JPEG at 0.85. A thumbnail is made for the attachment chip.
  The pixel work is behind an injectable `RenderBackend`, because jsdom has no canvas.
- **Scroll offset trick**: `domToCanvas` clones the element, and the clone is not scrolled. The
  clone gets `overflow: visible`, `height: auto` and `transform: translate(-scrollLeft,
  -scrollTop)`, while the canvas is sized to the visible box, so it shows what is on screen. Checked in
  Chromium on a scrolled document in the three themes.
- **Failure is not fatal**: any failure raises a typed `ScreenshotError` (`empty`, `render`,
  `encode`). A canvas tainted by a cross-origin image refuses to export (`encode`). The caller
  then attaches the text only and tells the user ("The screenshot could not be taken; the text
  was attached.").
- Nothing is sent by the capture itself: the AI gateway rule (a user action per operation)
  applies when the user presses Send.

## Consequences

- No new Tauri capability and no platform-specific code; it behaves the same on Windows and
  Linux, Wayland included.
- The image is a re-render, not a pixel copy: it can differ slightly from the screen
  (fonts, sticky elements, some CSS effects), which is acceptable for a model reading it.
- Images in the document are served through the asset protocol. Whether WebKitGTK lets the canvas
  draw and export them without tainting is **not yet verified on Linux** and must be checked by
  hand; until then the text-only fallback covers it. Mermaid and math render as DOM/SVG and are
  expected to work.
- Large visible areas cost a render of the whole scroll container; the selection is typically
  small, but a full-viewport capture can take a moment.
