import { Archive } from "libarchive.js";
import type { ArchiveReader } from "libarchive.js/dist/build/compiled/archive-reader";
import { ComicAdapter, selectPages, type ComicPage } from "../comic";
import { ReaderError } from "../types";

// Copied to public/libarchive by scripts/copy-runtime-assets.mjs; the worker loads
// libarchive.wasm relative to its own URL. (Vite still emits libarchive's default
// worker into assets/; it is never loaded because getWorker is overridden.)
const WORKER_URL = new URL("libarchive/worker-bundle.js", document.baseURI).href;

// libarchive.js hands out its worker only after a successful open, but failures
// and memory errors need the worker itself. Archive.open() calls getWorker
// synchronously, so openSession() installs this callback right before calling it.
let onWorkerCreated: ((worker: Worker) => void) | undefined;
Archive.init({
  getWorker: () => {
    const worker = new Worker(WORKER_URL, { type: "module" });
    onWorkerCreated?.(worker);
    return worker;
  },
});

// libarchive.js copies the whole archive into WebAssembly memory, which this build
// caps at 2 GB; extraction needs headroom on top. Larger files fail inside the worker.
export const MAX_ARCHIVE_BYTES = 1.5 * 1024 ** 3;
// Opening only copies the file into the worker; minutes mean the worker is stuck.
const OPEN_TIMEOUT_MS = 120_000;

const sizeFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** Rejects pending calls of a worker that was terminated or crashed. */
class SessionEnded extends Error {
  constructor() {
    super("Archive worker ended");
  }
}

/**
 * One libarchive worker with the archive loaded. Comlink calls to a terminated
 * worker never settle, so every call is raced against `ended`, which rejects when
 * the session is closed (restart, close) or the worker reports an error.
 */
class Session {
  readonly extractors = new Map<string, () => Promise<unknown>>();
  private readonly ended: Promise<never>;
  private end: (reason: Error) => void = () => {};

  constructor(
    readonly reader: ArchiveReader,
    private readonly worker: Worker | undefined,
  ) {
    this.ended = new Promise<never>((_, reject) => (this.end = reject));
    this.ended.catch(() => {}); // Only meaningful while a call races against it.
    worker?.addEventListener("error", this.onWorkerError);
  }

  run<T>(call: Promise<T>): Promise<T> {
    return Promise.race([call, this.ended]);
  }

  close(): void {
    this.worker?.removeEventListener("error", this.onWorkerError);
    this.end(new SessionEnded());
    // Terminates the worker, which frees its WebAssembly memory.
    void this.reader.close();
  }

  private readonly onWorkerError = (): void => this.end(new SessionEnded());
}

/** Comic archives read through libarchive (WASM): CBR now, CB7/CBT later. */
export class ArchiveAdapter extends ComicAdapter {
  private session: Session | undefined;
  private file: File | undefined;
  private restarting: Promise<void> | undefined;

  protected async listPages(file: File): Promise<ComicPage[]> {
    if (file.size > MAX_ARCHIVE_BYTES) {
      const gb = sizeFormat.format(file.size / 1024 ** 3);
      const max = sizeFormat.format(MAX_ARCHIVE_BYTES / 1024 ** 3);
      throw new ReaderError(`„${file.name}“ ist mit ${gb} GB zu groß. Comic-Archive bis ${max} GB werden unterstützt.`);
    }

    let session: Session;
    try {
      session = await openSession(file);
    } catch (error) {
      throw new ReaderError(`„${file.name}“ ist kein lesbares Archiv oder beschädigt.`, { cause: error });
    }
    if (this.closed) {
      // close() ran while the worker was starting; it couldn't release this session yet.
      session.close();
      return [];
    }
    this.session = session;
    this.file = file;

    let listing: unknown[];
    try {
      if (await session.run(session.reader.hasEncryptedData())) {
        throw new ReaderError(`„${file.name}“ ist passwortgeschützt. Das wird nicht unterstützt.`);
      }
      listing = await session.run(session.reader.getFilesArray());
    } catch (error) {
      if (error instanceof ReaderError) throw error;
      throw new ReaderError(`„${file.name}“ ist kein lesbares Archiv oder beschädigt.`, { cause: error });
    }

    const entries = indexEntries(session, listing);
    return selectPages(entries).map(({ path, type }) => ({ path, type, read: () => this.extract(path) }));
  }

  protected override releaseArchive(): void {
    this.session?.close();
    this.session = undefined;
    this.file = undefined;
  }

  /**
   * Extracts one page. For large archives the archive itself fills most of
   * libarchive's 2 GB WebAssembly memory, and repeated extractions can exhaust it.
   * Then a fresh worker (fresh memory) is started and the page retried once.
   */
  private async extract(path: string): Promise<Blob> {
    const session = await this.currentSession();
    try {
      return await extractFrom(session, path);
    } catch (error) {
      if (this.closed || !this.file || !isRecoverable(error)) throw error;
      await this.restart(this.file, session);
      return await extractFrom(await this.currentSession(), path);
    }
  }

  /** The live session; waits for a running restart and retries a failed one once. */
  private async currentSession(): Promise<Session> {
    if (!this.session && this.restarting) await this.restarting.catch(() => {});
    if (!this.session && !this.closed && this.file) {
      // An earlier restart failed; give it another chance for this page.
      await this.restart(this.file, undefined).catch(() => {});
    }
    if (this.closed) throw new ReaderError("Das Archiv ist bereits geschlossen.");
    const session = this.session;
    if (!session) throw new ReaderError("Das Archiv konnte nicht erneut geladen werden. Bitte die Datei neu öffnen.");
    return session;
  }

  /** Replaces `failed` (or a missing session) with a fresh worker. */
  private restart(file: File, failed: Session | undefined): Promise<void> {
    // Someone else already replaced the failed session (or is doing so right now).
    if (this.session !== failed) return this.restarting ?? Promise.resolve();
    // Concurrent failures (render + prefetch) share one restart.
    this.restarting ??= (async () => {
      this.session = undefined;
      failed?.close(); // Rejects the other pending calls, which then wait for this restart.
      const session = await openSession(file);
      try {
        if (!this.closed) indexEntries(session, await session.run(session.reader.getFilesArray()));
      } catch (error) {
        session.close();
        throw error;
      }
      // close() may have run at any point above; it couldn't see this session.
      if (this.closed) session.close();
      else this.session = session;
    })().finally(() => {
      this.restarting = undefined;
    });
    return this.restarting;
  }
}

async function extractFrom(session: Session, path: string): Promise<Blob> {
  const extract = session.extractors.get(path);
  if (!extract) throw new ReaderError(`„${path}“ fehlt im Archiv.`);
  const data = await session.run(extract());
  if (!(data instanceof Blob)) throw new ReaderError(`„${path}“ konnte nicht entpackt werden.`);
  return data;
}

/**
 * Worker gone, WebAssembly memory exhausted, or the WebAssembly module trapped
 * (e.g. "table index is out of bounds" once memory ran low): a fresh worker can
 * help. Corrupt entries can't.
 */
function isRecoverable(error: unknown): boolean {
  if (error instanceof SessionEnded) return true;
  if (!(error instanceof Error)) return false;
  // Comlink keeps the original error name across the worker boundary.
  if (error.name === "RuntimeError") return true;
  return /allocate memory|out of memory|already closed|out of bounds|unreachable/i.test(error.message);
}

function indexEntries(session: Session, listing: readonly unknown[]): Array<{ path: string }> {
  const entries: Array<{ path: string }> = [];
  for (const item of listing) {
    const entry = toEntry(item);
    if (!entry) continue;
    session.extractors.set(entry.path, entry.extract);
    entries.push({ path: entry.path });
  }
  return entries;
}

/**
 * Archive.open() never settles if the worker fails (its error isn't forwarded), so
 * race it against worker errors and a timeout, and terminate the worker on failure.
 */
async function openSession(file: File): Promise<Session> {
  const created: Worker[] = [];
  onWorkerCreated = (worker) => created.push(worker);
  let opening: Promise<ArchiveReader>;
  try {
    opening = Archive.open(file); // Calls getWorker synchronously.
  } finally {
    onWorkerCreated = undefined;
  }
  const worker = created[0];

  let timer: number | undefined;
  let onError: (() => void) | undefined;
  const failure = new Promise<never>((_, reject) => {
    onError = () => reject(new Error("Archive worker failed"));
    worker?.addEventListener("error", onError);
    timer = window.setTimeout(() => reject(new Error("Opening the archive timed out")), OPEN_TIMEOUT_MS);
  });
  try {
    return new Session(await Promise.race([opening, failure]), worker);
  } catch (error) {
    worker?.terminate();
    throw error;
  } finally {
    window.clearTimeout(timer);
    if (onError) worker?.removeEventListener("error", onError);
  }
}

/** Validates one item of libarchive's untyped `getFilesArray()` result. */
function toEntry(item: unknown): { path: string; extract: () => Promise<unknown> } | undefined {
  if (typeof item !== "object" || item === null || !("file" in item) || !("path" in item)) return undefined;
  const { file, path } = item;
  if (typeof path !== "string" || typeof file !== "object" || file === null) return undefined;
  if (!("name" in file) || typeof file.name !== "string") return undefined;
  if (!("extract" in file)) return undefined;
  const extract: unknown = file.extract;
  if (typeof extract !== "function") return undefined;
  // `path` is the folder inside the archive ("" or "issue/"), without the file name.
  // The result is untyped here and checked in extractFrom().
  return { path: path + file.name, extract: (): Promise<unknown> => Promise.resolve(extract.call(file)) };
}

export default function createAdapter(): ArchiveAdapter {
  return new ArchiveAdapter();
}
