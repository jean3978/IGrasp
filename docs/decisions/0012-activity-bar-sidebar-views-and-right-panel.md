# 0012 — Activity bar, sidebar views and a right panel

- Status: Accepted
- Date: 2026-10-24

## Context

Phase 2 adds four views that belong next to the Explorer (Search, Recent changes, Broken links;
a Git view comes later) and two sections about the active document (Outline, Backlinks; a Git
status panel comes later). They need a home that scales, keeps the document wide, and feels
familiar to people coming from VS Code.

## Decision

- A VS Code-style **activity bar** (40 px icons at the far left) switches the sidebar between the
  views. It is a `tablist` (one tab stop, ↑ / ↓ between views) with badges (broken links count,
  a spinner while a search runs), and each view has a shortcut and a View menu entry.
- The activity bar **stays visible when the sidebar is hidden**, and clicking the active view
  toggles the sidebar, as in VS Code. (The plan placed the bar inside the sidebar so that `Ctrl+B`
  hid both; then hiding the sidebar from the bar would have removed the bar itself.)
- A **right panel** (a collapsible `react-resizable-panels` panel) holds collapsible sections for
  the active document, Outline and Backlinks, hidden by default and toggled with `Ctrl+Alt+B`.
- The session saves `sidebarView` and `rightPanel { visible, widthPx }`; both use
  `#[serde(default)]`, so sessions saved by 0.1.0 load unchanged and the session `version` stays
  1.

## Consequences

- New views and panels slot in without new layout work; the Git phase adds an icon and a section.
- The window loses 40 px of width to the bar, the price of an always-reachable set of views.
- The plan's one-time "Outline and backlinks are in the right panel" hint toast is not built yet;
  the toolbar button and the View menu make the panel discoverable meanwhile.
