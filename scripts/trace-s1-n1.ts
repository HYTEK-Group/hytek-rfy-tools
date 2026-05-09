// Trace S1 of N1 from XML through to rendered position. Then compare to
// Detailer's reference. The aim: lock the flipped→lipSign mapping with
// observed truth, no more guessing.
import { readFileSync } from "node:fs";
import { framecadImportToRfy } from "../lib/framecad-import";
import { decodeXml } from "@hytek/rfy-codec";

async function main() {
  const xml = readFileSync("C:/Users/Scott/Downloads/HG260002-NLBW.xml", "utf8");

  // 1. Pull the raw S1 of N1 from the source XML.
  const n1Block = xml.match(/<frame name="N1"[^]*?<\/frame>/)?.[0] ?? "";
  const s1Block = n1Block.match(/<stick name="S1"[^]*?<\/stick>/)?.[0] ?? "";
  console.log("=== Source XML for N1 / S1 ===");
  console.log(s1Block.slice(0, 400));
  // Extract flipped + start/end + profile
  const flipped = /<flipped>\s*(true|false)\s*<\/flipped>/.exec(s1Block)?.[1];
  const startStr = /<start>([\d.,\- ]+)<\/start>/.exec(s1Block)?.[1]?.trim();
  const endStr = /<end>([\d.,\- ]+)<\/end>/.exec(s1Block)?.[1]?.trim();
  const profile = /<profile([^/]*)\/>/.exec(s1Block)?.[1] ?? "";
  console.log(`\nflipped: ${flipped}`);
  console.log(`start:  ${startStr}`);
  console.log(`end:    ${endStr}`);
  console.log(`profile:${profile}`);

  // Also pull T1 (top plate, flipped=false in HG260002 N1) and B1 (flipped=true).
  const t1Block = n1Block.match(/<stick name="T1"[^]*?<\/stick>/)?.[0] ?? "";
  const b1Block = n1Block.match(/<stick name="B1"[^]*?<\/stick>/)?.[0] ?? "";
  console.log(`\nT1 flipped: ${/<flipped>\s*(true|false)\s*<\/flipped>/.exec(t1Block)?.[1]}`);
  console.log(`B1 flipped: ${/<flipped>\s*(true|false)\s*<\/flipped>/.exec(b1Block)?.[1]}`);

  // 2. Run S1 through the codec's pipeline and inspect the synthesized
  // outline corners. The codec's rectangle is bit-exact-equivalent to
  // Detailer's elevation graphics for this stud.
  const r = framecadImportToRfy(xml);
  const doc = decodeXml(r.xml);
  const n1 = doc.project.plans[0]!.frames.find(f => f.name === "N1")!;
  const s1 = n1.sticks.find(st => st.name === "S1")!;
  console.log(`\n=== S1 in decoded RfyDocument ===`);
  console.log(`stick.flipped: ${s1.flipped}`);
  console.log(`stick.length:  ${s1.length}`);
  console.log(`stick.profile: web=${s1.profile.web} lFlange=${s1.profile.lFlange} rFlange=${s1.profile.rFlange} lip=${s1.profile.lip}`);
  if (s1.outlineCorners) {
    for (let i = 0; i < s1.outlineCorners.length; i++) {
      const c = s1.outlineCorners[i]!;
      console.log(`  corner[${i}]: x=${c.x.toFixed(2)} y=${c.y.toFixed(2)}`);
    }
    const xs = s1.outlineCorners.map(c => c.x);
    const ys = s1.outlineCorners.map(c => c.y);
    console.log(`  bbox X: ${Math.min(...xs).toFixed(2)} .. ${Math.max(...xs).toFixed(2)}  width=${(Math.max(...xs)-Math.min(...xs)).toFixed(2)}`);
    console.log(`  bbox Y: ${Math.min(...ys).toFixed(2)} .. ${Math.max(...ys).toFixed(2)}  height=${(Math.max(...ys)-Math.min(...ys)).toFixed(2)}`);
  }
  // S1's other end stud (S2 — should be the rightmost)
  const s2 = n1.sticks.find(st => st.name === "S2")!;
  console.log(`\nS2 flipped: ${s2.flipped}, corners[0]: x=${s2.outlineCorners?.[0]?.x.toFixed(2)}`);
  // List all studs in N1
  const studsByX = n1.sticks
    .filter(st => st.outlineCorners && st.type === "stud")
    .map(st => ({
      name: st.name,
      flipped: st.flipped,
      cx: (st.outlineCorners![0]!.x + st.outlineCorners![2]!.x) / 2,
    }))
    .sort((a, b) => a.cx - b.cx);
  console.log(`\nN1 studs by elevation X (left to right):`);
  for (const s of studsByX) console.log(`  ${s.name}: flipped=${s.flipped}  cx=${s.cx.toFixed(2)}mm`);
}
main().catch(e => { console.error(e); process.exit(1); });
