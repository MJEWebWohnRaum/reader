import { describe, expect, it, vi, type Mock } from "vitest";
import { bindClickZones, bindKeyboard, WheelPager } from "../src/ui/controls";

type MockActions = Record<"next" | "prev" | "toggleFullscreen" | "toggleTheme", Mock<() => void>>;

function mockActions(): MockActions {
  return { next: vi.fn(), prev: vi.fn(), toggleFullscreen: vi.fn(), toggleTheme: vi.fn() };
}

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("bindKeyboard", () => {
  it("maps arrows, F and D", () => {
    const actions = mockActions();
    const dispose = bindKeyboard(document, actions);
    key(document, { key: "ArrowRight" });
    key(document, { key: "ArrowLeft" });
    key(document, { key: "f" });
    key(document, { key: "D" });
    expect(actions.next).toHaveBeenCalledTimes(1);
    expect(actions.prev).toHaveBeenCalledTimes(1);
    expect(actions.toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(actions.toggleTheme).toHaveBeenCalledTimes(1);
    dispose();
    key(document, { key: "ArrowRight" });
    expect(actions.next).toHaveBeenCalledTimes(1);
  });

  it("ignores modifier shortcuts, key repeat for toggles and typing in inputs", () => {
    const actions = mockActions();
    const dispose = bindKeyboard(document, actions);
    key(document, { key: "f", ctrlKey: true });
    key(document, { key: "d", repeat: true });
    const input = document.createElement("input");
    document.body.append(input);
    key(input, { key: "ArrowRight" });
    expect(actions.toggleFullscreen).not.toHaveBeenCalled();
    expect(actions.toggleTheme).not.toHaveBeenCalled();
    expect(actions.next).not.toHaveBeenCalled();
    input.remove();
    dispose();
  });
});

describe("bindClickZones", () => {
  it("left half goes back, right half goes forward", () => {
    const actions = mockActions();
    const area = document.createElement("div");
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) });
    bindClickZones(area, actions);
    area.dispatchEvent(new MouseEvent("click", { clientX: 100 }));
    area.dispatchEvent(new MouseEvent("click", { clientX: 900 }));
    expect(actions.prev).toHaveBeenCalledTimes(1);
    expect(actions.next).toHaveBeenCalledTimes(1);
  });
});

describe("WheelPager", () => {
  it("turns one page per gesture", () => {
    const actions = mockActions();
    let now = 0;
    const pager = new WheelPager(actions, 200, () => now);
    for (let i = 0; i < 20; i++) {
      pager.handle(0, 30);
      now += 16;
    }
    expect(actions.next).toHaveBeenCalledTimes(1);
    now += 500;
    pager.handle(0, -100);
    expect(actions.prev).toHaveBeenCalledTimes(1);
  });

  it("uses horizontal delta when it dominates and ignores zero deltas", () => {
    const actions = mockActions();
    let now = 0;
    const pager = new WheelPager(actions, 200, () => now);
    pager.handle(50, 5);
    now += 1000;
    pager.handle(0, 0);
    expect(actions.next).toHaveBeenCalledTimes(1);
    expect(actions.prev).not.toHaveBeenCalled();
  });
});
