export interface ControlActions {
  next(): void;
  prev(): void;
  toggleFullscreen(): void;
  toggleTheme(): void;
  toggleDoublePage(): void;
  textLarger(): void;
  textSmaller(): void;
  cycleTextWidth(): void;
}

/**
 * Arrow keys turn pages, F toggles fullscreen, D dark mode, 2 double page;
 * + / − change the font size and W the text width (reflowable formats).
 */
export function bindKeyboard(target: Document | HTMLElement, actions: ControlActions): () => void {
  const handler = (e: Event): void => {
    if (!(e instanceof KeyboardEvent)) return;
    if (e.ctrlKey || e.altKey || e.metaKey || isEditable(e.target)) return;
    switch (e.key) {
      case "ArrowRight":
        actions.next();
        break;
      case "ArrowLeft":
        actions.prev();
        break;
      case "f":
      case "F":
        if (e.repeat) return;
        actions.toggleFullscreen();
        break;
      case "d":
      case "D":
        if (e.repeat) return;
        actions.toggleTheme();
        break;
      case "2":
        if (e.repeat) return;
        actions.toggleDoublePage();
        break;
      case "+":
      case "=": // "+" without Shift on US layouts.
        actions.textLarger();
        break;
      case "-":
        actions.textSmaller();
        break;
      case "w":
      case "W":
        if (e.repeat) return;
        actions.cycleTextWidth();
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  target.addEventListener("keydown", handler);
  return () => target.removeEventListener("keydown", handler);
}

/** Click on the left half goes back, right half goes forward. */
export function bindClickZones(area: HTMLElement, actions: Pick<ControlActions, "next" | "prev">): () => void {
  const handler = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const rect = area.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width / 2) actions.prev();
    else actions.next();
  };
  area.addEventListener("click", handler);
  return () => area.removeEventListener("click", handler);
}

/**
 * Turns at most one page per wheel gesture. Trackpads and free-spinning wheels
 * fire dozens of events per gesture; further events are ignored until the
 * wheel has been quiet for `quietMs`.
 */
export class WheelPager {
  private lastEvent = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly actions: Pick<ControlActions, "next" | "prev">,
    private readonly quietMs = 200,
    private readonly now: () => number = () => performance.now(),
  ) {}

  handle(deltaX: number, deltaY: number): void {
    const t = this.now();
    const withinGesture = t - this.lastEvent < this.quietMs;
    this.lastEvent = t;
    if (withinGesture) return;
    const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
    if (delta > 0) this.actions.next();
    else if (delta < 0) this.actions.prev();
  }
}

export function bindWheel(area: HTMLElement, actions: Pick<ControlActions, "next" | "prev">): () => void {
  const pager = new WheelPager(actions);
  const handler = (e: WheelEvent): void => {
    if (e.ctrlKey) return; // Browser zoom gesture.
    e.preventDefault();
    pager.handle(e.deltaX, e.deltaY);
  };
  area.addEventListener("wheel", handler, { passive: false });
  return () => area.removeEventListener("wheel", handler);
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
  );
}
