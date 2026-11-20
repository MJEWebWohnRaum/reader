import {
  GlobalWorkerOptions,
  getDocument,
  InvalidPDFException,
  PasswordException,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ReaderError, type ReaderAdapter } from "../types";

GlobalWorkerOptions.workerSrc = workerUrl;

// Copied to public/pdfjs by scripts/copy-pdf-assets.mjs; must be absolute for the worker.
const assetUrl = (folder: string): string => new URL(`pdfjs/${folder}/`, document.baseURI).href;

// Keeps huge pages (posters, high-DPI displays) from exhausting canvas memory.
const MAX_CANVAS_PIXELS = 16_777_216;

export class PdfAdapter implements ReaderAdapter {
  private loadingTask: PDFDocumentLoadingTask | undefined;
  private pdf: PDFDocumentProxy | undefined;
  private renderTask: RenderTask | undefined;
  private closed = false;

  async open(file: File): Promise<void> {
    const data = new Uint8Array(await file.arrayBuffer());
    if (this.closed) return;
    this.loadingTask = getDocument({
      data,
      cMapUrl: assetUrl("cmaps"),
      standardFontDataUrl: assetUrl("standard_fonts"),
      wasmUrl: assetUrl("wasm"),
      iccUrl: assetUrl("iccs"),
      enableXfa: false,
    });
    try {
      const pdf = await this.loadingTask.promise;
      if (this.closed) return;
      this.pdf = pdf;
    } catch (error) {
      if (error instanceof PasswordException) {
        throw new ReaderError(`„${file.name}“ ist passwortgeschützt. Das wird noch nicht unterstützt.`, { cause: error });
      }
      if (error instanceof InvalidPDFException) {
        throw new ReaderError(`„${file.name}“ ist keine gültige PDF-Datei oder beschädigt.`, { cause: error });
      }
      throw error;
    }
  }

  pageCount(): number {
    return this.pdf?.numPages ?? 0;
  }

  async renderPage(index: number, container: HTMLElement): Promise<void> {
    const pdf = this.pdf;
    if (!pdf || this.closed) return;
    const page = await pdf.getPage(index + 1);
    if (this.closed) return;

    const base = page.getViewport({ scale: 1 });
    const fit = Math.min(container.clientWidth / base.width, container.clientHeight / base.height);
    const cssScale = Number.isFinite(fit) && fit > 0 ? fit : 1;
    const dpr = window.devicePixelRatio || 1;
    const maxScale = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height));
    const viewport = page.getViewport({ scale: Math.min(cssScale * dpr, maxScale) });

    // Render off-screen first so the previous page stays visible until the new one is ready.
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
    canvas.style.height = `${Math.floor(base.height * cssScale)}px`;

    const task = page.render({ canvas, viewport });
    this.renderTask = task;
    try {
      await task.promise;
    } finally {
      if (this.renderTask === task) this.renderTask = undefined;
      page.cleanup();
    }
    if (this.closed) return;
    container.replaceChildren(canvas);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.renderTask?.cancel();
    this.renderTask = undefined;
    this.pdf = undefined;
    // Destroying the loading task also destroys the document and terminates the worker.
    void this.loadingTask?.destroy().catch(() => {});
    this.loadingTask = undefined;
  }
}

export default function createAdapter(): PdfAdapter {
  return new PdfAdapter();
}
