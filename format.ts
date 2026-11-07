/** Markdown formats supported by the /copy command. */

import markedJira from './vendor/marked-jira.js';
import { Marked } from './vendor/marked.js';

export const DEFAULT_FORMAT = 'md';

const JIRA_FORMAT = 'jira';
const MARKDOWN_FORMATS = new Set(['md', 'markdown']);

const jiraParser = new Marked();
jiraParser.use(markedJira());

/** Whether a lowercased format name is supported. */
export function isSupportedFormat(format: string): boolean {
  return MARKDOWN_FORMATS.has(format) || format === JIRA_FORMAT;
}

/** Converts Markdown into Jira wiki markup. */
export function toJira(markdown: string): string {
  return jiraParser.parse(markdown).trimEnd();
}
