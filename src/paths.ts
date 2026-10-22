/** Local-time `YYYYMMDD_HHMMSS`, matching `videos_20260921_163400.html`. */
export function timestamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/**
 * Insert the timestamp before the extension: `videos.html` →
 * `videos_20260921_163400.html`. A literal `{timestamp}` token anywhere in the
 * path is replaced instead, so `out/{timestamp}/videos.html` also works.
 * `stamp === null` (from `--no-timestamp`) returns the path unchanged.
 */
export function withTimestamp(path: string, stamp: string | null): string {
  if (!stamp) return path;
  if (path.includes("{timestamp}"))
    return path.replaceAll("{timestamp}", stamp);
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  if (dot <= slash) return `${path}_${stamp}`;
  return `${path.slice(0, dot)}_${stamp}${path.slice(dot)}`;
}
