import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanFolder } from "../src/scanner.ts";

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function makeTree(structure: Record<string, string | null>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "yt-catalog-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(structure)) {
    const full = join(dir, name);
    if (content === null) {
      await mkdir(full, { recursive: true });
    } else {
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content);
    }
  }
  return dir;
}

describe("scanFolder", () => {
  test("flat scan lists files, skips directories", async () => {
    const dir = await makeTree({
      "b.mp4": "",
      "a.mp4": "",
      sub: null,
    });
    expect(await scanFolder(dir, { recursive: false })).toEqual([
      "a.mp4",
      "b.mp4",
    ]);
  });

  test("recursive scan includes nested files as relative paths", async () => {
    const dir = await makeTree({
      "top.mp4": "",
      "sub/nested.mp4": "",
      "sub/deep/deeper.mp4": "",
    });
    expect(await scanFolder(dir, { recursive: true })).toEqual([
      "sub/deep/deeper.mp4",
      "sub/nested.mp4",
      "top.mp4",
    ]);
  });
});
