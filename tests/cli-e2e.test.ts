import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

function entry(id: string, title: string, channel = "Chan") {
  return {
    id,
    title,
    channel,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${id}`,
    originalFilename: `${channel} [${id}] ${title}.mp4`,
  };
}

async function run(args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, YOUTUBE_API_KEY: "unused-in-merge" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "yt-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("merge end to end", () => {
  test("writes html + json, dedups by id, sorts by channel then title", async () => {
    await withTmp(async (dir) => {
      await writeFile(
        join(dir, "videos.json"),
        JSON.stringify([entry("aaaaaaaaaaa", "Zeta", "Chan B")]),
      );
      await writeFile(
        join(dir, "videos_1.json"),
        JSON.stringify([
          entry("aaaaaaaaaaa", "Zeta duplicate", "Chan B"),
          entry("bbbbbbbbbbb", "Alpha", "Chan A"),
        ]),
      );
      const html = join(dir, "out.html");
      const json = join(dir, "out.json");

      const { stdout, stderr, code } = await run([
        "merge",
        dir,
        "-o",
        html,
        "-j",
        json,
      ]);

      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout).toContain("2 videos from 2 file(s)");
      expect(stdout).toContain("1 duplicates removed");
      const written = JSON.parse(await readFile(json, "utf8"));
      expect(written.map((v: { id: string }) => v.id)).toEqual([
        "bbbbbbbbbbb",
        "aaaaaaaaaaa",
      ]);
      expect(written[1].title).toBe("Zeta");
      const page = await readFile(html, "utf8");
      expect(page).toContain(
        '<script id="catalog-data" type="application/json">',
      );
    });
  });

  test("refuses identical --html and --json outputs", async () => {
    await withTmp(async (dir) => {
      await writeFile(
        join(dir, "videos.json"),
        JSON.stringify([entry("aaaaaaaaaaa", "A")]),
      );
      const out = join(dir, "same.txt");
      const { stderr, code } = await run(["merge", dir, "-o", out, "-j", out]);
      expect(code).toBe(1);
      expect(stderr).toContain("--html and --json must differ");
    });
  });

  test("no catalogs found exits 1", async () => {
    await withTmp(async (dir) => {
      const { stderr, code } = await run(["merge", dir]);
      expect(code).toBe(1);
      expect(stderr).toContain("no videos*.json files");
    });
  });
});

describe("scan argument validation", () => {
  test("missing folder exits 1 with a message, not a stack trace", async () => {
    const { stderr, code } = await run(["scan", "/tmp/definitely-not-here"]);
    expect(code).toBe(1);
    expect(stderr).toContain("folder not found");
  });

  test("legacy bare-folder form points at scan", async () => {
    const { stderr, code } = await run(["/tmp/whatever"]);
    expect(code).toBe(1);
    expect(stderr).toContain("yt-catalog scan <folder>");
  });
});
