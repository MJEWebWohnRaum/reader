import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CbzAdapter } from "../src/reader/adapters/cbz";
import { ComicAdapter, naturalCompare, pageImageType, selectPages, type ComicPage } from "../src/reader/comic";
import { ReaderError } from "../src/reader/types";

describe("pageImageType", () => {
  it("accepts common image extensions in any case", () => {
    expect(pageImageType("001.JPG")).toBe("image/jpeg");
    expect(pageImageType("sub/dir/page.Png")).toBe("image/png");
    expect(pageImageType("a.webp")).toBe("image/webp");
  });

  it("accepts paths starting with ./ (common in TAR/RAR archives)", () => {
    expect(pageImageType("./001.jpg")).toBe("image/jpeg");
    expect(pageImageType("./issue/002.png")).toBe("image/png");
  });

  it("rejects non-images, macOS metadata and hidden files", () => {
    expect(pageImageType("ComicInfo.xml")).toBeUndefined();
    expect(pageImageType("Thumbs.db")).toBeUndefined();
    expect(pageImageType("__MACOSX/._001.jpg")).toBeUndefined();
    expect(pageImageType("issue/__MACOSX/001.jpg")).toBeUndefined();
    expect(pageImageType("._002.jpg")).toBeUndefined();
    expect(pageImageType(".thumbs/003.jpg")).toBeUndefined();
    expect(pageImageType("noextension")).toBeUndefined();
    expect(pageImageType("issue\\__MACOSX\\001.jpg")).toBeUndefined();
  });
});

describe("selectPages", () => {
  it("sorts naturally and case-insensitively", () => {
    const names = ["page10.jpg", "Page2.jpg", "page1.jpg", "cover.txt", "page01b.jpg", "__MACOSX/page3.jpg"];
    const pages = selectPages(names.map((path) => ({ path })));
    expect(pages.map((p) => p.path)).toEqual(["page1.jpg", "page01b.jpg", "Page2.jpg", "page10.jpg"]);
  });

  it("ignores ./ prefixes and backslashes when sorting", () => {
    const pages = selectPages(["./issue/10.jpg", "issue/2.jpg", "issue\\1.jpg"].map((path) => ({ path })));
    expect(pages.map((p) => p.path)).toEqual(["issue\\1.jpg", "issue/2.jpg", "./issue/10.jpg"]);
  });

  it("sorts folders naturally too", () => {
    expect(["ch10/1.jpg", "ch2/1.jpg"].sort(naturalCompare)).toEqual(["ch2/1.jpg", "ch10/1.jpg"]);
  });
});

class TestComic extends ComicAdapter {
  released = false;
  constructor(private readonly testPages: ComicPage[]) {
    super();
  }
  protected listPages(): Promise<ComicPage[]> {
    return Promise.resolve(this.testPages);
  }
  protected override releaseArchive(): void {
    this.released = true;
  }
}

function fakePages(count: number): ComicPage[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `${i}.png`,
    type: "image/png",
    read: () => Promise.resolve(new Uint8Array([i])),
  }));
}

describe("ComicAdapter", () => {
  let created: string[];
  let revoked: string[];
  let counter: number;

  beforeEach(() => {
    created = [];
    revoked = [];
    counter = 0;
    // jsdom has no object URLs; define stubs so vi.spyOn can wrap and restore them.
    URL.createObjectURL ??= () => "";
    URL.revokeObjectURL ??= () => {};
    HTMLImageElement.prototype.decode ??= () => Promise.resolve();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:test/${counter++}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => void revoked.push(url));
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it("renders pages as images and prefetches the next page", async () => {
    const adapter = new TestComic(fakePages(3));
    await adapter.open(new File([], "x.cbz"));
    const container = document.createElement("div");
    await adapter.renderPage(0, container);
    await flush();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:test/0");
    expect(created).toHaveLength(2);
  });

  it("keeps a bounded number of object URLs and revokes everything on close", async () => {
    const adapter = new TestComic(fakePages(20));
    await adapter.open(new File([], "x.cbz"));
    const container = document.createElement("div");
    for (let i = 0; i < 20; i++) await adapter.renderPage(i, container);
    await flush();
    expect(created.length - revoked.length).toBeLessThanOrEqual(4);
    adapter.close();
    await flush();
    expect(revoked.sort()).toEqual(created.sort());
    expect(adapter.released).toBe(true);
    expect(adapter.pageCount()).toBe(0);
  });

  it("revokes a URL that finishes extracting after close", async () => {
    let finish: (data: Uint8Array<ArrayBuffer>) => void = () => {};
    const slow: ComicPage = { path: "1.png", type: "image/png", read: () => new Promise((r) => (finish = r)) };
    const adapter = new TestComic([slow]);
    await adapter.open(new File([], "x.cbz"));
    const rendering = adapter.renderPage(0, document.createElement("div"));
    adapter.close();
    finish(new Uint8Array([1]));
    await rendering;
    await flush();
    expect(created).toHaveLength(1);
    expect(revoked).toEqual(created);
  });

  it("reports broken images as a readable error", async () => {
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValue(new Error("decode"));
    const adapter = new TestComic(fakePages(1));
    await adapter.open(new File([], "x.cbz"));
    await expect(adapter.renderPage(0, document.createElement("div"))).rejects.toBeInstanceOf(ReaderError);
  });

  it("rejects archives without images", async () => {
    const adapter = new TestComic([]);
    await expect(adapter.open(new File([], "leer.cbz"))).rejects.toThrow("enthält keine Bilder");
  });
});

describe("CbzAdapter", () => {
  class InspectableCbz extends CbzAdapter {
    list(file: File): Promise<ComicPage[]> {
      return this.listPages(file);
    }
  }

  it("lists only images, naturally sorted", async () => {
    const zip = new JSZip();
    for (const name of ["10.jpg", "2.jpg", "1.jpg", "ComicInfo.xml", "__MACOSX/._1.jpg"]) zip.file(name, "x");
    zip.folder("empty");
    const data = await zip.generateAsync({ type: "blob" });
    const pages = await new InspectableCbz().list(new File([data], "test.cbz"));
    expect(pages.map((p) => p.path)).toEqual(["1.jpg", "2.jpg", "10.jpg"]);
  });

  it("opens the public fixture", async () => {
    const data = await readFile("test-fixtures/public/reader-sample.cbz");
    const adapter = new CbzAdapter();
    await adapter.open(new File([new Uint8Array(data)], "reader-sample.cbz"));
    expect(adapter.pageCount()).toBeGreaterThan(0);
    adapter.close();
  });

  it("reports non-zip data as a readable error", async () => {
    const adapter = new CbzAdapter();
    await expect(adapter.open(new File(["not a zip"], "kaputt.cbz"))).rejects.toThrow("kein gültiges CBZ");
  });
});
