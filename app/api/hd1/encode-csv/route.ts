// HD1 — XML → CSV.
//
// Strategy: synthesize XML → ParsedProject → RfyDocument (via the codec's
// existing pipeline), then emit a Howick-format CSV via generateHowickCsv()
// (Agent 1's exporter, codec commit bc8f6d7).
//
// generateHowickCsv() walks every plan/frame/stick in the document and
// produces a single combined CSV — no per-plan splitting, no concatenation.
// The Howick rollformer firmware consumes one CSV per project.
import { NextResponse } from "next/server";
import { decodeXml, generateHowickCsv } from "@hytek/rfy-codec";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { readBodyText } from "@/lib/read-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.xml");
    const xml = (await readBodyText(req)).trim();
    if (!xml) throw new Error("Empty input");

    const lower = xml.toLowerCase();
    if (!lower.includes("<framecad_import")) {
      throw new Error("Expected <framecad_import> XML at the top level.");
    }

    const result = framecadImportToRfy(xml);
    if (result.stickCount === 0) throw new Error("No sticks found in <framecad_import> document.");
    const doc = decodeXml(result.xml);
    const csv = generateHowickCsv(doc);
    if (!csv || csv.trim().length === 0) throw new Error("Howick CSV exporter produced no output.");

    const baseName = filename.replace(/\.xml$/i, "");
    const safeJob = (result.jobnum || baseName).replace(/[^A-Za-z0-9._-]/g, "");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${safeJob}.csv"`,
        "x-plan-count": String(doc.project.plans.length),
        "x-csv-format": "howick",
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
