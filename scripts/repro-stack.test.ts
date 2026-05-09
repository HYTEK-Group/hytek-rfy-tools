// Reproduce: generate the PDF from a known NLBW XML and check that
// studs in each frame are at DIFFERENT page X coords (not stacked).
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { decodeXml } from "@hytek/rfy-codec";
import { generateFramePdf } from "../lib/pdf/frame-elevation";
import { framecadImportToRfy } from "../lib/framecad-import";

describe("PDF stack repro", () => {
  it("renders NLBW frames; checks studs spread along page X", async () => {
    const xmlPath = join(process.cwd(),
      "node_modules/@hytek/rfy-codec/test-corpus/HG260012_23_SPRINGWOOD_ST_TOWNHOUSES/TH01-1F-NLBW-89.075.xml"
    );
    const xml = readFileSync(xmlPath, "utf8");
    const result = framecadImportToRfy(xml);
    const doc = decodeXml(result.xml);

    const bytes = await generateFramePdf(doc, { pageSize: "A3" });
    const outPath = join(process.cwd(), "scripts", "out-NLBW-test.pdf");
    writeFileSync(outPath, bytes);
    console.log(`wrote ${outPath} (${(bytes.length/1024).toFixed(1)} KB)`);

    // Decode each page's stream and count unique X coordinates of moveto.
    const buf = Buffer.from(bytes);
    let pi = 0, lowX = 0;
    let off = 0;
    while (off < buf.length) {
      const sIdx = buf.indexOf("stream\n", off);
      if (sIdx === -1) break;
      const eIdx = buf.indexOf("endstream", sIdx + 7);
      if (eIdx === -1) break;
      const data = buf.slice(sIdx + 7, eIdx);
      off = eIdx + 9;
      try {
        const decoded = zlib.inflateSync(data);
        const text = decoded.toString("latin1");
        const matches = [...text.matchAll(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+m\b/g)];
        if (matches.length > 5) {
          pi++;
          const xs = matches.map(m => Number(m[1]));
          const uniq = new Set(xs.map(x => Math.round(x*10)/10));
          if (uniq.size < 30 && matches.length > 100) {
            lowX++;
            console.log(`★ page ${pi}: ${matches.length} moveto, only ${uniq.size} unique X — possible stack`);
          }
        }
      } catch {}
    }
    console.log(`Total flagged: ${lowX}`);
  });
});
