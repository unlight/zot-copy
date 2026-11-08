/** Markdown formats supported by the /copy command. */

import { Marked } from 'marked';
import markedJira from 'marked-jira';

export const DEFAULT_FORMAT = 'md';

const JIRA_FORMAT = 'jira';
const JIRA_ALIASES = new Set(['jira', 'j']);
const MARKDOWN_FORMATS = new Set(['md', 'markdown']);

const jiraParser = new Marked();
jiraParser.use(markedJira());

/** Canonical lowercased format name, or undefined when unsupported. */
export function resolveFormat(format: string): string | undefined {
  if (MARKDOWN_FORMATS.has(format)) return format;
  if (JIRA_ALIASES.has(format)) return JIRA_FORMAT;
  return undefined;
}

/** Converts Markdown into Jira wiki markup. */
export function toJira(markdown: string): string {
  return jiraParser.parse(markdown, { async: false }).trimEnd();
}
