import type { TextWidth, ViewOptions } from "../reader/types";

const STORAGE_KEY = "reader.view";

/** Font size steps for reflowable text. */
export const TEXT_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8] as const;
export const TEXT_WIDTHS: readonly TextWidth[] = ["narrow", "medium", "wide"];

export const DEFAULT_VIEW_OPTIONS: ViewOptions = { doublePage: false, textScale: 1, textWidth: "medium" };

export function loadViewOptions(): ViewOptions {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return sanitize(raw);
  } catch {
    return { ...DEFAULT_VIEW_OPTIONS };
  }
}

export function saveViewOptions(options: ViewOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Storage may be unavailable (private mode); settings then last for this session.
  }
}

/** Next larger (+1) or smaller (-1) font size step, clamped to the available steps. */
export function stepTextScale(current: number, direction: 1 | -1): number {
  const index = TEXT_SCALES.findIndex((scale) => scale >= current - 0.001);
  const from = index < 0 ? TEXT_SCALES.length - 1 : index;
  const to = Math.max(0, Math.min(TEXT_SCALES.length - 1, from + direction));
  return TEXT_SCALES[to] ?? 1;
}

export function nextTextWidth(current: TextWidth): TextWidth {
  const index = TEXT_WIDTHS.indexOf(current);
  return TEXT_WIDTHS[(index + 1) % TEXT_WIDTHS.length] ?? "medium";
}

/** Accepts stored values only if they are still valid; anything else falls back to defaults. */
function sanitize(raw: unknown): ViewOptions {
  const options = { ...DEFAULT_VIEW_OPTIONS };
  if (typeof raw !== "object" || raw === null) return options;
  if ("doublePage" in raw && typeof raw.doublePage === "boolean") options.doublePage = raw.doublePage;
  if ("textScale" in raw && typeof raw.textScale === "number" && TEXT_SCALES.some((s) => s === raw.textScale)) {
    options.textScale = raw.textScale;
  }
  if ("textWidth" in raw) options.textWidth = TEXT_WIDTHS.find((w) => w === raw.textWidth) ?? options.textWidth;
  return options;
}
