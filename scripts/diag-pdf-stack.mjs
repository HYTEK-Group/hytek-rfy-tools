import { framecadImportToRfy } from "../lib/framecad-import.ts";
import { decodeXml } from "@hytek/rfy-codec";
import { readFileSync } from "node:fs";

const xmlPath = process.argv[2];
const xml = readFileSync(xmlPath, "utf8");
const result = framecadImportToRfy(xml);
const doc = decodeXml(result.xml);

const wantedFrames = process.argv[3] ? process.argv[3].split(",") : null;

for (const plan of doc.project.plans) {
  for (const frame of plan.frames) {
    if (wantedFrames && !wantedFrames.includes(frame.name)) continue;
    console.log(`\n=== ${plan.name} / ${frame.name} ===`);
    for (const stick of frame.sticks) {
      const c = stick.outlineCorners;
      if (!c) {
        console.log(`  ${stick.name}: NO outlineCorners`);
        continue;
      }
      const xs = c.map(p => p.x);
      const ys = c.map(p => p.y);
      console.log(`  ${stick.name.padEnd(6)} type=${(stick.type||"?").padEnd(8)} x=[${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}] y=[${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)}] corners=${JSON.stringify(c.map(p=>[+p.x.toFixed(1),+p.y.toFixed(1)]))}`);
    }
  }
}
