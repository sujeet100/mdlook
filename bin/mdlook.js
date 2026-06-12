#!/usr/bin/env node
import { enableCompileCache } from 'node:module';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// V8 bytecode cache (Node 22.8+) — cuts repeat-run import time for the heavy deps
try { enableCompileCache(); } catch {}

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
  --port N               fixed port for popup mode (default: random)
  -h, --help             show this help

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
      port: { type: 'string', default: '0' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
} catch (err) {
  console.error(`mdlook: ${err.message}`);
  process.exit(1);
}

if (args.values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const target = args.positionals[0];
if (!target) {
  console.error('mdlook: no input file (try `mdlook README.md` or `mdlook --help`)');
  process.exit(1);
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
      err.code === 'ENOENT' ? 'no such file'
      : err.code === 'EISDIR' ? 'is a directory (mdlook previews single files)'
      : err.message;
    console.error(`mdlook: cannot read ${target}: ${reason}`);
    process.exit(1);
  }
}

const baseDir = filePath ? path.dirname(filePath) : process.cwd();

if (args.values.window) {
  const { serve } = await import('../src/server.js');
  await serve({ filePath, baseDir, markdown, port: Number(args.values.port) });
} else {
  const { renderToTerminal } = await import('../src/terminal.js');
  const images =
    !args.values['no-images'] && process.stdout.isTTY && supportsInlineImages(process.env);
  const out = await renderToTerminal(markdown, {
    baseDir,
    images,
    refresh: args.values.refresh,
  });
  process.stdout.write(out);
}
