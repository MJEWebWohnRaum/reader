# Reader

A calm, local reader for PDF, EPUB and comic archives (CBZ, CBR). Everything runs in the browser: no server, no upload, no network requests after the app has loaded. See [PROJEKT.md](PROJEKT.md) for scope and roadmap.

## Usage

```powershell
npm install
npm run dev        # development server
npm run build      # production build in dist/
npm run preview    # serve dist/ locally
```

Open a file with the **Öffnen** button or drop it onto the window.

| Action | Keys / mouse |
|---|---|
| Next / previous page | → / ←, click on the right / left half, mouse wheel |
| Fullscreen | F or the button at the top right |
| Dark mode (default on, remembered) | D or the moon button |
| Double page (remembered) | 2 or the double page button |
| EPUB font size (remembered) | + / − or the A+ / A− buttons |
| EPUB text width: narrow, medium, wide (remembered) | W or the width button |

The toolbar fades out while reading and comes back when the mouse moves. In double page view, PDFs and comics show the cover alone and then pages 2+3, 4+5 …; EPUBs show two text columns.

### Limits

- EPUB pages are screens of reflowed text, so the page count is an estimate that is refined while reading.
- Comic archives read via libarchive (CBR) are limited to 1.5 GB, because the whole archive is held in WebAssembly memory.
- Password-protected PDFs and archives are not supported.

## Development

```powershell
npm run typecheck  # TypeScript (app and tests)
npm test           # Vitest
```

`npm run dev` and `npm run build` first copy pdf.js and libarchive runtime files (fonts, CMaps, workers, WebAssembly) into `public/` via `scripts/copy-runtime-assets.mjs`, so they are served locally.

## Public test fixtures

`test-fixtures/public/` contains original, generated fixtures for PDF, EPUB, CBZ, and CBR. They are small samples intended for reader development and format checks. Regenerate them with:

```powershell
node scripts/create-public-fixtures.mjs
```

Creating the CBR fixture requires WinRAR's `Rar.exe`. Set `RAR_EXE` to its path if it is not installed at `C:\Program Files\WinRAR\Rar.exe`.

Private sample documents belong in `test-daten/`. That directory is ignored by Git and must not be added to public commits.
