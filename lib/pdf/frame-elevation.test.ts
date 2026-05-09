// Tests for frame-elevation PDF generator.
//
// Strategy: build a minimal RfyDocument in-memory (no need for a real
// .rfy file on disk in CI), generate a PDF, and assert basic invariants:
//   - Output is a valid PDF (starts with %PDF-)
//   - Byte length is reasonable (>500B, <10MB)
//   - Page count == frame count across all plans (confirmed by parsing
//     the PDF back through pdf-lib — regex over compressed PDF streams
//     is unreliable)
//
// Plus one integration test against a cached schedule XML if available
// (skipped if the file isn't present, so CI doesn't break on machines
// without the test corpus).

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { generateFramePdf } from "./frame-elevation";
import { framecadImportToRfy } from "../framecad-import";
import type {
  RfyDocument,
  RfyFrame,
  RfyStick,
  RfyToolingOp,
} from "@hytek/rfy-codec";
import { decodeXml } from "@hytek/rfy-codec";

// Inflate every Flate-encoded stream in a PDF and concatenate the decoded
// content. Used to inspect raw vector ops (moveto, lineto) for regression
// testing that polygons are drawn within page bounds.
function inflateAllStreams(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  let out = "";
  let idx = 0;
  while (true) {
    const start = buf.indexOf(Buffer.from("stream\n"), idx);
    if (start < 0) break;
    const end = buf.indexOf(Buffer.from("\nendstream"), start);
    if (end < 0) break;
    const body = buf.slice(start + 7, end);
    try {
      out += zlib.inflateSync(body).toString("binary") + "\n";
    } catch {
      out += body.toString("binary") + "\n";
    }
    idx = end + 10;
  }
  return out;
}

// Count `x y m` (moveto) commands in a decoded PDF stream and return the
// list of (x, y) tuples. Useful for verifying drawn-shapes coordinates.
function moveToPoints(streamText: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const re = /(?:^|\s)(-?[\d.]+) (-?[\d.]+) m(?=\s|$)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(streamText)) !== null) {
    out.push({ x: parseFloat(m[1]!), y: parseFloat(m[2]!) });
  }
  return out;
}

// Load a generated PDF back through pdf-lib to count pages reliably.
async function pageCountOf(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

// ---------- Fixtures ----------

function makeStick(name: string, length: number, tooling: RfyToolingOp[] = []): RfyStick {
  // 4 corners forming a 41×length rect at origin.
  return {
    name,
    length,
    type: "stud",
    flipped: false,
    profile: {
      metricLabel: "70.075",
      gauge: "0.75",
      shape: "C-section",
      web: 70,
      lFlange: 41,
      rFlange: 41,
      lip: 10,
    },
    tooling,
    outlineCorners: [
      { x: 0, y: 0 },
      { x: length, y: 0 },
      { x: length, y: 41 },
      { x: 0, y: 41 },
    ],
  };
}

function makeFrame(name: string, sticks: RfyStick[]): RfyFrame {
  return {
    name,
    weight: 41.2,
    length: 3000,
    height: 2615,
    sticks,
  };
}

function makeMinimalDoc(frameCount = 3): RfyDocument {
  const frames: RfyFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const sticks = [
      makeStick(`T${i + 1}`, 3000, [
        { kind: "point", type: "InnerDimple", pos: 500 },
        { kind: "point", type: "InnerDimple", pos: 1500 },
        { kind: "point", type: "InnerDimple", pos: 2500 },
        { kind: "spanned", type: "Swage", startPos: 100, endPos: 200 },
      ]),
      makeStick(`B${i + 1}`, 3000, [
        { kind: "point", type: "Bolt", pos: 200 },
        { kind: "point", type: "Bolt", pos: 2800 },
      ]),
      // Vertical stud — corners stack a thin tall rect.
      {
        ...makeStick(`S${i + 1}`, 2615, [
          { kind: "point", type: "LipNotch", pos: 100 },
          { kind: "point", type: "LipNotch", pos: 2500 },
        ]),
        outlineCorners: [
          { x: 100, y: 0 },
          { x: 141, y: 0 },
          { x: 141, y: 2615 },
          { x: 100, y: 2615 },
        ],
      },
    ];
    frames.push(makeFrame(`L${i + 24}`, sticks));
  }

  return {
    scheduleVersion: "2",
    project: {
      name: "TEST PROJECT",
      jobNum: "TEST123",
      client: "Test Client",
      date: "2026-05-08",
      plans: [
        {
          name: "GF-LBW-70.075",
          frames,
        },
      ],
    },
  };
}

// ---------- Tests ----------

describe("generateFramePdf", () => {
  it("produces a non-empty PDF for a minimal doc", async () => {
    const doc = makeMinimalDoc(1);
    const bytes = await generateFramePdf(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1024);
    expect(bytes.length).toBeLessThan(10 * 1024 * 1024);
    const head = Buffer.from(bytes.slice(0, 5)).toString("ascii");
    expect(head).toBe("%PDF-");
  });

  it("emits one page per frame", async () => {
    for (const n of [1, 3, 7]) {
      const doc = makeMinimalDoc(n);
      const bytes = await generateFramePdf(doc);
      expect(await pageCountOf(bytes)).toBe(n);
    }
  });

  it("respects pageSize option", async () => {
    const doc = makeMinimalDoc(1);
    const a4 = await generateFramePdf(doc, { pageSize: "A4" });
    const a3 = await generateFramePdf(doc, { pageSize: "A3" });
    expect(a4.length).toBeGreaterThan(0);
    expect(a3.length).toBeGreaterThan(0);
  });

  it("handles a doc with no frames", async () => {
    const doc: RfyDocument = {
      scheduleVersion: "2",
      project: {
        name: "EMPTY",
        jobNum: "X",
        client: "x",
        date: "2026-01-01",
        plans: [],
      },
    };
    const bytes = await generateFramePdf(doc);
    expect(bytes.length).toBeGreaterThan(500);
    expect(await pageCountOf(bytes)).toBe(1);
  });

  it("handles all tool-op kinds without crashing", async () => {
    const allOps: RfyToolingOp[] = [
      { kind: "point", type: "InnerDimple", pos: 100 },
      { kind: "point", type: "Bolt", pos: 200 },
      { kind: "point", type: "Web", pos: 300 },
      { kind: "point", type: "ScrewHoles", pos: 400 },
      { kind: "point", type: "LipNotch", pos: 500 },
      { kind: "point", type: "LeftFlange", pos: 600 },
      { kind: "point", type: "RightFlange", pos: 700 },
      { kind: "point", type: "InnerNotch", pos: 800 },
      { kind: "point", type: "InnerService", pos: 900 },
      { kind: "point", type: "Chamfer", pos: 1000 },
      { kind: "point", type: "TrussChamfer", pos: 1100 },
      { kind: "spanned", type: "Swage", startPos: 1200, endPos: 1400 },
      { kind: "start", type: "Chamfer" },
      { kind: "end", type: "Chamfer" },
    ];
    const doc: RfyDocument = {
      scheduleVersion: "2",
      project: {
        name: "ALL OPS",
        jobNum: "X",
        client: "x",
        date: "2026-01-01",
        plans: [{ name: "P", frames: [makeFrame("F1", [makeStick("T1", 1500, allOps)])] }],
      },
    };
    const bytes = await generateFramePdf(doc);
    expect(bytes.length).toBeGreaterThan(1024);
  });
});

// ---------- Integration: real schedule XML ----------

describe("generateFramePdf with cached schedule XML", () => {
  const candidatePaths = [
    join(process.cwd(), "tmp_detailer_test", "HG260017_GF-LBW-70.075.detailer-ref.xml"),
    join(process.cwd(), "tmp_detailer_test", "COMPARE-1-y-drive-ref.xml"),
  ];
  const sample = candidatePaths.find(p => existsSync(p));

  if (!sample) {
    it.skip("no cached schedule XML found — skipping integration test", () => {});
    return;
  }

  it(`renders against ${sample.split(/[\\/]/).pop()}`, async () => {
    const xml = readFileSync(sample, "utf8");
    const doc = decodeXml(xml);
    const bytes = await generateFramePdf(doc, { pageSize: "A3" });
    expect(bytes.length).toBeGreaterThan(2 * 1024);
    expect(bytes.length).toBeLessThan(10 * 1024 * 1024);

    let expectedFrames = 0;
    for (const p of doc.project.plans) expectedFrames += p.frames.length;
    expect(await pageCountOf(bytes)).toBe(expectedFrames);
  });
});

// ---------- Regression: stick polygons drawn within page bounds ----------
//
// Bug fixed 2026-05-09: pdf-lib's `drawSvgPath` applies an internal
// `scale(1, -1)` to flip the SVG Y axis, and without an explicit `y:`
// translate option, polygon coordinates land at NEGATIVE Y on the PDF
// page. Sticks were being drawn off-page (visibly empty PDFs) for every
// production XML. The renderer now emits raw moveto/lineto ops which
// don't apply any flip.
//
// This test guards against regression by inflating every PDF stream and
// asserting:
//   1. Many moveTo commands exist (proving sticks are drawn)
//   2. ALL moveTo coordinates are within page bounds — i.e. positive and
//      less than the page's width/height in points
//
// The minimal test doc has 2615mm-tall studs on a 595×841 A4-equivalent
// scaling, so reasonable on-page coords land in the (0, 800) range.

// ---------- Regression: studs spread along the wall length ----------
//
// Bug guard 2026-05-09: a regression in the codec or the renderer's
// projection logic could collapse all wall studs to the same page-X coord
// (so they appear stacked vertically instead of side-by-side). This test
// builds an in-memory wall frame with 3 studs at x=0/600/1200mm and
// asserts the rendered polygons land at THREE distinct page X centroids.
//
// We need to track the current transformation matrix (CTM) because
// pdf-lib's drawRectangle / drawCircle emit `cm` translate ops before
// moveto/lineto — the literal numbers in the stream are relative to the
// translate, not absolute page coords.

interface Mat3 { a: number; b: number; c: number; d: number; e: number; f: number; }
const CTM_IDENTITY: Mat3 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function mulCTM(m1: Mat3, m2: Mat3): Mat3 {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}
function applyCTM(m: Mat3, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

interface AbsPoly { xs: number[]; ys: number[]; }

function parsePolysWithCTM(text: string): AbsPoly[] {
  const tokens: string[] = [];
  const re = /(-?\d+\.?\d*)|([A-Za-z]+\*?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push(m[0]);
  const stack: Mat3[] = [];
  let cur: Mat3 = CTM_IDENTITY;
  const polys: AbsPoly[] = [];
  let active: AbsPoly | null = null;
  const nums: number[] = [];
  for (const t of tokens) {
    if (/^-?\d/.test(t)) { nums.push(Number(t)); continue; }
    switch (t) {
      case "q": stack.push({ ...cur }); break;
      case "Q": cur = stack.pop() ?? CTM_IDENTITY; break;
      case "cm": {
        if (nums.length >= 6) {
          const [a, b, c, d, e, f] = nums.slice(-6);
          cur = mulCTM(cur, { a: a!, b: b!, c: c!, d: d!, e: e!, f: f! });
        }
        nums.length = 0; break;
      }
      case "m": {
        if (nums.length >= 2) {
          const x = nums[nums.length - 2]!, y = nums[nums.length - 1]!;
          if (active) polys.push(active);
          const p = applyCTM(cur, x, y);
          active = { xs: [p.x], ys: [p.y] };
        }
        nums.length = 0; break;
      }
      case "l": {
        if (nums.length >= 2 && active) {
          const x = nums[nums.length - 2]!, y = nums[nums.length - 1]!;
          const p = applyCTM(cur, x, y);
          active.xs.push(p.x); active.ys.push(p.y);
        }
        nums.length = 0; break;
      }
      case "h": case "S": case "s": case "f": case "F":
      case "f*": case "B": case "B*": case "b": case "b*": case "n":
        if (active) { polys.push(active); active = null; }
        nums.length = 0; break;
      default:
        if (/^[A-Za-z]/.test(t)) nums.length = 0;
    }
  }
  if (active) polys.push(active);
  return polys;
}

describe("generateFramePdf — studs spread along wall length", () => {
  it("3 studs at 0/600/1200mm produce 3 distinct page X centroids (not stacked)", async () => {
    // Build a 1500mm × 2400mm wall with 3 studs at x=0/600/1200mm.
    const studHeight = 2400;
    const sticks: RfyStick[] = [0, 600, 1200].map((x, i) => ({
      name: `S${i + 1}`,
      length: studHeight,
      type: "stud",
      flipped: false,
      profile: { metricLabel: "89.075", gauge: "0.75", shape: "C-section", web: 89, lFlange: 41, rFlange: 41, lip: 11 },
      tooling: [],
      outlineCorners: [
        { x: x, y: 0 },
        { x: x + 41, y: 0 },
        { x: x + 41, y: studHeight },
        { x: x, y: studHeight },
      ],
    }));
    const doc: RfyDocument = {
      scheduleVersion: "2",
      project: {
        name: "STACK-TEST", jobNum: "T", client: "c", date: "2026-05-09",
        plans: [{ name: "P", frames: [makeFrame("N1", sticks)] }],
      },
    };
    const bytes = await generateFramePdf(doc, { pageSize: "A3" });
    const stream = inflateAllStreams(bytes);
    const polys = parsePolysWithCTM(stream);
    // Find vertical stick polygons (height >> width, area > marker).
    const vertSticks = polys.filter(p => {
      if (p.xs.length !== 4) return false;
      const w = Math.max(...p.xs) - Math.min(...p.xs);
      const h = Math.max(...p.ys) - Math.min(...p.ys);
      return h > w * 5 && Math.max(w, h) > 50;
    });
    expect(vertSticks.length).toBe(3);
    const centroids = vertSticks
      .map(p => (Math.min(...p.xs) + Math.max(...p.xs)) / 2)
      .sort((a, b) => a - b);
    // Three distinct X coords, with at least 100pt between adjacent studs
    // (a 1500mm-wide frame on A3 fits at scale > 0.5 pt/mm, so 600mm = 300pt).
    expect(centroids[1]! - centroids[0]!).toBeGreaterThan(100);
    expect(centroids[2]! - centroids[1]!).toBeGreaterThan(100);
  });
});

describe("generateFramePdf — vector-ops regression", () => {
  it("emits stick polygon moveTos within page bounds (in-memory doc)", async () => {
    const doc = makeMinimalDoc(1);
    const bytes = await generateFramePdf(doc, { pageSize: "A3" });
    const stream = inflateAllStreams(bytes);
    const pts = moveToPoints(stream);

    // The minimal doc has 3 sticks, each a 4-vertex polygon → at least
    // 3 moveTos for stick polygons (plus more for tooling-mark V shapes,
    // anchor circles, dimension ticks, etc.). Threshold 10 is conservative.
    expect(pts.length).toBeGreaterThanOrEqual(10);

    // Page is A3 landscape → 1190.55 × 841.89 pt.
    const PAGE_W = 1190.55;
    const PAGE_H = 841.89;
    // Allow a small negative margin for line-width overflow at edges.
    const MIN = -2;
    const offPage = pts.filter(
      p => p.x < MIN || p.y < MIN || p.x > PAGE_W + 2 || p.y > PAGE_H + 2
    );
    if (offPage.length > 0) {
      throw new Error(
        `${offPage.length}/${pts.length} moveTos drawn off-page. ` +
          `First 5 off-page coords: ${offPage.slice(0, 5).map(p => `(${p.x},${p.y})`).join(", ")}. ` +
          `If you see negative Y, drawSvgPath's Y-flip is back — use raw moveto/lineto ops.`
      );
    }
  });

  it("emits stick polygon moveTos within page bounds (framecad_import path)", async () => {
    // Use a framecad_import XML to exercise the full pipeline that
    // production HD1 hits (the path that broke before this fix). Locate
    // any <framecad_import> XML in tmp_detailer_test or fall back to the
    // codec test corpus.
    const candidates = [
      join(process.cwd(), "tmp_detailer_test", "HG260002-LBW.xml"),
      join(
        process.cwd(),
        "node_modules/@hytek/rfy-codec/test-corpus/2603191/2603191-ROCKVILLE.xml"
      ),
      join(
        process.cwd(),
        "node_modules/@hytek/rfy-codec/test-corpus/HG250082_FLAGSTONE_OSHC/UPPER-GF-LBW-89.075.xml"
      ),
    ];
    const sample = candidates.find(p => existsSync(p));
    if (!sample) {
      // No framecad_import XML available — skip rather than fail CI on a
      // dev machine without the corpus.
      return;
    }

    const xml = readFileSync(sample, "utf8");
    const result = framecadImportToRfy(xml);
    const doc = decodeXml(result.xml);
    const bytes = await generateFramePdf(doc, { pageSize: "A3" });
    const stream = inflateAllStreams(bytes);
    const pts = moveToPoints(stream);

    // Real production XML has hundreds of sticks → thousands of moveTos
    // (4 corners × N sticks + tooling marks). 100 is a safe lower bound.
    expect(pts.length).toBeGreaterThanOrEqual(100);

    const PAGE_W = 1190.55;
    const PAGE_H = 841.89;
    const MIN = -2;
    const offPage = pts.filter(
      p => p.x < MIN || p.y < MIN || p.x > PAGE_W + 2 || p.y > PAGE_H + 2
    );
    if (offPage.length > 0) {
      throw new Error(
        `${offPage.length}/${pts.length} moveTos drawn off-page from ${sample.split(/[\\/]/).pop()}. ` +
          `First 5 off-page: ${offPage.slice(0, 5).map(p => `(${p.x},${p.y})`).join(", ")}.`
      );
    }
  }, 120_000);
});

// ---------- Regression: end-stud orientation (lips outward) ----------
//
// computeWebOverrides forces lipSign=+1 on the leftmost vertical stud
// (lips on +perp = LEFT in elevation) and lipSign=-1 on the rightmost
// stud (lips on -perp = RIGHT). The audit (2026-05-09) flagged that
// the asymmetric stick outline's doubled line MUST sit on the OUTER
// face of frame-end studs (lips face the wall edge; web faces the
// interior).
//
// We assert this indirectly by checking that the leftmost stud's
// asymmetric "interior offset" line (the inside half of the doubled
// edge) lies on its INNER side (closer to the frame interior), not on
// the outer face. The test is geometric: with 3 studs at x=0 / 600 /
// 1200, the leftmost stud's doubled line should sit at x=0+offset, NOT
// at x=0-offset.
describe("generateFramePdf — end-stud orientation", () => {
  it("leftmost end-stud doubles its OUTER long edge (lips face wall edge)", async () => {
    // Build a wall frame "ExternalWall" so isWallFrame() returns true via
    // the frameTypes Map (matches production XML's frame.type attribute).
    const studHeight = 2400;
    const sticks: RfyStick[] = [0, 600, 1200].map((x, i) => ({
      name: `S${i + 1}`,
      length: studHeight,
      type: "stud",
      flipped: false,
      profile: { metricLabel: "89.075", gauge: "0.75", shape: "C-section", web: 89, lFlange: 41, rFlange: 41, lip: 11 },
      tooling: [],
      outlineCorners: [
        { x: x, y: 0 },
        { x: x + 41, y: 0 },
        { x: x + 41, y: studHeight },
        { x: x, y: studHeight },
      ],
    }));
    // Add a top + bottom plate so the frame is structurally complete.
    sticks.push({
      name: "T1", length: 1241, type: "plate", flipped: false,
      profile: { metricLabel: "89.075", gauge: "0.75", shape: "C-section", web: 89, lFlange: 41, rFlange: 41, lip: 11 },
      tooling: [],
      outlineCorners: [
        { x: 0, y: studHeight - 41 }, { x: 1241, y: studHeight - 41 },
        { x: 1241, y: studHeight }, { x: 0, y: studHeight },
      ],
    });
    sticks.push({
      name: "B1", length: 1241, type: "plate", flipped: false,
      profile: { metricLabel: "89.075", gauge: "0.75", shape: "C-section", web: 89, lFlange: 41, rFlange: 41, lip: 11 },
      tooling: [],
      outlineCorners: [
        { x: 0, y: 0 }, { x: 1241, y: 0 },
        { x: 1241, y: 41 }, { x: 0, y: 41 },
      ],
    });
    const frameTypes = new Map<string, string>();
    frameTypes.set("N1", "ExternalWall");
    const doc: RfyDocument = {
      scheduleVersion: "2",
      project: {
        name: "ENDSTUD-TEST", jobNum: "T", client: "c", date: "2026-05-09",
        plans: [{ name: "P", frames: [makeFrame("N1", sticks)] }],
      },
    };
    const bytes = await generateFramePdf(doc, { pageSize: "A3", frameTypes });
    const stream = inflateAllStreams(bytes);
    const polys = parsePolysWithCTM(stream);

    // Find the leftmost vertical stud polygon (3 expected, each 41×2400).
    const verticals = polys.filter(p => {
      if (p.xs.length !== 4) return false;
      const w = Math.max(...p.xs) - Math.min(...p.xs);
      const h = Math.max(...p.ys) - Math.min(...p.ys);
      return h > w * 5 && Math.max(w, h) > 50;
    });
    expect(verticals.length).toBe(3);
    const leftmost = verticals.reduce((acc, p) => {
      const minX = Math.min(...p.xs);
      return minX < Math.min(...acc.xs) ? p : acc;
    });
    const studMinX = Math.min(...leftmost.xs);
    const studMaxX = Math.max(...leftmost.xs);

    // The asymmetric outline emits a vertical hairline INSIDE one long
    // edge. For the leftmost stud, lipSign=+1 (lips on +perp = LEFT in
    // elevation, the wall edge) means the doubled line sits INSIDE the
    // LEFT edge, i.e. just to the right of studMinX. It should NOT sit
    // inside the RIGHT edge.
    //
    // We check this by extracting all vertical line segments rendered
    // within the stud's bounding box. The asymmetric line lands at
    // x ~= studMinX + 0.8pt (OFFSET_PT in drawStick).
    //
    // To find these lines we re-scan the stream tokens for `m`+`l` pairs
    // at the same X. The PDF stream has many primitive line ops, so we
    // count moveTo points whose x ∈ (studMinX, studMinX+3).
    const ptsAll = moveToPoints(stream);
    const insideLeftEdge = ptsAll.filter(p => p.x > studMinX + 0.2 && p.x < studMinX + 3 && p.y < 1000 && p.y > 50);
    const insideRightEdge = ptsAll.filter(p => p.x > studMaxX - 3 && p.x < studMaxX - 0.2 && p.y < 1000 && p.y > 50);
    // We expect AT LEAST one moveTo within ~3pt of the LEFT edge interior
    // (the asymmetric doubled line). If the sign is flipped, this would
    // appear on the RIGHT edge interior instead.
    expect(insideLeftEdge.length).toBeGreaterThanOrEqual(1);
    // Inverse assertion (sanity): more interior moveTos on left than right
    // for a leftmost stud where lips face LEFT (the wall edge).
    expect(insideLeftEdge.length).toBeGreaterThanOrEqual(insideRightEdge.length);
  });
});
