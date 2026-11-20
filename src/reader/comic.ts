import { ReaderError, type ReaderAdapter } from "./types";

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Image MIME type for an archive path, or undefined if it is not a page image. */
export function pageImageType(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((s) => s !== "" && s !== ".");
  const name = segments.at(-1) ?? "";
  // Skip macOS resource forks and hidden files/folders (".DS_Store", "._001.jpg", ".thumbnails/").
  if (segments.some((s) => s === "__MACOSX" || s.startsWith("."))) return undefined;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? undefined : IMAGE_TYPES[name.slice(dot + 1).toLowerCase()];
}

/** Natural, case-insensitive order: "page2" before "page10". */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

export interface ComicPage {
  path: string;
  type: string;
  /** Extracts the raw image data. Called lazily, possibly more than once. */
  read(): Promise<Blob | ArrayBuffer | Uint8Array<ArrayBuffer>>;
}

/** "./issue\2.jpg" and "issue/2.jpg" sort the same. */
function sortKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

/** Filters archive entries down to page images in natural order. */
export function selectPages<T extends { path: string }>(entries: readonly T[]): Array<T & { type: string }> {
  const pages: Array<T & { type: string }> = [];
  for (const entry of entries) {
    const type = pageImageType(entry.path);
    if (type) pages.push({ ...entry, type });
  }
  return pages.sort((a, b) => naturalCompare(sortKey(a.path), sortKey(b.path)));
}

const CACHE_SIZE = 4;

/**
 * Shared adapter logic for image archives. Subclasses only list the pages.
 * Object URLs are created lazily for a small window of pages and revoked when
 * they fall out of the cache or the document is closed, so memory stays bounded.
 */
export abstract class ComicAdapter implements ReaderAdapter {
  private pages: ComicPage[] = [];
  private readonly cache = new Map<number, Promise<string>>();
  protected closed = false;

  protected abstract listPages(file: File): Promise<ComicPage[]>;
  protected releaseArchive(): void {}

  async open(file: File): Promise<void> {
    const pages = await this.listPages(file);
    if (this.closed) return;
    if (pages.length === 0) throw new ReaderError(`„${file.name}“ enthält keine Bilder.`);
    this.pages = pages;
  }

  pageCount(): number {
    return this.pages.length;
  }

  async renderPage(index: number, container: HTMLElement): Promise<void> {
    const url = await this.pageUrl(index);
    const img = document.createElement("img");
    img.alt = `Seite ${index + 1}`;
    img.src = url;
    try {
      await img.decode();
    } catch (error) {
      if (this.closed) return;
      throw new ReaderError(`Seite ${index + 1} ist kein lesbares Bild.`, { cause: error });
    }
    if (this.closed) return;
    container.replaceChildren(img);
    // Prefetch the next page so turning forward feels instant.
    if (index + 1 < this.pages.length) this.pageUrl(index + 1).catch(() => {});
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const url of this.cache.values()) url.then((u) => URL.revokeObjectURL(u), () => {});
    this.cache.clear();
    this.pages = [];
    this.releaseArchive();
  }

  private pageUrl(index: number): Promise<string> {
    const cached = this.cache.get(index);
    if (cached) {
      // Refresh LRU position.
      this.cache.delete(index);
      this.cache.set(index, cached);
      return cached;
    }
    const page = this.pages[index];
    if (!page) return Promise.reject(new ReaderError(`Seite ${index + 1} existiert nicht.`));

    // Every URL promise passes through the cache; eviction and close() revoke it from there.
    const promise = page.read().then((data) => URL.createObjectURL(new Blob([data], { type: page.type })));
    this.cache.set(index, promise);
    promise.catch(() => {
      // Failed extraction: forget it so the next render retries.
      if (this.cache.get(index) === promise) this.cache.delete(index);
    });
    this.evict();
    return promise;
  }

  private evict(): void {
    while (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next();
      if (oldest.done) return;
      const promise = this.cache.get(oldest.value);
      this.cache.delete(oldest.value);
      promise?.then((u) => URL.revokeObjectURL(u), () => {});
    }
  }
}
