import { spawn } from 'node:child_process';

/**
 * Write rendered output to stdout, paging through $PAGER (default `less -R`)
 * when it would overflow the screen. Inline images never page — they don't
 * survive a pager's alternate screen; terminal scrollback handles that case.
 */
export async function writeOutput(out, { forcePager = false, noPager = false, images = false }) {
  const rows = process.stdout.rows || 24;
  const shouldPage =
    forcePager || (!noPager && !images && process.stdout.isTTY && out.split('\n').length > rows);

  if (!shouldPage) {
    process.stdout.write(out);
    return;
  }

  const [cmd, ...cmdArgs] = (process.env.PAGER || 'less -R').split(/\s+/);
  const pager = spawn(cmd, cmdArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  pager.on('error', () => process.stdout.write(out));
  pager.stdin.on('error', () => {}); // pager quit early — not an error
  pager.stdin.end(out);
  await new Promise((resolve) => {
    pager.on('close', resolve);
  });
}
