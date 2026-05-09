// lib/brain/encoder.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { brainEncode } from "./encoder";

// Use a small <framecad_import> XML committed to the repo as a fixture.
// Task 12 adds one; this test skips until the fixture exists.
const fixturePath = join(process.cwd(), "lib", "brain", "fixtures", "small.xml");

describe("brain encoder", () => {
  it("produces a classification report from a FrameCAD XML", () => {
    if (!existsSync(fixturePath)) {
      console.warn(`Skipping: no fixture at ${fixturePath}`);
      return;
    }
    const xml = readFileSync(fixturePath, "utf8");
    const { report } = brainEncode(xml);

    expect(report.totalOps).toBeGreaterThan(0);
    expect(report.catalogued + report.uncatalogued).toBe(report.totalOps);
    expect(Array.isArray(report.uncataloguedNames)).toBe(true);
    expect(Array.isArray(report.perPlan)).toBe(true);
  });
});
