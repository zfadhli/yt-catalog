#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "citty";
import { scanFolder } from "./scanner.js";
import { parseFilename } from "./parser.js";
import { resolveVideos } from "./api.js";
import { renderHtml } from "./html.js";
import { mergeVideos, parseCatalog } from "./merge.js";
import type { VideoEntry } from "./types.js";

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_S = 15;
/** Mirrors the clamp in api.ts, so the CLI never accepts a value it ignores. */
const MAX_CONCURRENCY = 20;

const mergeCommand = defineCommand({
  meta: {
    name: "merge",
    description:
      "Merge every videos*.json in a folder into one HTML + JSON catalog, deduplicated",
  },
  args: {
    folder: {
      type: "positional",
      description: "Folder containing videos*.json catalogs",
      default: ".",
    },
    html: {
      type: "string",
      alias: "o",
      default: "videos.html",
      description: "Output path for the merged HTML catalog",
    },
    json: {
      type: "string",
      alias: "j",
      default: "videos.json",
      description: "Output path for the merged JSON catalog",
    },
  },
  async run({ args }) {
    const folder = resolve((args.folder as string | undefined) ?? ".");
    const inputs = await listCatalogs(folder);
    if (inputs.length === 0) {
      console.error(`error: no videos*.json files in ${folder}`);
      process.exit(1);
    }

    const catalogs: VideoEntry[][] = [];
    for (const name of inputs) {
      const path = join(folder, name);
      try {
        catalogs.push(parseCatalog(await Bun.file(path).text(), name));
      } catch (err) {
        console.error(`error: ${(err as Error).message}`);
        process.exit(1);
      }
    }

    const total = catalogs.reduce((n, c) => n + c.length, 0);
    const videos = mergeVideos(catalogs).sort((a, b) =>
      a.channel.localeCompare(b.channel) || a.title.localeCompare(b.title),
    );

    const htmlPath = resolve(args.html as string);
    const jsonPath = resolve(args.json as string);
    if (htmlPath === jsonPath) {
      console.error("error: --html and --json must differ");
      process.exit(1);
    }
    await Bun.write(htmlPath, renderHtml(videos));
    await Bun.write(jsonPath, JSON.stringify(videos, null, 2) + "\n");

    console.log(
      `done: ${videos.length} videos from ${inputs.length} file(s) ` +
        `(${total - videos.length} duplicates removed) → ${htmlPath} + ${jsonPath}`,
    );
  },
});

const scanCommand = defineCommand({
  meta: {
    name: "scan",
    version: "0.1.0",
    description:
      "Scan a folder of downloaded YouTube videos and generate a searchable HTML + JSON catalog.",
  },
  args: {
    folder: {
      type: "positional",
      description:
        "Folder containing videos named `<channel> [<id>] <title>.mp4`",
      required: true,
    },
    html: {
      type: "string",
      alias: "o",
      default: "videos.html",
      description:
        "Output path for the HTML catalog; `{timestamp}` → YYYYMMDD_HHMMSS",
    },
    json: {
      type: "string",
      alias: "j",
      default: "videos.json",
      description:
        "Output path for the JSON catalog; `{timestamp}` → YYYYMMDD_HHMMSS",
    },
    timestamp: {
      type: "boolean",
      default: true,
      description:
        "Timestamp prefix on outputs (default on; disable with --no-timestamp)",
    },
    concurrency: {
      type: "string",
      alias: "c",
      default: String(DEFAULT_CONCURRENCY),
      description:
        `Max concurrent YouTube API requests, each covering up to 50 videos (default ${DEFAULT_CONCURRENCY}, max ${MAX_CONCURRENCY})`,
    },
    recursive: {
      type: "boolean",
      alias: "r",
      default: false,
      description: "Scan subdirectories recursively (default: top-level only)",
    },
    timeout: {
      type: "string",
      default: String(DEFAULT_TIMEOUT_S),
      description: "Per-request API timeout in seconds (default 15)",
    },
    "api-key": {
      type: "string",
      description:
        "YouTube Data API v3 key (default: $YOUTUBE_API_KEY). Required.",
    },
  },
  async run({ args }) {
    const folder = resolve(args.folder as string);
    try {
      const st = await stat(folder);
      if (!st.isDirectory()) {
        console.error(`error: not a directory: ${folder}`);
        process.exit(1);
      }
    } catch {
      console.error(`error: folder not found: ${folder}`);
      process.exit(1);
    }

    const concurrency = parseConcurrency(args.concurrency as string);
    const timeoutMs = parseTimeout(args.timeout as string);
    const stamp = args.timestamp === false ? null : timestamp();
    const htmlPath = resolve(withTimestamp(args.html as string, stamp));
    const jsonPath = resolve(withTimestamp(args.json as string, stamp));
    const apiKey =
      (args["api-key"] as string | undefined)?.trim() ||
      process.env.YOUTUBE_API_KEY?.trim() ||
      configKey() ||
      "";
    if (!apiKey) {
      console.error(
        "error: YouTube Data API key required. Provide one of:\n" +
          "  --api-key <key>\n" +
          "  YOUTUBE_API_KEY=<key> in the environment\n" +
          "  YOUTUBE_API_KEY=<key> in ./.env (cwd)\n" +
          `  YOUTUBE_API_KEY=<key> in ${GLOBAL_ENV_PATH}`,
      );
      process.exit(1);
    }

    // 1. Scan.
    let files: string[];
    try {
      files = await scanFolder(folder, {
        recursive: Boolean(args.recursive),
      });
    } catch (err) {
      console.error(
        `error: cannot read folder ${folder}: ${(err as Error).message}`,
      );
      process.exit(1);
    }
    if (files.length === 0) {
      console.error(`warning: no files found in ${folder}`);
    }

    // 2. Parse filenames.
    const parsed = [];
    const unparseable: string[] = [];
    for (const f of files) {
      const p = parseFilename(f);
      if (p) parsed.push(p);
      else unparseable.push(f);
    }

    // 3. Resolve via YouTube Data API v3 (failures become skips, never throw).
    const isTty = process.stderr.isTTY === true;
    const started = Date.now();
    const { videos, skipped } = await resolveVideos(parsed, {
      apiKey,
      concurrency,
      timeoutMs,
      onProgress:
        parsed.length >= 10 && isTty
          ? (done, total) => {
              process.stderr.write(`\rresolving videos ${done}/${total}…`);
            }
          : undefined,
    });
    if (parsed.length >= 10 && isTty) process.stderr.write("\n");
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    // 4. Write outputs.
    const html = renderHtml(videos);
    await Bun.write(htmlPath, html);
    await Bun.write(jsonPath, JSON.stringify(videos, null, 2) + "\n");

    // 5. Report.
    console.log(
      `done: ${videos.length} videos → ${htmlPath} + ${jsonPath} (${elapsed}s)`,
    );
    const skippedLines = [
      ...unparseable.map((f) => `  SKIP (filename did not match pattern): ${f}`),
      ...skipped.map((s) => `  SKIP (${s.reason}): ${s.file.originalFilename}`),
    ];
    if (skippedLines.length > 0) {
      const shown = skippedLines.slice(0, 50);
      console.error(
        `skipped ${skippedLines.length} of ${files.length} file(s):\n${shown.join("\n")}` +
          (skippedLines.length > shown.length
            ? `\n  …and ${skippedLines.length - shown.length} more`
            : ""),
      );
    }
  },
});

/**
 * Catalogs to merge, in the order they are read. Excludes the default output
 * name so `merge` in a directory it has already written to does not fold its
 * own result back in; anything else named `videos*.json` is fair game.
 */
async function listCatalogs(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /^videos.*\.json$/.test(e.name))
    .map((e) => e.name)
    .filter((name) => name !== "videos.json")
    .sort();
}

/** Local-time `YYYYMMDD_HHMMSS`, matching `videos_20260921_163400.html`. */
export function timestamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/**
 * Insert the timestamp before the extension: `videos.html` →
 * `videos_20260921_163400.html`. A literal `{timestamp}` token anywhere in the
 * path is replaced instead, so `out/{timestamp}/videos.html` also works.
 * `stamp === null` (from `--no-timestamp`) returns the path unchanged.
 */
export function withTimestamp(path: string, stamp: string | null): string {
  if (!stamp) return path;
  if (path.includes("{timestamp}")) return path.replaceAll("{timestamp}", stamp);
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  if (dot <= slash) return `${path}_${stamp}`;
  return `${path.slice(0, dot)}_${stamp}${path.slice(dot)}`;
}

const GLOBAL_ENV_PATH = join(homedir(), ".yt-catalog.env");

/**
 * Fallback API-key sources, so the CLI works from any cwd:
 *   1. `$YOUTUBE_API_KEY_ENV` (explicit file path)
 *   2. `~/.yt-catalog.env`
 *   3. `<script dir>/../.env` — the repo checkout when installed via `bun link`
 * Bun autoloads `./.env` from cwd already; this only widens the search.
 */
function configKey(): string {
  const candidates = [
    process.env.YOUTUBE_API_KEY_ENV,
    join(homedir(), ".yt-catalog.env"),
    fileURLToPath(new URL("../.env", import.meta.url)),
  ];
  for (const path of candidates) {
    if (!path) continue;
    try {
      const raw = readFileSync(path, "utf8");
      const match = raw.match(/^\s*(?:export\s+)?YOUTUBE_API_KEY\s*=\s*(.+)$/m);
      const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    } catch {
      // Missing/unreadable candidate: try the next one.
    }
  }
  return "";
}

function parseConcurrency(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error(
      `warning: invalid --concurrency "${raw}", using default ${DEFAULT_CONCURRENCY}`,
    );
    return DEFAULT_CONCURRENCY;
  }
  return Math.min(n, MAX_CONCURRENCY);
}

function parseTimeout(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(
      `warning: invalid --timeout "${raw}", using default ${DEFAULT_TIMEOUT_S}s`,
    );
    return DEFAULT_TIMEOUT_S * 1000;
  }
  return Math.min(n, 300) * 1000;
}

const main = defineCommand({
  meta: {
    name: "yt-catalog",
    version: "0.1.0",
    description:
      "Catalog downloaded YouTube videos: `scan` builds one from a folder, `merge` combines existing catalogs.",
  },
  args: {},
  subCommands: { scan: scanCommand, merge: mergeCommand },
});

/**
 * `yt-catalog <folder>` was the original single-command form. citty now treats
 * the first positional as a command name, so point stragglers at `scan` rather
 * than letting citty report a confusing "Unknown command `./downloads`".
 */
export function legacyHint(argv: string[]): string | null {
  const first = argv.find((a) => !a.startsWith("-"));
  if (!first || first === "scan" || first === "merge") return null;
  return `error: unknown command \`${first}\`\n` +
    `hint: scanning a folder is now \`yt-catalog scan <folder>\``;
}

// Guarded so `bun test` can import the helpers above without running the CLI.
if (import.meta.main) {
  const hint = legacyHint(process.argv.slice(2));
  if (hint) {
    console.error(hint);
    process.exit(1);
  }
  runMain(main);
}
