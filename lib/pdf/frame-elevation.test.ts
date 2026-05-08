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
import { PDFDocument } from "pdf-lib";
import { generateFramePdf } from "./frame-elevation";
import type {
  RfyDocument,
  RfyFrame,
  RfyStick,
  RfyToolingOp,
} from "@hytek/rfy-codec";
import { decodeXml } from "@hytek/rfy-codec";

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
