import { framecadImportToRfy } from "../lib/framecad-import.ts";
import { decodeXml } from "@hytek/rfy-codec";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const xml = readFileSync(join(process.cwd(), "node_modules/@hytek/rfy-codec/test-corpus/HG250057_SE25_LOT_99_RATNAM_ROAD_REDBANK_PLAINS/U2-GF-TIN-70.075.xml"), "utf8");
console.log("Input XML length:", xml.length);
console.log("First 200 chars:", xml.slice(0, 200));

const result = framecadImportToRfy(xml);
console.log("Schedule XML length:", result.xml.length);
console.log("stick count:", result.stickCount);

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

// Inspect first stick of first frame
const firstFrame = doc.project.plans[0]?.frames?.[0];
const firstStick = firstFrame?.sticks?.[0];
if (firstStick) {
  console.log("First stick name:", firstStick.name);
  console.log("First stick outlineCorners:", JSON.stringify(firstStick.outlineCorners));
}

// Print first stick's elevation-graphics from raw schedule XML
const schedXml = result.xml;
const stickStart = schedXml.indexOf("<stick");
if (stickStart >= 0) {
  const stickEnd = schedXml.indexOf("</stick>", stickStart);
  console.log("First <stick> XML snippet (first 1500 chars):");
  console.log(schedXml.slice(stickStart, Math.min(stickEnd + 8, stickStart + 1500)));
}
