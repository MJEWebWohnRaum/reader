import type { FormatEntry } from "../reader/registry";
import { ReaderError, type ReaderAdapter, type ViewOptions } from "../reader/types";

export type ViewerStatus = "empty" | "loading" | "ready" | "error";

export interface ViewerState {
  status: ViewerStatus;
  fileName: string;
  /** Zero-based index of the current page (the left one in a double page). */
  page: number;
  /** Last visible page: `page + 1` in a double page, otherwise `page`. */
  pageEnd: number;
  pageCount: number;
  /** The open format lays out text itself and honours font size and text width. */
  textOptions: boolean;
  /** Message for status "error", or for a single page that failed to render. */
  message: string;
}

interface OpenDocument {
  adapter: ReaderAdapter;
  element: HTMLElement;
  rendering: boolean;
  renderRequested: boolean;
}

const EMPTY_STATE: ViewerState = {
  status: "empty",
  fileName: "",
  page: 0,
  pageEnd: 0,
  pageCount: 0,
  textOptions: false,
  message: "",
};

/** First page of the double page containing `page`: the cover stands alone, then 2+3, 4+5 … */
export function spreadStart(page: number): number {
  return page <= 0 ? 0 : page % 2 === 1 ? page : page - 1;
}

/** Pages shown together, starting at `start` (a spread start). */
export function spreadPages(start: number, pageCount: number): number[] {
  return start === 0 || start + 1 >= pageCount ? [start] : [start, start + 1];
}

/**
 * Owns the currently open document: page index, rendering and cleanup.
 * Renders are serialized per document; rapid page turns collapse into one
 * render of the latest page instead of overlapping renders.
 */
export class Viewer {
  private doc: OpenDocument | undefined;
  private generation = 0;
  private state: ViewerState = { ...EMPTY_STATE };
  /** Page whose render error is currently shown, so a later success can clear it. */
  private failedPage: number | undefined;

  constructor(
    private readonly host: HTMLElement,
    private readonly resolveFormat: (file: File) => FormatEntry | undefined,
    private readonly onChange: (state: Readonly<ViewerState>) => void,
    private options: ViewOptions = { doublePage: false, textScale: 1, textWidth: "medium" },
  ) {}

  getState(): Readonly<ViewerState> {
    return this.state;
  }

  async open(file: File): Promise<void> {
    const format = this.resolveFormat(file);
    const unsupported = `„${file.name}“ hat ein nicht unterstütztes Format.`;
    if (!format && this.doc) {
      // Keep the open document; a wrongly dropped file shouldn't close it.
      this.setState({ message: unsupported });
      return;
    }

    const generation = ++this.generation;
    this.disposeDocument();
    this.setState({ status: "loading", fileName: file.name, page: 0, pageCount: 0, textOptions: false, message: "" });
    if (!format) {
      this.fail(unsupported);
      return;
    }

    let adapter: ReaderAdapter | undefined;
    try {
      adapter = await format.load();
      await adapter.open(file);
      if (generation !== this.generation) {
        safeClose(adapter);
        return;
      }
      const count = adapter.pageCount();
      if (count < 1) throw new ReaderError(`„${file.name}“ enthält keine anzeigbaren Seiten.`);

      const element = document.createElement("div");
      element.className = "document";
      this.host.append(element);
      this.doc = { adapter, element, rendering: false, renderRequested: false };

      adapter.setViewOptions?.(this.options);
      adapter.onPageCountChange?.((newCount) => {
        if (generation !== this.generation || newCount < 1) return;
        const page = this.normalize(Math.min(this.state.page, newCount - 1));
        const pageChanged = page !== this.state.page;
        this.setState({ pageCount: newCount, page });
        if (pageChanged) this.requestRender();
      });
      adapter.onPageChange?.((index) => {
        // A page turn queued meanwhile wins; the adapter will report again if needed.
        if (generation !== this.generation || this.doc?.renderRequested) return;
        const page = Math.max(0, Math.min(index, this.state.pageCount - 1));
        // Only the indicator follows; the adapter already shows this page.
        if (page !== this.state.page) this.setState({ page });
      });

      this.setState({ status: "ready", pageCount: count, textOptions: adapter.setViewOptions !== undefined });
      this.requestRender();
    } catch (error) {
      if (adapter) safeClose(adapter);
      if (generation !== this.generation) return;
      this.fail(userMessage(error, `„${file.name}“ konnte nicht geöffnet werden. Die Datei ist möglicherweise beschädigt.`));
    }
  }

  next(): void {
    const { page, pageEnd, pageCount } = this.state;
    if (pageEnd + 1 < pageCount) this.goTo(this.pairing() ? pageEnd + 1 : page + 1);
  }

  prev(): void {
    const page = this.state.page;
    this.goTo(this.pairing() ? spreadStart(page - 1) : page - 1);
  }

  goTo(index: number): void {
    if (this.state.status !== "ready") return;
    const target = this.normalize(Math.max(0, Math.min(index, this.state.pageCount - 1)));
    if (target === this.state.page) return;
    this.setState({ page: target, message: "" });
    this.requestRender();
  }

  /** Applies new display settings to the open document (and to documents opened later). */
  setViewOptions(options: ViewOptions): void {
    const wasPairing = this.pairing();
    this.options = options;
    const doc = this.doc;
    if (!doc || this.state.status !== "ready") return;
    if (doc.adapter.setViewOptions) {
      doc.adapter.setViewOptions(options);
    } else if (wasPairing !== this.pairing()) {
      // The old view stays until the new one is rendered (see renderSpread / renderPage).
      this.setState({ page: this.normalize(this.state.page) });
    }
    this.requestRender();
  }

  /** Re-renders the current page, e.g. after the window was resized. */
  refresh(): void {
    if (this.state.status === "ready") this.requestRender();
  }

  close(): void {
    this.generation++;
    this.disposeDocument();
    this.setState({ ...EMPTY_STATE });
  }

  private requestRender(): void {
    const doc = this.doc;
    if (!doc) return;
    doc.renderRequested = true;
    if (!doc.rendering) void this.renderLoop(doc);
  }

  private async renderLoop(doc: OpenDocument): Promise<void> {
    doc.rendering = true;
    try {
      while (doc.renderRequested && doc === this.doc) {
        doc.renderRequested = false;
        const index = this.state.page;
        // The page whose rendering failed, if any (in a double page, possibly the right one).
        let failed: { page: number; error: unknown } | undefined;
        try {
          if (this.pairing()) failed = await this.renderSpread(doc, spreadPages(index, this.state.pageCount));
          else await doc.adapter.renderPage(index, doc.element);
        } catch (error) {
          failed = { page: index, error };
        }
        if (doc !== this.doc) continue;
        if (failed && index === this.state.page) {
          this.setState({ message: userMessage(failed.error, `Seite ${failed.page + 1} konnte nicht angezeigt werden.`) });
          this.failedPage = index;
        } else if (!failed && index === this.failedPage) {
          this.setState({ message: "" });
        }
      }
    } finally {
      doc.rendering = false;
    }
  }

  /**
   * Two pages side by side in their own slots; a single page (cover, last page) is
   * centered. The new pair is rendered hidden but laid out (PDF pages are fitted to
   * their slot) and only then replaces the old view, so both pages change together.
   * A page that fails to render leaves its slot empty; the other page is still shown.
   */
  private async renderSpread(
    doc: OpenDocument,
    pages: number[],
  ): Promise<{ page: number; error: unknown } | undefined> {
    const [first, second] = pages;
    if (first === undefined) return undefined;
    const pair = document.createElement("div");
    pair.className = second === undefined ? "spread-pair single pending" : "spread-pair pending";
    const left = document.createElement("div");
    left.className = "page-slot left";
    const right = document.createElement("div");
    right.className = "page-slot right";
    pair.append(left, right);
    doc.element.append(pair);
    let failed: { page: number; error: unknown } | undefined;
    for (const [page, slot] of [[first, left], [second, right]] as const) {
      if (page === undefined || doc !== this.doc) continue;
      try {
        await doc.adapter.renderPage(page, slot);
      } catch (error) {
        slot.replaceChildren();
        failed ??= { page, error };
      }
    }
    // Replace whatever was shown before: an older pair or a single page.
    for (const old of [...doc.element.children]) if (old !== pair) old.remove();
    pair.classList.remove("pending");
    return failed;
  }

  /** Whether the viewer pairs pages itself (double page for fixed-layout formats). */
  private pairing(): boolean {
    return this.options.doublePage && this.doc !== undefined && this.doc.adapter.setViewOptions === undefined;
  }

  private normalize(page: number): number {
    return this.pairing() ? spreadStart(page) : page;
  }

  private disposeDocument(): void {
    const doc = this.doc;
    if (!doc) return;
    this.doc = undefined;
    doc.element.remove();
    safeClose(doc.adapter);
  }

  private fail(message: string): void {
    this.setState({ status: "error", page: 0, pageCount: 0, message });
  }

  private setState(patch: Partial<ViewerState>): void {
    // Any new message replaces a shown page error.
    if (patch.message !== undefined) this.failedPage = undefined;
    const next = { ...this.state, ...patch };
    const shown = this.pairing() && next.status === "ready" ? spreadPages(next.page, next.pageCount) : [next.page];
    next.pageEnd = shown.at(-1) ?? next.page;
    this.state = next;
    this.onChange(this.state);
  }
}

function safeClose(adapter: ReaderAdapter): void {
  try {
    adapter.close();
  } catch (error) {
    // A failing cleanup must not block error reporting or opening the next file.
    console.error(error);
  }
}

function userMessage(error: unknown, fallback: string): string {
  if (error instanceof ReaderError) return error.message;
  console.error(error);
  return fallback;
}
