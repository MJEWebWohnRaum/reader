import ePub, { type Book, type Contents, type Location, type Rendition } from "epubjs";
import { ReaderError, type ReaderAdapter } from "../types";

// Short sections (title pages, images) say little about text density; ignore them.
const MIN_SAMPLE_CHARS = 3000;

/**
 * EPUB is reflowable: a "page" is one screen of text and depends on the window size.
 * Page turns are relative (rendition.next/prev), so no text is ever skipped, and the
 * total page count is an estimate that is refined while reading.
 *
 * After a window resize the screens before the current position re-flow, so the page
 * number may drift. The start of the book always resets it to page 1 and is always
 * reachable: the adapter never reports page 1 unless the book's start is shown.
 */
export class EpubAdapter implements ReaderAdapter {
  private book: Book | undefined;
  private rendition: Rendition | undefined;
  /** Screens turned since the start of the book. */
  private position = 0;
  /** Page the viewer currently asks for; keeps the count estimate ahead of it. */
  private target = 0;
  private location: Location | undefined;
  private count = 1;
  private countListener: ((count: number) => void) | undefined;
  private pageListener: ((index: number) => void) | undefined;
  /** Spine indices of linear sections, i.e. the ones next()/prev() actually visit. */
  private sections: number[] = [];
  /** Text length per spine index (filled shortly after open). */
  private sectionChars: Map<number, number> | undefined;
  /** Measured screens per spine index at the current container size. */
  private readonly sectionScreens = new Map<number, number>();
  private layoutSize = "";
  private themeCss = "";
  private closed = false;

  async open(file: File): Promise<void> {
    const data = await file.arrayBuffer();
    if (this.closed) return;
    const book = ePub();
    this.book = book;
    let spineLength: number;
    try {
      await book.open(data, "binary");
      await book.ready;
      spineLength = (await book.loaded.spine).length;
    } catch (error) {
      throw new ReaderError(`„${file.name}“ ist keine gültige EPUB-Datei oder beschädigt.`, { cause: error });
    }
    if (this.closed) return;
    for (let index = 0; index < spineLength; index++) {
      if (book.spine.get(index)?.linear) this.sections.push(index);
    }
    if (this.sections.length === 0) throw new ReaderError(`„${file.name}“ enthält keine lesbaren Kapitel.`);
    // Provisional count until text lengths and screen sizes are known.
    this.count = this.sections.length;
    void this.measureSections(book);
  }

  pageCount(): number {
    return this.count;
  }

  onPageCountChange(listener: (count: number) => void): void {
    this.countListener = listener;
  }

  onPageChange(listener: (index: number) => void): void {
    this.pageListener = listener;
  }

  async renderPage(index: number, container: HTMLElement): Promise<void> {
    if (this.closed || !this.book) return;
    this.target = index;
    this.updateTheme(container);
    const size = `${container.clientWidth}x${container.clientHeight}`;
    if (size !== this.layoutSize) {
      // Screens per section measured at another size no longer apply.
      this.layoutSize = size;
      this.sectionScreens.clear();
    }

    let rendition = this.rendition;
    if (!rendition) {
      const page = document.createElement("div");
      page.className = "epub-page";
      container.replaceChildren(page);
      rendition = this.createRendition(this.book, page);
      this.rendition = rendition;
      this.position = 0;
      await rendition.display();
      if (this.closed) return;
      this.location = await settledLocation(rendition);
    } else if (index === this.position) {
      // Resize or theme refresh: epub.js re-flows by itself; only refresh the location.
      this.location = (await settledLocation(rendition)) ?? this.location;
    }

    // Walk screen by screen, even when several page turns were coalesced into one
    // request, so no text is ever skipped.
    while (this.position !== index && !this.closed) {
      const forward = index > this.position;
      if (forward ? this.location?.atEnd : this.location?.atStart) break;
      await (forward ? rendition.next() : rendition.prev());
      if (this.closed) return;
      this.position += forward ? 1 : -1;
      this.location = (await settledLocation(rendition)) ?? this.location;
    }
    if (this.closed) return;

    if (this.location?.atStart) this.position = 0;
    else if (this.position === 0 && this.location) this.position = 1; // Keep "back" possible.
    this.updateCount();
    if (this.position !== index) this.pageListener?.(this.position);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.countListener = undefined;
    this.pageListener = undefined;
    const book = this.book;
    this.book = undefined;
    this.rendition = undefined;
    if (!book) return;
    const urls = blobUrlsOf(book);
    try {
      // Also destroys the rendition.
      book.destroy();
    } catch {
      // A half-initialized book can throw while tearing down; nothing left to keep.
    }
    for (const url of urls) URL.revokeObjectURL(url);
  }

  private createRendition(book: Book, element: HTMLElement): Rendition {
    const rendition = book.renderTo(element, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      spread: "none",
      allowScriptedContent: false,
    });
    rendition.hooks.content.register((contents: Contents) => this.applyTheme(contents.document));
    return rendition;
  }

  private updateCount(): void {
    const location = this.location;
    const floor = Math.max(this.position, this.target) + 2;
    if (!location) {
      // Position unknown: never block turning forward (e.g. a single-section book).
      this.setCount(Math.max(this.count, floor));
      return;
    }
    this.sectionScreens.set(location.start.index, location.start.displayed.total);
    if (location.atEnd) {
      this.setCount(this.position + 1);
      return;
    }
    const estimate = this.sectionChars && estimatePages(this.sections, this.sectionChars, this.sectionScreens);
    // Always keep at least one page ahead while the book isn't finished.
    this.setCount(Math.max(estimate ?? this.count, floor));
  }

  private setCount(count: number): void {
    if (count === this.count || this.closed) return;
    this.count = count;
    this.countListener?.(count);
  }

  /**
   * Reads every section's raw text length straight from the archive. Much faster
   * than epub.js locations (which lay out the whole book) and good enough for an
   * estimate scaled by measured screens.
   */
  private async measureSections(book: Book): Promise<void> {
    try {
      const chars = new Map<number, number>();
      for (const index of this.sections) {
        const url = book.spine.get(index)?.url;
        const markup = url ? await book.archive.getText(url) : "";
        if (this.closed) return;
        chars.set(index, textLength(markup));
      }
      this.sectionChars = chars;
      this.updateCount();
    } catch {
      // Without text lengths the count stays a rough estimate; reading still works.
    }
  }

  /** Book text follows the reader's theme colors (read from the page container). */
  private updateTheme(container: HTMLElement): void {
    const style = getComputedStyle(container);
    const accent = style.getPropertyValue("--accent").trim() || style.color;
    const css =
      // Matching color-scheme keeps Chrome from painting an opaque backdrop behind the iframe.
      `:root { color-scheme: ${style.colorScheme || "normal"}; }` +
      `html, body, body * { color: ${style.color} !important; background-color: transparent !important; ` +
      `border-color: ${style.color} !important; }` +
      `a, a * { color: ${accent} !important; }`;
    if (css === this.themeCss) return;
    this.themeCss = css;
    // Only the currently loaded sections; others get the theme via the content hook.
    const loaded: unknown = this.rendition?.getContents();
    for (const contents of Array.isArray(loaded) ? loaded : [loaded]) {
      const doc = documentOf(contents);
      if (doc) this.applyTheme(doc);
    }
  }

  private applyTheme(doc: Document): void {
    let style = doc.getElementById("reader-theme");
    if (!style) {
      style = doc.createElement("style");
      style.id = "reader-theme";
      doc.head.append(style);
    }
    style.textContent = this.themeCss;
  }
}

/**
 * Extrapolates the screens measured in visited sections to the whole book, using
 * each section's text length as the scale. Undefined until a text section was measured.
 */
export function estimatePages(
  sections: readonly number[],
  chars: ReadonlyMap<number, number>,
  screens: ReadonlyMap<number, number>,
): number | undefined {
  let sampleScreens = 0;
  let sampleChars = 0;
  for (const [section, total] of screens) {
    const length = chars.get(section) ?? 0;
    if (length >= MIN_SAMPLE_CHARS) {
      sampleScreens += total;
      sampleChars += length;
    }
  }
  if (sampleChars === 0) return undefined;
  const screensPerChar = sampleScreens / sampleChars;
  let estimate = 0;
  for (const section of sections) {
    estimate += screens.get(section) ?? Math.max(1, Math.round((chars.get(section) ?? 0) * screensPerChar));
  }
  return estimate;
}

/** Approximate visible text length of an (X)HTML document: markup and whitespace runs removed. */
export function textLength(markup: string): number {
  return markup
    .replace(/<(script|style)\b[^>]*?(\/>|>[\s\S]*?<\/\1>)/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Blob URLs epub.js created for the book's resources. It never revokes them itself
 * (Archive.destroy iterates the cache keys instead of the URLs), so close() does.
 */
function blobUrlsOf(book: Book): string[] {
  // Internal fields, not part of the published typings.
  const candidates: unknown[] = [];
  const replacements = field(field(book, "resources"), "replacementUrls");
  if (Array.isArray(replacements)) candidates.push(...replacements);
  const cache = field(field(book, "archive"), "urlCache");
  if (typeof cache === "object" && cache !== null) candidates.push(...Object.values(cache));
  return candidates.filter((url): url is string => typeof url === "string" && url.startsWith("blob:"));
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** The iframe document of an epub.js Contents object (cross-realm, so no instanceof). */
function documentOf(contents: unknown): Document | undefined {
  if (typeof contents !== "object" || contents === null || !("document" in contents)) return undefined;
  const doc: unknown = contents.document;
  return typeof doc === "object" && doc !== null && "getElementById" in doc && "head" in doc
    ? (doc as Document)
    : undefined;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    // The timeout covers throttled background tabs, where frames may never come.
    const timer = window.setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Current location after a navigation. epub.js computes positions from the scrolled
 * view in a later animation frame, so wait two frames and ask the view manager directly
 * instead of relying on the "relocated" event, which doesn't fire on every chapter change.
 */
async function settledLocation(rendition: Rendition): Promise<Location | undefined> {
  await nextFrame();
  await nextFrame();
  const location: unknown = rendition.currentLocation();
  return isLocation(location) ? location : undefined;
}

function isLocation(value: unknown): value is Location {
  return typeof value === "object" && value !== null && "start" in value && "end" in value;
}

export default function createAdapter(): EpubAdapter {
  return new EpubAdapter();
}
