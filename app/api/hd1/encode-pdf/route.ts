// HD1 — XML → PDF (frame elevation).
//
// Thin HD1-namespaced wrapper around `generateFramePdf()` from
// `lib/pdf/frame-elevation.ts` (Agent 2's output). The single source of
// truth for the renderer lives there; this route exists so HD1 can have
// its own URL surface (`/api/hd1/...`) for the future case where we want
// to add HD1-specific options without churning the shared `/api/generate-pdf`
// endpoint.
import { NextResponse } from "next/server";
import { decodeXml } from "@hytek/rfy-codec";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { readBodyText } from "@/lib/read-body";
import { generateFramePdf, type PdfPageSize } from "@/lib/pdf/frame-elevation";

export const runtime = "nodejs";
// Match `/api/generate-pdf`'s budget — typical jobs render <2s, large packed
// XMLs stay under 10s on Vercel's lambda.
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.xml");
    const xml = (await readBodyText(req)).trim();
    if (!xml) throw new Error("Empty input");

    const url = new URL(req.url);
    const pageSize = (url.searchParams.get("pageSize") ?? "A3") as PdfPageSize;
    const showDimensions = url.searchParams.get("dimensions") !== "0";
    const showToolingMarks = url.searchParams.get("tooling") !== "0";

    const lower = xml.toLowerCase();
    let scheduleXml: string;
    if (lower.includes("<framecad_import")) {
      const result = framecadImportToRfy(xml);
      if (result.stickCount === 0) throw new Error("No sticks found in <framecad_import> document.");
      scheduleXml = result.xml;
    } else if (lower.includes("<schedule")) {
      scheduleXml = xml;
    } else {
      throw new Error("Expected <framecad_import> or <schedule> XML at top level.");
    }

    const doc = decodeXml(scheduleXml);
    if (doc.project.plans.length === 0) throw new Error("Decoded document has no plans.");

    const pdfBytes = await generateFramePdf(doc, { pageSize, showDimensions, showToolingMarks });
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
        "x-pdf-source": "frame-elevation",
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
