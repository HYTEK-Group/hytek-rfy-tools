// FrameCAD <framecad_import> XML → ZIP containing the production bundle:
//   <jobnum>_<plan>.rfy           — encrypted file the F300i loads
//   <jobnum>#1-1_<plan>.csv       — per-plan rollforming CSV (one per plan)
//   README.txt                    — quick reference for what's inside
//
// Bundling logic lives in lib/encode-bundle.ts so /api/brain/encode can
// reuse it. This route is a thin wrapper.

import { NextResponse } from "next/server";
import { buildBundle } from "@/lib/encode-bundle";
import { readBodyText } from "@/lib/read-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.xml");
    const xml = await readBodyText(req);
    const { zipBytes, headers } = await buildBundle(xml, filename);
    return new NextResponse(new Uint8Array(zipBytes), { status: 200, headers });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
