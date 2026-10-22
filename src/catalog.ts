import { renderHtml } from "./html.js";
import type { VideoEntry } from "./types.js";

/**
 * Merge catalogs into one list, dropping duplicate video ids.
 * First occurrence wins, so earlier files take precedence; the returned order
 * follows input order and is otherwise left for the caller to sort.
 */
export function mergeVideos(catalogs: VideoEntry[][]): VideoEntry[] {
  const byId = new Map<string, VideoEntry>();
  for (const catalog of catalogs) {
    for (const video of catalog) {
      if (!byId.has(video.id)) byId.set(video.id, video);
    }
  }
  return [...byId.values()];
}

/**
 * Reject anything that is not an array of objects carrying a string `id`.
 * A hand-edited or truncated catalog should fail loudly rather than produce a
 * page missing half its videos.
 */
export function parseCatalog(text: string, file: string): VideoEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${(err as Error).message})`);
  }
  if (!Array.isArray(data)) {
    throw new Error(`${file}: expected a JSON array of videos`);
  }
  for (const item of data) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as VideoEntry).id !== "string"
    ) {
      throw new Error(`${file}: entry without a string "id"`);
    }
  }
  return data as VideoEntry[];
}

export async function writeCatalog(
  videos: VideoEntry[],
  htmlPath: string,
  jsonPath: string,
): Promise<void> {
  if (htmlPath === jsonPath) {
    console.error("error: --html and --json must differ");
    process.exit(1);
  }
  await Bun.write(htmlPath, renderHtml(videos));
  await Bun.write(jsonPath, JSON.stringify(videos, null, 2) + "\n");
}
