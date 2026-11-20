# Reader

A local reader for PDF, EPUB, and comic archives. The project is currently in its planning and setup phase; see [PROJEKT.md](PROJEKT.md) for scope and roadmap.

## Public test fixtures

`test-fixtures/public/` contains original, generated fixtures for PDF, EPUB, CBZ, and CBR. They are small samples intended for reader development and format checks. Regenerate them with:

```powershell
node scripts/create-public-fixtures.mjs
```

Creating the CBR fixture requires WinRAR's `Rar.exe`. Set `RAR_EXE` to its path if it is not installed at `C:\Program Files\WinRAR\Rar.exe`.

Private sample documents belong in `test-daten/`. That directory is ignored by Git and must not be added to public commits.