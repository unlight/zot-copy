export class Marked {
  use(...extensions: unknown[]): this;
  parse(markdown: string): string;
}
