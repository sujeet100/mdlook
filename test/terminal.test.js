import assert from 'node:assert/strict';
import { test } from 'node:test';

// chalk reads the environment at import time and static imports are hoisted,
// so terminal.js must be loaded dynamically after this is set
process.env.FORCE_COLOR = '1';
delete process.env.COLORFGBG; // deterministic dark-background fallback
const { renderToTerminal } = await import('../src/terminal.js');

const render = (md, opts = {}) =>
  renderToTerminal(md, { baseDir: process.cwd(), images: false, refresh: false, ...opts });

test('renders bold and inline code inside list items', async () => {
  const out = await render('- item with **bold** and `code`\n');
  assert.match(out, /\x1b\[1mbold\x1b\[22m/, 'bold should use ANSI bold');
  assert.match(out, /\x1b\[33mcode\x1b\[39m/, 'inline code should be colored');
  assert.doesNotMatch(out, /\*\*bold\*\*/, 'no literal ** markers');
});

test('h1 uppercases text but never ANSI escape codes', async () => {
  const out = await render('# Title with **bold**\n');
  assert.match(out, /TITLE WITH/);
  assert.match(out, /\x1b\[1m/, 'lowercase m must survive uppercasing');
  assert.doesNotMatch(out, /\x1b\[1M/, 'corrupted escape (uppercase M) must not appear');
});

test('h2 renders as a full-width band with fixed 256-cube colors', async () => {
  const out = await render('## Section\n');
  assert.match(out, /\x1b\[48;5;90m/, 'fixed dark-magenta background');
  assert.match(out, /\x1b\[38;5;231m/, 'fixed white foreground');
});

test('github alerts get a styled title and drop the [!NOTE] marker', async () => {
  const out = await render('> [!NOTE]\n> useful info\n');
  assert.match(out, /Note/);
  assert.match(out, /useful info/);
  assert.doesNotMatch(out, /\[!NOTE\]/);
});

test('task list checkboxes become glyphs', async () => {
  const out = await render('- [x] done\n- [ ] open\n');
  assert.match(out, /✔/);
  assert.match(out, /☐/);
  assert.doesNotMatch(out, /\[x\]/i);
});

test('mermaid fences degrade to plain fences when images are off', async () => {
  const out = await render('```mermaid\nflowchart LR\n A-->B\n```\n');
  assert.match(out, /flowchart LR/);
  assert.doesNotMatch(out, /\x1b_G/, 'no kitty graphics without images');
});

test('&nbsp; entities become spaces', async () => {
  const out = await render('a&nbsp;&nbsp;b\n');
  assert.match(out, /a {2}b/);
});

test('remote images render as labeled links, not raw markdown', async () => {
  const out = await render('![badge](https://example.com/b.svg)\n');
  assert.match(out, /🖼 badge/);
  assert.doesNotMatch(out, /!\[badge\]/);
});

test('plain mode skips bands, panels, and list recoloring', async () => {
  const out = await render('## Section\n\n- item\n\n```js\nx\n```\n', { plain: true });
  assert.doesNotMatch(out, /\x1b\[48;5;90m/, 'no h2 band');
  assert.doesNotMatch(out, /\x1b\[48;5;236m/, 'no code panel');
  assert.doesNotMatch(out, /•/, 'default * bullets kept');
});

test('no sentinel bytes ever leak into output', async () => {
  const out = await render('# t\n\n![x](./missing.png)\n\n```mermaid\nA-->B\n```\n');
  assert.doesNotMatch(out, /\x00MDVIMG/);
});
