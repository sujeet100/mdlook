# Changelog

## Unreleased

- GitHub task lists render as checkboxes in popup mode (were literal `[x]` text)
- `--version`/`-v` flag; usage errors now exit 2 (was 1)
- Piped input with no file argument is read automatically (`cat x.md | mdlook`)
- Test suite (`node:test`), Biome lint/format, CI workflow
- Lockfile regenerated against the public npm registry
- Live-reload watcher survives the watched directory being deleted

## 0.1.2 — 2026-06-12

- H1 banner uses inverse video (readable on any theme; was black-on-cyan)
- H2 headings render as full-width bands using fixed 256-cube colors
  (theme palettes remap ANSI colors; Catppuccin made the old band unreadable)
- Bold/italics/inline code render correctly inside list items
- H1 no longer corrupts ANSI escapes when uppercasing
- Remote images (CI badges) render as labeled links instead of raw markdown
- `&nbsp;` entities become spaces; loose-list spacing artifacts removed
- Showcase demo doc and README screenshots

## 0.1.1 — 2026-06-12

- GitHub alerts (`> [!NOTE]` etc.) in both terminal and popup modes
- YAML frontmatter split off and shown as a collapsible block in the popup
- Auto-pager for long documents (`--pager`/`--no-pager`)
- `--plain` mode: minimal GitHub-faithful styling
- Friendlier error for directories

## 0.1.0 — 2026-06-12

Initial release: terminal rendering with inline mermaid diagrams via the Kitty
graphics protocol, popup window mode with live reload and dark-mode toggle,
content-hash diagram caching, theme-aware code panels.
