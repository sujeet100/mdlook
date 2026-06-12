#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { enableCompileCache } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

// V8 bytecode cache (Node 22.8+) — cuts repeat-run import time for the heavy deps
try {
  enableCompileCache();
} catch {}

// exit quietly when the downstream pipe closes early (mdlook x.md | head)
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const HELP = `mdlook — markdown previewer (terminal + popup window)

Usage:
  mdlook FILE.md         render in the terminal (mermaid as inline images)
  mdlook -w FILE.md      open a standalone popup window with live reload
  mdlookw FILE.md        same as mdlook -w
  mdlook -               read markdown from stdin

Options:
  -w, --window           popup window mode
  --no-images            terminal mode: skip inline images, show fences instead
  --refresh              re-render mermaid diagrams, ignoring the cache
  --plain                minimal styling (GitHub-faithful, no color accents)
  --pager                page output through $PAGER / less -R (disables images)
  --no-pager             never page, even for long output
  --port N               fixed port for popup mode (default: random)
  -h, --help             show this help
  -v, --version          show version

Environment:
  CHROME_PATH            Chrome/Chromium binary for diagrams and the popup window
  MDLOOK_NO_OPEN         popup mode: start the server without opening a window
`;

// Inline images need a terminal that speaks the Kitty graphics protocol.
// Anything else (iTerm2, VS Code, plain xterm, ...) gets the source fence
// instead of invisible diagrams or base64 garbage.
function supportsInlineImages(env) {
  if (env.TMUX) return false;
  return Boolean(
    env.KITTY_WINDOW_ID ||
      env.GHOSTTY_RESOURCES_DIR ||
      env.WEZTERM_EXECUTABLE ||
      env.KONSOLE_VERSION ||
      /kitty|ghostty/i.test(env.TERM || '') ||
      /ghostty|wezterm/i.test(env.TERM_PROGRAM || ''),
  );
}

let args;
try {
  args = parseArgs({
    options: {
      window: { type: 'boolean', short: 'w', default: false },
      'no-images': { type: 'boolean', default: false },
      refresh: { type: 'boolean', default: false },
      plain: { type: 'boolean', default: false },
      pager: { type: 'boolean', default: false },
      'no-pager': { type: 'boolean', default: false },
      port: { type: 'string', default: '0' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
  });
} catch (err) {
  console.error(`mdlook: ${err.message}`);
  process.exit(2);
}

if (args.values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

if (args.values.version) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

// no file argument but piped input → read stdin, like `mdlook -`
const target = args.positionals[0] ?? (process.stdin.isTTY ? null : '-');
if (!target) {
  console.error('mdlook: no input file (try `mdlook README.md` or `mdlook --help`)');
  process.exit(2);
}

let markdown;
let filePath = null; // null when reading stdin
if (target === '-') {
  markdown = readFileSync(0, 'utf8');
} else {
  filePath = path.resolve(target);
  try {
    markdown = readFileSync(filePath, 'utf8');
  } catch (err) {
    const reason =
      err.code === 'ENOENT'
        ? 'no such file'
        : err.code === 'EISDIR'
          ? 'is a directory (mdlook previews single files)'
          : err.message;
    console.error(`mdlook: cannot read ${target}: ${reason}`);
    process.exit(1);
  }
}

const baseDir = filePath ? path.dirname(filePath) : process.cwd();
const { stripFrontmatter } = await import('../src/frontmatter.js');

if (args.values.window) {
  const { serve } = await import('../src/server.js');
  await serve({
    filePath,
    baseDir,
    markdown,
    port: Number(args.values.port),
    plain: args.values.plain,
  });
} else {
  const { renderToTerminal } = await import('../src/terminal.js');
  const images =
    !args.values['no-images'] &&
    !args.values.pager && // pagers can't display kitty graphics
    process.stdout.isTTY &&
    supportsInlineImages(process.env);
  const out = await renderToTerminal(stripFrontmatter(markdown).body, {
    baseDir,
    images,
    refresh: args.values.refresh,
    plain: args.values.plain,
  });

  // Page long output — but only when there are no inline images (they don't
  // survive a pager's alternate screen; terminal scrollback handles that case).
  const rows = process.stdout.rows || 24;
  const shouldPage =
    args.values.pager ||
    (!args.values['no-pager'] && !images && process.stdout.isTTY && out.split('\n').length > rows);
  if (shouldPage) {
    const { spawn } = await import('node:child_process');
    const [cmd, ...cmdArgs] = (process.env.PAGER || 'less -R').split(/\s+/);
    const pager = spawn(cmd, cmdArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
    pager.on('error', () => process.stdout.write(out));
    pager.stdin.on('error', () => {}); // pager quit early — not an error
    pager.stdin.end(out);
    await new Promise((resolve) => pager.on('close', resolve));
  } else {
    process.stdout.write(out);
  }
}
