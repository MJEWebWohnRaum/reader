// Copies pdf.js runtime data (CMaps, standard fonts, wasm decoders, ICC profiles)
// into public/ so they are served locally and bundled into dist/. Runs before dev/build.
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "package.json"));
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const target = join(root, "public", "pdfjs");

// Start clean so files from an older pdf.js version don't linger in dist/.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(join(source, folder), join(target, folder), {
    recursive: true,
    // QuickJS is only needed for PDF scripting, which the reader never enables.
    filter: (path) => !/quickjs/i.test(path),
  });
}
