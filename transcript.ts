/** Session transcript lookup and assistant-text extraction. */

import { createHash } from 'node:crypto';
import { createReadStream, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { errorMessage, isObject, log } from './protocol.ts';

export interface SessionLookup {
  cwd: string;
  extensionDirectory: string;
  sessionId: string;
}

const IS_MACOS = process.platform === 'darwin';

/** Guess zot's state directory; the host never reveals it directly. */
function zotHomeCandidates(extensionDirectory: string): string[] {
  const homes: string[] = [];
  if (process.env.ZOT_HOME) homes.push(process.env.ZOT_HOME);
  if (process.env.XDG_STATE_HOME)
    homes.push(path.join(process.env.XDG_STATE_HOME, 'zot'));
  const home = homedir();
  homes.push(
    IS_MACOS
      ? path.join(home, 'Library', 'Application Support', 'zot')
      : path.join(home, '.local', 'state', 'zot'),
  );
  if (extensionDirectory) {
    const parent = path.dirname(extensionDirectory);
    if (
      path.basename(parent) === 'extensions' &&
      path.basename(path.dirname(parent)) !== '.zot'
    ) {
      homes.push(path.dirname(parent));
    }
  }
  return [...new Set(homes)];
}

function sessionDirectoryName(cwd: string): string {
  return createHash('sha256').update(cwd, 'utf8').digest('hex').slice(0, 16);
}

/** Session id recorded in the meta line of a transcript. */
async function readSessionId(filePath: string): Promise<string> {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const row: unknown = JSON.parse(line);
      if (!isObject(row)) return '';
      const meta = row.meta;
      return isObject(meta) && typeof meta.id === 'string' ? meta.id : '';
    }
  } catch {
    return '';
  } finally {
    lines.close();
    input.destroy();
  }
  return '';
}

/** Transcript of the active session, or undefined when it cannot be found. */
async function findSessionFile(
  lookup: SessionLookup,
): Promise<string | undefined> {
  if (!lookup.sessionId || !lookup.cwd) {
    log('no transcript fallback: session id or cwd is unknown');
    return;
  }
  const searched: string[] = [];
  for (const home of zotHomeCandidates(lookup.extensionDirectory)) {
    const directory = path.join(
      home,
      'sessions',
      sessionDirectoryName(lookup.cwd),
    );
    searched.push(directory);
    let names: string[];
    try {
      names = readdirSync(directory).filter(name => name.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const name of names) {
      const filePath = path.join(directory, name);
      if ((await readSessionId(filePath)) === lookup.sessionId) return filePath;
    }
  }
  log(
    `no transcript for session ${lookup.sessionId}; looked in ${JSON.stringify(searched)}`,
  );
}

/** Visible assistant text of one stored message, tool blocks skipped. */
function messageText(message: unknown): string {
  if (!isObject(message) || message.role !== 'assistant') return '';
  const blocks = Array.isArray(message.content) ? message.content : [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (!isObject(block)) continue;
    if (typeof block.text === 'string' && !('name' in block))
      parts.push(block.text);
  }
  return parts.join('');
}

/** Last non-empty assistant text stored in a session transcript. */
async function transcriptLastText(filePath: string): Promise<string> {
  let last = '';
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const raw of lines) {
      let row: unknown;
      try {
        row = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isObject(row)) continue;
      let text = '';
      if (row.type === 'message') {
        text = messageText(row.message);
      } else if (row.type === 'compaction') {
        const messages: unknown[] = Array.isArray(row.messages)
          ? (row.messages as unknown[])
          : [];
        const stored = messages
          .toReversed()
          .map(message => messageText(message));
        text = stored.find(item => item.trim()) ?? '';
      } else {
        continue;
      }
      if (text.trim()) last = text;
    }
  } catch (error) {
    log(`cannot read transcript ${filePath}: ${errorMessage(error)}`);
  } finally {
    lines.close();
    input.destroy();
  }
  return last;
}

export async function lastStoredText(lookup: SessionLookup): Promise<string> {
  const filePath = await findSessionFile(lookup);
  return filePath ? transcriptLastText(filePath) : '';
}
