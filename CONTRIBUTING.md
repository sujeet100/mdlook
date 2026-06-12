# Contributing to mdlook

Thanks for helping out! This is a small, dependency-light project — please keep it that way.

## Dev setup

```sh
git clone https://github.com/sujeet100/mdlook.git
cd mdlook
npm ci
node bin/mdlook.js demo/showcase.md       # terminal mode
node bin/mdlook.js -w demo/showcase.md    # popup mode
```

Requirements: Node ≥ 22. Chrome/Chromium is needed for mermaid rendering and popup mode
(set `CHROME_PATH` if it isn't auto-discovered) — the test suite runs without it.

## Checks

```sh
npm test        # node:test suite (test/*.test.js)
npm run lint    # biome (lint + format check)
npm run lint:fix
```

Both run in CI on every PR. Rendering bug fixes should come with a regression test that
asserts on the ANSI or HTML output — see `test/terminal.test.js` for the pattern.

## Conventions

Project conventions live in [CLAUDE.md](./CLAUDE.md) — architecture, error handling,
CLI behavior (stdout/stderr discipline, exit codes), and a list of hard-won gotchas
(ANSI/theme pitfalls, marked-terminal quirks). Worth reading before touching
`src/terminal.js`.

The short version: logic in `src/`, thin entries in `bin/`, `node:` prefixes on builtin
imports, throw real `Error`s, new dependencies need a strong justification.

## Pull requests

- One concern per PR; small is beautiful
- Describe what a user sees before/after, not just what the code does
- Screenshots welcome for anything visual (both light and dark terminal themes if relevant)
