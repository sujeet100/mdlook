import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { supportsLanguage } from 'cli-highlight';
import chalk from 'chalk';
import { renderMermaid, closeMermaidBrowser } from './mermaid.js';

const SENTINEL = (i) => `\x00MDVIMG${i}\x00`;
const SENTINEL_RE = /\x00MDVIMG(\d+)\x00/g;
const RASTER_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif']);

function walk(tokens, fn) {
  for (const token of tokens) {
    fn(token);
    if (token.tokens) walk(token.tokens, fn);
    if (token.items) walk(token.items, fn);
  }
}

function toSentinelToken(token, i) {
  const s = SENTINEL(i);
  token.type = 'paragraph';
  token.text = s;
  token.tokens = [{ type: 'text', raw: s, text: s, escaped: false }];
}

function pngSize(buf) {
  // PNG: 8-byte signature, 4-byte length, "IHDR", then width/height as big-endian uint32s
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Kitty graphics protocol: transmit-and-display a PNG at the cursor.
// f=100 PNG, a=T display, q=2 suppress responses (we never read them),
// m=1/0 chunk continuation. Ghostty supports this natively.
function kittyImage(buf, termCols) {
  const size = pngSize(buf);
  let ctrl = 'a=T,f=100,q=2';
  if (size) {
    // mmdc renders at -s 2 (retina); ~20 device px per cell keeps diagrams readable
    const cols = Math.min(termCols - 2, Math.max(20, Math.round(size.width / 20)));
    ctrl += `,c=${cols}`;
  }
  const b64 = buf.toString('base64');
  let out = '';
  for (let i = 0; i < b64.length; i += 4096) {
    const last = i + 4096 >= b64.length;
    const head = i === 0 ? `${ctrl},m=${last ? 0 : 1}` : `m=${last ? 0 : 1}`;
    out += `\x1b_G${head};${b64.slice(i, i + 4096)}\x1b\\`;
  }
  return out + '\n';
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const visibleLen = (s) => s.replace(ANSI_RE, '').length;

// uppercase the text but leave ANSI escape sequences untouched ("\x1b[1m" must not become "\x1b[1M")
const ansiSafeUpper = (s) =>
  s.replace(/\x1b\[[0-9;]*m|[^\x1b]+/g, (seg) => (seg.startsWith('\x1b') ? seg : seg.toUpperCase()));

// Ask the terminal for its background color (OSC 11) to pick a panel shade
// that works on both light and dark themes. Falls back to COLORFGBG, then dark.
function detectLightBackground() {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    const fgbg = process.env.COLORFGBG;
    if (fgbg) {
      const bg = Number(fgbg.split(';').pop());
      return Promise.resolve(bg >= 7 && bg !== 8);
    }
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let buf = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      const m = buf.match(/rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i);
      if (!m) return resolve(false);
      const [r, g, b] = m.slice(1).map((h) => parseInt(h.slice(0, 2).padEnd(2, h[0]), 16));
      resolve(0.299 * r + 0.587 * g + 0.114 * b > 128);
    };
    const onData = (d) => {
      buf += d.toString('latin1');
      if (buf.includes('\x07') || buf.includes('\x1b\\')) done();
    };
    const timer = setTimeout(done, 150);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
    process.stdout.write('\x1b]11;?\x07');
  });
}

// IntelliJ-style shaded panel behind code blocks
function codePanel(rendered, bg, termCols) {
  const lines = rendered.replace(/^\n+|\n+$/g, '').split('\n');
  const width = Math.min(termCols, Math.max(...lines.map(visibleLen)) + 4);
  const blank = bg(' '.repeat(width));
  const padded = lines.map((l) => bg(l + ' '.repeat(Math.max(0, width - visibleLen(l)))));
  return '\n' + [blank, ...padded, blank].join('\n') + '\n\n';
}

function errorFence(source, message) {
  const code = source
    .split('\n')
    .map((l) => '  ' + chalk.gray(l))
    .join('\n');
  return `${code}\n  ${chalk.red(`✗ mermaid render failed: ${message}`)}\n`;
}

// GitHub alert blockquotes: > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
const ALERTS = {
  NOTE: { color: chalk.blue, icon: 'ℹ', label: 'Note' },
  TIP: { color: chalk.green, icon: '✦', label: 'Tip' },
  IMPORTANT: { color: chalk.magenta, icon: '✱', label: 'Important' },
  WARNING: { color: chalk.yellow, icon: '⚠', label: 'Warning' },
  CAUTION: { color: chalk.red, icon: '✖', label: 'Caution' },
};
const ALERT_RE = /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/;

export async function renderToTerminal(markdown, { baseDir, images, refresh, plain = false }) {
  const termCols = process.stdout.columns || 80;
  const lightBg = await detectLightBackground();
  const panelBg = chalk.bgAnsi256(lightBg ? 254 : 236);
  const mermaidTheme = lightBg ? 'default' : 'dark'; // diagram text must contrast the terminal bg

  // distinct style per heading level: hue + weight stand in for font size.
  // H2 is a full-width band — terminals can't change font size, so a block of
  // background color is what makes section boundaries scannable.
  const h2Band = (s) => {
    const pad = Math.max(0, termCols - visibleLen(s) - 2);
    return chalk.bgMagenta.whiteBright.bold(` ${s} ${' '.repeat(pad)}`);
  };
  const HEADING_STYLES = {
    2: h2Band,
    3: (s) => chalk.bold.cyan('◆ ' + s),
    4: (s) => chalk.bold.blue('◇ ' + s),
    5: (s) => chalk.bold.green(s),
    6: (s) => chalk.bold.dim(s),
  };
  let headingDepth = 2;

  const ext = markedTerminal(
    plain
      ? { tab: 2, width: termCols, emoji: true }
      : {
          tab: 2,
          width: termCols,
          emoji: true,
          showSectionPrefix: false, // drop literal #/## markers
          // inverse video swaps the theme's own fg/bg — readable in any palette,
          // unlike a fixed bg color whose contrast is at the theme's mercy
          firstHeading: (s) => chalk.inverse.bold(` ${ansiSafeUpper(s)} `),
          heading: (s) => (HEADING_STYLES[headingDepth] || HEADING_STYLES[6])(s),
          hr: (s) => chalk.cyan.dim(s),
          tableOptions: { style: { head: ['cyan', 'bold'], border: ['grey'] } },
        },
  );
  const origHeading = ext.renderer.heading;
  ext.renderer.heading = function (token, ...rest) {
    headingDepth = token?.depth ?? 2;
    return origHeading.call(this, token, ...rest);
  };
  // Remote images (badges etc.) otherwise render as raw ![alt](url) markdown.
  // Local raster images are sentinel-swapped before this runs, so only
  // non-displayable ones reach here.
  const origImage = ext.renderer.image;
  ext.renderer.image = function (token, ...rest) {
    if (token && typeof token === 'object' && token.href) {
      const alt = token.text || token.title || 'image';
      return chalk.blue(`🖼 ${alt}`) + chalk.dim(` (${token.href})`);
    }
    return origImage.call(this, token, ...rest);
  };
  // marked-terminal's text() drops a token's parsed inline children and emits the
  // raw text — list items arrive as such tokens, leaving **bold** and `code`
  // literal. Render the children through the inline parser instead.
  const origText = ext.renderer.text;
  ext.renderer.text = function (token, ...rest) {
    if (token && typeof token === 'object' && token.tokens?.length) {
      return this.parser.parseInline(token.tokens);
    }
    return origText.call(this, token, ...rest);
  };
  const origCode = ext.renderer.code;
  ext.renderer.code = function (token, ...rest) {
    // cli-highlight warns on stderr for languages it doesn't know (e.g. mermaid)
    if (token?.lang && !supportsLanguage(token.lang)) token = { ...token, lang: '' };
    const rendered = origCode.call(this, token, ...rest);
    return plain ? rendered : codePanel(rendered, panelBg, termCols);
  };
  const origBlockquote = ext.renderer.blockquote;
  ext.renderer.blockquote = function (...args) {
    const rendered = origBlockquote.apply(this, args);
    if (plain) return rendered;
    let lines = rendered.replace(/^\n+|\n+$/g, '').split('\n');
    // GitHub alert? styled title line + matching gutter color
    const alertType = (lines[0]?.replace(ANSI_RE, '').match(ALERT_RE) || [])[1];
    let bar = chalk.cyan;
    if (alertType) {
      const { color, icon, label } = ALERTS[alertType];
      bar = color;
      lines = [' ' + color.bold(`${icon} ${label}`), ...lines.slice(1)];
    }
    return '\n' + lines.map((l) => bar('▌') + l).join('\n') + '\n\n';
  };
  const marked = new Marked(ext);
  const tokens = marked.lexer(markdown);

  // slots[i] = {png} | {error, source} | {file}
  const slots = [];
  const pending = [];

  if (images) {
    walk(tokens, (token) => {
      if (token.type === 'code' && token.lang === 'mermaid') {
        const i = slots.push(null) - 1;
        const source = token.text;
        pending.push(
          renderMermaid(source, { refresh, theme: mermaidTheme })
            .then((png) => (slots[i] = { png }))
            .catch((err) => (slots[i] = { error: err.message, source })),
        );
        toSentinelToken(token, i);
      } else if (token.type === 'image' && token.href && !/^[a-z]+:\/\//i.test(token.href)) {
        const file = path.resolve(baseDir, token.href);
        if (RASTER_EXT.has(path.extname(file).toLowerCase()) && fs.existsSync(file)) {
          const i = slots.push({ file }) - 1;
          const s = SENTINEL(i);
          token.type = 'text';
          token.text = s;
          token.raw = s;
        }
      }
    });
    await Promise.all(pending);
    await closeMermaidBrowser(); // renderMermaid never rejects past its catch; safe to close here
  }

  // Recolor list markers AFTER rendering: marked-terminal relies on literal
  // "* " prefixes while assembling nested lists, so this can't happen earlier.
  // Code-block lines are immune — they start with the panel's bg escape, not whitespace.
  let ansi = marked.parser(tokens).replace(/&nbsp;/g, ' ');
  if (!plain) {
    ansi = ansi
      .replace(/^(\s*(?:\*|\d+\.) (?:\x1b\[0m)?)\[x\]/gim, (_, pre) => pre + chalk.green('✔'))
      .replace(/^(\s*(?:\*|\d+\.) (?:\x1b\[0m)?)\[ \]/gm, (_, pre) => pre + chalk.dim('☐'))
      .replace(/^(\s*)\* /gm, (_, ind) => `${ind}${chalk.cyan('•')} `)
      .replace(/^(\s*)(\d+)\. /gm, (_, ind, n) => `${ind}${chalk.bold.cyan(n + '.')} `)
      .replace(/^\s*(?:\x1b\[0m\s*)+$\n/gm, ''); // stray reset-only lines between nested list items
  }

  return ansi.replace(SENTINEL_RE, (_, n) => {
    const slot = slots[Number(n)];
    if (!slot) return '';
    if (slot.error) return errorFence(slot.source, slot.error);
    try {
      return kittyImage(fs.readFileSync(slot.png || slot.file), termCols);
    } catch (err) {
      return chalk.red(`✗ cannot display image: ${err.message}`) + '\n';
    }
  });
}
