/** Default file names for `/copy file`. */

const FALLBACK_NAME = 'zot-copy';
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Builds the default `<alias>-dd-mmm-YYYYTHH:mm.<ext>` file name. */
export function defaultFileName(
  alias: string,
  format: string,
  now = new Date(),
): string {
  const safeAlias =
    alias.replaceAll(/[^\w.-]+/g, '-').replaceAll(/^-+|-+$/g, '') ||
    FALLBACK_NAME;
  const day = String(now.getDate()).padStart(2, '0');
  const month = MONTHS[now.getMonth()] ?? 'Jan';
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const extension = format === 'jira' ? '.jira' : '.md';
  return `${safeAlias}-${day}-${month}-${year}T${hours}:${minutes}${extension}`;
}
