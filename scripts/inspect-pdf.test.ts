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
        const moves = [...text.matchAll(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+m\b/g)];
        const lines = [...text.matchAll(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+l\b/g)];
        if (moves.length > 5) {
          paged++;
          // Only sample STICK polygons: groups of (m, l, l, l, h) where
          // the 4 points form a rectangle. Approach: scan moveto and the
          // next 3 lineto pairs, treat as a polygon.
          const ops: { x: number; y: number; op: string }[] = [];
          for (const m of [...text.matchAll(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(m|l)\b/g)]) {
            ops.push({ x: Number(m[1]), y: Number(m[2]), op: m[3]! });
          }
          // Group polygons: m followed by lineTos until next m
          const polys: { xs: number[]; ys: number[] }[] = [];
          let cur: { xs: number[]; ys: number[] } | null = null;
          for (const o of ops) {
            if (o.op === "m") {
              if (cur) polys.push(cur);
              cur = { xs: [o.x], ys: [o.y] };
            } else if (cur) {
              cur.xs.push(o.x);
              cur.ys.push(o.y);
            }
          }
          if (cur) polys.push(cur);
          // Stick polygons: 4 corners, AND area larger than marker triangle.
          const sticks = polys.filter(p => {
            if (p.xs.length !== 4) return false;
            const w = Math.max(...p.xs) - Math.min(...p.xs);
            const h = Math.max(...p.ys) - Math.min(...p.ys);
            // Real sticks are at least ~10pt long; markers are <8pt.
            return Math.max(w, h) > 12;
          });
          // Compute the X "centroid" (average) of each polygon.
          const stickXs = sticks.map(p => (Math.min(...p.xs) + Math.max(...p.xs)) / 2);
          // For typical wall frames, expect ~5-15 sticks with distinct X.
          const uniqStickXs = new Set(stickXs.map(x => Math.round(x * 10) / 10));
          // Page is "stacked" if there are >5 stick polys but <3 unique X.
          const stacked = sticks.length >= 3 && uniqStickXs.size <= Math.ceil(sticks.length / 3);
          if (stacked || (sticks.length >= 5 && uniqStickXs.size <= 4)) {
            console.log(`page ${paged}: ${sticks.length} stick polys, ${uniqStickXs.size} unique X centroids${stacked ? " ★STACKED" : ""}`);
            console.log(`  stick X centroids: ${[...uniqStickXs].sort((a,b)=>a-b).join(", ")}`);
          }
        }
      } catch (e) {
        // not a flate stream — skip
      }
    }
  });
});
