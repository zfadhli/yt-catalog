import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface ScanOptions {
  recursive: boolean;
}

/**
 * List files in a folder (flat by default, recursive when requested).
 * Returns basenames for flat scans, paths relative to `dir` for recursive
 * scans. Directories themselves are never included. Results are sorted so
 * "original order" output is deterministic across platforms.
 */
export async function scanFolder(
  dir: string,
  options: ScanOptions,
): Promise<string[]> {
  const out: string[] = [];
  await walk(dir, "", out, options.recursive);
  out.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
  return out;
}

async function walk(
  base: string,
  rel: string,
  out: string[],
  recursive: boolean,
): Promise<void> {
  const entries = await readdir(join(base, rel), { withFileTypes: true });
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (recursive) await walk(base, relPath, out, recursive);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      out.push(relPath);
    }
  }
}
