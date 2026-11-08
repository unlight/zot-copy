# zot-copy

[![CI](https://github.com/unlight/zot-copy/actions/workflows/ci.yml/badge.svg)](https://github.com/unlight/zot-copy/actions/workflows/ci.yml)

Copy the last agent response as Markdown or Jira wiki markup, to the
clipboard or a file. A TypeScript extension for zot, running on Node.js.

## Install

```bash
zot ext install https://github.com/unlight/zot-copy
```

Or run ad-hoc:

```bash
zot --ext ./zot-copy
```

The repository ships the built `dist/copy.js`, so installing needs no build
step and no `npm install`.

Restart zot after installing or updating.

## Usage

```text
/copy                     # Markdown to the clipboard
/copy markdown            # same as the default
/copy md                  # alias for markdown
/copy jira                # Jira wiki markup to the clipboard
/copy j                   # alias for jira
/copy file [path]         # Markdown to a file
/copy jira file [path]    # Jira wiki markup to a file
```

The format argument is optional and case-insensitive; `j` is short for
`jira`. The default `md` assumes the agent already writes Markdown and copies
the text untouched. `jira` converts it through `marked` and `marked-jira`:
headings become `h1.`, bold becomes `*bold*`, links become `[text|url]`,
and fenced code becomes `{code}` blocks.

`/copy file` writes instead of touching the clipboard. Without a path it
creates `<session alias>-dd-mmm-YYYY-HH-mm-ss.md` in the session working
directory (`.jira` for Jira markup); relative paths resolve against that
directory.

## How it works

- **Runtime** — zot executes the committed `dist/copy.js`, an ESM bundle built
  by tsdown from `src/`. Node.js 22.18+ runs it directly; `marked` and
  `marked-jira` are bundled into the artifact, so no `npm install` happens at
  install time. `npm run typecheck` checks the types separately.
- **Event subscription** — the extension subscribes to `assistant_message`
  and `turn_end`. A response is committed only when its turn ends without
  `stop: "tool_use"`, so intermediate narration is never copied. `turn_start`
  resets only the current step, which keeps the previous answer available
  while a new turn is running; session boundaries clear the cache.
- **Clipboard write** — on `/copy` the stored text is written through the
  platform clipboard tool: `pbcopy` on macOS, `wl-copy` / `xclip` / `xsel`
  on Linux. Candidates are tried in order; a broken tool does not stop the
  fallback chain.
- **File write** — `/copy file [path]` writes the payload with
  `writeFileSync` instead of calling the clipboard, so it works over SSH and
  headless hosts.
- **Encoding** — frames are JSON lines in UTF-8 and clipboard payloads are
  handed over as UTF-8 regardless of the host locale.
- **Format conversion** — `/copy jira` renders the stored Markdown with
  `marked` and `marked-jira`; `/copy` and `/copy markdown` pass the text
  through untouched.
- **Transcript fallback** — a session loaded with `/sessions` replays no
  events, so when the cache is empty `/copy` reads the last assistant message
  from `<state dir>/sessions/<hash of cwd>/*.jsonl` instead of failing.

## Known limitations

- A `/btw` side dialog emits `assistant_message` attributed to the active
  session (host behaviour), so its reply can replace the text `/copy` reads.
- Only the Linux and macOS clipboard tools are supported.
- The transcript fallback depends on zot's state layout (no host API exposes
  the session file), so a future change there degrades `/copy` back to
  "nothing to copy" rather than to a wrong answer.

## TODO / Ideas

- **P1** Keep a short response history and support `/copy N`.
- **P1** Add a panel picker for fenced code blocks, the full response and an
  "always copy full response" setting.
- **P1** Add Windows (`clip.exe`/PowerShell), Termux and WSL clipboard backends.
- **P2** Add OSC 52 and tmux fallbacks. OSC 52 from an extension needs a
  `/dev/tty` write or a host API; this has to be verified first.
- **P2** Read long transcripts from the tail and cache the result instead of
  scanning the whole session file on every `/copy`.
- **P2** Add tests for platform-specific backends, the picker and transcript
  edge cases.

## Development

```bash
npm install
npm run lint
npm test
npm run format:check
```

`npm test` rebuilds `dist/copy.js` with tsdown and runs the wire tests against
that bundle. Commit the rebuilt bundle with any source change: zot never runs
`npm install` or a build step after cloning or pulling. The tests drive the
real subprocess over stdio and stub the clipboard tool, so no zot session and
no clipboard access are needed. `npm run lint` runs ESLint and `tsc --noEmit`.

## Requirements

- Node.js 22.18+
- zot 0.4.x
- A system clipboard tool: `pbcopy` (macOS), `wl-copy` / `xclip` / `xsel`
  (Linux)

## License

[MIT](https://opensource.org/licenses/MIT), Copyright (c) 2026
