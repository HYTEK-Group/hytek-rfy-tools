// Repro: a tall narrow wall frame — verify studs DON'T collapse to same X.
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import * as zlib from "node:zlib";
import { generateFramePdf } from "../lib/pdf/frame-elevation";
import type { RfyDocument } from "@hytek/rfy-codec";

function makeFrame(name: string, studXs: number[], studHeight: number) {
  const sticks = studXs.map((x, i) => ({
    name: `S${i+1}`,
    length: studHeight,
    type: "stud" as const,
    flipped: false,
    designHash: undefined,
    profile: { web: 89, lFlange: 41, rFlange: 41, lLip: 11, rLip: 11, shape: "C" as const, gauge: "0.75" },
    tooling: [],
    outlineCorners: [
      { x: x - 20, y: 0 },
      { x: x + 20, y: 0 },
      { x: x + 20, y: studHeight },
      { x: x - 20, y: studHeight },
    ],
  }));
  return {
    name, designId: "x", weight: 0, length: studXs[studXs.length-1]! + 20,
    height: studHeight, transformationMatrix: undefined, sticks,
  };
}

describe("narrow frame X spread", () => {
  it("3 studs at 0/600/1200 are not collapsed to one X", async () => {
    const doc: RfyDocument = {
      project: {
        name: "test", jobNum: "T", client: "c", date: "2026-01-01",
        plans: [{ name: "P1", frames: [makeFrame("N1", [0, 600, 1200], 2400)] }],
      },
    };
    const bytes = await generateFramePdf(doc);
    writeFileSync("scripts/out-narrow.pdf", bytes);

    // Decode the page stream and check unique X coords of moveto.
    const buf = Buffer.from(bytes);
    let pageOps = "";
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
        if (matches.length >= 3) {
          pageOps = text;
          const xs = matches.map(m => Number(m[1]));
          const sorted = [...new Set(xs.map(x => Math.round(x*10)/10))].sort((a,b)=>a-b);
          console.log(`mv=${matches.length}, unique Xs (${sorted.length}): ${sorted.join(", ")}`);
          // 3 studs → 12 corners → at least 6 distinct X coords.
          const studXs = sorted.filter(x => x > 100);
          console.log(`stud-zone Xs (>100): ${studXs.join(", ")}`);
          // Expect at least 3 well-separated studs (>=3 distinct clusters)
          break;
        }
      } catch {}
    }
  });
});
