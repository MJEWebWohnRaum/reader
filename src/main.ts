import "./styles.css";
import { enableFileDrop, pickFile } from "./platform/files";
import { onFullscreenChange, toggleFullscreen } from "./platform/fullscreen";
import { registerAllFormats } from "./reader/formats";
import { findFormat, supportedExtensions } from "./reader/registry";
import type { TextWidth, ViewOptions } from "./reader/types";
import { bindClickZones, bindKeyboard, bindWheel, type ControlActions } from "./ui/controls";
import { loadViewOptions, nextTextWidth, saveViewOptions, stepTextScale } from "./ui/settings";
import { applyTheme, loadTheme, toggleTheme } from "./ui/theme";
import { Viewer, type ViewerState } from "./ui/viewer";

const IDLE_MS = 2500;
const RESIZE_DEBOUNCE_MS = 150;

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

applyTheme(loadTheme());
registerAllFormats();

const body = document.body;
const fileName = byId("file-name");
const pageIndicator = byId("page-indicator");
const message = byId("message");
const inputLayer = byId("input-layer");
byId("formats").textContent = `Unterstützt: ${supportedExtensions().join(", ").toUpperCase()}`;

let previousStatus: ViewerState["status"] | undefined;

function render(state: Readonly<ViewerState>): void {
  for (const status of ["empty", "loading", "ready", "error"] as const) {
    body.classList.toggle(status, state.status === status);
  }
  fileName.textContent = state.fileName;
  document.title = state.fileName ? `${state.fileName} – Reader` : "Reader";
  const pages = state.pageEnd > state.page ? `${state.page + 1}–${state.pageEnd + 1}` : `${state.page + 1}`;
  pageIndicator.textContent = state.status === "ready" ? `Seite ${pages} / ${state.pageCount}` : "";
  body.classList.toggle("has-text-options", state.status === "ready" && state.textOptions);
  message.textContent = state.message;
  if (state.status !== previousStatus) {
    previousStatus = state.status;
    if (state.status === "ready") scheduleIdle();
    else setIdle(false);
  }
}

let viewOptions = loadViewOptions();
const viewer = new Viewer(byId("page-host"), findFormat, render, viewOptions);
render(viewer.getState());

const WIDTH_LABELS: Record<TextWidth, string> = { narrow: "schmal", medium: "mittel", wide: "breit" };

function showViewOptions(options: ViewOptions): void {
  byId("double-page-button").setAttribute("aria-pressed", String(options.doublePage));
  byId("text-width-button").title = `Textbreite: ${WIDTH_LABELS[options.textWidth]} (W)`;
}

function updateViewOptions(patch: Partial<ViewOptions>): void {
  viewOptions = { ...viewOptions, ...patch };
  saveViewOptions(viewOptions);
  showViewOptions(viewOptions);
  viewer.setViewOptions(viewOptions);
}

/** Font size and text width only apply to formats that lay out text themselves. */
function updateTextOptions(patch: Partial<ViewOptions>): void {
  if (viewer.getState().textOptions) updateViewOptions(patch);
}

showViewOptions(viewOptions);

async function openFromPicker(): Promise<void> {
  const file = await pickFile(supportedExtensions());
  if (file) await viewer.open(file);
}

const actions: ControlActions = {
  next: () => viewer.next(),
  prev: () => viewer.prev(),
  toggleFullscreen: () => void toggleFullscreen(),
  toggleTheme: () => {
    toggleTheme();
    // Reflowable content (EPUB) takes its text colors from the theme.
    viewer.refresh();
  },
  toggleDoublePage: () => updateViewOptions({ doublePage: !viewOptions.doublePage }),
  textLarger: () => updateTextOptions({ textScale: stepTextScale(viewOptions.textScale, 1) }),
  textSmaller: () => updateTextOptions({ textScale: stepTextScale(viewOptions.textScale, -1) }),
  cycleTextWidth: () => updateTextOptions({ textWidth: nextTextWidth(viewOptions.textWidth) }),
};

bindKeyboard(document, actions);
bindClickZones(inputLayer, actions);
bindWheel(inputLayer, actions);
enableFileDrop(body, {
  onFile: (file) => void viewer.open(file),
  onDragStateChange: (active) => body.classList.toggle("dragging", active),
});

byId("open-button").addEventListener("click", () => void openFromPicker());
byId("empty-open-button").addEventListener("click", () => void openFromPicker());
byId("theme-button").addEventListener("click", actions.toggleTheme);
byId("fullscreen-button").addEventListener("click", actions.toggleFullscreen);
byId("double-page-button").addEventListener("click", actions.toggleDoublePage);
byId("text-larger-button").addEventListener("click", actions.textLarger);
byId("text-smaller-button").addEventListener("click", actions.textSmaller);
byId("text-width-button").addEventListener("click", actions.cycleTextWidth);

// Buttons keep focus after a click; blur so Space/Enter don't re-trigger them while reading.
for (const button of document.querySelectorAll("button")) {
  button.addEventListener("click", () => button.blur());
}

onFullscreenChange((active) => byId("fullscreen-button").classList.toggle("active", active));

// Hide toolbar and cursor while reading; any mouse movement brings them back.
let idleTimer: number | undefined;
function setIdle(idle: boolean): void {
  body.classList.toggle("idle", idle);
}
const toolbar = byId("toolbar");
function scheduleIdle(): void {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    // Never hide the toolbar from under the mouse pointer.
    setIdle(viewer.getState().status === "ready" && !toolbar.matches(":hover"));
  }, IDLE_MS);
}
document.addEventListener("mousemove", () => {
  setIdle(false);
  scheduleIdle();
});

let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => viewer.refresh(), RESIZE_DEBOUNCE_MS);
});
