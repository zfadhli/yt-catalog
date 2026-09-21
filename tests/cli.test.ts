import { describe, expect, test } from "bun:test";
import { timestamp, withTimestamp } from "../src/cli.ts";

const STAMP = "20260921_163400";

describe("timestamp", () => {
  test("formats local time as YYYYMMDD_HHMMSS", () => {
    // Month is 0-indexed in the Date constructor; 8 = September.
    expect(timestamp(new Date(2026, 8, 21, 16, 34, 0))).toBe(STAMP);
    expect(timestamp(new Date(2026, 0, 5, 9, 7, 3))).toBe("20260105_090703");
  });
});

describe("withTimestamp", () => {
  test("prefixes the basename, keeping the extension", () => {
    expect(withTimestamp("videos.html", STAMP)).toBe(`videos_${STAMP}.html`);
    expect(withTimestamp("videos.json", STAMP)).toBe(`videos_${STAMP}.json`);
  });

  test("handles paths, multiple dots, and extensionless names", () => {
    expect(withTimestamp("/out/dir/videos.html", STAMP)).toBe(
      `/out/dir/videos_${STAMP}.html`,
    );
    expect(withTimestamp("my.catalog.html", STAMP)).toBe(
      `my.catalog_${STAMP}.html`,
    );
    expect(withTimestamp("out/videos", STAMP)).toBe(`out/videos_${STAMP}`);
  });

  test("does not treat a dot in a parent directory as an extension", () => {
    expect(withTimestamp("out.v2/videos", STAMP)).toBe(
      `out.v2/videos_${STAMP}`,
    );
    expect(withTimestamp("out.v2/videos.html", STAMP)).toBe(
      `out.v2/videos_${STAMP}.html`,
    );
  });

  test("replaces an explicit {timestamp} token anywhere in the path", () => {
    expect(withTimestamp("out/{timestamp}/videos.html", STAMP)).toBe(
      `out/${STAMP}/videos.html`,
    );
    expect(withTimestamp("catalog-{timestamp}.html", STAMP)).toBe(
      `catalog-${STAMP}.html`,
    );
  });

  test("null stamp (--no-timestamp) leaves the path untouched", () => {
    expect(withTimestamp("videos.html", null)).toBe("videos.html");
    expect(withTimestamp("out/{timestamp}/videos.html", null)).toBe(
      "out/{timestamp}/videos.html",
    );
  });
});
