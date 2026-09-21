import { describe, expect, test } from "bun:test";
import { pickThumbnail, resolveVideos, toEntry } from "../src/api.ts";
import { API_BATCH_SIZE, videosApiUrl } from "../src/types.ts";
import type { ParsedFile } from "../src/types.ts";

const KEY = "test-key";

const file = (id: string): ParsedFile => ({
  channel: "FileChannel",
  id,
  title: "File Title",
  originalFilename: `FileChannel [${id}] File Title.mp4`,
});

const apiItem = (id: string, thumbnails: unknown = thumbs()) => ({
  id,
  snippet: { title: "Official Title", channelTitle: "Official Channel", thumbnails },
});

const thumbs = (overrides: Record<string, unknown> = {}) => ({
  default: { url: "https://i.ytimg.com/vi/x/default.jpg" },
  medium: { url: "https://i.ytimg.com/vi/x/mqdefault.jpg" },
  high: { url: "https://i.ytimg.com/vi/x/hqdefault.jpg" },
  ...overrides,
});

/** Response builder; records every requested URL. */
function apiFetch(
  handler: (ids: string[]) => { status?: number; body: unknown },
): { fetchFn: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn = (async (url: unknown) => {
    const u = String(url);
    urls.push(u);
    const ids = new URL(u).searchParams.get("id")?.split(",") ?? [];
    const r = handler(ids);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.body,
    };
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
}

describe("videosApiUrl", () => {
  test("uses videos.list with part=snippet and comma-joined ids", () => {
    const url = new URL(videosApiUrl(["a", "b"], KEY));
    expect(url.pathname).toBe("/youtube/v3/videos");
    expect(url.searchParams.get("part")).toBe("snippet");
    expect(url.searchParams.get("id")).toBe("a,b");
    expect(url.searchParams.get("key")).toBe(KEY);
  });
});

describe("pickThumbnail", () => {
  test("prefers high, falls back down the chain", () => {
    expect(pickThumbnail(thumbs())).toContain("hqdefault");
    expect(pickThumbnail({ default: { url: "d" } })).toBe("d");
    expect(pickThumbnail({ medium: { url: "m" } })).toBe("m");
    expect(pickThumbnail({})).toBeNull();
    expect(pickThumbnail(undefined)).toBeNull();
    expect(pickThumbnail({ high: {} })).toBeNull();
  });
});

describe("toEntry", () => {
  test("maps API snippet onto the catalog entry", () => {
    expect(toEntry(apiItem("AAAAAAAAAAA"), file("AAAAAAAAAAA"))).toEqual({
      id: "AAAAAAAAAAA",
      title: "Official Title",
      channel: "Official Channel",
      thumbnail: "https://i.ytimg.com/vi/x/hqdefault.jpg",
      url: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
      originalFilename: "FileChannel [AAAAAAAAAAA] File Title.mp4",
    });
  });

  test("falls back to filename metadata when snippet fields are absent", () => {
    const entry = toEntry({ id: "AAAAAAAAAAA", snippet: { thumbnails: thumbs() } }, file("AAAAAAAAAAA"));
    expect(entry).toMatchObject({ title: "File Title", channel: "FileChannel" });
  });

  test("is null without a usable thumbnail", () => {
    expect(toEntry({ id: "AAAAAAAAAAA", snippet: {} }, file("AAAAAAAAAAA"))).toBeNull();
  });
});

describe("resolveVideos", () => {
  test("batches ≤50 ids per request and keeps filename order", async () => {
    const files = Array.from({ length: 120 }, (_, i) => file(id(i)));
    const { fetchFn, urls } = apiFetch((ids) => ({
      body: { items: ids.map((id) => apiItem(id)) },
    }));
    const { videos, skipped } = await resolveVideos(files, {
      apiKey: KEY,
      concurrency: 4,
      timeoutMs: 1000,
      fetchFn,
    });
    expect(urls.length).toBe(3); // ceil(120/50)
    for (const u of urls) {
      const ids = new URL(u).searchParams.get("id")!.split(",");
      expect(ids.length).toBeLessThanOrEqual(API_BATCH_SIZE);
    }
    expect(videos.map((v) => v.id)).toEqual(files.map((f) => f.id));
    expect(skipped).toHaveLength(0);
  });

  test("skips ids the API omits (deleted/private) without failing the batch", async () => {
    const files = [file(id(0)), file(id(1)), file(id(2))];
    const { fetchFn } = apiFetch((ids) => ({
      body: { items: ids.filter((i) => i !== id(1)).map((i) => apiItem(i)) },
    }));
    const { videos, skipped } = await resolveVideos(files, {
      apiKey: KEY,
      concurrency: 1,
      timeoutMs: 1000,
      fetchFn,
    });
    expect(videos.map((v) => v.id)).toEqual([id(0), id(2)]);
    expect(skipped).toEqual([
      { file: files[1], reason: expect.stringContaining("not found") },
    ]);
  });

  test("a failed batch skips only its own videos, others still resolve", async () => {
    const files = Array.from({ length: 60 }, (_, i) => file(id(i)));
    const { fetchFn } = apiFetch((ids) =>
      ids[0] === id(0)
        ? {
            status: 403,
            body: { error: { message: "quotaExceeded" } },
          }
        : { body: { items: ids.map((i) => apiItem(i)) } },
    );
    const { videos, skipped } = await resolveVideos(files, {
      apiKey: KEY,
      concurrency: 1,
      timeoutMs: 1000,
      fetchFn,
    });
    expect(videos).toHaveLength(10); // second batch only
    expect(skipped).toHaveLength(50);
    expect(skipped[0]!.reason).toContain("quotaExceeded");
  });

  test("returns everything as skipped when the key is rejected", async () => {
    const files = [file(id(0)), file(id(1))];
    const { fetchFn } = apiFetch(() => ({
      status: 400,
      body: { error: { message: "API key not valid" } },
    }));
    const { videos, skipped } = await resolveVideos(files, {
      apiKey: KEY,
      concurrency: 1,
      timeoutMs: 1000,
      fetchFn,
    });
    expect(videos).toHaveLength(0);
    expect(skipped).toHaveLength(2);
    expect(skipped[1]!.reason).toContain("API key not valid");
  });

  test("network errors and timeouts become skips, never throws", async () => {
    const files = [file(id(0)), file(id(1))];
    const { fetchFn } = apiFetch(() => {
      throw new Error("network down");
    });
    const { videos, skipped } = await resolveVideos(files, {
      apiKey: KEY,
      concurrency: 1,
      timeoutMs: 1000,
      fetchFn,
    });
    expect(videos).toHaveLength(0);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]!.reason).toContain("network down");
  });

  test("respects the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = (async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }) as unknown as typeof fetch;
    await resolveVideos(
      Array.from({ length: 200 }, (_, i) => file(id(i))),
      { apiKey: KEY, concurrency: 3, timeoutMs: 5000, fetchFn },
    );
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});

/** Distinct 11-char ids for fixtures. */
function id(n: number): string {
  return `AAAAAAAAA${String(n).padStart(2, "0").slice(-2)}`.padEnd(11, "A").slice(0, 11);
}
