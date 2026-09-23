import { describe, expect, test } from "bun:test";
import { mergeVideos, parseCatalog } from "../src/merge.ts";
import type { VideoEntry } from "../src/types.ts";

function video(id: string, title = `title ${id}`): VideoEntry {
  return {
    id,
    title,
    channel: "Chan",
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${id}`,
    originalFilename: `Chan [${id}] ${title}.mp4`,
  };
}

describe("mergeVideos", () => {
  test("concatenates disjoint catalogs in input order", () => {
    const merged = mergeVideos([
      [video("aaaaaaaaaaa"), video("bbbbbbbbbbb")],
      [video("ccccccccccc")],
    ]);
    expect(merged.map((v) => v.id)).toEqual([
      "aaaaaaaaaaa",
      "bbbbbbbbbbb",
      "ccccccccccc",
    ]);
  });

  test("drops duplicate ids across catalogs, keeping the first", () => {
    const merged = mergeVideos([
      [video("aaaaaaaaaaa", "first")],
      [video("aaaaaaaaaaa", "second"), video("bbbbbbbbbbb")],
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].title).toBe("first");
  });

  test("drops duplicates within one catalog", () => {
    expect(mergeVideos([[video("aaaaaaaaaaa"), video("aaaaaaaaaaa")]])).toHaveLength(1);
  });

  test("handles empty input", () => {
    expect(mergeVideos([])).toEqual([]);
    expect(mergeVideos([[], []])).toEqual([]);
  });
});

describe("parseCatalog", () => {
  test("round-trips a serialized catalog", () => {
    const videos = [video("aaaaaaaaaaa")];
    expect(parseCatalog(JSON.stringify(videos), "videos.json")).toEqual(videos);
  });

  test("rejects invalid JSON with the filename in the message", () => {
    expect(() => parseCatalog("{oops", "videos_1.json")).toThrow(
      "videos_1.json: not valid JSON",
    );
  });

  test("rejects a non-array payload", () => {
    expect(() => parseCatalog('{"videos":[]}', "videos_1.json")).toThrow(
      'expected a JSON array of videos',
    );
  });

  test("rejects entries without a string id", () => {
    expect(() => parseCatalog('[{"title":"x"}]', "videos_1.json")).toThrow(
      'entry without a string "id"',
    );
  });
});
