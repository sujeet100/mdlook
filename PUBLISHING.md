# Open-sourcing mdv — assessment and plan

*Compiled 2026-06-12 from a market research pass (GitHub/npm/HN, verified June 2026) and a
skeptical end-user code audit.*

## Is it worth publishing?

**Yes — the demand is real and measured.** glow (25.8k stars, the category leader) has
"display images in terminal" as its top-voted open issue (107 👍) and "support mermaid"
at 62 👍, open for four years. The pending glow fix renders mermaid as ASCII art, not
images. Nobody in the big-star tier does image-fidelity mermaid, and **no tool anywhere
does both terminal and popup with live reload**.

**But the window is closing.** mdserve (Rust) went 0 → 407 stars in ~9 months doing the
browser half with mermaid + live reload, and is explicitly marketing to Claude Code
users. A tiny Rust tool (21 stars) already does mermaid-as-Kitty-images in the terminal —
and it's named mdv. Ship sooner rather than later, and lead with the thing only this
tool has: **one command, real diagrams, terminal or popup.**

## The name must change

Three-way collision: npm `mdv` is taken (a markdown *validator* whose bin is also
`mdv`), pip `mdv` is a 1.9k-star Python viewer, and the Rust near-clone is also `mdv`.
Verified available on npm today: **mdlook, mdpop, mdglance, mdvu, mermd**.
(`mermd` leans into the mermaid differentiator; `mdlook` reads nicely with a `mdlookw`
sibling.)

## Honest product review

**Beautiful?** Terminal: yes, distinctively — banner H1, per-level heading colors, shaded
code panels, theme-aware diagrams. More personality than glow's default. Popup: familiar
GitHub base with the gradient accents and a dark toggle. The risk: beauty is opinionated.
Ship a `--plain` flag / theme config for people who want GitHub-faithful or glow-muted.

**Intuitive?** The happy path is excellent: `mdv file.md`, zero config, no flags to learn.
The *failure* paths are not, and that's what first-wave users hit (see deal breakers).

**Deal breakers found in the audit** (all must be fixed before `npm publish`):

1. `package.json` is unpublishable: `"private": true`, no license/repository/engines/files.
2. Chrome discovery is macOS-only (4 hardcoded `/Applications` paths). No `CHROME_PATH`
   override. On Linux both mermaid and popup are dead on arrival.
3. The `open` browser fallback is darwin-only and **crashes the server with an unhandled
   ENOENT on Linux** (no error handler on the spawn).
4. No graphics-capability detection. In iTerm2, VS Code's terminal, Terminal.app, or
   Windows Terminal, diagrams either vanish silently or print kilobytes of base64
   garbage. Needs a capability probe or env allowlist (KITTY_WINDOW_ID, TERM=xterm-kitty,
   GHOSTTY_*, WEZTERM_*) with graceful fallback to the source fence.
5. Environment failures ("Chrome not found", transient launch errors) are written to the
   **negative cache** — install Chrome later and the diagram still "fails" forever unless
   you know about `--refresh`. Only mermaid parse errors should be cached.
6. `mdvw`-by-argv-sniffing breaks under npm's Windows shims — use two bin stub files.
7. The README describes the old mmdc pipeline and the personal-machine symlink install;
   the `~/.local/bin` wrappers hardcode zsh + Homebrew node and must not ship.

**What devs expect, in observed demand order** (glow issues, HN, competitor feature sets):

1. Pager integration with search (~77 combined 👍 across glow issues) — also fixes "5000-line README dumps to scrollback"
2. Inline images ✅ have · 3. Mermaid ✅ have
4. Streaming stdin (`claude | mdv -` re-rendering as it arrives) — the agent-pipeline angle, big in 2026
5. Themes (mdserve ships five, incl. Catppuccin)
6. GFM extras: alerts (`> [!NOTE]` — currently renders as literal text), footnotes, YAML frontmatter (currently renders as garbage — any Obsidian/Hugo user hits this in minutes)
7. TOC + directory browsing (`mdv docs/` currently prints a raw EISDIR)
8. Math/KaTeX (popup at minimum — GitHub renders `$...$`)
9. OSC8 hyperlinks in terminal output
10. HTML/PDF export — nearly free since Chrome is already in the stack, and it would absorb part of mermaid-cli's use case
11. Config file (XDG paths)
12. Cross-platform — the #1 dismissal in every comparison thread; Linux support is table stakes, Windows can follow

## Distribution plan

- **npm, renamed**, with both bins; `npx <name> README.md` must work as the trial path.
  `"engines": {"node": ">=22"}` (Node 20 is past EOL). MIT license. Enable npm provenance.
- **Bundle the CLI with esbuild** (faster cold npx, fewer transitive-dep warnings); keep
  `mermaid`/`puppeteer-core` external or lazy-loaded.
- **Chrome strategy**: keep puppeteer-core + system-browser discovery (this is the proven
  pattern; mermaid-cli's auto-download is its #1 complaint stream). Add Linux/Windows
  paths, honor `CHROME_PATH`, add `--browser-path`, and degrade gracefully: no Chrome →
  terminal mode still works, diagrams shown as fences with one clear install hint.
- **Homebrew**: personal tap at launch; homebrew-core needs notability (≥75 stars/30 forks)
  — revisit later.
- **Repo launch kit**: animated GIF of a README with diagrams rendering in Ghostty +
  popup side by side (this GIF *is* the marketing), screenshots in both themes,
  CONTRIBUTING, and a Claude Code skill/plugin like mdserve's to ride the agent-workflow
  wave.

## Suggested sequencing

1. **Publishable correctness** — deal breakers 1–7, rename, README rewrite. Small, mostly mechanical.
2. **First-wave retention** — pager, GitHub alerts, frontmatter, `--plain`/themes, friendly directory error.
3. **Growth** — Linux + graphics-protocol ladder (kitty → iTerm2 → sixel → half-blocks; mdcat is the reference), TOC/directory mode, math, export, streaming stdin.
