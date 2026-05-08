// Generate a sample frame-elevation PDF from a cached schedule XML.
// Run via vitest (any test runner that handles TS): `npx vitest run scripts/generate-sample-pdf.ts`
//
// Output: public/sample-frame.pdf — referenced from /generate page docs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { decodeXml } from "@hytek/rfy-codec";
import { describe, it, expect } from "vitest";
import { generateFramePdf } from "../lib/pdf/frame-elevation";

describe("sample PDF generator", () => {
  it("emits public/sample-frame.pdf from a cached schedule XML", async () => {
    const candidates = [
      join(process.cwd(), "tmp_detailer_test", "HG260017_GF-LBW-70.075.detailer-ref.xml"),
      join(process.cwd(), "tmp_detailer_test", "COMPARE-1-y-drive-ref.xml"),
    ];
    const sample = candidates.find(p => existsSync(p));
    if (!sample) {
      console.warn("[sample-pdf] no cached XML — skipping");
      return;
    }

    console.log(`[sample-pdf] reading ${sample}`);
    const xml = readFileSync(sample, "utf8");
    const doc = decodeXml(xml);

    let frameCount = 0;
    for (const p of doc.project.plans) frameCount += p.frames.length;
    console.log(`[sample-pdf] project=${doc.project.name} plans=${doc.project.plans.length} frames=${frameCount}`);

    const t0 = Date.now();
    const bytes = await generateFramePdf(doc, { pageSize: "A3" });
    const ms = Date.now() - t0;

    const out = join(process.cwd(), "public", "sample-frame.pdf");
    writeFileSync(out, bytes);
    console.log(`[sample-pdf] wrote ${out} (${(bytes.length / 1024).toFixed(1)} KB) in ${ms} ms`);

    expect(bytes.length).toBeGreaterThan(2 * 1024);
  });
});
