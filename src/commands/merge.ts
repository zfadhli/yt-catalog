import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defineCommand } from "citty";
import { mergeVideos, parseCatalog, writeCatalog } from "../catalog.js";
import type { VideoEntry } from "../types.js";
import { assertFolder } from "./folder.js";

export const mergeCommand = defineCommand({
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
    await assertFolder(folder);
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
    const videos = mergeVideos(catalogs).sort(
      (a, b) =>
        a.channel.localeCompare(b.channel) || a.title.localeCompare(b.title),
    );

    const htmlPath = resolve(args.html as string);
    const jsonPath = resolve(args.json as string);
    await writeCatalog(videos, htmlPath, jsonPath);

    console.log(
      `done: ${videos.length} videos from ${inputs.length} file(s) ` +
        `(${total - videos.length} duplicates removed) → ${htmlPath} + ${jsonPath}`,
    );
  },
});

/**
 * Catalogs to merge, in the order they are read.
 *
 * `videos.json` is included: it is the accumulated catalog, and dedup by video
 * id makes re-reading our own previous output idempotent. Excluding it (as an
 * earlier version did) silently discarded every video that only existed there,
 * so `merge` after a fresh scan destroyed the archive it was meant to extend.
 * Safe because every input is read fully before anything is written.
 */
export async function listCatalogs(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /^videos.*\.json$/.test(e.name))
    .map((e) => e.name)
    .sort();
}
