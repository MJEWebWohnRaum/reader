import { beforeEach, describe, expect, it, vi } from "vitest";

// pdf.js needs a real worker and canvas; mock just enough to test the adapter's logic.
const pdfjs = vi.hoisted(() => {
  class InvalidPDFException extends Error {}
  class PasswordException extends Error {}
  return {
    InvalidPDFException,
    PasswordException,
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: vi.fn(),
  };
});
vi.mock("pdfjs-dist", () => pdfjs);

const { PdfAdapter } = await import("../src/reader/adapters/pdf");
const { ReaderError } = await import("../src/reader/types");

function loadingTask(promise: Promise<unknown>): { promise: Promise<unknown>; destroy: ReturnType<typeof vi.fn> } {
  promise.catch(() => {});
  return { promise, destroy: vi.fn(() => Promise.resolve()) };
}

const pdfFile = (): File => new File(["%PDF-1.7"], "test.pdf");

describe("PdfAdapter", () => {
  beforeEach(() => {
    pdfjs.getDocument.mockReset();
  });

  it("opens a document and reports its page count", async () => {
    pdfjs.getDocument.mockReturnValue(loadingTask(Promise.resolve({ numPages: 12 })));
    const adapter = new PdfAdapter();
    await adapter.open(pdfFile());
    expect(adapter.pageCount()).toBe(12);
    const options = pdfjs.getDocument.mock.calls[0]?.[0] as Record<string, unknown>;
    // Runtime data must come from the app itself, never from a CDN.
    for (const key of ["cMapUrl", "standardFontDataUrl", "wasmUrl", "iccUrl"]) {
      expect(new URL(String(options[key])).origin).toBe(window.location.origin);
    }
  });

  it("maps invalid and password-protected PDFs to readable errors", async () => {
    pdfjs.getDocument.mockReturnValue(loadingTask(Promise.reject(new pdfjs.InvalidPDFException("bad"))));
    const invalid = new PdfAdapter().open(pdfFile());
    await expect(invalid).rejects.toBeInstanceOf(ReaderError);
    await expect(invalid).rejects.toThrow("keine gültige PDF");

    pdfjs.getDocument.mockReturnValue(loadingTask(Promise.reject(new pdfjs.PasswordException("pw"))));
    await expect(new PdfAdapter().open(pdfFile())).rejects.toThrow("passwortgeschützt");
  });

  it("does not keep the document when closed during open", async () => {
    let resolve: (doc: unknown) => void = () => {};
    const task = loadingTask(new Promise((r) => (resolve = r)));
    pdfjs.getDocument.mockReturnValue(task);
    const adapter = new PdfAdapter();
    const opening = adapter.open(pdfFile());
    await vi.waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalled());
    adapter.close();
    resolve({ numPages: 3 });
    await opening;
    expect(adapter.pageCount()).toBe(0);
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(() => adapter.close()).not.toThrow();
  });

  it("close() is safe after a failed open", async () => {
    pdfjs.getDocument.mockReturnValue(loadingTask(Promise.reject(new pdfjs.InvalidPDFException("bad"))));
    const adapter = new PdfAdapter();
    await adapter.open(pdfFile()).catch(() => {});
    expect(() => adapter.close()).not.toThrow();
  });
});
