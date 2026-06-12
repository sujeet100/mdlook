// Integration tests: boot the real CLI in popup mode as a child process and
// poke its HTTP surface. The server process.exit()s on client disconnect, so
// it must not run in-process.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/mdlook.js', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./alerts.md', import.meta.url));

let child;
let base;

before(async () => {
  child = spawn(process.execPath, [BIN, '-w', '--port', '0', FIXTURE], {
    env: { ...process.env, MDLOOK_NO_OPEN: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    let err = '';
    child.stderr.on('data', (d) => {
      err += d.toString();
      const m = err.match(/(http:\/\/127\.0\.0\.1:\d+)\//);
      if (m) resolve(m[1]);
    });
    child.on('exit', () => reject(new Error(`server exited early:\n${err}`)));
    setTimeout(() => reject(new Error(`server did not start:\n${err}`)), 10_000);
  });
});

after(() => child?.kill());

test('serves the page with theme toggle and alert styling', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /theme-toggle/);
  assert.match(html, /markdown-alert-note/);
  assert.match(html, /<title>alerts\.md<\/title>/);
});

test('frontmatter renders as a collapsible block, not body text', async () => {
  const html = await (await fetch(`${base}/content`)).text();
  assert.match(html, /<details class="frontmatter">/);
  assert.doesNotMatch(html, /<h2[^>]*>.*title: Alert test/);
});

test('github alerts render with type classes and titles', async () => {
  const html = await (await fetch(`${base}/content`)).text();
  assert.match(html, /markdown-alert markdown-alert-tip/);
  assert.match(html, /markdown-alert-title/);
  assert.doesNotMatch(html, /\[!TIP\]/);
});

test('normal blockquotes are not turned into alerts', async () => {
  const html = await (await fetch(`${base}/content`)).text();
  assert.match(html, /<blockquote>\n<p>a normal blockquote/);
});

test('path traversal is rejected', async () => {
  const res = await fetch(`${base}/..%2F..%2F.zshenv`);
  assert.equal(res.status, 404);
});

test('malformed percent-encoding gets 400, server survives', async () => {
  const res = await fetch(`${base}/%zz`);
  assert.equal(res.status, 400);
  assert.equal((await fetch(`${base}/`)).status, 200);
});

test('theme endpoint accepts only known values', async () => {
  assert.equal((await fetch(`${base}/theme/dark`, { method: 'POST' })).status, 204);
  assert.equal((await fetch(`${base}/theme/sparkly`, { method: 'POST' })).status, 404);
  // restore: follow-system is the default we want to leave behind
  await fetch(`${base}/theme/light`, { method: 'POST' });
});

test('assets are served from the package, not the doc dir', async () => {
  const res = await fetch(`${base}/assets/mermaid.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
});

test('task lists render as checkboxes in the popup', async () => {
  const html = await (await fetch(`${base}/content`)).text();
  assert.match(html, /<input type="checkbox" class="task-list-item-checkbox" disabled checked>/);
  assert.match(html, /<input type="checkbox" class="task-list-item-checkbox" disabled>/);
  assert.doesNotMatch(html, /\[x\] shipped/);
});
