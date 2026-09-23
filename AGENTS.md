# AGENTS.md

## Project overview

`yt-catalog` is a Bun CLI that scans a folder of downloaded YouTube videos named
`<channel> [<videoId>] <title>.mp4`, resolves each one through the YouTube Data
API v3, and writes a searchable, self-contained HTML catalog plus a JSON
catalog. It exists so users can delete large `.mp4` files while keeping a
browsable record of what they were.

Pipeline, in order:

```
src/         7 TypeScript files
  cli.ts     `scan` command: scan → parse filenames → resolve via API → write HTML + JSON
             `merge` command: videos*.json → deduped HTML + JSON, no API
  scanner.ts flat or recursive file listing
  parser.ts  filename → { channel, id, title }
  api.ts     batched videos.list calls, bounded concurrency, skip classification
  html.ts    renders the single-file page (Tailwind + Alpine, both inlined)
  merge.ts   catalog JSON → deduped VideoEntry[]; validates input shape
  types.ts   shared types + API URL helpers
  theme.css  Tailwind v4 source → theme.generated.css
tests/       6 bun:test files, mirroring src/ module names
scripts/     dom-check.mjs (jsdom DOM assertions; run under node)
vendor/      alpine.min.js (committed, inlined at render time)
```

Roughly 1 400 lines of TypeScript across 7 source files and 6 test files, plus
a 150-line DOM test script and the Tailwind source. One runtime dependency
(`citty`). No frameworks, no database, no server.

Key constraint to preserve: **the CLI never deletes or modifies user files.** It
only reads filenames and writes the two catalog files. Do not add code that
touches the originals.

## Setup commands

```sh
bun install        # install dependencies
bun run build:css  # rebuild Tailwind → src/theme.generated.css
bun src/cli.ts scan <folder>                 # run
bun src/cli.ts scan <folder> --help          # list all scan flags
bun src/cli.ts merge <folder>                # combine existing videos*.json
```

A YouTube Data API v3 key is required to run the CLI. Resolution order (first
hit wins), implemented in `cli.ts`:

1. `--api-key <key>`
2. `$YOUTUBE_API_KEY`
3. `./.env` — Bun autoloads this from the **current working directory**, not the
   repo root
4. `$YOUTUBE_API_KEY_ENV` — path to a key file
5. `~/.yt-catalog.env`
6. `<repo>/.env` — resolved via `import.meta.url`

Sources 5 and 6 exist so a globally linked CLI works from any directory. In
tests and CI, always pass `--api-key` explicitly or stub `fetchFn`; never rely
on a key being present.

## Testing instructions

```sh
bun test           # 44 unit tests (bun:test), all of tests/
bun run test:dom   # 21 DOM assertions against a generated page
bunx tsc --noEmit  # typecheck
```

**Important: `bun test` does not run the DOM suite.** They are separate on
purpose:

- `bun test` runs the six `tests/*.test.ts` files.
- `bun run test:dom` runs `scripts/dom-check.mjs` under **`node`, not `bun`**.
  jsdom 30 rejects Bun's window proxy with
  `'addEventListener' called on an object that is not a valid instance of EventTarget`.
  Do not "fix" this by switching the script to `bun`; run both suites.
- `dom-check.mjs` renders its own in-memory fixture when run without arguments,
  and drives any generated page when passed a path:
  `node scripts/dom-check.mjs /tmp/catalog.html`.

Run both before considering any page change done. The DOM suite caught two bugs
that unit tests missed: a search box that updated state but never filtered
(reason below), and a white-on-dark dropdown. The unit tests passed in both
cases.

Testing conventions:

- Tests live in `tests/`, named `<module>.test.ts` after the module under test.
- Tests import source with **`.ts`** extensions (`from "../src/api.ts"`), while
  `src/`'s own internal imports use **`.js`** extensions (`from "./api.js"`).
  This is deliberate — `tsconfig.json` sets `allowImportingTsExtensions`. Keep
  both styles as they are; changing one breaks either Bun or `tsc`.
- API tests never hit the network. `resolveVideos` accepts an injectable
  `fetchFn`; use the `apiFetch` helper in `tests/api.test.ts` and assert on
  requested URLs, batch sizes, and skip reasons.
- Add tests for behaviour changes. `tests/cli.test.ts` covers `timestamp` and
  `withTimestamp` as pure functions because `cli.ts` guards its entry point with
  `if (import.meta.main)` — keep that guard so tests can import the helpers
  without launching the CLI.

## Code style

- TypeScript, strict mode, ESM. `bunx tsc --noEmit` must pass with no errors.
- No formatter or linter is configured; match surrounding style. The codebase
  uses 2-space indent, double quotes, semicolons, and trailing commas.
- Prefer built-in Bun/Node APIs (`Bun.write`, `Bun.file`, `node:fs/promises`,
  native `fetch`) over adding dependencies. Adding a runtime dependency needs a
  strong justification — there is currently exactly one.
- Export pure functions and keep side effects in `cli.ts`. `parser.ts`,
  `scanner.ts`, and the helpers in `api.ts`/`html.ts` are all unit-testable
  without I/O or network.
- Comment the *why* for non-obvious decisions, not the *what*. Several existing
  comments document bugs that were hit (see the `.dark` note below in
  HTML/theme) — keep that convention when you fix something subtle.

## HTML and theming

The generated page inlines Tailwind CSS v4 and Alpine.js 3 so it stays a single
file with no CDN, server, or build step at runtime. Two consequences:

- `src/html.ts` calls `assets()` at render time, which **synchronously reads**
  `src/theme.generated.css` and `vendor/alpine.min.js`. If either is missing,
  rendering throws `ENOENT`. Both are committed so the CLI runs without a build.
- Tailwind scans `src/html.ts` (via `@source "./html.ts"` in `src/theme.css`) for
  class names. **After editing markup or classes in `html.ts`, run
  `bun run build:css` and commit the regenerated CSS**, or the new utilities are
  absent from the output. Editing `theme.css` requires the same rebuild.

Alpine-specific traps that have already caused bugs here:

- Do not put `@input="..."` (or `@change`) on an element that also uses
  `x-model`. The handler fires before `x-model` commits the value, so a filter
  reading the model sees the previous value — this silently broke search once.
  Drive filtering from state with `this.$watch("query", ...)` in `init()`.
- `[x-cloak]` must stay `display:none !important` in `theme.css`, because
  Alpine removes the attribute only after init. The selector gets merged with
  others by the minifier, so match on the declaration when testing it.
- Cards use `flex`, which would override the UA `[hidden]` rule; hidden elements
  are handled with `x-show`, not the `hidden` attribute.
- Theme is **light/dark only** — there is no "system" mode and
  `prefers-color-scheme` must not be consulted. `localStorage` key is
  `yt-catalog-theme`; an inline pre-paint script applies `dark` early to avoid a
  flash.
- Native `<option>` popups do not inherit the `<select>` background, so both the
  select and every option carry explicit `bg-background text-foreground`.

## API usage

- Endpoint: `videos.list` with `part=snippet`, IDs joined by commas,
  `id`-based lookup. Batches are capped at 50 IDs (`API_BATCH_SIZE`).
- Reads cost **1 quota unit per request**, regardless of batch size. Never
  introduce a `search` call — it costs 100 units.
- Concurrency is bounded by a worker pool in `resolveVideos`. The effective
  maximum is **20** (`api.ts` clamps, and `cli.ts`'s `MAX_CONCURRENCY` mirrors
  it). Keep those two in sync if you change either.
- Failure semantics are strict and load-bearing: anything the API does not
  return is omitted from **both** outputs — never rendered as a placeholder or a
  broken card — and reported as a skip on stderr. A whole-batch error (bad key,
  `quotaExceeded`) marks every file in that batch skipped with the API message.
  Per-item failures must never reject the whole run.
- Title and channel come from `snippet.title` / `snippet.channelTitle`, falling
  back to the parsed filename. Thumbnails prefer
  `high → medium → standard → maxres → default`.

## Architecture notes

- `cli.ts` is the only module with side effects. Guard the entry point with
  `if (import.meta.main) runMain(main)` so tests can import it.
- Exit codes: `0` on success **even when files were skipped** (check stderr),
  `1` for a missing/unreadable folder or a missing API key.
- Human-readable output goes to `stdout` (one summary line); errors, warnings,
  and skip lists go to `stderr`. Progress output is written only when
  `process.stderr.isTTY`, so piping stays clean.
- The skip summary prints at most 50 lines, then `…and N more`.
- Output paths are timestamped in **local time** as `YYYYMMDD_HHMMSS`, inserted
  before the extension. A literal `{timestamp}` token anywhere in `-o`/`-j`
  overrides the placement; `--no-timestamp` disables stamping.
- Two subcommands, `scan` and `merge`, registered on `main` via citty
  `subCommands`. citty treats the first positional as a command name, so the
  old bare `yt-catalog <folder>` form is gone; `legacyHint()` in the entry
  point catches it and points at `scan` instead of letting citty print
  "Unknown command `./downloads`".
- `merge` never deletes or rewrites its inputs, and skips its own default
  output name `videos.json` when listing inputs (`videos_*.json` and any other
  `videos*.json` are read).
- `parseFilename` accepts a full path or a bare filename and takes the basename
  (handles both `/` and `\`). It is strict about the ID being exactly 11
  characters of `[A-Za-z0-9_-]` and returns `null` for anything else rather than
  guessing.

## Pull request guidelines

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`,
  `test:`, `chore:`), with a body explaining the *why* when the change is
  non-obvious.
- Before committing, run all three:
  ```sh
  bun test && bun run test:dom && bunx tsc --noEmit
  ```
  There is no CI workflow configured, so these will not be run for you.
- If you changed markup or classes in `html.ts` or anything in `theme.css`, also
  run `bun run build:css` and include the regenerated
  `src/theme.generated.css` in the same commit. Committing markup without the
  rebuilt CSS ships the bug rather than fixing it.
- Keep the diff minimal and scoped. Deletion is preferred over addition; avoid
  new abstractions for single call sites, and prefer platform/stdlib features
  over new helpers.

## Security considerations

- The repo is **public**. `.env` is gitignored and contains a live API key.
  Never stage it, echo it, or paste key values into code, tests, commits, or
  README examples. `.env.example` holds an empty placeholder — keep it empty.
- Before committing, confirm `.env` is not staged:
  `git diff --cached --name-only | grep -x .env` should produce no output.
- The CLI sends video IDs to Google and nothing else. Do not add telemetry,
  analytics, or requests to third-party hosts.
- The generated HTML embeds catalog data as JSON inside a
  `<script type="application/json">` tag. `serializeForHtml` escapes `<` to
  `\u003c` so a title containing `</script>` cannot break out of the tag; keep
  that escaping. Card text must be inserted with `x-text`, not `innerHTML`.

## Common tasks

Add a CLI flag:
1. Add it to the `args` object in the `scanCommand` (or `mergeCommand`) in
   `src/cli.ts` (with `default` and `description`).
2. Wire it in `run()`, extracting any pure logic into an exported helper.
3. Unit-test the helper in `tests/cli.test.ts`.
4. Document it in `README.md` (options table) and here if relevant.

Change the page layout:
1. Edit the markup or Alpine component in `src/html.ts`.
2. `bun run build:css`.
3. `bun test && bun run test:dom && bunx tsc --noEmit`.
4. Update `tests/html.test.ts` if you added or removed a UI control, and
   `scripts/dom-check.mjs` if the behaviour changed.

Debug a catalog that is missing videos:
1. Re-run and read stderr — every skip prints a filename and a reason.
2. A `filename did not match pattern` skip means `parseFilename` rejected it;
   check the bracket format and the 11-character ID.
3. A `Data API: video not found` skip means the API does not return that ID
   (deleted, private, region-blocked, or a mistyped ID).
4. A whole-batch `quotaExceeded` or key error means every video in that batch
   was skipped; verify the key and remaining daily quota.
