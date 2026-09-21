import {
  API_BATCH_SIZE,
  videosApiUrl,
  watchUrl,
  type ParsedFile,
  type VideoEntry,
} from "./types.js";

export interface ApiThumbnail {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface ApiSnippet {
  title?: unknown;
  channelTitle?: unknown;
  thumbnails?: Record<string, ApiThumbnail> | unknown;
}

export interface ApiVideoItem {
  id?: unknown;
  snippet?: ApiSnippet;
}

interface ApiResponse {
  items?: ApiVideoItem[];
  error?: { message?: unknown };
}

export interface ResolveOptions {
  apiKey: string;
  /** Max concurrent HTTP requests (each covers up to 50 videos). */
  concurrency: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Fetch implementation (injectable for tests). */
  fetchFn?: typeof fetch;
  /** Called after each video settles: (done, total). */
  onProgress?: (done: number, total: number) => void;
}

export interface ResolveResult {
  videos: VideoEntry[];
  /** Reasons, parallel to skipped filenames in the caller. */
  skipped: { file: ParsedFile; reason: string }[];
}

/** Preferred thumbnail keys in descending resolution. Defaults to `high`. */
const THUMB_ORDER = ["high", "medium", "standard", "maxres", "default"];

/** Pick the best available thumbnail URL, or null when the snippet has none. */
export function pickThumbnail(
  thumbnails: Record<string, ApiThumbnail> | unknown,
): string | null {
  if (!thumbnails || typeof thumbnails !== "object") return null;
  const map = thumbnails as Record<string, ApiThumbnail>;
  for (const key of THUMB_ORDER) {
    const url = map[key]?.url;
    if (typeof url === "string" && url.length > 0) return url;
  }
  return null;
}

/** Map one API item to an entry, or null when required fields are missing. */
export function toEntry(
  item: ApiVideoItem,
  file: ParsedFile,
): VideoEntry | null {
  const id = typeof item.id === "string" && item.id ? item.id : file.id;
  const thumbnail = pickThumbnail(item.snippet?.thumbnails);
  if (!thumbnail) return null;
  const title = item.snippet?.title;
  const channel = item.snippet?.channelTitle;
  return {
    id,
    title: typeof title === "string" && title ? title : file.title,
    channel: typeof channel === "string" && channel ? channel : file.channel,
    thumbnail,
    url: watchUrl(id),
    originalFilename: file.originalFilename,
  };
}

/**
 * Chunk `files` into API batches (≤50 ids, deduplicated within a batch so the
 * response always covers every requested id) and resolve them with a bounded
 * worker pool. Per-batch failures never throw: every file in a failed batch
 * becomes a skip with the API's reason.
 */
export async function resolveVideos(
  files: ParsedFile[],
  options: ResolveOptions,
): Promise<ResolveResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const batches = chunk(files, API_BATCH_SIZE);
  const concurrency = Math.max(
    1,
    Math.min(Math.floor(options.concurrency) || 1, 20),
  );

  // Batch index -> (videoId -> entry). Missing ids are API "not found" skips.
  const byBatch = new Map<number, Map<string, VideoEntry>>();
  const batchErrors = new Map<number, string>();
  let done = 0;
  const report = () => options.onProgress?.(done, files.length);

  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= batches.length) return;
      const batch = batches[index];
      try {
        const res = await fetchBatch(batch, fetchFn, options);
        byBatch.set(index, res.entries);
        if (res.error) batchErrors.set(index, res.error);
        else if (res.entries.size < countDistinct(batch)) {
          batchErrors.set(index, `video not found`);
        }
      } catch (err) {
        batchErrors.set(
          index,
          err instanceof Error && err.name === "AbortError"
            ? "request timed out"
            : `request failed: ${(err as Error).message}`,
        );
      }
      done += batch.length;
      report();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(batches.length, 1)) }, () =>
      worker(),
    ),
  );

  const videos: VideoEntry[] = [];
  const skipped: { file: ParsedFile; reason: string }[] = [];
  batches.forEach((batch, index) => {
    const found = byBatch.get(index);
    const batchError = batchErrors.get(index);
    for (const file of batch) {
      const entry = found?.get(file.id);
      if (entry) videos.push(entry);
      else {
        const reason = entry === undefined && found && !batchError
          ? `video unavailable (deleted, private, or region-blocked)`
          : (batchError ?? "video unavailable");
        skipped.push({
          file,
          reason: `Data API: ${reason} for id "${file.id}"`,
        });
      }
    }
  });

  return { videos, skipped };
}

interface BatchResult {
  entries: Map<string, VideoEntry>;
  /** Set when the API returned an `error` object for the whole request. */
  error?: string;
}

async function fetchBatch(
  batch: ParsedFile[],
  fetchFn: typeof fetch,
  options: ResolveOptions,
): Promise<BatchResult> {
  const byId = new Map(batch.map((f) => [f.id, f]));
  const ids = [...byId.keys()];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetchFn(videosApiUrl(ids, options.apiKey), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    let data: ApiResponse;
    try {
      data = (await res.json()) as ApiResponse;
    } catch {
      return { entries: new Map(), error: `HTTP ${res.status}: invalid JSON` };
    }
    if (!res.ok) {
      const msg =
        typeof data?.error?.message === "string"
          ? data.error.message
          : `HTTP ${res.status}`;
      return { entries: new Map(), error: msg };
    }
    const entries = new Map<string, VideoEntry>();
    for (const item of data.items ?? []) {
      const file = typeof item.id === "string" ? byId.get(item.id) : undefined;
      if (!file) continue;
      const entry = toEntry(item, file);
      if (entry) entries.set(entry.id, entry);
    }
    return { entries };
  } finally {
    clearTimeout(timer);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function countDistinct(batch: ParsedFile[]): number {
  return new Set(batch.map((f) => f.id)).size;
}
