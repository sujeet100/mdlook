import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from './chrome.js';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'mdlook', 'mermaid');
const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MERMAID_JS = path.join(PKG_ROOT, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');

let mermaidVersion;
function getMermaidVersion() {
  if (!mermaidVersion) {
    mermaidVersion = JSON.parse(
      fs.readFileSync(path.join(PKG_ROOT, 'node_modules', 'mermaid', 'package.json'), 'utf8'),
    ).version;
  }
  return mermaidVersion;
}

// One headless Chrome shared by all diagrams in a run — booting Chrome is the
// expensive part (~1s), each additional diagram is just a new tab.
let browserP = null;
async function getBrowser() {
  if (!browserP) {
    const chrome = findChrome();
    if (!chrome) {
      throw new Error('Chrome/Chromium not found — install Google Chrome or set CHROME_PATH');
    }
    const puppeteer = (await import('puppeteer-core')).default;
    browserP = puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
    });
  }
  return browserP;
}

export async function closeMermaidBrowser() {
  if (!browserP) return;
  const pending = browserP;
  browserP = null;
  const browser = await pending.catch(() => null);
  await browser?.close().catch(() => {});
}

// Bound concurrent tabs to keep Chrome memory sane on diagram-heavy docs.
const MAX_CONCURRENT = 4;
let running = 0;
const queue = [];
function withSlot(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      running++;
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        running--;
        if (queue.length) queue.shift()();
      }
    };
    running < MAX_CONCURRENT ? run() : queue.push(run);
  });
}

async function renderToPng(source, pngPath, theme) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
    await page.addScriptTag({ path: MERMAID_JS });
    const result = await page.evaluate(
      async (src, theme) => {
        try {
          mermaid.initialize({ startOnLoad: false, theme });
          const { svg } = await mermaid.render('mdv', src);
          document.body.style.cssText = 'margin:0;background:transparent';
          document.body.innerHTML = svg;
          document.querySelector('svg').style.display = 'block';
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e.message || e).split('\n')[0] };
        }
      },
      source,
      theme,
    );
    if (!result.ok) {
      // a real mermaid parse error — safe to negative-cache, unlike env failures
      const err = new Error(result.error);
      err.diagramError = true;
      throw err;
    }
    const el = await page.$('svg');
    fs.writeFileSync(pngPath, await el.screenshot({ type: 'png', omitBackground: true }));
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Render mermaid source to a PNG, returning the cached file path.
 * Throws with the parse error on invalid diagrams.
 * Call closeMermaidBrowser() once all renders are done, or the process hangs.
 */
export async function renderMermaid(source, { refresh = false, theme = 'dark' } = {}) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const hash = createHash('sha256')
    .update(`${source}\0${theme}\0${getMermaidVersion()}`)
    .digest('hex');
  const pngPath = path.join(CACHE_DIR, `${hash}.png`);
  const errPath = path.join(CACHE_DIR, `${hash}.err`);
  if (!refresh) {
    if (fs.existsSync(pngPath)) return pngPath;
    // negative cache: a known-broken diagram shouldn't cost a Chrome boot per preview
    if (fs.existsSync(errPath)) throw new Error(fs.readFileSync(errPath, 'utf8'));
  }

  try {
    await withSlot(() => renderToPng(source, pngPath, theme));
    fs.rmSync(errPath, { force: true });
    return pngPath;
  } catch (err) {
    const detail = (err.message || 'render failed').trim();
    // only diagram errors are permanent; "Chrome not found" etc. must retry next run
    if (err.diagramError) fs.writeFileSync(errPath, detail);
    throw new Error(detail);
  }
}
