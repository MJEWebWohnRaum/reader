import type { AdapterFactory } from "./types";

export interface FormatEntry {
  label: string;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  load: AdapterFactory;
}

const formats: FormatEntry[] = [];

/** Adapters register here; loading is lazy so each format is its own chunk. */
export function registerFormat(entry: FormatEntry): void {
  formats.push(entry);
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function findFormat(file: Pick<File, "name" | "type">): FormatEntry | undefined {
  const ext = fileExtension(file.name);
  const byExtension = formats.find((f) => f.extensions.includes(ext));
  if (byExtension) return byExtension;
  return file.type ? formats.find((f) => f.mimeTypes.includes(file.type)) : undefined;
}

export function supportedExtensions(): string[] {
  return formats.flatMap((f) => f.extensions.map((e) => `.${e}`));
}

/** For tests only. */
export function clearFormats(): void {
  formats.length = 0;
}
