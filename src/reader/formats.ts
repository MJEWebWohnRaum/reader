import { registerFormat } from "./registry";

/** Registers all supported formats. Adapters are imported lazily. */
export function registerAllFormats(): void {
  // Formats are added per phase (see PROJEKT.md).
  void registerFormat;
}
