# Projekt: Reader

## Ziel
Ein schlanker, lokaler Reader für E-Books und Comics, der auf Mac und PC läuft.
Zuerst als Web-App im Browser, später als Desktop-App (Tauri).
Fokus auf ruhiges Lesen: Vollbild, Darkmode, einfaches Blättern. Keine Bibliothek, keine Cloud.

## Unterstützte Formate
| Format | Typ | Umsetzung |
|---|---|---|
| PDF | feste Seiten | pdf.js |
| EPUB | umfließender Text, Seiten entstehen durch Umbruch | epub.js |
| CBZ | ZIP mit Bildern | JSZip |
| CBR | RAR mit Bildern | libarchive.js |
| CB7 | 7z mit Bildern | libarchive.js (zurückgestellt) |
| CBT | TAR mit Bildern | libarchive.js (zurückgestellt) |

## Version 1 – Umfang
**Enthalten:**
- Datei öffnen per Dateiauswahl oder Drag & Drop
- Blättern: Pfeiltasten, Klick auf linke/rechte Bildschirmhälfte, Mausrad
- Seitenanzeige „Seite X / Y“
- Vollbild (Taste F und Button)
- Darkmode (Standard an, Taste D), Einstellung wird gespeichert
- Seite passt sich an die Fensterhöhe an
- Verständliche Fehlermeldung bei kaputten oder nicht unterstützten Dateien

**Testumgebung:**
- Abnahme zunächst nur in Chrome 157.0.8103.51
- Beispiel-Dateien für EPUB, CBR, CBZ und PDF liegen in `test-daten/`
- CB7/CBT, zusätzliche RAR-Varianten und beschädigte Dateien werden vorerst zurückgestellt; die vorhandenen CBR-Beispiele bleiben Teil der Formatprüfung

**Bewusst nicht enthalten (spätere Versionen):**
- Doppelseiten-Ansicht
- Leserichtung rechts nach links (Manga)
- Zoom, Lesezeichen, Lesefortschritt merken
- Bibliotheksansicht, Cover-Übersicht
- Seiten invertieren / Darkmode für Seiteninhalte
- Inhaltsverzeichnis bei EPUB/PDF

## Phasen
1. **Grundgerüst** – Projekt-Setup, Adapter-Interface, Bedien-UI
2. **CBZ + PDF** – die beiden einfachen Formate
3. **EPUB** – umfließender Text mit Pagination
4. **CBR** – Archivformat über WASM (höchstes Risiko, daher zuletzt); CB7/CBT sind zurückgestellt
5. **Desktop (optional)** – Tauri-Hülle, Builds für macOS und Windows, ggf. über GitHub Actions

Jede Phase endet mit Tests und einem Code-Review durch eine zweite Claude-Instanz.

## Abnahmekriterien V1
- Je eine Testdatei für PDF, EPUB, CBZ und CBR lässt sich öffnen und vollständig durchblättern.
- Vollbild und Darkmode funktionieren in Chrome 157.0.8103.51.
- Keine Netzwerkanfragen nach dem Laden der App.
- Tests mit beschädigten Dateien sind vorerst zurückgestellt.
- Speicher wächst beim mehrfachen Öffnen und Schließen von Comics nicht dauerhaft an.

## Bekannte Risiken
- **CBR/RAR:** proprietäres Format. Ob libarchive.js alle RAR-Varianten liest (ältere Versionen, verschlüsselte Archive), ist offen und muss mit echten Dateien getestet werden.
- **EPUB:** „Seiten“ hängen von Fenstergröße und Schrift ab, die Seitenzahl ist daher nur eine Näherung.
- **Tauri:** Drag & Drop, Vollbild und WASM/Worker brauchen dort eventuell Anpassungen (CSP, Fenster-Konfiguration).
