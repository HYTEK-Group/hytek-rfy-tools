// app/api/brain/encode/route.ts
//
// POST a FrameCAD <framecad_import> XML body. Returns the same ZIP that
// /api/encode-bundle returns (byte-identical bundle), with one extra file:
//   classification.json — every emitted operation tagged against Catalogue A.
//
// v0: brain delegates byte-emission to the shared bundling helper; the only
// NEW output is classification.json.

import { NextResponse } from "next/server";
import JSZip from "jszip";
import { buildBundle } from "@/lib/encode-bundle";
import { brainEncode } from "@/lib/brain/encoder";
import { readBodyText } from "@/lib/read-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.xml");
    const xml = await readBodyText(req);

    // 1. Existing bundle (byte-identical to /api/encode-bundle output).
    const { zipBytes, headers: bundleHeaders } = await buildBundle(xml, filename);

    // 2. Classification report from the brain layer.
    const { report } = brainEncode(xml);

    // 3. Add classification.json to the ZIP without changing existing files.
    const zip = await JSZip.loadAsync(zipBytes);
    zip.file("classification.json", JSON.stringify(report, null, 2));

    const newZipBytes = await zip.generateAsync({ type: "uint8array" });

    // 4. Forward the bundle's x-* headers + brain-specific headers.
    const safeBase = filename.replace(/\.(xml|txt)$/i, "");
    const responseHeaders: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(bundleHeaders).filter(([k]) => k.startsWith("x-") || k === "content-type")
      ),
      "content-disposition": `attachment; filename="${safeBase}_brain.zip"`,
      "x-brain-classified": String(report.catalogued),
      "x-brain-uncatalogued": String(report.uncatalogued),
    };

    return new NextResponse(new Uint8Array(newZipBytes), { status: 200, headers: responseHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
