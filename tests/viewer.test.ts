import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormatEntry } from "../src/reader/registry";
import { ReaderError, type ReaderAdapter } from "../src/reader/types";
import { Viewer, type ViewerState } from "../src/ui/viewer";

class FakeAdapter implements ReaderAdapter {
  rendered: number[] = [];
  closed = false;
  pendingRenders: Array<() => void> = [];
  manualRender = false;
  countListener: ((count: number) => void) | undefined;

  constructor(
    private count: number,
    private openImpl: () => Promise<void> = async () => {},
  ) {}

  open(): Promise<void> {
    return this.openImpl();
  }
  pageCount(): number {
    return this.count;
  }
  renderPage(index: number): Promise<void> {
    this.rendered.push(index);
    if (!this.manualRender) return Promise.resolve();
    return new Promise((resolve) => this.pendingRenders.push(resolve));
  }
  close(): void {
    this.closed = true;
  }
  onPageCountChange(listener: (count: number) => void): void {
    this.countListener = listener;
  }
}

function format(adapter: ReaderAdapter): FormatEntry {
  return { label: "Fake", extensions: ["fake"], mimeTypes: [], load: async () => adapter };
}

function file(name = "test.fake"): File {
  return new File(["x"], name);
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Viewer", () => {
  let host: HTMLElement;
  let states: ViewerState[];
  const onChange = (s: Readonly<ViewerState>): void => {
    states.push({ ...s });
  };

  beforeEach(() => {
    host = document.createElement("div");
    states = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("opens a document and renders the first page", async () => {
    const adapter = new FakeAdapter(3);
    const viewer = new Viewer(host, () => format(adapter), onChange);
    await viewer.open(file());
    await flush();
    expect(viewer.getState()).toMatchObject({ status: "ready", page: 0, pageCount: 3, fileName: "test.fake" });
    expect(adapter.rendered).toEqual([0]);
    expect(host.querySelectorAll(".document")).toHaveLength(1);
  });

  it("clamps navigation at the first and last page", async () => {
    const adapter = new FakeAdapter(2);
    const viewer = new Viewer(host, () => format(adapter), onChange);
    await viewer.open(file());
    viewer.prev();
    expect(viewer.getState().page).toBe(0);
    viewer.next();
    viewer.next();
    viewer.next();
    expect(viewer.getState().page).toBe(1);
    viewer.goTo(-5);
    expect(viewer.getState().page).toBe(0);
  });

  it("handles a single-page document", async () => {
    const adapter = new FakeAdapter(1);
    const viewer = new Viewer(host, () => format(adapter), onChange);
    await viewer.open(file());
    viewer.next();
    viewer.prev();
    await flush();
    expect(viewer.getState().page).toBe(0);
    expect(adapter.rendered).toEqual([0]);
  });

  it("reports an empty document as an error", async () => {
    const adapter = new FakeAdapter(0);
    const viewer = new Viewer(host, () => format(adapter), onChange);
    await viewer.open(file("leer.fake"));
    expect(viewer.getState().status).toBe("error");
    expect(viewer.getState().message).toContain("keine anzeigbaren Seiten");
    expect(adapter.closed).toBe(true);
  });

  it("reports unsupported formats", async () => {
    const viewer = new Viewer(host, () => undefined, onChange);
    await viewer.open(file("notes.txt"));
    expect(viewer.getState()).toMatchObject({ status: "error" });
    expect(viewer.getState().message).toContain("nicht unterstützt");
  });

  it("shows ReaderError messages and a generic message for other errors", async () => {
    const broken = new FakeAdapter(1, () => Promise.reject(new ReaderError("Kaputt.")));
    const viewer = new Viewer(host, () => format(broken), onChange);
    await viewer.open(file());
    expect(viewer.getState().message).toBe("Kaputt.");
    expect(broken.closed).toBe(true);

    const crashing = new FakeAdapter(1, () => Promise.reject(new TypeError("internal")));
    const viewer2 = new Viewer(host, () => format(crashing), onChange);
    await viewer2.open(file("a.fake"));
    expect(viewer2.getState().message).toContain("beschädigt");
    expect(viewer2.getState().message).not.toContain("internal");
  });

  it("collapses rapid page turns into one render of the latest page", async () => {
    const adapter = new FakeAdapter(10);
    adapter.manualRender = true;
    const viewer = new Viewer(host, () => format(adapter), onChange);
    await viewer.open(file());
    for (let i = 0; i < 5; i++) viewer.next();
    expect(adapter.rendered).toEqual([0]);
    adapter.pendingRenders.shift()?.();
    await flush();
    expect(adapter.rendered).toEqual([0, 5]);
    adapter.pendingRenders.shift()?.();
    await flush();
    expect(adapter.rendered).toEqual([0, 5]);
  });

  it("closes the previous document when a new one is opened", async () => {
    const first = new FakeAdapter(3);
    first.manualRender = true;
    const second = new FakeAdapter(4);
    let current: FakeAdapter = first;
    const viewer = new Viewer(host, () => format(current), onChange);
    await viewer.open(file("one.fake"));
    current = second;
    await viewer.open(file("two.fake"));
    await flush();
    expect(first.closed).toBe(true);
    expect(second.rendered).toEqual([0]);
    expect(host.querySelectorAll(".document")).toHaveLength(1);
    expect(viewer.getState()).toMatchObject({ fileName: "two.fake", pageCount: 4 });

    // A late render from the old document must not trigger more work.
    first.pendingRenders.shift()?.();
    await flush();
    expect(first.rendered).toEqual([0]);
  });

  it("ignores a slow open that was superseded by a newer one", async () => {
    let finishSlow: () => void = () => {};
    const slow = new FakeAdapter(3, () => new Promise((resolve) => (finishSlow = resolve)));
    const fast = new FakeAdapter(2);
    let current: FakeAdapter = slow;
    const viewer = new Viewer(host, () => format(current), onChange);
    const slowOpen = viewer.open(file("slow.fake"));
    current = fast;
    await viewer.open(file("fast.fake"));
    finishSlow();
    await slowOpen;
    expect(slow.closed).toBe(true);
    expect(viewer.getState()).toMatchObject({ fileName: "fast.fake", pageCount: 2 });
  });

  it("shows a page error without leaving the document", async () => {
    const adapter = new FakeAdapter(3);
    adapter.renderPage = (index: number) => (index === 1 ? Promise.reject(new Error("x")) : Promise.resolve());
    const viewer = new Viewer(host, () => format(adapter), onChange);
    await viewer.open(file());
    viewer.next();
    await flush();
    expect(viewer.getState()).toMatchObject({ status: "ready", page: 1 });
    expect(viewer.getState().message).toContain("Seite 2");
    viewer.next();
    expect(viewer.getState().message).toBe("");
  });

  it("follows page count changes from reflowable adapters", async () => {
    const adapter = new FakeAdapter(10);
    const viewer = new Viewer(host, () => format(adapter), onChange);
    await viewer.open(file());
    viewer.goTo(8);
    await flush();
    adapter.countListener?.(5);
    expect(viewer.getState()).toMatchObject({ pageCount: 5, page: 4 });
    await flush();
    expect(adapter.rendered.at(-1)).toBe(4);
  });

  it("reports an error even if close() throws after a failed open", async () => {
    const adapter = new FakeAdapter(1, () => Promise.reject(new ReaderError("Defekt.")));
    adapter.close = () => {
      throw new TypeError("nothing to close");
    };
    const viewer = new Viewer(host, () => format(adapter), onChange);
    await viewer.open(file());
    expect(viewer.getState()).toMatchObject({ status: "error", message: "Defekt." });
  });

  it("keeps the open document when an unsupported file is dropped", async () => {
    const adapter = new FakeAdapter(3);
    const viewer = new Viewer(host, (f) => (f.name.endsWith(".fake") ? format(adapter) : undefined), onChange);
    await viewer.open(file());
    viewer.next();
    await viewer.open(file("notes.txt"));
    expect(viewer.getState()).toMatchObject({ status: "ready", page: 1, fileName: "test.fake" });
    expect(viewer.getState().message).toContain("nicht unterstützt");
    expect(adapter.closed).toBe(false);
  });

  it("clears a page error once the page renders successfully", async () => {
    const adapter = new FakeAdapter(3);
    let failing = true;
    adapter.renderPage = () => (failing ? Promise.reject(new Error("x")) : Promise.resolve());
    const viewer = new Viewer(host, () => format(adapter), onChange);
    await viewer.open(file());
    await flush();
    expect(viewer.getState().message).not.toBe("");
    failing = false;
    viewer.refresh();
    await flush();
    expect(viewer.getState().message).toBe("");
  });

  it("close() resets to the empty state and cleans up", async () => {
    const adapter = new FakeAdapter(3);
    const viewer = new Viewer(host, () => format(adapter), onChange);
    await viewer.open(file());
    viewer.close();
    expect(adapter.closed).toBe(true);
    expect(viewer.getState().status).toBe("empty");
    expect(host.children).toHaveLength(0);
  });
});
