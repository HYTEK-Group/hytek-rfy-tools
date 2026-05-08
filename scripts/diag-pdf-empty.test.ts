// Diagnostic test: does framecadImportToRfy → decodeXml → generateFramePdf
// produce a PDF with stick outlines?
//
// Run: npx vitest run scripts/diag-pdf-empty.test.ts

import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { framecadImportToRfy } from "../lib/framecad-import";
import { decodeXml } from "@hytek/rfy-codec";
import { generateFramePdf } from "../lib/pdf/frame-elevation";

describe("diag pdf empty bug", () => {
  it("framecadImportToRfy → decode → outlineCorners populated", async () => {
    const xml = readFileSync(
      join(
        process.cwd(),
        "node_modules/@hytek/rfy-codec/test-corpus/HG250057_SE25_LOT_99_RATNAM_ROAD_REDBANK_PLAINS/U2-GF-TIN-70.075.xml"
      ),
      "utf8"
    );
    console.log("Input XML length:", xml.length);

    const result = framecadImportToRfy(xml);
    console.log("Schedule XML length:", result.xml.length);
    console.log("stick count from result:", result.stickCount);

    // Save the synthesized schedule for inspection
    writeFileSync(join(process.cwd(), "tmp_detailer_test", "diag-synthesized-schedule.xml"), result.xml);

    const doc = decodeXml(result.xml);
    let stickCount = 0;
    let withCorners = 0;
    let withoutCorners = 0;
    for (const plan of doc.project.plans) {
      for (const frame of plan.frames) {
        for (const stick of frame.sticks) {
          stickCount++;
          if (stick.outlineCorners && stick.outlineCorners.length === 4) withCorners++;
          else withoutCorners++;
        }
      }
    }
    console.log("Total sticks decoded:", stickCount);
    console.log("With outlineCorners:", withCorners);
    console.log("Without outlineCorners:", withoutCorners);

    const firstFrame = doc.project.plans[0]?.frames?.[0];
    const firstStick = firstFrame?.sticks?.[0];
    if (firstStick) {
      console.log("First stick name:", firstStick.name);
      console.log("First stick outlineCorners:", JSON.stringify(firstStick.outlineCorners));
    }

    // Render PDF and write it out
    const pdfBytes = await generateFramePdf(doc, { pageSize: "A3" });
    writeFileSync(join(process.cwd(), "tmp_detailer_test", "diag-output.pdf"), pdfBytes);
    console.log("PDF written:", pdfBytes.length, "bytes");
  }, 120_000);
});
