// All Fullscreen API access lives here so it can be swapped for Tauri's window API.

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null;
}

export async function toggleFullscreen(element: HTMLElement = document.documentElement): Promise<void> {
  try {
    if (isFullscreen()) await document.exitFullscreen();
    else await element.requestFullscreen();
  } catch {
    // Browsers reject when not triggered by a user gesture; nothing useful to report.
  }
}

export function onFullscreenChange(listener: (active: boolean) => void): () => void {
  const handler = (): void => listener(isFullscreen());
  document.addEventListener("fullscreenchange", handler);
  return () => document.removeEventListener("fullscreenchange", handler);
}
