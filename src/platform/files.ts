// All file access (picker, drag & drop) lives here so it can be swapped for Tauri's dialog API.

export function pickFile(accept: readonly string[]): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.addEventListener("change", () => resolve(input.files?.[0]), { once: true });
    input.addEventListener("cancel", () => resolve(undefined), { once: true });
    input.click();
  });
}

export interface DropHandlers {
  onFile(file: File): void;
  onDragStateChange?(active: boolean): void;
}

/** Enables dropping files anywhere on `target`. Returns a disposer. */
export function enableFileDrop(target: HTMLElement, handlers: DropHandlers): () => void {
  // Counter, because dragenter/dragleave also fire for child elements.
  let depth = 0;
  const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes("Files") ?? false;

  const onEnter = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (depth++ === 0) handlers.onDragStateChange?.(true);
  };
  const onOver = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const onLeave = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) handlers.onDragStateChange?.(false);
  };
  const onDrop = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    handlers.onDragStateChange?.(false);
    const file = e.dataTransfer?.files[0];
    if (file) handlers.onFile(file);
  };

  target.addEventListener("dragenter", onEnter);
  target.addEventListener("dragover", onOver);
  target.addEventListener("dragleave", onLeave);
  target.addEventListener("drop", onDrop);
  return () => {
    target.removeEventListener("dragenter", onEnter);
    target.removeEventListener("dragover", onOver);
    target.removeEventListener("dragleave", onLeave);
    target.removeEventListener("drop", onDrop);
  };
}
