// Inspect the bad PDF — list pages and dump operators on selected pages.
import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import * as zlib from "node:zlib";
import { PDFDocument } from "pdf-lib";

describe("inspect bad PDF", () => {
  it("dumps page metadata + decoded streams of first few pages", async () => {
    const pdfPath = "C:/Users/Scott/Downloads/HG260002_frames (2).pdf";
    const bytes = readFileSync(pdfPath);
    const pdf = await PDFDocument.load(bytes);
    console.log(`pages: ${pdf.getPageCount()}`);
    const titles = pdf.getTitle();
    console.log(`title: ${titles}`);

    // Decode stream operators for each page; look for "m" (moveto)/"l" (lineto)
    // counts and unique X coords used in path coords.
    const pages = pdf.getPages();
    for (let i = 0; i < Math.min(pages.length, 3); i++) {
      const page = pages[i]!;
      const cs = page.node.Contents();
      // Pull raw stream
      // pdf-lib doesn't directly expose decoded streams easily; use lookup
      // via the page node refs.
      console.log(`page ${i+1}: size=${page.getSize().width.toFixed(1)}×${page.getSize().height.toFixed(1)}`);
    }

    // Lower-level: scan raw bytes for path ops. The problem PDF has all
    // stud rectangles at the same X; if we find polygon moveto coords, the
    // page X values should differ.
    const buf = Buffer.from(bytes);
    // find "stream" / "endstream" pairs
    const streams: Buffer[] = [];
    let i = 0;
    while (i < buf.length) {
      const sIdx = buf.indexOf("stream\n", i);
      if (sIdx === -1) break;
      const eIdx = buf.indexOf("endstream", sIdx + 7);
      if (eIdx === -1) break;
      const data = buf.slice(sIdx + 7, eIdx);
      streams.push(data);
      i = eIdx + 9;
    }
    console.log(`found ${streams.length} streams`);
    let paged = 0;
    for (const s of streams) {
      try {
        const decoded = zlib.inflateSync(s);
        const text = decoded.toString("latin1");
        // Look for moveto patterns: "X Y m"
        const matches = [...text.matchAll(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+m\b/g)];
        if (matches.length > 5) {
          paged++;
          const xs = matches.map(m => Number(m[1]));
          const ys = matches.map(m => Number(m[2]));
          const uniqueXs = new Set(xs.map(x => Math.round(x * 10) / 10));
          const uniqueYs = new Set(ys.map(y => Math.round(y * 10) / 10));
          // Flag pages where X/Y are suspiciously few
          const suspect = uniqueXs.size < 30 && matches.length > 100;
          console.log(`page ${paged}: ${matches.length} moveto, ${uniqueXs.size}x ${uniqueYs.size}y unique${suspect ? " ★STACK?" : ""}`);
        }
      } catch (e) {
        // not a flate stream — skip
      }
    }
  });
});
