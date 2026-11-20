import type { FormatEntry } from "../reader/registry";
import { ReaderError, type ReaderAdapter } from "../reader/types";

export type ViewerStatus = "empty" | "loading" | "ready" | "error";

export interface ViewerState {
  status: ViewerStatus;
  fileName: string;
  /** Zero-based index of the current page. */
  page: number;
  pageCount: number;
  /** Message for status "error", or for a single page that failed to render. */
  message: string;
}

interface OpenDocument {
  adapter: ReaderAdapter;
  element: HTMLElement;
  rendering: boolean;
  renderRequested: boolean;
}

const EMPTY_STATE: ViewerState = { status: "empty", fileName: "", page: 0, pageCount: 0, message: "" };

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
    this.setState({ status: "loading", fileName: file.name, page: 0, pageCount: 0, message: "" });
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

      adapter.onPageCountChange?.((newCount) => {
        if (generation !== this.generation || newCount < 1) return;
        const page = Math.min(this.state.page, newCount - 1);
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

      this.setState({ status: "ready", pageCount: count });
      this.requestRender();
    } catch (error) {
      if (adapter) safeClose(adapter);
      if (generation !== this.generation) return;
      this.fail(userMessage(error, `„${file.name}“ konnte nicht geöffnet werden. Die Datei ist möglicherweise beschädigt.`));
    }
  }

  next(): void {
    this.goTo(this.state.page + 1);
  }

  prev(): void {
    this.goTo(this.state.page - 1);
  }

  goTo(index: number): void {
    if (this.state.status !== "ready") return;
    const target = Math.max(0, Math.min(index, this.state.pageCount - 1));
    if (target === this.state.page) return;
    this.setState({ page: target, message: "" });
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
        try {
          await doc.adapter.renderPage(index, doc.element);
          if (doc === this.doc && index === this.failedPage) this.setState({ message: "" });
        } catch (error) {
          if (doc === this.doc && index === this.state.page) {
            this.setState({ message: userMessage(error, `Seite ${index + 1} konnte nicht angezeigt werden.`) });
            this.failedPage = index;
          }
        }
      }
    } finally {
      doc.rendering = false;
    }
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
    this.state = { ...this.state, ...patch };
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
