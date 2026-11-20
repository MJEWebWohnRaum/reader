// Copies runtime files that bundlers can't pick up on their own into public/, so they
// are served locally and end up in dist/. Runs before dev/build.
// - pdf.js: CMaps, standard fonts, wasm decoders, ICC profiles
// - libarchive.js: module worker and its wasm (loaded relative to the worker)
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "package.json"));
const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));

async function copyFresh(target, entries) {
  // Start clean so files from an older version don't linger in dist/.
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const [from, to, filter] of entries) {
    await cp(from, join(target, to), { recursive: true, filter });
  }
}

const pdfjs = packageDir("pdfjs-dist");
// QuickJS is only needed for PDF scripting, which the reader never enables.
const noQuickJs = (path) => !/quickjs/i.test(path);
await copyFresh(
  join(root, "public", "pdfjs"),
  ["cmaps", "standard_fonts", "wasm", "iccs"].map((folder) => [join(pdfjs, folder), folder, noQuickJs]),
);

const libarchive = join(packageDir("libarchive.js"), "dist");
await copyFresh(join(root, "public", "libarchive"), [
  [join(libarchive, "worker-bundle.js"), "worker-bundle.js"],
  [join(libarchive, "libarchive.wasm"), "libarchive.wasm"],
]);
