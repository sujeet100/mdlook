// Browser discovery and launching — shared by mermaid rendering (headless)
// and popup mode (windowed).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const home = os.homedir();
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      path.join(home, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/bin/microsoft-edge',
    ],
    win32: [
      path.join(
        process.env.PROGRAMFILES || 'C:\\Program Files',
        'Google\\Chrome\\Application\\chrome.exe',
      ),
      path.join(
        process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
        'Google\\Chrome\\Application\\chrome.exe',
      ),
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(
        process.env.PROGRAMFILES || 'C:\\Program Files',
        'Microsoft\\Edge\\Application\\msedge.exe',
      ),
    ],
  };
  return (candidates[process.platform] || []).find((p) => p && fs.existsSync(p)) || null;
}

// cross-platform "open in default browser" with a survivable failure mode
function openExternal(url) {
  const [cmd, ...cmdArgs] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
  child.on('error', () => console.error(`mdlook: could not open a browser — visit ${url}`));
  child.unref();
}

export function openPreviewWindow(url) {
  if (process.env.MDLOOK_NO_OPEN || process.env.MDV_NO_OPEN) return;
  const chrome = findChrome();
  if (!chrome) {
    console.error('mdlook: Chrome/Chromium not found, opening in default browser');
    openExternal(url);
    return;
  }
  // Dedicated user-data-dir forces a separate Chrome process: --window-size is
  // honored, and closing the window drops the SSE connection so we can auto-exit.
  const child = spawn(
    chrome,
    [
      `--app=${url}`,
      `--user-data-dir=${path.join(os.homedir(), '.cache', 'mdlook', 'chrome-profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=980,1100',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.on('error', () => {
    console.error('mdlook: failed to launch Chrome, opening in default browser');
    openExternal(url);
  });
  child.unref();
}
