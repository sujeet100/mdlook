import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { full as markdownItEmoji } from 'markdown-it-emoji';
import markdownItAnchor from 'markdown-it-anchor';
import hljs from 'highlight.js';
import { findChrome } from './mermaid.js';

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
const NM = path.join(PKG_ROOT, 'node_modules');

const ASSETS = {
  '/assets/markdown-light.css': [path.join(NM, 'github-markdown-css', 'github-markdown-light.css'), 'text/css'],
  '/assets/markdown-dark.css': [path.join(NM, 'github-markdown-css', 'github-markdown-dark.css'), 'text/css'],
  '/assets/hljs-light.css': [path.join(NM, 'highlight.js', 'styles', 'github.css'), 'text/css'],
  '/assets/hljs-dark.css': [path.join(NM, 'highlight.js', 'styles', 'github-dark.css'), 'text/css'],
  '/assets/mermaid.js': [path.join(NM, 'mermaid', 'dist', 'mermaid.min.js'), 'text/javascript'],
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

const STATIC_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.css': 'text/css', '.txt': 'text/plain',
  '.md': 'text/plain',
};

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function makeRenderer() {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return `<pre><code class="hljs language-${lang}">${hljs.highlight(code, { language: lang }).value}</code></pre>`;
      }
      return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`;
    },
  })
    .use(markdownItEmoji)
    .use(markdownItAnchor);

  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim().split(/\s+/)[0] === 'mermaid') {
      // mermaid.js reads textContent, so HTML-escaping the source is safe
      return `<pre class="mermaid">${escapeHtml(token.content)}</pre>\n`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };
  return md;
}

function pageTemplate(title, body, savedTheme) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/markdown-light.css" id="md-light">
<link rel="stylesheet" href="/assets/markdown-dark.css" id="md-dark" disabled>
<link rel="stylesheet" href="/assets/hljs-light.css" id="hl-light">
<link rel="stylesheet" href="/assets/hljs-dark.css" id="hl-dark" disabled>
<style>
  body { margin: 0; background: #ffffff; }
  html.dark body { background: #0d1117; }
  article.markdown-body { max-width: 920px; margin: 0 auto; padding: 32px 40px 64px; box-sizing: border-box; }
  pre.mermaid { background: transparent; display: flex; justify-content: center; }

  #theme-toggle {
    position: fixed; top: 14px; right: 16px; z-index: 10;
    width: 36px; height: 36px; border-radius: 50%; border: 1px solid #d0d7de;
    background: #ffffffcc; backdrop-filter: blur(4px);
    font-size: 17px; line-height: 1; cursor: pointer; opacity: .55; transition: opacity .15s;
  }
  #theme-toggle:hover { opacity: 1; }
  html.dark #theme-toggle { background: #161b22cc; border-color: #30363d; }

  /* a little personality on top of the GitHub base */
  article.markdown-body h1 {
    background: linear-gradient(90deg, #0891b2, #7c3aed, #db2777);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    border-bottom: none; padding-bottom: 0;
  }
  article.markdown-body h1::after {
    content: ''; display: block; height: 3px; margin-top: 10px; border-radius: 2px;
    background: linear-gradient(90deg, #0891b2, #7c3aed, #db2777, transparent);
  }
  article.markdown-body h2 { color: #0891b2; border-bottom-color: #0891b233; }
  article.markdown-body h3 { color: #7c3aed; }
  article.markdown-body h4 { color: #db2777; }
  article.markdown-body blockquote {
    border-left: 4px solid #7c3aed; background: #7c3aed10;
    border-radius: 0 6px 6px 0; padding: 8px 16px;
  }
  article.markdown-body table th { background: #0891b212; }
  article.markdown-body hr {
    height: 2px; background: linear-gradient(90deg, #0891b2, #7c3aed, transparent);
  }
  html.dark article.markdown-body h2 { color: #22d3ee; border-bottom-color: #22d3ee33; }
  html.dark article.markdown-body h3 { color: #a78bfa; }
  html.dark article.markdown-body h4 { color: #f472b6; }
  html.dark article.markdown-body blockquote { border-left-color: #a78bfa; background: #a78bfa14; }
  html.dark article.markdown-body table th { background: #22d3ee14; }
</style>
</head>
<body>
<button id="theme-toggle" title="Toggle dark mode"></button>
<article class="markdown-body">${body}</article>
<script>
  const savedTheme = ${JSON.stringify(savedTheme)}; // 'light' | 'dark' | null = follow system
  let dark = savedTheme ? savedTheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;

  function applyTheme() {
    document.documentElement.classList.toggle('dark', dark);
    for (const [id, on] of [['md-light', !dark], ['md-dark', dark], ['hl-light', !dark], ['hl-dark', dark]]) {
      document.getElementById(id).disabled = !on;
    }
    document.getElementById('theme-toggle').textContent = dark ? '☀️' : '🌙';
  }

  // mermaid.js is ~2.5MB of parse time — only load it when the doc has diagrams
  async function renderDiagrams() {
    if (!document.querySelector('pre.mermaid')) return;
    if (!window.mermaid) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/assets/mermaid.js'; s.onload = resolve; s.onerror = reject;
        document.body.appendChild(s);
      });
    }
    mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' });
    await mermaid.run();
  }

  async function refreshContent() {
    const y = scrollY;
    const html = await (await fetch('/content')).text();
    document.querySelector('article').innerHTML = html;
    await renderDiagrams();
    scrollTo(0, y);
  }

  document.getElementById('theme-toggle').onclick = async () => {
    dark = !dark;
    applyTheme();
    fetch('/theme/' + (dark ? 'dark' : 'light'), { method: 'POST' });
    await refreshContent(); // diagrams bake the theme in at render time
  };

  applyTheme();
  renderDiagrams();
  new EventSource('/events').onmessage = refreshContent;
</script>
</body>
</html>`;
}

// cross-platform "open in default browser" with a survivable failure mode
function openExternal(url) {
  const [cmd, ...cmdArgs] =
    process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url];
  const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
  child.on('error', () => console.error(`mdlook: could not open a browser — visit ${url}`));
  child.unref();
}

function openWindow(url) {
  if (process.env.MDLOOK_NO_OPEN || process.env.MDV_NO_OPEN) return;
  const chrome = findChrome();
  if (!chrome) {
    console.error('mdlook: Chrome/Chromium not found, opening in default browser');
    openExternal(url);
    return;
  }
  // Dedicated user-data-dir forces a separate Chrome process: --window-size is
  // honored, and closing the window drops the SSE connection so we can auto-exit.
  const child = spawn(chrome, [
    `--app=${url}`,
    `--user-data-dir=${path.join(os.homedir(), '.cache', 'mdlook', 'chrome-profile')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=980,1100',
  ], { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    console.error('mdlook: failed to launch Chrome, opening in default browser');
    openExternal(url);
  });
  child.unref();
}

export async function serve({ filePath, baseDir, markdown, port }) {
  const md = makeRenderer();
  const title = filePath ? path.basename(filePath) : 'stdin';
  let source = markdown;

  const render = () => md.render(source);
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
      res.end(pageTemplate(title, render(), theme));
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
      if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
      req.on('close', () => {
        sseClients.delete(res);
        if (hadClient && sseClients.size === 0) {
          exitTimer = setTimeout(() => process.exit(0), 3000);
        }
      });
    } else {
      // static files (e.g. images referenced by the markdown), jailed to baseDir
      const file = path.resolve(baseDir, '.' + url);
      if (!file.startsWith(baseDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
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
    fs.watch(path.dirname(filePath), (event, name) => {
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
  }

  server.listen(port || 0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.error(`mdlook: serving ${title} at ${url}`);
    openWindow(url);
  });
}
