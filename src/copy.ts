#!/usr/bin/env node
/** zot /copy — copy the last agent response to the clipboard or a file. */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { copyToClipboard } from './clipboard.ts';
import { defaultFileName } from './filename.ts';
import { DEFAULT_FORMAT, isSupportedFormat, toJira } from './format.ts';
import {
  errorMessage,
  isObject,
  log,
  NAME,
  send,
  textField,
} from './protocol.ts';
import type { JsonObject } from './protocol.ts';
import { lastStoredText } from './transcript.ts';

const VERSION = '1.1.0';
const CAPABILITIES = ['commands'];
const SUBSCRIBED_EVENTS = [
  'assistant_message',
  'turn_end',
  'session_start',
  'turn_start',
  'session_end',
];

interface SessionState {
  cwd: string;
  extensionDirectory: string;
  lastText: string;
  sessionAlias: string;
  sessionId: string;
  stepText: string;
}

const state: SessionState = {
  cwd: '',
  extensionDirectory: '',
  lastText: '',
  sessionAlias: '',
  sessionId: '',
  stepText: '',
};

function respond(commandId: string, display = '', error = ''): void {
  // The host drops display text when error is set, so send only one of them.
  const frame: JsonObject = { type: 'command_response', id: commandId };
  if (error) {
    frame.error = error;
  } else {
    frame.action = 'display';
    frame.display = display;
  }
  send(frame);
}

/** Message text for /copy, falling back to the session transcript. */
async function cachedOrStoredText(): Promise<string> {
  if (state.lastText.trim()) return state.lastText;
  return lastStoredText({
    cwd: state.cwd,
    extensionDirectory: state.extensionDirectory,
    sessionId: state.sessionId,
  });
}

interface CopyRequest {
  file: boolean;
  filePath: string;
  format: string;
}

/** Parses `/copy` arguments; returns an error message for unknown input. */
function parseCopyRequest(rawInput: string): CopyRequest | string {
  const input = rawInput.trim();
  if (!input) return { file: false, filePath: '', format: DEFAULT_FORMAT };
  const spaceIndex = input.search(/\s/);
  const head = (
    spaceIndex === -1 ? input : input.slice(0, spaceIndex)
  ).toLowerCase();
  const tail = spaceIndex === -1 ? '' : input.slice(spaceIndex + 1).trim();
  if (head === 'file')
    return { file: true, filePath: tail, format: DEFAULT_FORMAT };
  if (!isSupportedFormat(head)) {
    return `Unknown format "${head}". Usage: /copy [md|jira] [file [path]].`;
  }
  if (!tail) return { file: false, filePath: '', format: head };
  const fileMatch = /^file(?:\s+([\s\S]*))?$/i.exec(tail);
  return fileMatch
    ? { file: true, filePath: fileMatch[1]?.trim() ?? '', format: head }
    : `Unknown arguments "${input}". Usage: /copy [md|jira] [file [path]].`;
}

/** Writes the payload and returns an error message, or undefined on success. */
function writePayload(filePath: string, payload: string): string | undefined {
  try {
    writeFileSync(filePath, payload, 'utf8');
    return undefined;
  } catch (error) {
    return `Could not write ${filePath}: ${errorMessage(error)}`;
  }
}

async function handleCommandInvoked(frame: JsonObject): Promise<void> {
  const commandId = textField(frame, 'id');
  if (frame.name !== NAME) {
    respond(commandId, '', `unknown command /${textField(frame, 'name')}`);
    return;
  }
  const request = parseCopyRequest(textField(frame, 'args'));
  if (typeof request === 'string') {
    respond(commandId, '', request);
    return;
  }
  const text = await cachedOrStoredText();
  if (!text.trim()) {
    respond(
      commandId,
      'Nothing to copy yet — no agent response in this session.',
    );
    return;
  }
  const payload = request.format === 'jira' ? toJira(text) : text;
  if (request.file) {
    const target =
      request.filePath || defaultFileName(state.sessionAlias, request.format);
    const filePath = path.resolve(state.cwd || process.cwd(), target);
    const writeError = writePayload(filePath, payload);
    if (writeError) {
      respond(commandId, '', writeError);
      return;
    }
    respond(commandId, `Wrote the last agent response to ${filePath}.`);
    return;
  }
  const result = await copyToClipboard(payload);
  if (!result.ok) {
    respond(commandId, '', result.reason);
    return;
  }
  respond(commandId, 'Copied the last agent response to the clipboard.');
}

function handleEvent(frame: JsonObject): void {
  const eventName = textField(frame, 'event');
  state.sessionId = textField(frame, 'session_id') || state.sessionId;
  state.cwd = textField(frame, 'cwd') || state.cwd;
  const sessionAlias = textField(frame, 'session_alias');
  if (eventName === 'session_start' || sessionAlias) {
    state.sessionAlias = sessionAlias;
  }
  switch (eventName) {
    case 'assistant_message': {
      // The host emits one event per model step; only a final step is an answer.
      const text = textField(frame, 'text');
      if (text.trim()) state.stepText = text;
      break;
    }
    case 'turn_end': {
      // Tool-use steps are narration, not the final response.
      if (textField(frame, 'stop') !== 'tool_use' && state.stepText.trim())
        state.lastText = state.stepText;
      state.stepText = '';
      break;
    }
    case 'turn_start': {
      // Keep the previous answer available while a new turn is running.
      state.stepText = '';
      break;
    }
    case 'session_start':
    case 'session_end': {
      state.lastText = '';
      state.stepText = '';
      break;
    }
    // No default
  }
}

function handleHelloAck(frame: JsonObject): void {
  state.extensionDirectory = textField(frame, 'extension_dir');
  state.cwd = textField(frame, 'cwd');
  send({
    type: 'register_command',
    name: NAME,
    description: 'copy the last agent response (clipboard or file; md or jira)',
  });
  send({ type: 'subscribe', events: SUBSCRIBED_EVENTS });
  send({ type: 'ready' });
}

/** Returns false when the host asks the serve loop to stop. */
async function shouldContinue(frame: JsonObject): Promise<boolean> {
  const frameType = textField(frame, 'type');
  switch (frameType) {
    case 'hello_ack': {
      handleHelloAck(frame);
      break;
    }
    case 'command_invoked': {
      await handleCommandInvoked(frame);
      break;
    }
    case 'event': {
      handleEvent(frame);
      break;
    }
    case 'shutdown': {
      send({ type: 'shutdown_ack' });
      return false;
    }
    // No default
  }
  return true;
}

async function serve(): Promise<void> {
  send({
    type: 'hello',
    name: NAME,
    version: VERSION,
    capabilities: CAPABILITIES,
  });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch (error) {
      log(`malformed frame: ${errorMessage(error)}`);
      continue;
    }
    if (!isObject(frame)) {
      log('malformed frame: not a JSON object');
      continue;
    }
    if (!(await shouldContinue(frame))) {
      lines.close();
      return;
    }
  }
}

async function main(): Promise<void> {
  // The host is gone; silence the write-after-close noise.
  process.stdout.on('error', () => process.exit(0));
  try {
    await serve();
  } catch (error) {
    log(`fatal: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

void main();
