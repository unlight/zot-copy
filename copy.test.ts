/** Wire-level tests for copy.ts: real subprocess, fake clipboard tools. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

type JsonObject = Record<string, unknown>;

const SCRIPT = fileURLToPath(new URL('copy.ts', import.meta.url));
const CAPTURED = 'captured.txt';
const LINUX_ONLY =
  process.platform === 'linux' ? false : 'clipboard stubs are Linux-only';

interface Fixture {
  bin: string;
  home: string;
  cwd: string;
  capture: string;
}

function line(item: unknown): string {
  return (typeof item === 'string' ? item : JSON.stringify(item)) + '\n';
}

function makeFixture(t: TestContext): Fixture {
  const base = mkdtempSync(path.join(tmpdir(), 'zot-copy-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = path.join(base, 'bin');
  const home = path.join(base, 'zot-home');
  mkdirSync(bin);
  mkdirSync(home);
  return {
    bin,
    home,
    cwd: '/work/demo',
    capture: path.join(base, CAPTURED),
  };
}

/** Feed frames to the extension and return its stdout lines as frames. */
function runExtension(
  lines: unknown[],
  bin: string,
  environmentExtra: Record<string, string>,
): JsonObject[] {
  const environment: Record<string, string | undefined> = { ...process.env };
  delete environment.WAYLAND_DISPLAY;
  environment.DISPLAY = ':0';
  environment.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
  environment.ZOT_HOME = '';
  Object.assign(environment, environmentExtra);
  const proc = spawnSync(process.execPath, [SCRIPT], {
    input: lines.map(item => line(item)).join(''),
    encoding: 'utf8',
    env: environment,
    timeout: 30_000,
  });
  assert.equal(
    proc.status,
    0,
    `extension exited with ${proc.status}: ${proc.stderr}`,
  );
  return proc.stdout
    .split('\n')
    .filter(out => out.trim())
    .map(out => JSON.parse(out) as JsonObject);
}

function runLines(f: Fixture, lines: unknown[]): JsonObject[] {
  return runExtension(lines, f.bin, { ZOT_HOME: f.home });
}

function responses(frames: JsonObject[]): JsonObject[] {
  return frames.filter(frame => frame.type === 'command_response');
}

function firstResponse(frames: JsonObject[]): JsonObject {
  const response = responses(frames)[0];
  assert.ok(response, 'expected a command_response frame');
  return response;
}

function displayed(response: JsonObject): string {
  return typeof response.display === 'string' ? response.display : '';
}

function helloAck(f: Fixture): JsonObject {
  return {
    type: 'hello_ack',
    cwd: f.cwd,
    extension_dir: path.join(f.home, 'extensions', 'copy'),
  };
}

/** Lay out a transcript the way zot does: sessions/<sha256(cwd)[:16]>. */
function writeSession(
  f: Fixture,
  sessionId: string,
  messages: unknown[],
): string {
  const directory = path.join(
    f.home,
    'sessions',
    createHash('sha256').update(f.cwd).digest('hex').slice(0, 16),
  );
  mkdirSync(directory, { recursive: true });
  const rows: unknown[] = [
    { type: 'meta', meta: { id: sessionId, cwd: f.cwd, alias: 'old-one' } },
  ];
  for (const message of messages) rows.push({ type: 'message', message });
  const filePath = path.join(directory, 'named-old-one.jsonl');
  writeFileSync(
    filePath,
    rows.map(row => JSON.stringify(row) + '\n').join(''),
    'utf8',
  );
  return filePath;
}

/** Install a fake clipboard tool that captures stdin and exits with code. */
function stubTool(f: Fixture, name: string, exitCode = 0): string {
  const script = path.join(f.bin, name);
  writeFileSync(
    script,
    `#!/bin/sh\ncat > "${f.capture}"\nexit ${exitCode}\n`,
    'utf8',
  );
  chmodSync(script, 0o755);
  return script;
}

void test('handshake order', t => {
  const frames = runLines(makeFixture(t), [{ type: 'hello_ack' }]);
  assert.deepEqual(
    frames.map(frame => frame.type),
    ['hello', 'register_command', 'subscribe', 'ready'],
  );
  assert.equal(frames[0]?.name, 'copy');
  const events = frames[2]?.events as string[];
  assert.ok(events.includes('assistant_message'));
  assert.ok(events.includes('turn_end'));
});

void test('nothing to copy before any message', t => {
  const frames = runLines(makeFixture(t), [
    { type: 'hello_ack' },
    { type: 'command_invoked', id: 'c1', name: 'copy' },
  ]);
  assert.ok(displayed(firstResponse(frames)).startsWith('Nothing to copy yet'));
});

void test('copies last assistant message', { skip: LINUX_ONLY }, t => {
  const f = makeFixture(t);
  stubTool(f, 'xclip');
  const frames = runLines(f, [
    { type: 'hello_ack' },
    { type: 'event', event: 'assistant_message', text: 'привет' },
    { type: 'event', event: 'turn_end', stop: 'end_turn' },
    { type: 'command_invoked', id: 'c1', name: 'copy' },
  ]);
  assert.ok(displayed(firstResponse(frames)).startsWith('Copied the last'));
  assert.equal(readFileSync(f.capture, 'utf8'), 'привет');
});

void test('jira format converts markdown', { skip: LINUX_ONLY }, t => {
  const f = makeFixture(t);
  stubTool(f, 'xclip');
  const frames = runLines(f, [
    { type: 'hello_ack' },
    {
      type: 'event',
      event: 'assistant_message',
      text: '# Title\n\nSome **bold** and [link](https://example.com).',
    },
    { type: 'event', event: 'turn_end', stop: 'end_turn' },
    { type: 'command_invoked', id: 'c1', name: 'copy', args: 'jira' },
  ]);
  assert.ok(displayed(firstResponse(frames)).startsWith('Copied the last'));
  assert.equal(
    readFileSync(f.capture, 'utf8'),
    'h1. Title\n\nSome *bold* and [link|https://example.com].',
  );
});

void test('markdown format keeps the source text', { skip: LINUX_ONLY }, t => {
  const f = makeFixture(t);
  stubTool(f, 'xclip');
  const text = '# Title\n\n**bold**';
  runLines(f, [
    { type: 'hello_ack' },
    { type: 'event', event: 'assistant_message', text },
    { type: 'event', event: 'turn_end', stop: 'end_turn' },
    { type: 'command_invoked', id: 'c1', name: 'copy', args: ' Markdown ' },
  ]);
  assert.equal(readFileSync(f.capture, 'utf8'), text);
});

void test('unknown format is rejected', t => {
  const f = makeFixture(t);
  const frames = runLines(f, [
    { type: 'hello_ack' },
    { type: 'event', event: 'assistant_message', text: 'text' },
    { type: 'event', event: 'turn_end', stop: 'end_turn' },
    { type: 'command_invoked', id: 'c1', name: 'copy', args: 'pdf' },
  ]);
  const response = firstResponse(frames);
  assert.match(String(response.error), /Unknown format "pdf"/);
  assert.match(String(response.error), /Usage: \/copy/);
  assert.ok(!existsSync(f.capture));
});

void test('clipboard failure sends only error', { skip: LINUX_ONLY }, t => {
  const f = makeFixture(t);
  stubTool(f, 'xclip', 1);
  stubTool(f, 'xsel', 1);
  const frames = runLines(f, [
    { type: 'hello_ack' },
    { type: 'event', event: 'assistant_message', text: 'text' },
    { type: 'event', event: 'turn_end', stop: 'end_turn' },
    { type: 'command_invoked', id: 'c1', name: 'copy' },
  ]);
  const response = firstResponse(frames);
  assert.match(String(response.error), /exited with 1/);
  assert.ok(!('display' in response));
});

void test(
  'turn_start keeps last completed response',
  { skip: LINUX_ONLY },
  t => {
    const f = makeFixture(t);
    stubTool(f, 'xclip');
    const frames = runLines(f, [
      { type: 'hello_ack' },
      { type: 'event', event: 'assistant_message', text: 'готово' },
      { type: 'event', event: 'turn_end', stop: 'end_turn' },
      { type: 'event', event: 'turn_start', step: 2 },
      { type: 'command_invoked', id: 'c1', name: 'copy' },
    ]);
    assert.ok(displayed(firstResponse(frames)).startsWith('Copied the last'));
    assert.equal(readFileSync(f.capture, 'utf8'), 'готово');
  },
);

void test('tool_use step is not copied', t => {
  const frames = runLines(makeFixture(t), [
    { type: 'hello_ack' },
    { type: 'event', event: 'assistant_message', text: 'I will inspect' },
    { type: 'event', event: 'turn_end', stop: 'tool_use' },
    { type: 'command_invoked', id: 'c1', name: 'copy' },
  ]);
  assert.ok(displayed(firstResponse(frames)).startsWith('Nothing to copy yet'));
});

void test(
  'tool_use step does not replace previous response',
  { skip: LINUX_ONLY },
  t => {
    const f = makeFixture(t);
    stubTool(f, 'xclip');
    const frames = runLines(f, [
      { type: 'hello_ack' },
      { type: 'event', event: 'assistant_message', text: 'готово' },
      { type: 'event', event: 'turn_end', stop: 'end_turn' },
      { type: 'event', event: 'turn_start', step: 2 },
      { type: 'event', event: 'assistant_message', text: 'I will inspect' },
      { type: 'event', event: 'turn_end', stop: 'tool_use' },
      { type: 'command_invoked', id: 'c1', name: 'copy' },
    ]);
    assert.ok(displayed(firstResponse(frames)).startsWith('Copied the last'));
    assert.equal(readFileSync(f.capture, 'utf8'), 'готово');
  },
);

void test('session boundary clears completed response', t => {
  for (const boundary of ['session_start', 'session_end']) {
    const frames = runLines(makeFixture(t), [
      { type: 'hello_ack' },
      { type: 'event', event: 'assistant_message', text: 'preamble' },
      { type: 'event', event: 'turn_end', stop: 'end_turn' },
      { type: 'event', event: boundary },
      { type: 'command_invoked', id: 'c1', name: 'copy' },
    ]);
    assert.ok(
      displayed(firstResponse(frames)).startsWith('Nothing to copy yet'),
      `${boundary} should clear the cache`,
    );
  }
});

void test('malformed frame keeps running', t => {
  const frames = runLines(makeFixture(t), [
    { type: 'hello_ack' },
    'not json',
    { type: 'command_invoked', id: 'c1', name: 'copy' },
  ]);
  assert.equal(firstResponse(frames).id, 'c1');
});

void test(
  'copies transcript text after session load',
  { skip: LINUX_ONLY },
  t => {
    const f = makeFixture(t);
    stubTool(f, 'xclip');
    writeSession(f, 'sess-1', [
      { role: 'user', content: [{ text: 'вопрос' }] },
      { role: 'assistant', content: [{ text: 'старый ответ' }] },
      { role: 'assistant', content: [{ summary: 'размышление' }] },
      {
        role: 'assistant',
        content: [{ id: 't1', name: 'bash', arguments: {} }],
      },
      { role: 'assistant', content: [{ text: 'новый ответ' }] },
    ]);
    const frames = runLines(f, [
      helloAck(f),
      {
        type: 'event',
        event: 'session_start',
        session_id: 'sess-1',
        cwd: f.cwd,
      },
      { type: 'command_invoked', id: 'c1', name: 'copy' },
    ]);
    assert.ok(displayed(firstResponse(frames)).startsWith('Copied the last'));
    assert.equal(readFileSync(f.capture, 'utf8'), 'новый ответ');
  },
);

void test('unknown session stays empty', t => {
  const f = makeFixture(t);
  writeSession(f, 'sess-2', [
    { role: 'assistant', content: [{ text: 'чужое' }] },
  ]);
  const frames = runLines(f, [
    helloAck(f),
    { type: 'event', event: 'session_start', session_id: 'other', cwd: f.cwd },
    { type: 'command_invoked', id: 'c1', name: 'copy' },
  ]);
  assert.ok(displayed(firstResponse(frames)).startsWith('Nothing to copy yet'));
});

void test('metadata versions match the source constant', () => {
  const directory = path.dirname(SCRIPT);
  const source = readFileSync(SCRIPT, 'utf8');
  const sourceVersion = /^const VERSION = '([^']+)';$/m.exec(source)?.[1];
  assert.ok(sourceVersion);
  for (const fileName of ['extension.json', 'package.json']) {
    const raw = readFileSync(path.join(directory, fileName), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    assert.equal(parsed.version, sourceVersion, `${fileName} version`);
  }
  const lockfile = JSON.parse(
    readFileSync(path.join(directory, 'package-lock.json'), 'utf8'),
  ) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };
  assert.equal(lockfile.version, sourceVersion, 'package-lock.json version');
  assert.equal(
    lockfile.packages?.['']?.version,
    sourceVersion,
    'package-lock.json root version',
  );
});
