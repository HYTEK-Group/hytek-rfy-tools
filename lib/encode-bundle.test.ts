// lib/encode-bundle.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildBundle } from "./encode-bundle";

const fixturePath = join(process.cwd(), "lib", "brain", "fixtures", "small.xml");

describe("buildBundle helper", () => {
  it("produces a non-empty ZIP and headers for a valid FrameCAD XML", async () => {
    if (!existsSync(fixturePath)) {
      console.warn(`Skipping: no fixture at ${fixturePath}`);
      return;
    }
    const xml = readFileSync(fixturePath, "utf8");
    const result = await buildBundle(xml, "small.xml");

    expect(result.zipBytes.length).toBeGreaterThan(100);
    expect(result.headers["content-type"]).toBe("application/zip");
    expect(result.headers["x-stick-count"]).toBeDefined();
    expect(Number(result.headers["x-stick-count"])).toBeGreaterThan(0);
  });

  it("rejects non-framecad-import XML with a clear error", async () => {
    await expect(buildBundle("<not_framecad/>", "x.xml")).rejects.toThrow(/framecad_import/i);
  });

  it("rejects empty input", async () => {
    await expect(buildBundle("", "x.xml")).rejects.toThrow(/empty/i);
  });
});
