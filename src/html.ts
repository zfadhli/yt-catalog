import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "tempura";
import type { VideoEntry } from "./types.js";

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

const render = compile(
  readFileSync(fileURLToPath(new URL("./page.hbs", import.meta.url)), "utf8"),
  { props: ["themeInit", "css", "payload", "appJs", "alpineJs"] },
);

/**
 * Render the single-file page. Markup lives in `page.hbs`; Tailwind scans that
 * file (`@source` in `theme.css`), so classes added there show up only after
 * `bun run build:css`.
 */
export function renderHtml(videos: VideoEntry[]): string {
  const { css, js } = assets();
  return render({
    count: videos.length,
    themeInit: THEME_INIT,
    css,
    payload: serializeForHtml(videos),
    appJs: APP_JS,
    alpineJs: js,
  });
}
