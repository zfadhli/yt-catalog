import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const GLOBAL_ENV_PATH = join(homedir(), ".yt-catalog.env");

/**
 * Fallback API-key sources, so the CLI works from any cwd:
 *   1. `$YOUTUBE_API_KEY_ENV` (explicit file path)
 *   2. `~/.yt-catalog.env`
 *   3. `<script dir>/../.env` — the repo checkout when installed via `bun link`
 * Bun autoloads `./.env` from cwd already; this only widens the search.
 */
export function resolveApiKey(): string {
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
