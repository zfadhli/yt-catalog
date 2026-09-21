# yt-catalog

Reclaim disk space from downloaded YouTube videos without losing track of them.
`yt-catalog` scans a folder of files named `<channel> [<youtube-id>] <title>.mp4`,
resolves each video through the **YouTube Data API v3**, and generates:

- **`videos_<timestamp>.html`** — a single self-contained page (no runtime
  dependencies): live search by title/channel, sorting, dark mode, thumbnails
  + watch links.
- **`videos_<timestamp>.json`** — the same catalog as pretty-printed JSON for
  backup/imports.

Videos the API does not return (deleted, private, region-blocked, or a bad
filename ID) are omitted from **both** outputs (no
placeholders); a skip summary is printed to stderr. Original `.mp4` files are
never touched — delete them yourself once you're happy with the catalog.

### Page design

The generated page is styled with **Tailwind CSS v4** and driven by **Alpine.js
3** — both inlined at build time, so the output is still one file with no CDN or
runtime dependency. The design system follows
[Oxbow UI](https://github.com/michael-andreuzza/oxbow) (MIT): an oklch semantic
token palette (`--background`, `--card`, `--muted-foreground`, `--brand`, …),
layered shadows, `0.625rem` radius scale, and a `.dark` class for dark mode
(light/dark only, toggled manually and remembered in `localStorage`).

Editing `src/theme.css` or the markup in `src/html.ts` requires a CSS rebuild:

```sh
bun run build:css   # src/theme.css → src/theme.generated.css (inlined)
```

`src/theme.generated.css` and `vendor/alpine.min.js` are committed so the CLI
runs without a build step.

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- A **YouTube Data API v3 key** (free):
  1. Create/select a project at [Google Cloud Console](https://console.cloud.google.com/)
  2. Enable **YouTube Data API v3** under *APIs & Services → Library*
  3. Create an **API key** under *APIs & Services → Credentials*

```sh
export YOUTUBE_API_KEY="AIza…"
```

Or let the CLI find a key file. Searched in order (first hit wins):

1. `--api-key <key>`
2. `YOUTUBE_API_KEY` in the environment
3. `./.env` — autoloaded by Bun from the **current working directory**
4. `$YOUTUBE_API_KEY_ENV` — explicit path to a key file
5. `~/.yt-catalog.env` — works from any cwd
6. `<repo>/.env` — the checkout, when installed via `bun link`

Rungs 4–6 exist so a globally installed `yt-catalog` works in any video folder:

```sh
cp .env.example ~/.yt-catalog.env   # then paste your key
chmod 600 ~/.yt-catalog.env
cd ~/Videos/some-folder && yt-catalog .
```

Setting the environment variable in your shell rc is still the simplest
permanent option.

Quota: each request reads up to **50 videos for 1 unit**; the default 10 000
daily units cover ~500 000 videos/day. No per-video cost, no `search` calls
(which would cost 100 units each).

## Install

```sh
bun install
bun run build:css # only needed after editing src/theme.css or src/html.ts
```

### Global CLI

```sh
bun link                # registers yt-catalog in ~/.bun/bin
yt-catalog ./downloads  # run from anywhere

bun unlink yt-catalog   # remove
```

The global bin is a symlink to this checkout, so source edits take effect
immediately — no reinstall after changing `src/`.

> `bun install -g .` fails on Bun 1.4 with `refusing to install dependency with
> unsafe name` (Bun reads the package name as empty for path installs). Use
> `bun link` instead.

Requires `~/.bun/bin` on `PATH`:

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

## Usage

```sh
# Basic: scan ./downloads, write ./videos_20260921_163400.html + .json
bun src/cli.ts ./downloads

# Explicit key, custom names, recursive scan, higher concurrency
bun src/cli.ts ./downloads --api-key "$YOUTUBE_API_KEY" -o catalog.html -j catalog.json -r -c 10

# No timestamp suffix (overwrite-friendly): ./videos.html
bun src/cli.ts ./downloads --no-timestamp

# Explicit timestamp placement
bun src/cli.ts ./downloads -o 'out/{timestamp}/videos.html'

# Full help
bun src/cli.ts --help
```

| Argument / flag      | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `<folder>`           | **Required.** Folder of `Channel [videoId] Title.mp4` files        |
| `--api-key`          | YouTube Data API v3 key (default `$YOUTUBE_API_KEY`); required     |
| `-o, --html`         | HTML output path (default `videos.html`)                           |
| `-j, --json`         | JSON output path (default `videos.json`)                           |
| `--no-timestamp`     | Skip the timestamp suffix (default: on)                            || `-c, --concurrency`  | Max concurrent API requests, 1–20 (default `5`), 50 videos each    |
| `-r, --recursive`    | Also scan subdirectories (default: top level only)                 |
| `--timeout`          | Per-request API timeout in seconds (default `15`)                  |

### Output naming

Every run stamps outputs with local time, so successive runs never clobber
each other:

```
videos.html  →  videos_20260921_163400.html
videos.json  →  videos_20260921_163400.json
```

The suffix goes before the extension. `{timestamp}` in `-o`/`-j` overrides the
placement: `-o 'out/{timestamp}/videos.html'`. Use `--no-timestamp` for a fixed
name.

Exit code is `0` on success (even when some files are skipped); `1` for a
missing/unreadable folder or a missing API key.

## Filename format

```
RickAstleyVEVO [dQw4w9WgXcQ] Rick Astley - Never Gonna Give You Up.mp4
└─ channel ──┘ └──── id ────┘ └──────────── title ────────────────┘
```

- Channel: anything up to the `[...]`.
- ID: exactly 11 `[A-Za-z0-9_-]` characters in brackets.
- Title: anything between the `[...]` and the `.mp4` (case-insensitive).
- Surrounding whitespace is tolerated; everything else is reported as skipped.

## JSON shape

```json
[
  {
    "id": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
    "channel": "Rick Astley",
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "originalFilename": "RickAstleyVEVO [dQw4w9WgXcQ] Rick Astley - Never Gonna Give You Up.mp4"
  }
]
```

Title/channel come from the API snippet (`snippet.title`, `snippet.channelTitle`),
falling back to the parsed filename when absent. Thumbnails prefer
`snippet.thumbnails.high`, then `medium`/`standard`/`maxres`/`default`.

## Development

```sh
bun test           # 34 unit tests
bun run test:dom   # drives a generated page in jsdom: search/sort/theme/empty
bunx tsc --noEmit  # typecheck
```

Project layout:

```
src/
  cli.ts               # Citty command: args, orchestration, timestamped outputs
  scanner.ts           # flat / recursive folder scan
  parser.ts            # filename → { channel, id, title }
  api.ts               # batched YouTube Data API v3 fetch + skip classification
  html.ts              # page renderer (Oxbow-styled, Alpine-driven)  theme.css            # Tailwind v4 source: Oxbow tokens, dark mode, components
  theme.generated.css  # built stylesheet, inlined into the page
  types.ts             # shared types + URL helpers
vendor/alpine.min.js   # vendored Alpine 3 runtime, inlined into the page
scripts/dom-check.mjs  # DOM smoke test (jsdom); also accepts a generated page
```

Only runtime dependency is [`citty`](https://github.com/unjs/citty); HTTP and
filesystem access use built-in Bun/Node APIs. Tailwind and jsdom are
development-only.
