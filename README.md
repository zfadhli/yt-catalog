<!-- prettier-ignore -->
<div align="center">

<img src="./.github/assets/logo.svg" alt="" align="center" height="72" />

# yt-catalog

**Turn a folder of downloaded YouTube videos into a browsable, searchable catalog — then delete the files.**

[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.0-fbf0df?style=flat-square&logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_v4-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Alpine.js](https://img.shields.io/badge/Alpine.js_3-8bc0d0?style=flat-square&logo=alpinedotjs&logoColor=white)](https://alpinejs.dev)
[![YouTube Data API v3](https://img.shields.io/badge/YouTube_Data_API_v3-ff0000?style=flat-square&logo=youtube&logoColor=white)](https://developers.google.com/youtube/v3)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

[Overview](#overview) • [Features](#features) • [Getting started](#getting-started) • [Usage](#usage) • [Output](#output) • [How it works](#how-it-works) • [Development](#development)

</div>

## Overview

You downloaded a lot of YouTube videos. They are eating your disk. You would
rather just watch them on YouTube — but you do not want to lose track of what
you had.

`yt-catalog` scans a folder of files named `<channel> [<videoId>] <title>.mp4`,
looks each video up through the **YouTube Data API v3**, and writes two files:

- a **single self-contained HTML page** — live search, sorting, light/dark mode, thumbnails
- a **JSON catalog** — the same data, for backups, imports, or further processing

Then you delete the `.mp4` files. The catalog stays.

```console
$ cd ~/Videos/downloads && yt-catalog .
done: 1284 videos → /home/you/Videos/downloads/videos_20260921_163400.html + /home/you/Videos/downloads/videos_20260921_163400.json (6.2s)
skipped 17 of 1301 file(s):
  SKIP (filename did not match pattern): 2024-notes.txt
  SKIP (Data API: video not found for id "AAAAAAAAAAA"): x [AAAAAAAAAAA] Gone.mp4
```

> [!IMPORTANT]
> `yt-catalog` never deletes or modifies your video files. It only reads
> filenames and writes the two catalog files. Deleting the originals is always a
> decision you make yourself, after checking the catalog.

## Features

- **One command, two artifacts** — HTML catalog and JSON data in a single run.
- **Single-file output** — CSS and JS are inlined; the page opens from `file://`
  with no CDN, build step, or server. The only network requests are the YouTube
  thumbnails themselves.
- **Live search** — filters by title and channel as you type, case-insensitive.
- **Five sort modes** — original filename order, title A–Z / Z–A, channel A–Z / Z–A.
- **Light and dark mode** — toggled manually and remembered in `localStorage`.
- **Quota-friendly API use** — batched `videos.list`, 50 videos per request and
  **1 quota unit per request**. 1 000 videos costs 20 units.
- **Honest failures** — anything the API will not return is left out of *both*
  outputs rather than rendered as a broken card, and every skip is printed to
  stderr.
- **Timestamped outputs** — repeated runs never clobber a previous catalog.

## Getting started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- A **YouTube Data API v3 key** (free, no billing required)

### 1. Get an API key

1. Create or select a project in the [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **YouTube Data API v3** under *APIs & Services → Library*
3. Create an **API key** under *APIs & Services → Credentials*

> [!NOTE]
> `videos.list` reads cost **1 unit** per call and cover up to 50 videos, so the
> default 10 000 units/day is roughly 500 000 videos. Avoid the `search`
> endpoint — it costs 100 units per call. `yt-catalog` never uses it.

### 2. Install

```sh
git clone https://github.com/zfadhli/yt-catalog.git
cd yt-catalog
bun install
```

### 3. Make the key available

The CLI looks for a key in this order — first hit wins:

| # | Source | Notes |
| - | ------ | ----- |
| 1 | `--api-key <key>` | explicit, always wins |
| 2 | `$YOUTUBE_API_KEY` | environment variable |
| 3 | `./.env` | in the **current working directory** |
| 4 | `$YOUTUBE_API_KEY_ENV` | path to a key file you choose |
| 5 | `~/.yt-catalog.env` | works from any directory |
| 6 | `<repo>/.env` | the checkout, when installed with `bun link` |

The simplest permanent setup:

```sh
cp .env.example .env
# edit .env and paste your key
```

Sources 4–6 exist so a globally installed CLI works from any video folder:

```sh
cp .env.example ~/.yt-catalog.env && chmod 600 ~/.yt-catalog.env
```

### 4. Run it

```sh
bun src/cli.ts ~/Videos/downloads
```

### Optional: install globally

```sh
bun link                # registers `yt-catalog` in ~/.bun/bin
yt-catalog ~/Videos/downloads
bun unlink yt-catalog   # remove
```

The global binary is a symlink into this checkout, so source edits take effect
immediately. Make sure `~/.bun/bin` is on your `PATH`:

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

> [!WARNING]
> `bun install -g .` does not work on Bun 1.4 — it fails with
> `refusing to install dependency with unsafe name`, because Bun reads the
> package name as empty for path installs. Use `bun link` instead.

## Usage

```sh
# Scan ./downloads → videos_<timestamp>.html + videos_<timestamp>.json
yt-catalog ./downloads

# Recurse into subfolders, raise concurrency, choose output names
yt-catalog ./downloads -r -c 10 -o catalog.html -j catalog.json

# Fixed filenames (overwrite on each run)
yt-catalog ./downloads --no-timestamp

# Place the timestamp in a directory instead
yt-catalog ./downloads -o 'out/{timestamp}/videos.html'
```

### Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `<folder>` | *required* | Folder containing `Channel [videoId] Title.mp4` files |
| `--api-key <key>` | `$YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `-o, --html <path>` | `videos.html` | HTML output path; `{timestamp}` is expanded |
| `-j, --json <path>` | `videos.json` | JSON output path; `{timestamp}` is expanded |
| `--no-timestamp` | timestamp on | Write fixed names instead of timestamped ones |
| `-c, --concurrency <n>` | `5` | Parallel API requests (1–50); each covers up to 50 videos |
| `-r, --recursive` | off | Scan subdirectories too |
| `--timeout <seconds>` | `15` | Per-request API timeout |

### Exit codes

| Code | Meaning |
| ---- | ------- |
| `0` | Catalog written. Some files may have been skipped — check stderr |
| `1` | Folder missing/unreadable, or no API key found |

### Output naming

Outputs are stamped with local time, so repeated runs never overwrite a previous
catalog:

```
videos.html  →  videos_20260921_163400.html
videos.json  →  videos_20260921_163400.json
```

The stamp goes before the extension. Put `{timestamp}` anywhere in `-o` / `-j`
to control the placement yourself, or pass `--no-timestamp` for fixed names.

## Output

### The HTML page

One file, roughly 67 KB of shell plus the data, with Tailwind CSS v4 and
Alpine.js 3 inlined. Search, sort, and theme switching all run client-side —
there is no server and no network access beyond loading thumbnails from YouTube.

| Videos | File size |
| ------ | --------- |
| 100 | ~82 KB |
| 2 000 | ~444 KB |

For reference, filtering and sorting a 2 000-video catalog takes about 2 ms in
the browser.

The design follows the [Oxbow UI](https://github.com/michael-andreuzza/oxbow)
design system (MIT): an oklch semantic token palette (`--background`, `--card`,
`--muted-foreground`, `--brand`), layered shadows, and a `.dark` class for theme
switching.

### The JSON catalog

A pretty-printed, UTF-8 array containing only successfully resolved videos:

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

`title` and `channel` come from the API snippet and fall back to the parsed
filename when absent. Thumbnails prefer `high` → `medium` → `standard` →
`maxres` → `default`.

## How it works

```
cli.ts        scan folder → parse filenames → resolve via API → write HTML + JSON
scanner.ts    flat or recursive file listing
parser.ts     filename → { channel, id, title }
api.ts        batched videos.list calls, bounded concurrency, skip classification
html.ts       renders the self-contained page
theme.css     Tailwind v4 source (Oxbow tokens), built into theme.generated.css
```

### Filename format

```
RickAstleyVEVO [dQw4w9WgXcQ] Rick Astley - Never Gonna Give You Up.mp4
└─ channel ──┘ └──── id ────┘ └──────────── title ────────────────┘
```

- **channel** — anything before the `[`
- **id** — exactly 11 characters from `A–Z a–z 0–9 _ -`, inside square brackets
- **title** — everything between the `]` and the `.mp4` (extension case-insensitive)

Surrounding whitespace is tolerated. Anything else is reported as a skip rather
than guessed at.

### What gets skipped

| Situation | Behaviour |
| --------- | --------- |
| Filename does not match the pattern | Skipped, reported to stderr |
| ID unknown to the API (deleted, private, region-blocked, typo) | Skipped, reported to stderr |
| API error for a whole batch (`quotaExceeded`, invalid key) | Every video in that batch skipped, with the API message |
| Timeout or network failure | Skipped, reported to stderr |

Nothing is ever rendered as a placeholder or a broken card — a video is in both
outputs or in neither.

## Development

```sh
bun test           # 36 unit tests
bun run test:dom   # 21 DOM assertions against a real generated page (jsdom)
bunx tsc --noEmit  # typecheck
bun run build:css  # rebuild src/theme.css → src/theme.generated.css
```

The DOM suite drives an actual catalog page: it checks that cards render, that
search and sort reorder the DOM, that the theme toggle flips the `.dark` class,
and that the empty state appears. Several bugs — a dead search box, a
white-on-dark dropdown — were caught here and not by unit tests, so it is worth
running after any markup change.

> [!NOTE]
> `build:css` is only needed after editing `src/theme.css` or the markup inside
> `src/html.ts`, because Tailwind scans that file for class names.
> `src/theme.generated.css` and `vendor/alpine.min.js` are committed so the CLI
> runs with no build step.

Only one runtime dependency — [`citty`](https://github.com/unjs/citty). HTTP and
filesystem access use built-in Bun/Node APIs; Tailwind and jsdom are
development-only.
