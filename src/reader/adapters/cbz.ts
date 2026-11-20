import JSZip from "jszip";
import { ComicAdapter, selectPages, type ComicPage } from "../comic";
import { ReaderError } from "../types";

export class CbzAdapter extends ComicAdapter {
  protected async listPages(file: File): Promise<ComicPage[]> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (error) {
      throw new ReaderError(`„${file.name}“ ist kein gültiges CBZ/ZIP-Archiv oder beschädigt.`, { cause: error });
    }
    const entries = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => ({ path: entry.name, entry }));
    return selectPages(entries).map(({ path, type, entry }) => ({
      path,
      type,
      read: () => entry.async("blob"),
    }));
  }
}

export default function createAdapter(): CbzAdapter {
  return new CbzAdapter();
}
