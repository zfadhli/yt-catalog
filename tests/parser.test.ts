import { describe, expect, test } from "bun:test";
import { parseFilename } from "../src/parser.ts";

describe("parseFilename", () => {
  test("parses the standard pattern", () => {
    expect(
      parseFilename(
        "RickAstleyVEVO [dQw4w9WgXcQ] Rick Astley - Never Gonna Give You Up.mp4",
      ),
    ).toEqual({
      channel: "RickAstleyVEVO",
      id: "dQw4w9WgXcQ",
      title: "Rick Astley - Never Gonna Give You Up",
      originalFilename:
        "RickAstleyVEVO [dQw4w9WgXcQ] Rick Astley - Never Gonna Give You Up.mp4",
    });
  });

  test("tolerates extra whitespace and uppercase extension", () => {
    const p = parseFilename("Some Channel  [AbC123_-xYz]  My Video Title.MP4");
    expect(p).toMatchObject({
      channel: "Some Channel",
      id: "AbC123_-xYz",
      title: "My Video Title",
    });
  });

  test("accepts full paths (posix and windows)", () => {
    expect(parseFilename("/dl/Chan [dQw4w9WgXcQ] Title.mp4")?.id).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      parseFilename("C:\\dl\\Chan [dQw4w9WgXcQ] Title.mp4")?.channel,
    ).toBe("Chan");
  });

  test("rejects non-matching filenames", () => {
    expect(parseFilename("just a video.mp4")).toBeNull();
    expect(parseFilename("Chan [short] Title.mp4")).toBeNull(); // id too short
    expect(parseFilename("Chan [dQw4w9WgXcQtoolong] Title.mp4")).toBeNull();
    expect(parseFilename("Chan [dQw4w9WgXcQ] Title.mkv")).toBeNull();
    expect(parseFilename("[dQw4w9WgXcQ] Title.mp4")).toBeNull(); // empty channel
    expect(parseFilename("Chan [dQw4w9WgXcQ].mp4")).toBeNull(); // empty title
    expect(parseFilename("notes.txt")).toBeNull();
  });

  test("keeps brackets inside the title intact", () => {
    const p = parseFilename("Chan [dQw4w9WgXcQ] Best [2024] Mix.mp4");
    expect(p?.title).toBe("Best [2024] Mix");
  });
});
