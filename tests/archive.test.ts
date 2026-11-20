import { beforeEach, describe, expect, it, vi } from "vitest";

// libarchive needs a real module worker and WebAssembly; mock its small API surface.
interface FakeReader {
  hasEncryptedData: () => Promise<boolean | null>;
  getFilesArray: () => Promise<unknown[]>;
  close: ReturnType<typeof vi.fn>;
}

const libarchive = vi.hoisted(() => ({
  Archive: { init: vi.fn(), open: vi.fn<(file: File) => Promise<FakeReader>>() },
}));
vi.mock("libarchive.js", () => libarchive);

const { ArchiveAdapter, MAX_ARCHIVE_BYTES } = await import("../src/reader/adapters/archive");

function entry(path: string, name: string, extract: () => Promise<File> = async () => new File(["x"], name)): unknown {
  return { path, file: { name, extract } };
}

function reader(files: unknown[], encrypted: boolean | null = false): FakeReader {
  return {
    hasEncryptedData: async () => encrypted,
    getFilesArray: async () => files,
    close: vi.fn(async () => {}),
  };
}

class InspectableArchive extends ArchiveAdapter {
  listForTest(): Promise<Array<{ path: string; read(): Promise<unknown> }>> {
    return this.listPages(new File(["data"], "test.cbr"));
  }
}

describe("ArchiveAdapter", () => {
  beforeEach(() => {
    // Braces matter: a function returned from beforeEach runs as teardown.
    libarchive.Archive.open.mockReset();
  });

  it("lists images with their folder path, naturally sorted, without metadata", async () => {
    libarchive.Archive.open.mockResolvedValue(
      reader([
        entry("issue/", "10.jpg"),
        entry("issue/", "2.JPG"),
        entry("", "ComicInfo.xml"),
        entry("__MACOSX/issue/", "._2.jpg"),
        entry("./issue/", "1.png"),
        { broken: true },
      ]),
    );
    const pages = await new InspectableArchive().listForTest();
    expect(pages.map((p) => p.path)).toEqual(["./issue/1.png", "issue/2.JPG", "issue/10.jpg"]);
  });

  it("rejects encrypted archives with a readable message", async () => {
    libarchive.Archive.open.mockResolvedValue(reader([entry("", "1.jpg")], true));
    const adapter = new ArchiveAdapter();
    await expect(adapter.open(new File(["x"], "geheim.cbr"))).rejects.toThrow("passwortgeschützt");
  });

  it("rejects archives over the size limit before starting a worker", async () => {
    const huge = new File(["x"], "riesig.cbr");
    Object.defineProperty(huge, "size", { value: MAX_ARCHIVE_BYTES + 1 });
    await expect(new ArchiveAdapter().open(huge)).rejects.toThrow("zu groß");
    expect(libarchive.Archive.open).not.toHaveBeenCalled();
  });

  it("maps open failures to a ReaderError", async () => {
    libarchive.Archive.open.mockImplementation(() => Promise.reject(new Error("Unrecognized archive format")));
    await expect(new ArchiveAdapter().open(new File(["x"], "kaputt.cbr"))).rejects.toThrow("kein lesbares Archiv");
  });

  it("restarts the worker and retries once when an extraction fails", async () => {
    const failing = reader([entry("", "1.jpg", () => Promise.reject(new Error("Unable to allocate memory")))]);
    const fresh = reader([entry("", "1.jpg", async () => new File(["ok"], "1.jpg"))]);
    libarchive.Archive.open.mockResolvedValueOnce(failing).mockResolvedValueOnce(fresh);
    const pages = await new InspectableArchive().listForTest();
    const data = await pages[0]?.read();
    expect(data).toBeInstanceOf(File);
    expect(failing.close).toHaveBeenCalled();
    expect(libarchive.Archive.open).toHaveBeenCalledTimes(2);
  });

  it("lets a request still queued in the old worker join the restart instead of hanging", async () => {
    // Page 2's extraction never answers: its worker gets terminated by the restart.
    const failing = reader([
      entry("", "1.jpg", () => Promise.reject(new Error("Unable to allocate memory"))),
      entry("", "2.jpg", () => new Promise<File>(() => {})),
    ]);
    const fresh = reader([entry("", "1.jpg"), entry("", "2.jpg", async () => new File(["two"], "2.jpg"))]);
    libarchive.Archive.open.mockResolvedValueOnce(failing).mockResolvedValueOnce(fresh);
    const pages = await new InspectableArchive().listForTest();
    const pending = pages[1]?.read();
    const first = pages[0]?.read();
    await expect(first).resolves.toBeInstanceOf(File);
    await expect(pending).resolves.toBeInstanceOf(File);
    // Both failures shared one restart.
    expect(libarchive.Archive.open).toHaveBeenCalledTimes(2);
  });

  it("restarts after a WebAssembly trap", async () => {
    const trap = Object.assign(new Error("table index is out of bounds"), { name: "RuntimeError" });
    const crashed = reader([entry("", "1.jpg", () => Promise.reject(trap))]);
    libarchive.Archive.open.mockResolvedValueOnce(crashed).mockResolvedValueOnce(reader([entry("", "1.jpg")]));
    const pages = await new InspectableArchive().listForTest();
    await expect(pages[0]?.read()).resolves.toBeInstanceOf(File);
    expect(crashed.close).toHaveBeenCalled();
  });

  it("does not restart for errors a fresh worker can't fix", async () => {
    const corrupt = reader([entry("", "1.jpg", () => Promise.reject(new Error("CRC failed")))]);
    libarchive.Archive.open.mockResolvedValueOnce(corrupt);
    const pages = await new InspectableArchive().listForTest();
    await expect(pages[0]?.read()).rejects.toThrow("CRC failed");
    expect(libarchive.Archive.open).toHaveBeenCalledTimes(1);
    expect(corrupt.close).not.toHaveBeenCalled();
  });

  it("closes a session that finishes restarting after close()", async () => {
    const failing = reader([entry("", "1.jpg", () => Promise.reject(new Error("Unable to allocate memory")))]);
    const late = reader([entry("", "1.jpg")]);
    let resolveRestart: (r: FakeReader) => void = () => {};
    libarchive.Archive.open
      .mockResolvedValueOnce(failing)
      .mockReturnValueOnce(new Promise<FakeReader>((r) => (resolveRestart = r)));
    const adapter = new InspectableArchive();
    const pages = await adapter.listForTest();
    const reading = pages[0]?.read();
    await vi.waitFor(() => expect(libarchive.Archive.open).toHaveBeenCalledTimes(2));
    adapter.close();
    resolveRestart(late);
    await expect(reading).rejects.toThrow();
    expect(late.close).toHaveBeenCalledTimes(1);
  });

  it("waits for a running restart when a page is requested meanwhile", async () => {
    const failing = reader([
      entry("", "1.jpg", () => Promise.reject(new Error("Unable to allocate memory"))),
      entry("", "2.jpg"),
    ]);
    const fresh = reader([entry("", "1.jpg"), entry("", "2.jpg", async () => new File(["two"], "2.jpg"))]);
    let resolveRestart: (r: FakeReader) => void = () => {};
    libarchive.Archive.open
      .mockResolvedValueOnce(failing)
      .mockReturnValueOnce(new Promise<FakeReader>((r) => (resolveRestart = r)));
    const pages = await new InspectableArchive().listForTest();
    const first = pages[0]?.read();
    await vi.waitFor(() => expect(libarchive.Archive.open).toHaveBeenCalledTimes(2));
    const second = pages[1]?.read(); // Requested while the restart is running.
    resolveRestart(fresh);
    await expect(first).resolves.toBeInstanceOf(File);
    await expect(second).resolves.toBeInstanceOf(File);
  });

  it("closes the new session when close() runs while the restart lists files", async () => {
    const failing = reader([entry("", "1.jpg", () => Promise.reject(new Error("Unable to allocate memory")))]);
    let resolveListing: (files: unknown[]) => void = () => {};
    const fresh: FakeReader = {
      hasEncryptedData: async () => false,
      getFilesArray: () => new Promise((r) => (resolveListing = r)),
      close: vi.fn(async () => {}),
    };
    libarchive.Archive.open.mockResolvedValueOnce(failing).mockResolvedValueOnce(fresh);
    const adapter = new InspectableArchive();
    const pages = await adapter.listForTest();
    const reading = pages[0]?.read();
    await vi.waitFor(() => expect(libarchive.Archive.open).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    adapter.close();
    resolveListing([entry("", "1.jpg")]);
    await expect(reading).rejects.toThrow();
    expect(fresh.close).toHaveBeenCalledTimes(1);
  });

  it("retries a failed restart on the next page request", async () => {
    const failing = reader([
      entry("", "1.jpg", () => Promise.reject(new Error("Unable to allocate memory"))),
      entry("", "2.jpg"),
    ]);
    const fresh = reader([entry("", "1.jpg"), entry("", "2.jpg", async () => new File(["two"], "2.jpg"))]);
    libarchive.Archive.open
      .mockResolvedValueOnce(failing)
      .mockImplementationOnce(() => Promise.reject(new Error("worker crashed")))
      .mockResolvedValueOnce(fresh);
    const pages = await new InspectableArchive().listForTest();
    await expect(pages[0]?.read()).rejects.toThrow();
    await expect(pages[1]?.read()).resolves.toBeInstanceOf(File);
    expect(libarchive.Archive.open).toHaveBeenCalledTimes(3);
  });

  it("closes the worker on close() and when closed while opening", async () => {
    const opened = reader([entry("", "1.jpg")]);
    libarchive.Archive.open.mockResolvedValue(opened);
    const adapter = new ArchiveAdapter();
    await adapter.open(new File(["x"], "a.cbr"));
    adapter.close();
    expect(opened.close).toHaveBeenCalledTimes(1);

    let resolveOpen: (r: FakeReader) => void = () => {};
    const late = reader([entry("", "1.jpg")]);
    libarchive.Archive.open.mockReturnValue(new Promise((r) => (resolveOpen = r)));
    const slow = new ArchiveAdapter();
    const opening = slow.open(new File(["x"], "b.cbr"));
    slow.close();
    resolveOpen(late);
    await opening;
    expect(late.close).toHaveBeenCalledTimes(1);
  });
});
