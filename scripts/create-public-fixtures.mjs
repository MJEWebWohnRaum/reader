import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = join(root, "test-fixtures", "public");
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x21, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localRecords.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralRecords.push(centralHeader, name);
    localOffset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  endRecord.writeUInt16LE(0, 20);
  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

function makePng(pageNumber) {
  const width = 360;
  const height = 480;
  const pixels = Buffer.alloc(width * height * 4);
  const palettes = [
    { sky: [250, 229, 194], ground: [36, 112, 109], hero: [239, 99, 73], sun: [245, 180, 63] },
    { sky: [204, 229, 221], ground: [50, 94, 120], hero: [240, 171, 56], sun: [234, 117, 96] },
    { sky: [238, 211, 217], ground: [80, 107, 77], hero: [54, 133, 133], sun: [240, 173, 68] },
  ];
  const palette = palettes[pageNumber - 1];

  function rectangle(x, y, rectangleWidth, rectangleHeight, color) {
    for (let row = Math.max(0, y); row < Math.min(height, y + rectangleHeight); row += 1) {
      for (let column = Math.max(0, x); column < Math.min(width, x + rectangleWidth); column += 1) {
        const offset = (row * width + column) * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = 255;
      }
    }
  }

  function circle(centerX, centerY, radius, color) {
    for (let y = centerY - radius; y <= centerY + radius; y += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) rectangle(x, y, 1, 1, color);
      }
    }
  }

  function digit(value, x, y, color) {
    const glyphs = {
      1: ["010", "110", "010", "010", "111"],
      2: ["110", "001", "010", "100", "111"],
      3: ["110", "001", "010", "001", "110"],
    };
    for (const [row, line] of glyphs[value].entries()) {
      for (const [column, bit] of [...line].entries()) {
        if (bit === "1") rectangle(x + column * 4, y + row * 4, 3, 3, color);
      }
    }
  }

  rectangle(0, 0, width, height, palette.sky);
  rectangle(0, 0, width, 18, [35, 54, 65]);
  rectangle(0, 344, width, 136, palette.ground);
  circle(278, 100, 46, palette.sun);
  rectangle(38, 196, 284, 5, [35, 54, 65]);
  rectangle(58, 201, 5, 110, [35, 54, 65]);
  rectangle(297, 201, 5, 110, [35, 54, 65]);
  rectangle(145 + (pageNumber - 1) * 65, 274, 48, 64, palette.hero);
  rectangle(154 + (pageNumber - 1) * 65, 289, 7, 7, [35, 54, 65]);
  rectangle(177 + (pageNumber - 1) * 65, 289, 7, 7, [35, 54, 65]);
  rectangle(24, 28, 38, 38, [255, 255, 255]);
  digit(pageNumber, 38, 36, [35, 54, 65]);

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
  }

  function chunk(type, data) {
    const name = Buffer.from(type, "ascii");
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, checksum]);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makePdf() {
  const pageStreams = [1, 2, 3].map((page) => {
    const x = 70 + page * 115;
    return [
      "BT /F1 26 Tf 72 710 Td (Reader Sample PDF) Tj ET",
      `BT /F1 16 Tf 72 675 Td (Original page ${page} of 3) Tj ET`,
      `${0.15 + page * 0.12} 0.46 0.48 rg 72 490 440 110 re f`,
      `0.94 0.63 ${0.22 + page * 0.12} rg ${x} 330 82 82 re f`,
      "0.19 0.27 0.32 rg 72 115 440 8 re f",
      `BT /F1 12 Tf 72 80 Td (Page ${page}) Tj ET`,
    ].join("\n");
  });
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageStreams.map((_, index) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${pageStreams.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  for (const [index, stream] of pageStreams.entries()) {
    const contentId = 4 + index * 2;
    const pageId = contentId + 1;
    objects[contentId - 1] = `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`;
    objects[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
  }

  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, "ascii"));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}

async function findRarExecutable() {
  const candidates = [process.env.RAR_EXE, "C:\\Program Files\\WinRAR\\Rar.exe", "rar.exe"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("WinRAR Rar.exe not found. Set the RAR_EXE environment variable to its path.");
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const pages = [1, 2, 3].map(makePng);
  const names = pages.map((_, index) => `page-${index + 1}.png`);
  const comicEntries = pages.map((data, index) => ({ name: names[index], data }));
  const epubEntries = [
    { name: "mimetype", data: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      data: '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: "OEBPS/content.opf",
      data: '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:reader-test:epub-001</dc:identifier><dc:title>A Small Reader Test</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    },
    {
      name: "OEBPS/nav.xhtml",
      data: '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="chapter.xhtml">The First Page</a></li></ol></nav></body></html>',
    },
    {
      name: "OEBPS/chapter.xhtml",
      data: '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en"><head><title>The First Page</title><style>body{font-family:serif;line-height:1.6;margin:8%}h1{color:#246f6d}</style></head><body><h1>The First Page</h1><p>This original sample chapter exists to exercise EPUB opening, text layout, and page navigation.</p><p>As the window changes size, this paragraph should reflow naturally across the reader.</p><p>End of sample.</p></body></html>',
    },
  ];

  await writeFile(join(outputDirectory, "reader-sample.pdf"), makePdf());
  await writeFile(join(outputDirectory, "reader-sample.epub"), zip(epubEntries));
  await writeFile(join(outputDirectory, "reader-sample.cbz"), zip(comicEntries));

  const tempDirectory = await mkdtemp(join(tmpdir(), "reader-public-fixtures-"));
  try {
    const pagePaths = [];
    for (const [index, page] of pages.entries()) {
      const pagePath = join(tempDirectory, names[index]);
      await writeFile(pagePath, page);
      pagePaths.push(pagePath);
    }
    const rarExe = await findRarExecutable();
    const cbrPath = join(outputDirectory, "reader-sample.cbr");
    execFileSync(rarExe, ["a", "-idq", "-ep", "-y", cbrPath, ...pagePaths], { stdio: "inherit" });
    await access(cbrPath);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }

  console.log(`Created four public fixtures in ${outputDirectory}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});