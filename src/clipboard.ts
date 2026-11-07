/** Clipboard backends and the ordered fallback chain. */

import { spawn } from 'node:child_process';

import { log } from './protocol.ts';

export type ClipboardCommand = [string, ...string[]];

const CLIPBOARD_TIMEOUT_MS = 2000; // per candidate
const CLIPBOARD_BUDGET_MS = 5000; // whole chain, keeps the frame loop responsive
const IS_MACOS = process.platform === 'darwin';

function clipboardCandidates(): ClipboardCommand[] {
  if (IS_MACOS) return [['pbcopy']];
  const candidates: ClipboardCommand[] = [];
  if (process.env.WAYLAND_DISPLAY) candidates.push(['wl-copy']);
  candidates.push(
    ['xclip', '-selection', 'clipboard'],
    ['xsel', '--clipboard', '--input'],
  );
  return candidates;
}

function isClipboardAvailable(): boolean {
  return (
    IS_MACOS || Boolean(process.env.WAYLAND_DISPLAY || process.env.DISPLAY)
  );
}

function formatSeconds(ms: number): string {
  return String(Math.round(ms / 100) / 10);
}

function tryCandidate(
  argv: ClipboardCommand,
  text: string,
  timeoutMs: number,
): Promise<string> {
  const [command, ...toolArguments] = argv;
  return new Promise(resolve => {
    let isSettled = false;
    const finish = (failure: string): void => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      resolve(failure);
    };
    const child = spawn(command, toolArguments, {
      stdio: ['pipe', 'ignore', 'ignore'] as const,
    });
    const timer = setTimeout(
      () => {
        child.kill('SIGKILL');
        finish(`${command} timed out after ${formatSeconds(timeoutMs)}s`);
      },
      Math.max(1, timeoutMs),
    );
    child.once('error', (error: NodeJS.ErrnoException) => {
      finish(
        error.code === 'ENOENT'
          ? `${command} not found`
          : `${command}: ${error.message}`,
      );
    });
    child.once('exit', (code, signal) => {
      finish(
        code === 0
          ? ''
          : `${command} exited with ${code ?? signal ?? 'unknown'}`,
      );
    });
    child.stdin.on('error', () => {
      // The tool may exit before it reads the payload; the exit code decides.
    });
    child.stdin.end(text);
  });
}

export async function copyToClipboard(
  text: string,
): Promise<{ ok: boolean; reason: string }> {
  if (!isClipboardAvailable()) {
    return {
      ok: false,
      reason:
        'clipboard unavailable: no X11/Wayland display (DISPLAY/WAYLAND_DISPLAY unset)',
    };
  }
  const deadline = Date.now() + CLIPBOARD_BUDGET_MS;
  const failures: string[] = [];
  for (const argv of clipboardCandidates()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      failures.push('out of time budget');
      break;
    }
    const failure = await tryCandidate(
      argv,
      text,
      Math.min(CLIPBOARD_TIMEOUT_MS, remaining),
    );
    if (!failure) return { ok: true, reason: '' };
    log(failure);
    failures.push(failure);
  }
  return { ok: false, reason: `clipboard failed: ${failures.join('; ')}` };
}
