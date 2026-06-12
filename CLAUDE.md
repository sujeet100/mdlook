# mdlook — project conventions

Small ESM Node CLI. These conventions are deliberate; follow them for all changes.

## Architecture

- `bin/` holds thin entry points: shebang, arg parsing (`node:util` `parseArgs`), exit codes,
  and dispatch only. Logic lives in `src/`, one focused module per concern, imported lazily
  from bin so startup stays fast.
- No barrel files, no deep module trees, no framework. Import files directly with explicit
  `.js` extensions.
- Dependency policy: every dependency is attack surface and startup cost. Prefer `node:`
  builtins (`parseArgs`, `node:test`, `fetch`); justify any new dependency in the PR/commit.

## Style

- `node:` prefix on all builtin imports. Order: builtins, then npm deps, then local `./`,
  blank line between groups.
- camelCase functions/variables (verb-first for functions), `UPPER_SNAKE_CASE` for true
  module-level constants only, kebab-case file names.
- Comments explain constraints the code can't show (protocol quirks, why a workaround
  exists) — not what the next line does.

## Errors & CLI behavior

- Throw `Error` instances; use `{ cause }` when wrapping. No error-class hierarchies.
- Expected failures print `mdlook: <lowercase human message>` to stderr — no stack traces.
  Unexpected errors crash loudly with the stack (that's a bug report).
- Exit codes: 0 success, 1 runtime failure, 2 usage error.
- stdout is for the rendered document only (so piping works); all diagnostics go to stderr.
- `--help`/`--version` print to stdout and exit 0.
- Color: chalk handles `NO_COLOR`/`FORCE_COLOR`; never emit ANSI when stdout isn't a TTY
  unless forced. Kitty graphics only behind the capability check in `bin/mdlook.js`.
- Keep the EPIPE handler in bin — `mdlook x.md | head` must exit quietly.

## Testing

- `node:test` + `node:assert/strict`, files in `test/*.test.js`, run with `npm test`.
  No test frameworks.
- Terminal-renderer tests set `FORCE_COLOR=1` and import `src/terminal.js` **dynamically
  after** setting env (static imports hoist above env assignments; chalk reads env at
  import time).
- Server tests spawn the real bin as a child process — `serve()` calls `process.exit()`
  on client disconnect and must not run in-process.
- Every rendering bug fix gets a regression test asserting on the ANSI/HTML output.

## Packaging

- ESM only (`"type": "module"`), `engines >=22`, `files` whitelist (never `.npmignore`),
  `"exports": {}` so internals can't be deep-imported.
- The committed `package-lock.json` must reference `registry.npmjs.org` only — this machine
  has a corporate npm proxy configured, so after any `npm install` that touches the lockfile,
  re-run it with `--registry=https://registry.npmjs.org/` before committing.
- Mermaid renders via puppeteer-core driving the system Chrome — never add full `puppeteer`
  (its Chromium download is the #1 complaint against mermaid-cli).

## Gotchas (hard-won; don't regress)

- marked-terminal: list assembly depends on literal `* ` prefixes — recolor list markers
  only in the final post-processing pass, never in the renderer. Its `text()` ignores
  inline child tokens — the wrapper in `src/terminal.js` routes them through `parseInline`.
- Theme safety: the 16 ANSI colors are theme-remapped (Catppuccin maps brightWhite to
  lavender); for color *pairs* (bands, panels) use fixed 256-cube colors (16–231) or
  inverse video. Single foreground colors on default background may use ANSI colors.
- Never `toUpperCase()` a string containing ANSI escapes — `\x1b[1m` becomes `\x1b[1M`.
  Use `ansiSafeUpper` in `src/terminal.js`.
- Mermaid negative cache: only parse errors (`err.diagramError`) may be cached as `.err`
  files; environment errors (Chrome missing) must stay retryable.
- `fs.watch` watches the file's *directory* filtered by basename — editors with atomic
  saves replace the inode and kill direct file watches.
