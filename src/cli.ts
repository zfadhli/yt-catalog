#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { scanCommand as scan } from "./commands/scan.js";
import { mergeCommand as merge } from "./commands/merge.js";

const main = defineCommand({
  meta: {
    name: "yt-catalog",
    version: "0.1.0",
    description:
      "Catalog downloaded YouTube videos: `scan` builds one from a folder, `merge` combines existing catalogs.",
  },
  args: {},
  subCommands: { scan, merge },
});

/**
 * `yt-catalog <folder>` was the original single-command form. citty now treats
 * the first positional as a command name, so point stragglers at `scan` rather
 * than letting citty report a confusing "Unknown command `./downloads`".
 */
export function legacyHint(argv: string[]): string | null {
  const first = argv.find((a) => !a.startsWith("-"));
  if (!first || first === "scan" || first === "merge") return null;
  return (
    `error: unknown command \`${first}\`\n` +
    `hint: scanning a folder is now \`yt-catalog scan <folder>\``
  );
}

// Guarded so `bun test` can import the helpers above without running the CLI.
if (import.meta.main) {
  const hint = legacyHint(process.argv.slice(2));
  if (hint) {
    console.error(hint);
    process.exit(1);
  }
  runMain(main);
}
