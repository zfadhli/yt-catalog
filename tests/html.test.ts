import { describe, expect, test } from "bun:test";
import {
  escapeHtml,
  renderHtml,
  serializeForHtml,
} from "../src/html.ts";
import type { VideoEntry } from "../src/types.ts";

const videos: VideoEntry[] = [
  {
    id: "dQw4w9WgXcQ",
    title: "Rick Astley - Never Gonna Give You Up",
    channel: "RickAstleyVEVO",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    originalFilename:
      "RickAstleyVEVO [dQw4w9WgXcQ] Rick Astley - Never Gonna Give You Up.mp4",
  },
  {
    id: "AAAAAAAAAAA",
    title: 'Evil </script><script>alert("x")</script> Title',
    channel: "Chan & Co.",
    thumbnail: "https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg",
    url: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
    originalFilename: "Chan & Co. [AAAAAAAAAAA] Evil Title.mp4",
  },
];

describe("html renderer", () => {
  test("embeds video data as parseable JSON", () => {
    const html = renderHtml(videos);
    const m = html.match(
      /<script id="catalog-data" type="application\/json">(.*?)<\/script>/s,
    );
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual(videos);
  });

  test("neutralizes </script> inside titles", () => {
    const payload = serializeForHtml(videos);
    expect(payload).not.toContain("</script>");
    expect(payload).toContain("\\u003c/script>");
  });

  test("is self-contained with required UI controls", () => {
    const html = renderHtml(videos);
    expect(html).toContain('id="search"');
    expect(html).toContain('id="sort"');
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain("localStorage");
    // Light/dark only: system preference must not be consulted.
    expect(html).not.toContain("prefers-color-scheme");
    // No external scripts, stylesheets, or runtime deps.
    expect(html).not.toMatch(/<script src=/);
    expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/);
    expect(html).not.toMatch(/https?:\/\/[^"']*\.js/);
  });

  test("inlines Tailwind CSS and the vendored Alpine runtime", () => {
    const html = renderHtml(videos);
    // Real Tailwind output, not the source file. The minifier inlines the
    // `@theme inline` aliases, so assert on a concrete token value.
    expect(html).toContain("tailwindcss v4");
    expect(html).toContain("oklch(");
    expect(html).toContain("--brand");
    // Vendored Alpine bundle (no CDN reference).
    expect(html).toContain("alpine:init");
    expect(html.length).toBeGreaterThan(40_000);
  });

  test("cards are rendered client-side by Alpine x-for", () => {
    const html = renderHtml(videos);
    expect(html).toContain('x-data="catalog"');
    expect(html).toContain('x-for="v in visible"');
    expect(html).toContain('x-text="v.title"');
    expect(html).toContain('x-cloak');
  });

  test("dark mode uses Oxbow's .dark class; light/dark only (no system)", () => {
    const html = renderHtml(videos);
    const init = html.match(/<script>\(function\(\)\{try\{[\s\S]*?<\/script>/)![0];
    expect(init).toContain('classList.add("dark")');
    expect(init).not.toContain("prefers-color-scheme");
    // No system mode anywhere in the page.
    expect(html).not.toContain('"system"');
    expect(html).toContain("toggleTheme");
    expect(html).not.toContain("cycleTheme");
    // Theme classes must survive Tailwind tree-shaking.
    const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
    expect(style).toMatch(/\.dark\{[^}]*--background/);
  });

  test("sort dropdown is dark-mode safe", () => {
    // Native option popups do not inherit the control's background, so both the
    // select and every option need an explicit theme-aware background.
    const html = renderHtml(videos);
    const select = html.match(/<select[\s\S]*?<\/select>/)![0];
    expect(select).not.toContain("bg-transparent");
    expect(select).toContain("bg-background");
    const options = select.match(/<option[^>]*>/g)!;
    expect(options).toHaveLength(5);
    for (const opt of options) {
      expect(opt).toContain("bg-background");
      expect(opt).toContain("text-foreground");
    }
    // The utility must actually be emitted with the token, not just referenced.
    const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
    expect(style).toMatch(/background-color:var\(--background\)/);
  });

  test("no redundant watch link inside cards", () => {
    // Title and thumbnail already link to the video.
    const html = renderHtml(videos);
    expect(html).not.toContain("Watch on YouTube");
  });

  test("sort select offers all required modes", () => {
    const html = renderHtml(videos);
    for (const v of [
      "original",
      "title-asc",
      "title-desc",
      "channel-asc",
      "channel-desc",
    ]) {
      expect(html).toContain(`value="${v}"`);
    }
  });

  test("search and sort are driven by Alpine state, not event handlers", () => {
    // Regression test: `@input="apply"` on the same element as `x-model`
    // fires before x-model commits the value, so search silently did
    // nothing. Filtering must hang off state via $watch.
    const html = renderHtml(videos);
    expect(html).toContain('x-model.debounce.120ms="query"');
    expect(html).not.toContain('@input="apply"');
    expect(html).not.toContain('@change="apply"');
    expect(html).toContain('this.$watch("query"');
    expect(html).toContain('this.$watch("sort"');
  });

  test("hidden cards are actually hidden (author display must not beat [hidden])", () => {
    // `.card` is a flex container, which would override the UA stylesheet's
    // `[hidden]{display:none}` if the rule were not explicit.
    const html = renderHtml(videos);
    expect(html).toContain('x-show="visible.length === 0"');
    const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
    // The minifier merges selectors, so match the declaration, not the rule.
    expect(style).toMatch(/\[x-cloak\][^{}]*\{[^}]*display\s*:\s*none/);
  });

  test("escapeHtml covers content and attribute contexts", () => {
    expect(escapeHtml(`<a href="x">'&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;",
    );
  });
});
