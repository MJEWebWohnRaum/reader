/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works from a subpath and inside Tauri.
  base: "./",
  build: {
    target: "es2022",
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
