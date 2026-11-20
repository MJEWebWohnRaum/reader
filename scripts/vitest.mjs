// Windows: a lower-case drive letter in the cwd (e.g. "d:\" from VS Code) makes Vitest
// load its runner twice ("Cannot read properties of undefined (reading 'config')").
// Normalize the drive letter, then hand over to the regular Vitest CLI.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

process.chdir(process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase()));
const require = createRequire(join(process.cwd(), "package.json"));
const cli = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
await import(pathToFileURL(cli).href);
