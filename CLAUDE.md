# CLAUDE.md – Reader

Lokaler Dokument-Reader für PDF, EPUB und Comics (CBZ, CBR; CB7/CBT zurückgestellt).
Details zu Zielen und Umfang: siehe `PROJEKT.md`.

## Sprache
- Kommunikation mit Marcel auf Deutsch, Du-Form.
- Code, Variablen, Funktionsnamen und Commit-Messages auf Englisch.
- Code-Kommentare kurz, auf Englisch, nur wo das Warum nicht offensichtlich ist.

## Tech-Stack
- Vite + TypeScript (strict), kein UI-Framework
- PDF: pdf.js (`pdfjs-dist`)
- EPUB: epub.js
- CBZ: JSZip
- CBR: libarchive.js (WASM); CB7/CBT später über denselben Adapter
- Später: Tauri als Desktop-Hülle für macOS und Windows

## Befehle
- `npm install` – Abhängigkeiten
- `npm run dev` – Dev-Server
- `npm run build` – Produktions-Build
- `npm run typecheck` – `tsc --noEmit`
- `npm test` – Tests (Vitest)

Vor jedem Abschluss einer Aufgabe: `npm run typecheck`, `npm test` und `npm run build` müssen fehlerfrei durchlaufen.

## Architektur
```
src/
  main.ts              # Einstieg, UI-Verdrahtung
  reader/
    types.ts           # ReaderAdapter-Interface
    registry.ts        # Dateiendung/MIME -> Adapter
    adapters/
      pdf.ts
      epub.ts
      cbz.ts
      archive.ts       # CBR via libarchive.js
  platform/
    fullscreen.ts      # Vollbild gekapselt (später Tauri-API)
    files.ts           # Datei öffnen / Drag & Drop gekapselt
  ui/
    viewer.ts          # Dokumentzustand, Seitenwechsel, Render-Serialisierung
    theme.ts           # Darkmode, localStorage
    controls.ts        # Tastatur, Klickzonen, Mausrad
  styles.css
tests/
```

### ReaderAdapter-Interface
Jedes Format implementiert dasselbe Interface:
```ts
interface ReaderAdapter {
  open(file: File): Promise<void>;
  pageCount(): number;
  renderPage(index: number, container: HTMLElement): Promise<void>;
  close(): void;
  // Optional, für umfließende Formate (EPUB): meldet geänderte Seitenzahl,
  // z. B. nach Berechnung der Seiten oder nach Größenänderung des Fensters.
  onPageCountChange?(listener: (count: number) => void): void;
  // Optional, für umfließende Formate: meldet, wenn die angezeigte Seite vom
  // angefragten Index abweicht (z. B. Buchanfang nach Umbruch früher erreicht).
  onPageChange?(listener: (index: number) => void): void;
  // Optional, für umfließende Formate: übernimmt Doppelseite, Schriftgröße und
  // Textbreite selbst. Ohne diese Methode stellt der Viewer bei Doppelseite zwei
  // Seiten nebeneinander dar (feste Seiten: PDF, Comics).
  setViewOptions?(options: ViewOptions): void;
}
```
Die UI kennt nur dieses Interface, niemals ein konkretes Format.
Bei Fenstergrößenänderung rendert die UI die aktuelle Seite neu.

## Regeln
- **Alles lokal:** kein Server, kein Upload, keine CDN-Links. Libraries, Worker und WASM-Dateien werden gebundelt.
- **Plattform kapseln:** Browser-APIs für Vollbild und Dateizugriff nur in `src/platform/` aufrufen, nirgends sonst. So lassen sie sich später durch Tauri ersetzen.
- **Speicher:** Beim Schließen einer Datei Object-URLs freigeben (`URL.revokeObjectURL`) und Adapter-Ressourcen aufräumen.
- **Comic-Seiten:** Bilddateien im Archiv natürlich sortieren (`page2` vor `page10`), Nicht-Bilder und Ordner wie `__MACOSX` ignorieren.
- **Fehler:** Kaputte oder nicht unterstützte Dateien zeigen eine verständliche Meldung, die App stürzt nicht ab.
- **Umfang:** Nur bauen, was in `PROJEKT.md` unter V1 steht. Neue Features vorher mit Marcel absprechen.
- **Unsicherheit:** Bei unklaren Anforderungen oder unsicheren API-Details nachfragen bzw. offen sagen, statt zu raten.

## Umsetzungsreihenfolge
1. Grundgerüst, Interface, UI (Blättern, Seitenanzeige, Vollbild, Darkmode)
2. CBZ + PDF
3. EPUB
4. CBR (CB7/CBT zurückgestellt, siehe `PROJEKT.md`)
5. Ansichtsoptionen: Doppelseite, EPUB-Schriftgröße und -Textbreite

Nach jeder Phase: kurz testen, dann Review (siehe unten), dann erst die nächste Phase.

## Code-Review durch zweite Instanz
Nach jeder abgeschlossenen Phase den Subagenten `code-reviewer` aufrufen
(definiert in `.claude/agents/code-reviewer.md`). Er arbeitet in eigenem Kontext,
nur lesend, und kennt die Entstehung des Codes nicht. Dadurch prüft er unvoreingenommen.

Ablauf:
1. Phase fertig, Typecheck/Tests/Build grün.
2. `code-reviewer` mit der Phase und den geänderten Dateien beauftragen.
3. Befunde mit Schweregrad **kritisch** und **wichtig** beheben, **Hinweise** nach Ermessen.
4. Bei Uneinigkeit mit einem Befund: Marcel kurz begründen, nicht stillschweigend ignorieren.
5. Erneut prüfen lassen, bis keine kritischen Befunde mehr offen sind.
