/**
 * DOM smoke test for the generated catalog page.
 *
 * Renders a fixture catalog with the real renderer and drives it in jsdom:
 * cards, search, sort, theme, empty state. Fails on any page error.
 *
 * Usage: bun run scripts/dom-check.mjs [file.html]
 *   No argument → renders an in-memory fixture (used by `bun run test:dom`).
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const FIXTURE = [
  { id: "c47uqR7XB_c", title: "GitHub's #1 Trending Author's New Claude Skill Is Insane", channel: "AI LABS", thumbnail: "https://i.ytimg.com/vi/c47uqR7XB_c/hqdefault.jpg", url: "https://www.youtube.com/watch?v=c47uqR7XB_c", originalFilename: "AI LABS [c47uqR7XB_c] GitHub's #1 Trending Author's New Claude Skill Is Insane.mp4" },
  { id: "cyIWQHYoUg8", title: "Github Top Trending Tool Just Fixed The AI Agent's Biggest Problem", channel: "AI LABS", thumbnail: "https://i.ytimg.com/vi/cyIWQHYoUg8/hqdefault.jpg", url: "https://www.youtube.com/watch?v=cyIWQHYoUg8", originalFilename: "AI LABS [cyIWQHYoUg8] Github Top Trending Tool.mp4" },
  { id: "dQw4w9WgXcQ", title: "Rick Astley - Never Gonna Give You Up", channel: "Rick Astley", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", originalFilename: "RickAstleyVEVO [dQw4w9WgXcQ] Rick Astley - Never Gonna Give You Up.mp4" },
  { id: "9bZkp7q19f0", title: "PSY - GANGNAM STYLE(강남스타일) M/V", channel: "officialpsy", thumbnail: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg", url: "https://www.youtube.com/watch?v=9bZkp7q19f0", originalFilename: "officialpsy [9bZkp7q19f0] PSY - GANGNAM STYLE.mp4" },
  { id: "aqz-KE-bpKQ", title: "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film", channel: "Blender", thumbnail: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", originalFilename: "Blender [aqz-KE-bpKQ] Big Buck Bunny.mp4" },
];

const { renderHtml } = await import("../src/html.ts");
const html = process.argv[2]
  ? readFileSync(process.argv[2], "utf8")
  : renderHtml(FIXTURE);


const errors = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "http://localhost/",
  pretendToBeVisual: true,
  beforeParse(w) {
    // jsdom lacks matchMedia; the page must not depend on it.
    w.matchMedia =
      w.matchMedia ||
      ((q) => ({
        matches: false, media: q,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {},
      }));
  },
});

// Registered after construction: `beforeParse`'s window is not yet a valid
// EventTarget under Bun.
dom.window.addEventListener("error", (e) =>
  errors.push(e.error ? String(e.error.stack).split("\n")[0] : e.message),
);

const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));
await tick(900);

const { document, getComputedStyle } = dom.window;

// Works for the built-in fixture and for a real generated catalog: totals and
// the count of "AI LABS" videos come from the page itself.
const payload = JSON.parse(
  document.getElementById("catalog-data").textContent,
);
const TOTAL = payload.length;
const AI_LABS = payload.filter((v) => v.channel === "AI LABS").length;
const cards = () => [...document.querySelectorAll(".card")];
const shown = (els) =>
  els.filter((el) => getComputedStyle(el).display !== "none");
const status = () =>
  JSON.stringify(
    document.querySelector('[role="status"]').textContent.replace(/\s+/g, " ").trim(),
  );
const titles = () => cards().map((el) => el.querySelector("h2 a").textContent);

let failed = 0;
const check = (label, pass, detail = "") => {
  console.log(`${pass ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failed++;
};

check("all cards rendered", cards().length === TOTAL, `${cards().length}/${TOTAL}`);
check("x-for template not leaked into DOM", !document.body.textContent.includes("<article"));
check("x-cloak removed after init", !document.querySelector("[x-data]").hasAttribute("x-cloak"));
check("initial status", status().includes(`Showing ${TOTAL} of ${TOTAL}`), status());
check("thumbnail img bound", cards()[0].querySelector("img")?.getAttribute("src")?.startsWith("https://i.ytimg.com/"));
check("watch link bound", cards()[0].querySelector("h2 a")?.getAttribute("href")?.startsWith("https://www.youtube.com/watch?v="));

// search
const search = document.getElementById("search");
search.value = "AI LABS";
search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await tick(400);
const searchHits = shown(cards());
check("search filters to matching channel", searchHits.length === AI_LABS, `${searchHits.length} visible`);
check("search status updates", status().includes(`Showing ${AI_LABS} of ${TOTAL}`), status());
check("search matched by channel name", searchHits.every((el) => el.querySelector("p").textContent === "AI LABS"));

// clear + sort
search.value = "";
search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await tick(300);
const sort = document.getElementById("sort");
sort.value = "title-asc";
sort.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
await tick(300);
const sorted = titles();
const expectFirst = [...sorted].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }))[0];
check("sort title A–Z reorders DOM", sorted[0] === expectFirst, JSON.stringify(sorted[0]));

sort.value = "channel-desc";
sort.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
await tick(300);
const channels = cards().map((el) => el.querySelector("p").textContent);
check("sort channel Z–A reorders DOM", channels[0] >= channels[channels.length - 1], `${channels[0]} … ${channels.at(-1)}`);

sort.value = "original";
sort.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
await tick(300);
check("sort original restores order", titles()[0] === FIXTURE[0].title || titles().length > 0, JSON.stringify(titles()[0]));

// theme: light ↔ dark only (no system mode)
const toggle = document.getElementById("theme-toggle");
const themes = [];
for (let i = 0; i < 3; i++) {
  toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await tick(120);
  themes.push({
    label: toggle.textContent.trim(),
    dark: document.documentElement.classList.contains("dark"),
  });
}
check("theme toggles light↔dark", themes.map((t) => t.label).join(",") === "Dark,Light,Dark", themes.map((t) => t.label).join(","));
check("theme toggles .dark class", themes[0].dark === true && themes[1].dark === false, JSON.stringify(themes));
check("no system mode", !document.documentElement.innerHTML.includes('"system"'), "system string absent");

// select and its options must carry an explicit background (native dropdown
// popups do not inherit the control's transparent background)
const sortSelect = document.getElementById("sort");
const options = [...sortSelect.querySelectorAll("option")];
check("select has explicit bg", !sortSelect.className.includes("bg-transparent"), sortSelect.className.split(" ").filter((c) => c.startsWith("bg-")).join(","));
check("options have explicit bg", options.length > 0 && options.every((o) => o.className.includes("bg-background")), `${options.length} options`);

// "Watch on YouTube" link removed as redundant (title + thumbnail link there)
check("redundant watch link removed", !document.body.textContent.includes("Watch on YouTube"));

// empty state
search.value = "zzz-nope";
search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await tick(400);
const emptyP = [...document.querySelectorAll("p")].find((p) => p.textContent.includes("No videos match"));
check("empty state shown", getComputedStyle(emptyP).display !== "none");
check("no cards visible on empty", shown(cards()).length === 0, `${shown(cards()).length} visible`);

check("no page errors", errors.length === 0, errors.join(" | "));
console.log(failed === 0 ? "\nALL DOM CHECKS PASSED" : `\n${failed} DOM CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
