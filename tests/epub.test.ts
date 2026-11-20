import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { EpubAdapter, estimatePages, textLength } from "../src/reader/adapters/epub";

describe("textLength", () => {
  it("counts visible text only", () => {
    const html =
      '<?xml version="1.0"?><html><head><title>T</title><style>p { color: red }</style></head>' +
      "<body><h1>Kapitel  1</h1>\n<p>Hallo&nbsp;Welt</p><script>var x = 1;</script></body></html>";
    expect(textLength(html)).toBe("T Kapitel 1 Hallo Welt".length);
  });
});

describe("textLength (edge cases)", () => {
  it("handles self-closing style tags without swallowing text", () => {
    expect(textLength("<head><style/></head><body><p>Text</p><style>x{}</style></body>")).toBe("Text".length);
  });
});

describe("estimatePages", () => {
  const sections = [0, 1, 2, 3];
  const chars = new Map([
    [0, 100], // title page
    [1, 10_000],
    [2, 20_000],
    [3, 5_000],
  ]);

  it("is undefined until a text section was measured", () => {
    expect(estimatePages(sections, chars, new Map([[0, 1]]))).toBeUndefined();
  });

  it("extrapolates measured screens by text length", () => {
    // Section 1: 10 screens for 10k chars -> 1 screen per 1k chars.
    expect(estimatePages(sections, chars, new Map([[0, 1], [1, 10]]))).toBe(1 + 10 + 20 + 5);
  });

  it("uses measured values for visited sections and at least one screen elsewhere", () => {
    const sparse = new Map([[0, 0], [1, 10_000], [2, 20_000], [3, 0]]);
    expect(estimatePages(sections, sparse, new Map([[1, 4], [2, 12]]))).toBe(1 + 4 + 12 + 1);
  });
});

describe("EpubAdapter", () => {
  it("opens the public fixture with a provisional page count", async () => {
    const data = new Uint8Array(await readFile("test-fixtures/public/reader-sample.epub"));
    const adapter = new EpubAdapter();
    await adapter.open(new File([data], "reader-sample.epub"));
    expect(adapter.pageCount()).toBeGreaterThanOrEqual(1);
    adapter.close();
    expect(() => adapter.close()).not.toThrow();
  });

  it("reports invalid data as a readable error", async () => {
    const adapter = new EpubAdapter();
    await expect(adapter.open(new File(["kein zip"], "kaputt.epub"))).rejects.toThrow("keine gültige EPUB");
    expect(() => adapter.close()).not.toThrow();
  });
});
