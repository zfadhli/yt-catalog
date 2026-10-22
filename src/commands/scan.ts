import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import { scanFolder } from "../scanner.js";
import { parseFilename } from "../parser.js";
import { resolveVideos } from "../api.js";
import { writeCatalog } from "../catalog.js";
import { timestamp, withTimestamp } from "../paths.js";
import { GLOBAL_ENV_PATH, resolveApiKey } from "../config.js";

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_S = 15;
/** Mirrors the clamp in api.ts, so the CLI never accepts a value it ignores. */
const MAX_CONCURRENCY = 20;

export const scanCommand = defineCommand({
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
      description: `Max concurrent YouTube API requests, each covering up to 50 videos (default ${DEFAULT_CONCURRENCY}, max ${MAX_CONCURRENCY})`,
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
      resolveApiKey() ||
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
    await writeCatalog(videos, htmlPath, jsonPath);

    // 5. Report.
    console.log(
      `done: ${videos.length} videos → ${htmlPath} + ${jsonPath} (${elapsed}s)`,
    );
    const skippedLines = [
      ...unparseable.map(
        (f) => `  SKIP (filename did not match pattern): ${f}`,
      ),
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
