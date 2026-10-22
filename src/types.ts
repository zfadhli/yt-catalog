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
