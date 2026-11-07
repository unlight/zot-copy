/** Shared JSON-line plumbing for the zot extension protocol. */

export type JsonObject = Record<string, unknown>;

export const NAME = 'copy';

export function send(frame: JsonObject): void {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

export function log(message: string): void {
  process.stderr.write(`[${NAME}] ${message}\n`);
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function textField(frame: JsonObject, key: string): string {
  const value = frame[key];
  return typeof value === 'string' ? value : '';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
