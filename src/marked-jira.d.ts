declare module 'marked-jira' {
  import type { MarkedExtension } from 'marked';

  export default function markedJira(
    options?: Record<string, unknown>,
  ): MarkedExtension;
}
