#!/usr/bin/env node
/** zot /copy — copy the last agent response to the system clipboard. */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";

type JsonObject = Record<string, unknown>;
type ClipboardCommand = [string, ...string[]];

const NAME = "copy";
const VERSION = "1.0.0";
const CAPABILITIES = ["commands"];
const CLIPBOARD_TIMEOUT_MS = 2000; // per candidate
const CLIPBOARD_BUDGET_MS = 5000; // whole chain, keeps the frame loop responsive
const SUBSCRIBED_EVENTS = [
  "assistant_message",
  "turn_end",
  "session_start",
  "turn_start",
  "session_end",
];

const IS_MACOS = process.platform === "darwin";

let lastText = "";
let stepText = "";
let currentSessionId = "";
let currentCwd = "";
let extensionDir = "";

function send(frame: JsonObject): void {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function log(message: string): void {
  process.stderr.write(`[${NAME}] ${message}\n`);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(frame: JsonObject, key: string): string {
  const value = frame[key];
  return typeof value === "string" ? value : "";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatSeconds(ms: number): string {
  return String(Math.round(ms / 100) / 10);
}

function clipboardCandidates(): ClipboardCommand[] {
  if (IS_MACOS) return [["pbcopy"]];
  const candidates: ClipboardCommand[] = [];
  if (process.env.WAYLAND_DISPLAY) candidates.push(["wl-copy"]);
  candidates.push(["xclip", "-selection", "clipboard"]);
  candidates.push(["xsel", "--clipboard", "--input"]);
  return candidates;
}

function clipboardAvailable(): boolean {
  if (IS_MACOS) return true;
  return Boolean(process.env.WAYLAND_DISPLAY || process.env.DISPLAY);
}

function tryCandidate(argv: ClipboardCommand, text: string, timeoutMs: number): Promise<string> {
  const [command, ...args] = argv;
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (failure: string): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(failure);
    };
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] as const });
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(`${command} timed out after ${formatSeconds(timeoutMs)}s`);
    }, Math.max(1, timeoutMs));
    child.once("error", (err: NodeJS.ErrnoException) => {
      finish(err.code === "ENOENT" ? `${command} not found` : `${command}: ${err.message}`);
    });
    child.once("exit", (code, signal) => {
      finish(code === 0 ? "" : `${command} exited with ${code ?? signal ?? "unknown"}`);
    });
    child.stdin.on("error", () => {
      // The tool may exit before it reads the payload; the exit code decides.
    });
    child.stdin.end(text);
  });
}

async function copyToClipboard(text: string): Promise<{ ok: boolean; reason: string }> {
  if (!clipboardAvailable()) {
    return {
      ok: false,
      reason: "clipboard unavailable: no X11/Wayland display (DISPLAY/WAYLAND_DISPLAY unset)",
    };
  }
  const deadline = Date.now() + CLIPBOARD_BUDGET_MS;
  const failures: string[] = [];
  for (const argv of clipboardCandidates()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      failures.push("out of time budget");
      break;
    }
    const failure = await tryCandidate(argv, text, Math.min(CLIPBOARD_TIMEOUT_MS, remaining));
    if (!failure) return { ok: true, reason: "" };
    log(failure);
    failures.push(failure);
  }
  return { ok: false, reason: `clipboard failed: ${failures.join("; ")}` };
}

function respond(commandId: string, display = "", error = ""): void {
  // The host drops display text when error is set, so send only one of them.
  const frame: JsonObject = { type: "command_response", id: commandId };
  if (error) {
    frame.error = error;
  } else {
    frame.action = "display";
    frame.display = display;
  }
  send(frame);
}

/** Guess zot's state directory; the host never reveals it directly. */
function zotHomeCandidates(): string[] {
  const homes: string[] = [];
  if (process.env.ZOT_HOME) homes.push(process.env.ZOT_HOME);
  if (process.env.XDG_STATE_HOME) homes.push(join(process.env.XDG_STATE_HOME, "zot"));
  const home = homedir();
  if (IS_MACOS) {
    homes.push(join(home, "Library", "Application Support", "zot"));
  } else {
    homes.push(join(home, ".local", "state", "zot"));
  }
  if (extensionDir) {
    const parent = dirname(extensionDir);
    if (basename(parent) === "extensions" && basename(dirname(parent)) !== ".zot") {
      homes.push(dirname(parent));
    }
  }
  return [...new Set(homes)];
}

function sessionDirName(cwd: string): string {
  return createHash("sha256").update(cwd, "utf8").digest("hex").slice(0, 16);
}

/** Session id recorded in the meta line of a transcript. */
async function readSessionId(path: string): Promise<string> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const row: unknown = JSON.parse(line);
      if (!isObject(row)) return "";
      const meta = row.meta;
      return isObject(meta) && typeof meta.id === "string" ? meta.id : "";
    }
  } catch {
    return "";
  } finally {
    lines.close();
    input.destroy();
  }
  return "";
}

/** Transcript of the active session, or null when it cannot be found. */
async function findSessionFile(): Promise<string | null> {
  if (!currentSessionId || !currentCwd) {
    log("no transcript fallback: session id or cwd is unknown");
    return null;
  }
  const searched: string[] = [];
  for (const home of zotHomeCandidates()) {
    const directory = join(home, "sessions", sessionDirName(currentCwd));
    searched.push(directory);
    let names: string[];
    try {
      names = readdirSync(directory)
        .filter((name) => name.endsWith(".jsonl"))
        .sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const path = join(directory, name);
      if ((await readSessionId(path)) === currentSessionId) return path;
    }
  }
  log(`no transcript for session ${currentSessionId}; looked in ${JSON.stringify(searched)}`);
  return null;
}

/** Visible assistant text of one stored message, tool blocks skipped. */
function messageText(message: unknown): string {
  if (!isObject(message) || message.role !== "assistant") return "";
  const blocks = Array.isArray(message.content) ? message.content : [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (!isObject(block)) continue;
    if (typeof block.text === "string" && !("name" in block)) parts.push(block.text);
  }
  return parts.join("");
}

/** Last non-empty assistant text stored in a session transcript. */
async function transcriptLastText(path: string): Promise<string> {
  let last = "";
  const input = createReadStream(path, { encoding: "utf8" });
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
      let text = "";
      if (row.type === "message") {
        text = messageText(row.message);
      } else if (row.type === "compaction") {
        const messages = Array.isArray(row.messages) ? row.messages : [];
        const stored = [...messages].reverse().map(messageText);
        text = stored.find((item) => item.trim()) ?? "";
      } else {
        continue;
      }
      if (text.trim()) last = text;
    }
  } catch (err) {
    log(`cannot read transcript ${path}: ${errorMessage(err)}`);
  } finally {
    lines.close();
    input.destroy();
  }
  return last;
}

/** Message text for /copy, falling back to the session transcript. */
async function cachedOrStoredText(): Promise<string> {
  if (lastText.trim()) return lastText;
  const path = await findSessionFile();
  if (path === null) return "";
  return transcriptLastText(path);
}

async function handleCommandInvoked(frame: JsonObject): Promise<void> {
  const commandId = textField(frame, "id");
  if (frame.name !== "copy") {
    respond(commandId, "", `unknown command /${textField(frame, "name")}`);
    return;
  }
  const text = await cachedOrStoredText();
  if (!text.trim()) {
    respond(commandId, "Nothing to copy yet — no agent response in this session.");
    return;
  }
  const result = await copyToClipboard(text);
  if (!result.ok) {
    respond(commandId, "", result.reason);
    return;
  }
  respond(commandId, "Copied the last agent response to the clipboard.");
}

function handleEvent(frame: JsonObject): void {
  const eventName = textField(frame, "event");
  currentSessionId = textField(frame, "session_id") || currentSessionId;
  currentCwd = textField(frame, "cwd") || currentCwd;
  switch (eventName) {
    case "assistant_message": {
      // The host emits one event per model step; only a final step is an answer.
      const text = textField(frame, "text");
      if (text.trim()) stepText = text;
      break;
    }
    case "turn_end":
      // Tool-use steps are narration, not the final response.
      if (textField(frame, "stop") !== "tool_use" && stepText.trim()) lastText = stepText;
      stepText = "";
      break;
    case "turn_start":
      // Keep the previous answer available while a new turn is running.
      stepText = "";
      break;
    case "session_start":
    case "session_end":
      lastText = "";
      stepText = "";
      break;
  }
}

function handleHelloAck(frame: JsonObject): void {
  extensionDir = textField(frame, "extension_dir");
  currentCwd = textField(frame, "cwd");
  send({
    type: "register_command",
    name: NAME,
    description: "copy the last agent response to the clipboard",
  });
  send({ type: "subscribe", events: SUBSCRIBED_EVENTS });
  send({ type: "ready" });
}

async function serve(): Promise<void> {
  send({ type: "hello", name: NAME, version: VERSION, capabilities: CAPABILITIES });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch (err) {
      log(`malformed frame: ${errorMessage(err)}`);
      continue;
    }
    if (!isObject(frame)) {
      log("malformed frame: not a JSON object");
      continue;
    }
    switch (textField(frame, "type")) {
      case "hello_ack":
        handleHelloAck(frame);
        break;
      case "command_invoked":
        await handleCommandInvoked(frame);
        break;
      case "event":
        handleEvent(frame);
        break;
      case "shutdown":
        send({ type: "shutdown_ack" });
        lines.close();
        return;
    }
  }
}

async function main(): Promise<void> {
  // The host is gone; silence the write-after-close noise.
  process.stdout.on("error", () => process.exit(0));
  try {
    await serve();
  } catch (err) {
    log(`fatal: ${errorMessage(err)}`);
    process.exitCode = 1;
  }
}

void main();
