// Render a Detailer-replacement PDF for HG260002-NLBW.xml so we can
// visually compare against HG260002-NLBW-DETAILER-REF.pdf.
//
// Usage:
//   npx tsx scripts/render-test.ts [output-path]
//
// Default output: C:\Users\Scott\Downloads\HD1-PHASE-X-TEST.pdf where
// X is overridden with --label=B (or --label=C).

import { readFileSync, writeFileSync } from "node:fs";
import { decodeXml } from "@hytek/rfy-codec";
import { framecadImportToRfy } from "../lib/framecad-import";
import { generateFramePdf } from "../lib/pdf/frame-elevation";

const SOURCE_XML = "C:/Users/Scott/Downloads/HG260002-NLBW.xml";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const labelArg = args.find(a => a.startsWith("--label="));
  const label = labelArg ? labelArg.split("=")[1] : "B";
  const outArg = args.find(a => !a.startsWith("--"));
  const outPath = outArg ?? `C:/Users/Scott/Downloads/HD1-PHASE-${label}-TEST.pdf`;

  const xml = readFileSync(SOURCE_XML, "utf8");
  const result = framecadImportToRfy(xml);
  const doc = decodeXml(result.xml);

  const t0 = Date.now();
  const bytes = await generateFramePdf(doc, {
    pageSize: "A3",
    showDimensions: true,
    showToolingMarks: true,
    frameTypes: result.frameTypes,
    frameDiagonals: result.frameDiagonals,
    frameFasteners: result.frameFasteners,
    frameLabels: result.frameLabels,
    frameElevations: result.frameElevations,
  });
  const elapsed = Date.now() - t0;

  writeFileSync(outPath, bytes);
  let frameCount = 0;
  for (const p of doc.project.plans) frameCount += p.frames.length;

  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${outPath} — ${(bytes.length / 1024).toFixed(1)} KB, ` +
    `${frameCount} pages, ${elapsed}ms render time. ` +
    `Diagonals on ${result.frameDiagonals.size} frames; ` +
    `${result.frameFasteners.size} frames have fasteners; ` +
    `${result.frameLabels.size} frames have labels.`
  );
}

main().catch(e => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
