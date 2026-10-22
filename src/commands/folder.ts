import { stat } from "node:fs/promises";

/**
 * Exit 1 with a message instead of an ENOENT stack trace when the folder
 * argument is missing, unreadable, or not a directory. Shared by `scan` and
 * `merge` so both reject the same inputs with the same wording.
 */
export async function assertFolder(folder: string): Promise<void> {
  try {
    if (!(await stat(folder)).isDirectory()) {
      console.error(`error: not a directory: ${folder}`);
      process.exit(1);
    }
  } catch {
    console.error(`error: folder not found: ${folder}`);
    process.exit(1);
  }
}
