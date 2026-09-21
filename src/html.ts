import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VideoEntry } from "./types.js";

/** Escape text for safe interpolation into HTML content or attributes. */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Serialize the catalog payload for embedding in a `<script
 * type="application/json">` tag. `<` is unicode-escaped so a title
 * containing `</script>` can never break out of the tag.
 */
export function serializeForHtml(videos: VideoEntry[]): string {
	return JSON.stringify(videos).replace(/</g, "\\u003c");
}

/**
 * Load the prebuilt Tailwind stylesheet and vendored Alpine bundle, both
 * inlined so the generated page stays a single self-contained file.
 * `bun run build:css` regenerates the CSS; `vendor/alpine.min.js` is committed.
 */
export function assets(): { css: string; js: string } {
	return {
		css: readFileSync(
			fileURLToPath(new URL("./theme.generated.css", import.meta.url)),
			"utf8",
		),
		js: readFileSync(
			fileURLToPath(new URL("../vendor/alpine.min.js", import.meta.url)),
			"utf8",
		),
	};
}

/**
 * Alpine component: search, sort, theme. Cards are rendered by Alpine's
 * `x-for` over the embedded JSON, so filtering and ordering happen without a
 * page reload and without the DOM being rebuilt by hand.
 */
const APP_JS = String.raw`document.addEventListener("alpine:init", () => {
  Alpine.data("catalog", () => ({
    videos: [],
    query: "",
    sort: "original",
    theme: "light",
    visible: [],

    init() {
      const el = document.getElementById("catalog-data");
      this.videos = JSON.parse(el.textContent || "[]");
      this.theme = localStorage.getItem("yt-catalog-theme") === "dark" ? "dark" : "light";
      this.applyTheme();
      // Recompute on query/sort changes. An effect is used rather than an
      // @input handler: handler order against x-model (and its debounce) is
      // not guaranteed, which silently left query empty while typing.
      this.$watch("query", () => this.apply());
      this.$watch("sort", () => this.apply());
      this.apply();
    },

    get matches() {
      const q = this.query.trim().toLowerCase();
      if (!q) return this.videos;
      return this.videos.filter((v) =>
        (v.title + "\n" + v.channel).toLowerCase().includes(q),
      );
    },

    apply() {
      const list = [...this.matches];
      const collator = new Intl.Collator(undefined, {
        sensitivity: "base",
        numeric: true,
      });
      const byTitle = (a, b) => collator.compare(a.title, b.title);
      const byChannel = (a, b) => collator.compare(a.channel, b.channel);
      if (this.sort === "title-asc") list.sort(byTitle);
      else if (this.sort === "title-desc") list.sort((a, b) => byTitle(b, a));
      else if (this.sort === "channel-asc")
        list.sort((a, b) => byChannel(a, b) || byTitle(a, b));
      else if (this.sort === "channel-desc")
        list.sort((a, b) => byChannel(b, a) || byTitle(a, b));
      this.visible = list;
    },

    applyTheme() {
      document.documentElement.classList.toggle("dark", this.theme === "dark");
    },

    toggleTheme() {
      this.theme = this.theme === "dark" ? "light" : "dark";
      localStorage.setItem("yt-catalog-theme", this.theme);
      this.applyTheme();
    },

    get themeLabel() {
      return this.theme === "dark" ? "Dark" : "Light";
    },
  }));
});`;

/**
 * Runs before paint so the stored theme applies without a flash. Light is the
 * default; only an explicit stored "dark" wins. No system preference: the page
 * is light/dark only.
 */
const THEME_INIT = `(function(){try{if(localStorage.getItem("yt-catalog-theme")==="dark")document.documentElement.classList.add("dark");}catch(e){}})();`;

/**
 * Repeating card markup consumed by Alpine's `x-for`. Rendered by the browser
 * from the embedded JSON, so the page shell stays tiny regardless of catalog
 * size.
 */
const CARD = `<template x-for="v in visible" :key="v.id + v.originalFilename">
  <article class="card group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs hover:shadow-md">
    <a :href="v.url" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true" class="thumb block aspect-video overflow-hidden bg-muted">
      <img :src="v.thumbnail" :alt="v.title" loading="lazy" decoding="async" class="h-full w-full object-cover" />
    </a>
    <div class="flex flex-1 flex-col gap-1.5 p-4">
      <h2 class="line-clamp-2-yt text-sm font-semibold leading-snug">
        <a :href="v.url" target="_blank" rel="noopener noreferrer" class="hover:text-brand hover:underline" x-text="v.title"></a>
      </h2>
      <p class="truncate text-xs font-medium text-muted-foreground" x-text="v.channel"></p>
    </div>
  </article>
</template>`;

export function renderHtml(videos: VideoEntry[]): string {
	const payload = serializeForHtml(videos);
	const { css, js } = assets();
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>YouTube Catalog · ${videos.length} videos</title>
<script>${THEME_INIT}</script>
<style>${css}</style>
</head>
<body class="min-h-screen bg-background font-sans antialiased">
<div x-data="catalog" x-cloak class="min-h-screen">
  <header class="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
    <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
      <div class="flex items-baseline gap-2">
        <span class="text-base font-semibold tracking-tight">YouTube Catalog</span>
        <span class="text-xs font-medium text-muted-foreground">${videos.length} videos</span>
      </div>

      <div class="relative min-w-56 flex-1">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          id="search" type="search" x-model.debounce.120ms="query"
          placeholder="Search title or channel…" autocomplete="off"
          aria-label="Search by title or channel"
          class="h-9 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30" />
      </div>

      <select
        id="sort" x-model="sort" aria-label="Sort videos"
        class="h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30">
        <option class="bg-background text-foreground" value="original">Sort: Original order</option>
        <option class="bg-background text-foreground" value="title-asc">Title A–Z</option>
        <option class="bg-background text-foreground" value="title-desc">Title Z–A</option>
        <option class="bg-background text-foreground" value="channel-asc">Channel A–Z</option>
        <option class="bg-background text-foreground" value="channel-desc">Channel Z–A</option>
      </select>

      <button
        id="theme-toggle" type="button" @click="toggleTheme()"
        :aria-label="'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode'"
        class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input px-3 text-sm shadow-xs outline-none hover:bg-secondary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></svg>
        <span x-text="themeLabel"></span>
      </button>
    </div>
  </header>

  <div class="mx-auto max-w-7xl px-4 pt-4 sm:px-6" role="status" aria-live="polite">
    <p class="text-xs font-medium text-muted-foreground">
      Showing <span x-text="visible.length"></span> of <span x-text="videos.length"></span> videos
    </p>
  </div>

  <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      ${CARD}
    </div>
    <p x-show="visible.length === 0" class="py-16 text-center text-sm text-muted-foreground">
      No videos match your search.
    </p>
  </main>

  <footer class="mx-auto max-w-7xl px-4 pb-10 pt-2 sm:px-6">
    <p class="text-xs text-muted-foreground">Generated by yt-catalog · thumbnails and links point to YouTube.</p>
  </footer>
</div>

<script id="catalog-data" type="application/json">${payload}</script>
<script>${APP_JS}</script>
<script>${js}</script>
</body>
</html>
`;
}
