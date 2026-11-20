import { registerFormat } from "./registry";

/** Registers all supported formats. Adapters are imported lazily. */
export function registerAllFormats(): void {
  registerFormat({
    label: "PDF",
    extensions: ["pdf"],
    mimeTypes: ["application/pdf"],
    load: async () => (await import("./adapters/pdf")).default(),
  });
  registerFormat({
    label: "EPUB",
    extensions: ["epub"],
    mimeTypes: ["application/epub+zip"],
    load: async () => (await import("./adapters/epub")).default(),
  });
  registerFormat({
    label: "Comic (CBZ)",
    extensions: ["cbz"],
    mimeTypes: ["application/vnd.comicbook+zip", "application/x-cbz"],
    load: async () => (await import("./adapters/cbz")).default(),
  });
}
