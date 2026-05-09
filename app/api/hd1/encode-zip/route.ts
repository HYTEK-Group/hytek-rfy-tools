// HD1 — XML → ZIP (RFY + CSV + PDF in one bundle).
//
// Mirrors the existing /api/encode-bundle route but always emits all three
// output types (RFY, per-plan CSVs, PDF) — the post-EOL Detailer-replacement
// bundle that HD1's "Download All as ZIP" button expects.
//
// Oracle cache: per-plan lookup; bit-exact RFY bytes for plans matching a
// captured reference, codec-generated otherwise. CSVs always come from the
// codec (no Detailer CSV in the cache). PDF uses Agent 2's renderer when
// available, falls back to a placeholder.
import { NextResponse } from "next/server";
import { decodeXml, generateHowickCsv } from "@hytek/rfy-codec";
import JSZip from "jszip";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { readBodyText } from "@/lib/read-body";
import { oracleLookup, oracleLookupPerPlan } from "@/lib/oracle-cache";
import { generateFramePdf } from "@/lib/pdf/frame-elevation";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.xml");
    const xml = (await readBodyText(req)).trim();
    if (!xml) throw new Error("Empty input");

    const lower = xml.toLowerCase();
    if (!lower.includes("<framecad_import")) {
      throw new Error("Expected <framecad_import> XML at the top level.");
    }

    // 1. Codec pipeline (always — needed for CSV even on oracle hit).
    const result = framecadImportToRfy(xml);
    if (result.stickCount === 0) throw new Error("No sticks found in <framecad_import> document.");
    const doc = decodeXml(result.xml);
    // Howick CSV: single document-wide CSV (not per-plan). Matches the
    // /api/hd1/encode-csv route which also uses generateHowickCsv.
    const csv = generateHowickCsv(doc);

    // 2. Filename helpers.
    const baseName = filename.replace(/\.(xml|txt)$/i, "");
    const safeJob = (result.jobnum || baseName).replace(/[^A-Za-z0-9]/g, "");
    const planNames = doc.project.plans.map(p => p.name);

    // 3. Oracle lookups.
    const oracle = oracleLookup(xml);
    const perPlan = oracleLookupPerPlan(xml);
    let oracleHit = oracle.hit;

    // 4. Build ZIP.
    const zip = new JSZip();
    const wrote: string[] = [];

    // ─ RFY files ────────────────────────────────────────────────────────────
    if (doc.project.plans.length === 1) {
      const planName = planNames[0]!.replace(/[^A-Za-z0-9._-]/g, "");
      const rfyName = `${safeJob}_${planName}.rfy`;
      const rfyBytes = oracle.hit ? oracle.rfyBytes : result.rfy;
      zip.file(rfyName, new Uint8Array(rfyBytes));
      wrote.push(rfyName);
    } else if (perPlan.allHit && perPlan.totalPlans > 0) {
      for (const r of perPlan.results) {
        const safePlan = r.planName.replace(/[^A-Za-z0-9._-]/g, "");
        const rfyName = `${safeJob}_${safePlan}.rfy`;
        zip.file(rfyName, new Uint8Array(r.rfyBytes!));
        wrote.push(rfyName);
      }
      oracleHit = true;
    } else {
      // Mixed or no hits — emit hits per-plan + combined codec RFY for misses.
      for (const r of perPlan.results) {
        if (!r.hit) continue;
        const safePlan = r.planName.replace(/[^A-Za-z0-9._-]/g, "");
        const rfyName = `${safeJob}_${safePlan}.rfy`;
        zip.file(rfyName, new Uint8Array(r.rfyBytes!));
        wrote.push(rfyName);
      }
      const combinedName = `${safeJob}.rfy`;
      zip.file(combinedName, new Uint8Array(result.rfy));
      wrote.push(combinedName);
    }

    // ─ CSV file (Howick format, single document-wide) ───────────────────────
    const csvName = `${safeJob}.csv`;
    zip.file(csvName, csv);
    wrote.push(csvName);

    // ─ PDF (frame elevation) ────────────────────────────────────────────────
    // Reuse the doc we already decoded for CSVs — saves a re-parse.
    // Pass frameTypes so the renderer can pick wall vs truss vs floor
    // presentation style by actual frame.type from the source XML rather
    // than guessing from plan-name patterns (Scott, 2026-05-09: must work
    // for every frame type the XML presents, not just LBW/NLBW).
    const pdfBytes = await generateFramePdf(doc, {
      pageSize: "A3",
      showDimensions: true,
      showToolingMarks: true,
      frameTypes: result.frameTypes,
      frameDiagonals: result.frameDiagonals,
    });
    const pdfName = `${safeJob}_frames.pdf`;
    zip.file(pdfName, new Uint8Array(pdfBytes));
    wrote.push(pdfName);

    // ─ README ───────────────────────────────────────────────────────────────
    zip.file(
      "README.txt",
      `HYTEK HD1 — production bundle\n` +
      `=============================\n\n` +
      `Generated from: ${filename}\n` +
      `Project:        ${result.projectName}\n` +
      `Job number:     ${result.jobnum || "<unset>"}\n` +
      `Plans:          ${result.planCount}\n` +
      `Frames:         ${result.frameCount}\n` +
      `Sticks:         ${result.stickCount}\n` +
      `Cache status:   ${oracleHit ? "Detailer-blessed (100% match)" : "codec-generated (~80% match)"}\n\n` +
      `Files in this bundle (${wrote.length}):\n` +
      wrote.map(f => `  ${f}`).join("\n") + "\n\n" +
      `RFY: load on the F300i rollformer via USB.\n` +
      `CSV: Howick-format rollforming sequence (single document-wide CSV).\n` +
      `PDF: frame elevation drawing for site reference.\n`
    );

    const zipBuf = await zip.generateAsync({ type: "uint8array" });
    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${safeJob}_bundle.zip"`,
        "x-plan-count": String(result.planCount),
        "x-stick-count": String(result.stickCount),
        "x-oracle-hit": String(oracleHit),
        "x-pdf-source": "frame-elevation",
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
