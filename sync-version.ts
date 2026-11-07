/** Write the release version into the manifest, package metadata and source. */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isObject } from './protocol.ts';

const ROOT = import.meta.dirname;
const JSON_FILES = ['extension.json', 'package.json'];
const SOURCE_FILE = 'copy.ts';
const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COPY_VERSION = /^const VERSION = '[^']*';$/gm;

function writeJsonVersion(fileName: string, version: string): void {
  const filePath = path.join(ROOT, fileName);
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!isObject(parsed)) throw new Error(`${fileName} is not a JSON object`);
  const updated = { ...parsed, version };
  writeFileSync(filePath, `${JSON.stringify(updated, undefined, 2)}\n`, 'utf8');
}

function writeSourceVersion(version: string): void {
  const filePath = path.join(ROOT, SOURCE_FILE);
  const source = readFileSync(filePath, 'utf8');
  const matches = source.match(COPY_VERSION) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `expected one VERSION assignment in ${SOURCE_FILE}, found ${matches.length}`,
    );
  }
  const line = `const VERSION = '${version}';`;
  writeFileSync(
    filePath,
    source.replaceAll(COPY_VERSION, () => line),
    'utf8',
  );
}

function syncVersion(version: string): void {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`invalid semantic version: ${JSON.stringify(version)}`);
  }
  for (const fileName of JSON_FILES) writeJsonVersion(fileName, version);
  writeSourceVersion(version);
}

const version = process.argv[2];
if (version === undefined) {
  throw new Error('usage: sync-version.ts <version>');
}
syncVersion(version);
