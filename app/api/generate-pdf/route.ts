// FrameCAD XML → Manufacturing PDF (frame elevations).
//
// Replaces FrameCAD Detailer's Manufacturing PDF output (Detailer EOL
// 2026-05-14). One PDF page per frame, showing the elevation drawing
// with stick outlines and tooling marks.
//
// Accepts either:
//   - Decoded schedule XML (root: <schedule>...<frame>...) — used directly.
//   - <framecad_import> XML — pumped through framecadImportToRfy() first
//     to synthesize tooling-op positions, then decoded.
//
// Output: application/pdf with content-disposition attachment.

import { NextResponse } from "next/server";
import { decodeXml } from "@hytek/rfy-codec";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { readBodyText } from "@/lib/read-body";
import { generateFramePdf, type PdfPageSize } from "@/lib/pdf/frame-elevation";

export const runtime = "nodejs";

// 30s safety budget — typical 30-frame job renders in <2s; large packed
// XMLs with 100+ frames stay under 10s on Vercel's lambda.
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.xml");
    const xml = (await readBodyText(req)).trim();
    if (!xml) throw new Error("Empty input");

    // Optional query string controls.
    const url = new URL(req.url);
    const pageSize = (url.searchParams.get("pageSize") ?? "A3") as PdfPageSize;
    const showDimensions = url.searchParams.get("dimensions") !== "0";
    const showToolingMarks = url.searchParams.get("tooling") !== "0";

    const lower = xml.toLowerCase();
    let scheduleXml: string;
    let frameTypes: Map<string, string> | undefined = undefined;
    let frameDiagonals: Map<string, { start: { x: number; y: number }; end: { x: number; y: number } }[]> | undefined = undefined;
    let frameFasteners: Map<string, { pos: { x: number; y: number }; name: string; count: number }[]> | undefined = undefined;
    let frameLabels: Map<string, { pos: { x: number; y: number }; text: string; size: number; angle: number }[]> | undefined = undefined;
    let frameElevations: Map<string, number> | undefined = undefined;

    if (lower.includes("<framecad_import")) {
      // Synthesize via codec — fills in tooling-op positions.
      const result = framecadImportToRfy(xml);
      if (result.stickCount === 0) {
        throw new Error("No sticks found in <framecad_import> document.");
      }
      scheduleXml = result.xml;
      frameTypes = result.frameTypes;
      frameDiagonals = result.frameDiagonals;
      frameFasteners = result.frameFasteners;
      frameLabels = result.frameLabels;
      frameElevations = result.frameElevations;
    } else if (lower.includes("<schedule")) {
      scheduleXml = xml;
    } else {
      throw new Error(
        "Expected <framecad_import> or <schedule> XML at top level. " +
        "If this is an RFY file, use the decode flow first."
      );
    }

    const doc = decodeXml(scheduleXml);
    if (doc.project.plans.length === 0) {
      throw new Error("Decoded document has no plans.");
    }

    const pdfBytes = await generateFramePdf(doc, {
      pageSize,
      showDimensions,
      showToolingMarks,
      frameTypes,
      frameDiagonals,
      frameFasteners,
      frameLabels,
      frameElevations,
    });

    const safeJob = (doc.project.jobNum || "frames").replace(/[^A-Za-z0-9]/g, "");
    const baseName = filename.replace(/\.(xml|txt)$/i, "");
    const outName = `${safeJob || baseName}_frames.pdf`;

    let frameCount = 0;
    for (const p of doc.project.plans) frameCount += p.frames.length;

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${outName}"`,
        "x-frame-count": String(frameCount),
        "x-plan-count": String(doc.project.plans.length),
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
