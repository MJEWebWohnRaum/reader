import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VIEW_OPTIONS, loadViewOptions, nextTextWidth, saveViewOptions, stepTextScale } from "../src/ui/settings";

describe("view settings", () => {
  afterEach(() => localStorage.clear());

  it("defaults, persists and restores", () => {
    expect(loadViewOptions()).toEqual(DEFAULT_VIEW_OPTIONS);
    saveViewOptions({ doublePage: true, textScale: 1.25, textWidth: "wide" });
    expect(loadViewOptions()).toEqual({ doublePage: true, textScale: 1.25, textWidth: "wide" });
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem("reader.view", JSON.stringify({ doublePage: "yes", textScale: 7, textWidth: "huge" }));
    expect(loadViewOptions()).toEqual(DEFAULT_VIEW_OPTIONS);
    localStorage.setItem("reader.view", "{kaputt");
    expect(loadViewOptions()).toEqual(DEFAULT_VIEW_OPTIONS);
  });

  it("falls back to defaults when storage is unavailable", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadViewOptions()).toEqual(DEFAULT_VIEW_OPTIONS);
    spy.mockRestore();
  });

  it("steps font sizes within bounds and cycles widths", () => {
    expect(stepTextScale(1, 1)).toBe(1.1);
    expect(stepTextScale(1, -1)).toBe(0.9);
    expect(stepTextScale(0.8, -1)).toBe(0.8);
    expect(stepTextScale(1.8, 1)).toBe(1.8);
    expect(nextTextWidth("narrow")).toBe("medium");
    expect(nextTextWidth("wide")).toBe("narrow");
  });
});
