import type { ParsedFile } from "./types.js";

/**
 * Expected filename format:
 *   `<channel> [<11-char youtube id>] <title>.mp4`
 *
 * Examples:
 *   `RickAstleyVEVO [dQw4w9WgXcQ] Rick Astley - Never Gonna Give You Up.mp4`
 *   `Some Channel  [AbC123_-xYz]  My Video Title.MP4`
 *
 * The match is intentionally lenient about surrounding whitespace and the
 * case of the `.mp4` extension, but strict about the ID itself: exactly
 * 11 URL-safe base64 characters inside square brackets.
 */
const FILENAME_RE =
  /^(?<channel>.+?)\s*\[(?<id>[A-Za-z0-9_-]{11})\]\s*(?<title>.+?)\s*\.mp4\s*$/i;

/**
 * Parse a YouTube-download filename into its channel / id / title parts.
 * Returns `null` when the filename does not match the expected pattern.
 * Accepts a full path or a bare filename — only the basename is parsed.
 */
export function parseFilename(input: string): ParsedFile | null {
  // Basename: handle both POSIX and Windows separators.
  const originalFilename = input.split(/[/\\]/).pop() ?? input;
  const match = FILENAME_RE.exec(originalFilename.trim());
  if (!match?.groups) return null;

  const channel = match.groups.channel.trim();
  const id = match.groups.id;
  const title = match.groups.title.trim();
  if (!channel || !title) return null;

  return { channel, id, title, originalFilename };
}
