// Smoke test for the /api/generate-pdf route.
//
// Calls the route handler directly with a Request — no HTTP server needed.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { POST } from "./route";

const candidates = [
  join(process.cwd(), "tmp_detailer_test", "HG260017_GF-LBW-70.075.detailer-ref.xml"),
  join(process.cwd(), "tmp_detailer_test", "COMPARE-1-y-drive-ref.xml"),
];
const sample = candidates.find(p => existsSync(p));

describe("/api/generate-pdf", () => {
  it("rejects empty body with 400", async () => {
    const req = new Request("http://localhost/api/generate-pdf", {
      method: "POST",
      body: "",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects unrecognised XML root with 400", async () => {
    const req = new Request("http://localhost/api/generate-pdf", {
      method: "POST",
      body: "<not_a_thing/>",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text.toLowerCase()).toContain("framecad_import");
  });

  if (!sample) {
    it.skip("no cached schedule XML — skipping integration", () => {});
    return;
  }

  it(`returns a valid PDF for ${sample.split(/[\\/]/).pop()}`, async () => {
    const xml = readFileSync(sample, "utf8");
    const req = new Request("http://localhost/api/generate-pdf", {
      method: "POST",
      headers: { "x-filename": "test.xml" },
      body: xml,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const dispo = res.headers.get("content-disposition") ?? "";
    expect(dispo).toMatch(/attachment;\s*filename=/);

    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(2 * 1024);

    const doc = await PDFDocument.load(buf);
    const expected = Number(res.headers.get("x-frame-count"));
    expect(expected).toBeGreaterThan(0);
    expect(doc.getPageCount()).toBe(expected);
  });
});
