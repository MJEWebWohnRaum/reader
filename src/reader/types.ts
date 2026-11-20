/**
 * Common interface for every document format. The UI only knows this type.
 *
 * Contract for implementations:
 * - `pageCount()` must return >= 1 right after `open()` resolves, otherwise the
 *   document counts as empty. Slow formats return a provisional value and correct
 *   it later via `onPageCountChange`.
 * - `renderPage` fully replaces the container's content. It may be called again
 *   for the same page (e.g. after a resize). The container is attached to the DOM
 *   and sized before the first call. Calls are never concurrent.
 * - `close()` may be called at any time: while `open()` or `renderPage()` is still
 *   running, and after a failed `open()`. It must release all resources (object
 *   URLs, workers, render tasks) and should not throw.
 */
export interface ReaderAdapter {
  open(file: File): Promise<void>;
  pageCount(): number;
  renderPage(index: number, container: HTMLElement): Promise<void>;
  close(): void;
  /** Reflowable formats (EPUB) report page count changes, e.g. after layout or resize. */
  onPageCountChange?(listener: (count: number) => void): void;
}

export type AdapterFactory = () => Promise<ReaderAdapter>;

/** Error whose message is safe to show to the user as-is. */
export class ReaderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReaderError";
  }
}
