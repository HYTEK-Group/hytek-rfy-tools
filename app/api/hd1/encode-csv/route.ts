// HD1 — XML → CSV.
//
// Strategy: synthesize XML → ParsedProject → RfyDocument (via the codec's
// existing pipeline), then pull per-plan CSVs out via documentToCsvs().
//
// Single plan: returns one .csv body.
// Multi-plan: concatenates all plan CSVs into a single file.
//
// NOTE: Agent 1 is shipping a `generateCsv()` helper in @hytek/rfy-codec that
// will replace the XML→Doc→CSV pipeline below with a single call. When that
// commit lands, swap the body of this route for `generateCsv(xml)`.
import { NextResponse } from "next/server";
import { decodeXml, documentToCsvs } from "@hytek/rfy-codec";
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

    // STUB: Agent 1's generateCsv() not yet present in the codec package.
    // Fallback: use the existing XML → RFY → Doc → CSV path. Identical output
    // for production XML inputs.
    //
    // try { return await import("@hytek/rfy-codec").then(m => m.generateCsv(xml)); }
    // catch { /* fall through */ }
    const result = framecadImportToRfy(xml);
    if (result.stickCount === 0) throw new Error("No sticks found in <framecad_import> document.");
    const doc = decodeXml(result.xml);
    const csvs = documentToCsvs(doc);
    const entries = Object.entries(csvs);
    if (entries.length === 0) throw new Error("No plans produced CSV output.");

    const baseName = filename.replace(/\.xml$/i, "");
    const safeJob = (result.jobnum || baseName).replace(/[^A-Za-z0-9._-]/g, "");

    if (entries.length === 1) {
      const [planName, content] = entries[0];
      const safePlan = planName.replace(/[^A-Za-z0-9._-]/g, "_");
      return new NextResponse(content, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${safeJob}_${safePlan}.csv"`,
          "x-plan-count": "1",
        },
      });
    }

    // Multi-plan: concat with `# === planName ===` separators so it stays
    // human-readable. CSV consumers that only want raw rows should pull the
    // ZIP endpoint and split by file.
    let combined = "";
    for (const [planName, content] of entries) {
      combined += `# === ${planName} ===\n${content}\n`;
    }
    return new NextResponse(combined, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${safeJob}.csv"`,
        "x-plan-count": String(entries.length),
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
