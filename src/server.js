// Popup-mode HTTP server: serves the rendered page, assets, and doc-relative
// static files; pushes live-reload over SSE; exits when the window closes.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPreviewWindow } from './chrome.js';
import { stripFrontmatter } from './frontmatter.js';
import { escapeHtml, makeRenderer, pageTemplate } from './html.js';

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
const NM = path.join(PKG_ROOT, 'node_modules');

const ASSETS = {
  '/assets/markdown-light.css': [
    path.join(NM, 'github-markdown-css', 'github-markdown-light.css'),
    'text/css',
  ],
  '/assets/markdown-dark.css': [
    path.join(NM, 'github-markdown-css', 'github-markdown-dark.css'),
    'text/css',
  ],
  '/assets/hljs-light.css': [path.join(NM, 'highlight.js', 'styles', 'github.css'), 'text/css'],
  '/assets/hljs-dark.css': [path.join(NM, 'highlight.js', 'styles', 'github-dark.css'), 'text/css'],
  '/assets/mermaid.js': [path.join(NM, 'mermaid', 'dist', 'mermaid.min.js'), 'text/javascript'],
};

const STATIC_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.css': 'text/css',
  '.txt': 'text/plain',
  '.md': 'text/plain',
};

// theme preference persists across runs (the port — and so localStorage — changes every run)
const PREFS_PATH = path.join(os.homedir(), '.cache', 'mdlook', 'prefs.json');
function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
  } catch {
    return {};
  }
}
function writePrefs(prefs) {
  fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs));
}

export async function serve({ filePath, baseDir, markdown, port, plain = false }) {
  const md = makeRenderer();
  const title = filePath ? path.basename(filePath) : 'stdin';
  let source = markdown;

  const render = () => {
    const { frontmatter, body } = stripFrontmatter(source);
    const fmBlock = frontmatter
      ? `<details class="frontmatter"><summary>frontmatter</summary><pre>${escapeHtml(frontmatter)}</pre></details>\n`
      : '';
    return fmBlock + md.render(body);
  };
  let theme = readPrefs().theme ?? null; // 'light' | 'dark' | null = follow system

  const sseClients = new Set();
  let hadClient = false;
  let exitTimer = null;

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400);
      res.end('bad request');
      return;
    }

    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageTemplate(title, render(), theme, plain));
    } else if (url === '/theme/dark' || url === '/theme/light') {
      theme = url.split('/').pop();
      writePrefs({ ...readPrefs(), theme });
      res.writeHead(204);
      res.end();
    } else if (url === '/content') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(render());
    } else if (ASSETS[url]) {
      const [file, type] = ASSETS[url];
      res.writeHead(200, { 'Content-Type': type });
      fs.createReadStream(file).pipe(res);
    } else if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      hadClient = true;
      if (exitTimer) {
        clearTimeout(exitTimer);
        exitTimer = null;
      }
      req.on('close', () => {
        sseClients.delete(res);
        if (hadClient && sseClients.size === 0) {
          exitTimer = setTimeout(() => process.exit(0), 3000);
        }
      });
    } else {
      // static files (e.g. images referenced by the markdown), jailed to baseDir
      const file = path.resolve(baseDir, `.${url}`);
      if (
        !file.startsWith(baseDir + path.sep) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type':
          STATIC_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      });
      fs.createReadStream(file).pipe(res);
    }
  });

  // SSE heartbeat so proxies/clients don't drop idle connections
  setInterval(() => {
    for (const res of sseClients) res.write(': ping\n\n');
  }, 15000).unref();

  if (filePath) {
    // Watch the directory, not the file: editors with atomic saves (VS Code,
    // IntelliJ) replace the inode, which kills a direct file watch.
    let debounce = null;
    const watcher = fs.watch(path.dirname(filePath), (_event, name) => {
      if (name !== path.basename(filePath)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          source = fs.readFileSync(filePath, 'utf8');
        } catch {
          return; // transient mid-save state; next event will catch up
        }
        for (const res of sseClients) res.write('data: reload\n\n');
      }, 100);
    });
    // deleting the watched directory must degrade to "no live reload", not a crash
    watcher.on('error', () => watcher.close());
  }

  server.listen(port || 0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.error(`mdlook: serving ${title} at ${url}`);
    openPreviewWindow(url);
  });
}
