// HD1 — XML → RFY only.
//
// Mirrors /api/encode-bundle's RFY emission logic but returns just the .rfy
// bytes (no ZIP wrapping). Used by the HD1 page's "Download RFY" button.
//
// Oracle cache: checked FIRST. Single-plan input that matches a captured
// reference returns Detailer-bit-exact bytes. Multi-plan inputs that fully
// hit per-plan cache also return the codec's combined RFY (since this endpoint
// returns ONE file — for per-plan files use the ZIP endpoint).
import { NextResponse } from "next/server";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { readBodyText } from "@/lib/read-body";
import { oracleLookup } from "@/lib/oracle-cache";

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

    const baseName = filename.replace(/\.xml$/i, "");
    const oracle = oracleLookup(xml);

    if (oracle.hit) {
      // Detailer-bit-exact path.
      const safeJob = baseName.replace(/[^A-Za-z0-9._-]/g, "");
      return new NextResponse(new Uint8Array(oracle.rfyBytes), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${safeJob}.rfy"`,
          "x-oracle-hit": "true",
          "x-oracle-source": oracle.rfyPath,
        },
      });
    }

    // Codec path.
    const result = framecadImportToRfy(xml);
    if (result.stickCount === 0) {
      throw new Error("No sticks found in <framecad_import> document.");
    }
    const safeJob = (result.jobnum || baseName).replace(/[^A-Za-z0-9._-]/g, "");

    return new NextResponse(new Uint8Array(result.rfy), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${safeJob}.rfy"`,
        "x-oracle-hit": "false",
        "x-oracle-miss-reason": oracle.reason,
        "x-plan-count": String(result.planCount),
        "x-stick-count": String(result.stickCount),
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
