// HTML rendering for popup mode: markdown-it pipeline (GitHub alerts, task
// lists, mermaid fences) and the page template with theming.
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import markdownItAnchor from 'markdown-it-anchor';
import { full as markdownItEmoji } from 'markdown-it-emoji';

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function makeRenderer() {
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

  // GitHub alerts: > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
  const ALERT_ICONS = { note: 'ℹ️', tip: '💡', important: '❗', warning: '⚠️', caution: '🛑' };
  md.core.ruler.after('block', 'github-alerts', (state) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'blockquote_open') continue;
      let j = i + 1;
      while (j < toks.length && !['inline', 'blockquote_close'].includes(toks[j].type)) j++;
      if (toks[j]?.type !== 'inline') continue;
      const m = toks[j].content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/);
      if (!m) continue;
      const type = m[1].toLowerCase();
      toks[i].attrJoin('class', `markdown-alert markdown-alert-${type}`);
      // strip the marker (and its trailing softbreak) from the inline token
      toks[j].content = toks[j].content.slice(m[0].length);
      const kids = toks[j].children || [];
      if (kids[0]?.type === 'text') {
        kids[0].content = kids[0].content.replace(/^\[!\w+\]\s*/, '');
        if (!kids[0].content) {
          kids.shift();
          if (kids[0]?.type === 'softbreak') kids.shift();
        }
      }
      const title = new state.Token('html_block', '', 0);
      title.content = `<p class="markdown-alert-title">${ALERT_ICONS[type]} ${m[1][0] + m[1].slice(1).toLowerCase()}</p>\n`;
      toks.splice(i + 1, 0, title);
    }
  });

  // GitHub task lists: - [x] / - [ ] become disabled checkboxes
  md.core.ruler.after('inline', 'task-lists', (state) => {
    const toks = state.tokens;
    for (let i = 2; i < toks.length; i++) {
      if (toks[i].type !== 'inline') continue;
      if (toks[i - 1]?.type !== 'paragraph_open' || toks[i - 2]?.type !== 'list_item_open')
        continue;
      const kids = toks[i].children;
      if (kids?.[0]?.type !== 'text') continue;
      const m = kids[0].content.match(/^\[([ xX])\] /);
      if (!m) continue;
      kids[0].content = kids[0].content.slice(m[0].length);
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input type="checkbox" class="task-list-item-checkbox" disabled${m[1] === ' ' ? '' : ' checked'}> `;
      kids.unshift(box);
      toks[i - 2].attrJoin('class', 'task-list-item');
    }
  });

  return md;
}

// alerts are GitHub semantics, not mdlook personality — styled even in --plain mode
const ALERT_CSS = `
  .markdown-alert { border-left: 4px solid; padding: 4px 16px; margin-bottom: 16px; color: inherit; background: transparent; border-radius: 0; }
  .markdown-alert-title { font-weight: 600; margin: 4px 0; }
  .markdown-alert-note { border-color: #0969da; } .markdown-alert-note .markdown-alert-title { color: #0969da; }
  .markdown-alert-tip { border-color: #1a7f37; } .markdown-alert-tip .markdown-alert-title { color: #1a7f37; }
  .markdown-alert-important { border-color: #8250df; } .markdown-alert-important .markdown-alert-title { color: #8250df; }
  .markdown-alert-warning { border-color: #9a6700; } .markdown-alert-warning .markdown-alert-title { color: #9a6700; }
  .markdown-alert-caution { border-color: #cf222e; } .markdown-alert-caution .markdown-alert-title { color: #cf222e; }
  html.dark .markdown-alert-note { border-color: #2f81f7; } html.dark .markdown-alert-note .markdown-alert-title { color: #2f81f7; }
  html.dark .markdown-alert-tip { border-color: #3fb950; } html.dark .markdown-alert-tip .markdown-alert-title { color: #3fb950; }
  html.dark .markdown-alert-important { border-color: #a371f7; } html.dark .markdown-alert-important .markdown-alert-title { color: #a371f7; }
  html.dark .markdown-alert-warning { border-color: #d29922; } html.dark .markdown-alert-warning .markdown-alert-title { color: #d29922; }
  html.dark .markdown-alert-caution { border-color: #f85149; } html.dark .markdown-alert-caution .markdown-alert-title { color: #f85149; }
  details.frontmatter { margin-bottom: 16px; opacity: .75; }
  details.frontmatter summary { cursor: pointer; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  details.frontmatter pre { margin-top: 8px; }
  li.task-list-item { list-style-type: none; margin-left: -1.4em; }
  li.task-list-item .task-list-item-checkbox { margin-right: .45em; vertical-align: middle; }
`;

const ACCENT_CSS = `  /* a little personality on top of the GitHub base */
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
  article.markdown-body blockquote:not(.markdown-alert) {
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
  html.dark article.markdown-body blockquote:not(.markdown-alert) { border-left-color: #a78bfa; background: #a78bfa14; }
  html.dark article.markdown-body table th { background: #22d3ee14; }`;

export function pageTemplate(title, body, savedTheme, plain) {
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

${plain ? '' : ACCENT_CSS}
${ALERT_CSS}
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
