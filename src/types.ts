/** Shared types for the yt-catalog pipeline. */

export interface ParsedFile {
  /** Channel name parsed from the filename (before the [id]). */
  channel: string;
  /** 11-character YouTube video ID parsed from brackets. */
  id: string;
  /** Video title parsed from the filename (after the [id], without extension). */
  title: string;
  /** Original filename as found on disk (basename only). */
  originalFilename: string;
}

export interface VideoEntry {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  url: string;
  originalFilename: string;
}

export interface SkippedFile {
  originalFilename: string;
  reason: string;
}

export function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export const API_BATCH_SIZE = 50;

/** YouTube Data API v3 videos.list URL for up to 50 comma-separated IDs. */
export function videosApiUrl(ids: string[], apiKey: string): string {
  const params = new URLSearchParams({
    part: "snippet",
    id: ids.join(","),
    key: apiKey,
    maxResults: String(API_BATCH_SIZE),
  });
  return `https://www.googleapis.com/youtube/v3/videos?${params}`;
}
