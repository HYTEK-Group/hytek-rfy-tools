// HD1 — end-to-end smoke test.
//
// Drops the 2603191 ROCKVILLE fixture (the small framecad_import XML shipped
// with @hytek/rfy-codec) into all four HD1 endpoints and asserts:
//   - 200 status
//   - non-empty body
//   - sane content-type
//   - response shape matches what the HD1 page expects (filename header,
//     oracle-hit flag, etc.)
//
// We invoke the route handlers directly (no HTTP listener) because vitest's
// node env doesn't spin up a Next dev server. This mirrors the pattern used
// by `lib/pdf/frame-elevation.test.ts`.
//
// If the fixture isn't present, the test skips (CI without test corpus
// shouldn't break the build).

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { POST as encodeRfy } from "./encode-rfy/route";
import { POST as encodeCsv } from "./encode-csv/route";
import { POST as encodePdf } from "./encode-pdf/route";
import { POST as encodeZip } from "./encode-zip/route";

const FIXTURE = join(
  process.cwd(),
  "node_modules",
  "@hytek",
  "rfy-codec",
  "test-corpus",
  "2603191",
  "2603191-ROCKVILLE.xml"
);

let xmlBuf: Buffer | null = null;

beforeAll(() => {
  if (existsSync(FIXTURE)) xmlBuf = readFileSync(FIXTURE);
});

function makeReq(buf: Buffer, filename: string): Request {
  return new Request("http://localhost/api/hd1/test", {
    method: "POST",
    headers: {
      "x-filename": encodeURIComponent(filename),
      "content-type": "application/octet-stream",
    },
    // Convert Node Buffer to ArrayBuffer slice — Request expects BodyInit.
    // Cast: buf.buffer is typed as ArrayBuffer | SharedArrayBuffer in newer @types/node;
    // Node Buffers always sit on a real ArrayBuffer, so this is safe.
    body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  });
}

describe("HD1 smoke — drop fixture, verify all 4 endpoints", () => {
  it.runIf(existsSync(FIXTURE))("encode-rfy returns RFY bytes", async () => {
    const req = makeReq(xmlBuf!, "2603191-ROCKVILLE.xml");
    const res = await encodeRfy(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    const dispo = res.headers.get("content-disposition") ?? "";
    expect(dispo).toContain(".rfy");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it.runIf(existsSync(FIXTURE))("encode-csv returns CSV text", async () => {
    const req = makeReq(xmlBuf!, "2603191-ROCKVILLE.xml");
    const res = await encodeCsv(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
    // CSV should contain HEAD/CALC/TYPE rows or similar — at minimum non-blank.
    expect(body.trim().length).toBeGreaterThan(10);
  });

  it.runIf(existsSync(FIXTURE))("encode-pdf returns a valid PDF", async () => {
    const req = makeReq(xmlBuf!, "2603191-ROCKVILLE.xml");
    const res = await encodePdf(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(1024);
    // PDF magic bytes.
    expect(String.fromCharCode(...body.slice(0, 4))).toBe("%PDF");
    expect(res.headers.get("x-pdf-source")).toBe("frame-elevation");
  });

  it.runIf(existsSync(FIXTURE))("encode-zip returns a ZIP archive", async () => {
    const req = makeReq(xmlBuf!, "2603191-ROCKVILLE.xml");
    const res = await encodeZip(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(1024);
    // ZIP magic bytes "PK\x03\x04".
    expect(body[0]).toBe(0x50);
    expect(body[1]).toBe(0x4b);
    expect(body[2]).toBe(0x03);
    expect(body[3]).toBe(0x04);
    // Headers expose plan/stick counts so the UI can show diagnostics.
    expect(res.headers.get("x-plan-count")).toBeTruthy();
    expect(res.headers.get("x-stick-count")).toBeTruthy();
  });

  it.runIf(existsSync(FIXTURE))(
    "encode-zip returns oracle-hit header (true or false)",
    async () => {
      const req = makeReq(xmlBuf!, "2603191-ROCKVILLE.xml");
      const res = await encodeZip(req);
      const flag = res.headers.get("x-oracle-hit");
      expect(flag === "true" || flag === "false").toBe(true);
    }
  );

  it("rejects non-XML input with 400", async () => {
    const req = new Request("http://localhost/api/hd1/test", {
      method: "POST",
      headers: { "x-filename": "junk.txt" },
      body: "this is not XML at all",
    });
    const res = await encodeRfy(req);
    expect(res.status).toBe(400);
  });

  it("rejects empty body with 400", async () => {
    const req = new Request("http://localhost/api/hd1/test", {
      method: "POST",
      headers: { "x-filename": "empty.xml" },
      body: "",
    });
    const res = await encodeCsv(req);
    expect(res.status).toBe(400);
  });
});
