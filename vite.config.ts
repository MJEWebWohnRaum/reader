/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works from a subpath and inside Tauri.
  base: "./",
  resolve: {
    // epub.js imports JSZip's prebuilt dist file; share the module the CBZ adapter uses.
    alias: [{ find: /^jszip\/dist\/jszip$/, replacement: "jszip" }],
  },
  build: {
    target: "es2022",
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
