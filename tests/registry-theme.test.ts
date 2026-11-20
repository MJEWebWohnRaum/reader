import { afterEach, describe, expect, it } from "vitest";
import { clearFormats, fileExtension, findFormat, registerFormat, supportedExtensions } from "../src/reader/registry";
import type { ReaderAdapter } from "../src/reader/types";
import { applyTheme, loadTheme, toggleTheme } from "../src/ui/theme";

const load = (): Promise<ReaderAdapter> => Promise.reject(new Error("not used"));

describe("registry", () => {
  afterEach(clearFormats);

  it("finds formats by extension, case-insensitive", () => {
    registerFormat({ label: "Comic", extensions: ["cbz"], mimeTypes: ["application/vnd.comicbook+zip"], load });
    registerFormat({ label: "PDF", extensions: ["pdf"], mimeTypes: ["application/pdf"], load });
    expect(findFormat({ name: "Heft.CBZ", type: "" })?.label).toBe("Comic");
    expect(findFormat({ name: "a.b.pdf", type: "" })?.label).toBe("PDF");
    expect(supportedExtensions()).toEqual([".cbz", ".pdf"]);
  });

  it("falls back to the MIME type and returns undefined for unknown files", () => {
    registerFormat({ label: "PDF", extensions: ["pdf"], mimeTypes: ["application/pdf"], load });
    expect(findFormat({ name: "download", type: "application/pdf" })?.label).toBe("PDF");
    expect(findFormat({ name: "notes.txt", type: "text/plain" })).toBeUndefined();
    expect(findFormat({ name: "noext", type: "" })).toBeUndefined();
  });

  it("extracts extensions", () => {
    expect(fileExtension("x.tar.CBT")).toBe("cbt");
    expect(fileExtension("README")).toBe("");
  });
});

describe("theme", () => {
  afterEach(() => localStorage.clear());

  it("defaults to dark and persists toggles", () => {
    expect(loadTheme()).toBe("dark");
    applyTheme(loadTheme());
    expect(toggleTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(loadTheme()).toBe("light");
    expect(toggleTheme()).toBe("dark");
    expect(loadTheme()).toBe("dark");
  });
});
