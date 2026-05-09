// Diagnostic — print outlineCorners for given frames in an XML.
// Run: npx vitest run scripts/diag-pdf-stack.test.ts
import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeXml } from "@hytek/rfy-codec";
import { framecadImportToRfy } from "../lib/framecad-import";

describe("diag NLBW outlineCorners", () => {
  it("dumps stick corners for selected frames", async () => {
    const xmlPath = join(process.cwd(),
      "node_modules/@hytek/rfy-codec/test-corpus/HG260012_23_SPRINGWOOD_ST_TOWNHOUSES/TH01-1F-NLBW-89.075.xml"
    );
    const xml = readFileSync(xmlPath, "utf8");
    const result = framecadImportToRfy(xml);
    const doc = decodeXml(result.xml);
    const wanted = new Set(["N1115", "N1116", "N1119", "N1120"]);
    for (const plan of doc.project.plans) {
      for (const frame of plan.frames) {
        if (!wanted.has(frame.name)) continue;
        console.log(`\n=== ${plan.name} / ${frame.name} ===`);
        for (const stick of frame.sticks) {
          const c = stick.outlineCorners;
          if (!c) {
            console.log(`  ${stick.name}: NO outlineCorners`);
            continue;
          }
          const xs = c.map(p => p.x);
          const ys = c.map(p => p.y);
          console.log(
            `  ${stick.name.padEnd(6)} type=${(stick.type || "?").padEnd(8)}` +
            ` x=[${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}]` +
            ` y=[${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)}]`
          );
        }
      }
    }
  });
});
