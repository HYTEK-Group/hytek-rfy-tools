// lib/brain/smoke.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brainEncode } from "./encoder";
import { buildBundle } from "../encode-bundle";

const fixturePath = join(process.cwd(), "lib", "brain", "fixtures", "small.xml");

describe("brain smoke test", () => {
  it("buildBundle produces non-empty ZIP bytes for the fixture", async () => {
    const xml = readFileSync(fixturePath, "utf8");
    const { zipBytes, headers } = await buildBundle(xml, "small.xml");
    expect(zipBytes.length).toBeGreaterThan(100);
    expect(Number(headers["x-stick-count"])).toBeGreaterThan(0);
  }, 30_000);

  it("brainEncode produces a well-formed classification report", () => {
    const xml = readFileSync(fixturePath, "utf8");
    const { report } = brainEncode(xml);

    expect(report.totalOps).toBeGreaterThan(0);
    expect(report.catalogued + report.uncatalogued).toBe(report.totalOps);

    // v0 expectation: every emitted op should match a Catalogue A name. If
    // this fails, the catalogue is missing an op name the codec actually
    // emits — surface it explicitly so the next session can add it.
    if (report.uncatalogued > 0) {
      const names = report.uncataloguedNames.join(", ");
      throw new Error(
        `Catalogue A is missing the following op name(s) emitted by the codec: ${names}. ` +
        `Either add them to data/brain/operations.json or rename the codec output to match an existing entry.`
      );
    }
  });

  it("perPlan totals add up to overall totals", () => {
    const xml = readFileSync(fixturePath, "utf8");
    const { report } = brainEncode(xml);
    const sumTotal = report.perPlan.reduce((a, p) => a + p.totalOps, 0);
    const sumUncat = report.perPlan.reduce((a, p) => a + p.uncatalogued, 0);
    expect(sumTotal).toBe(report.totalOps);
    expect(sumUncat).toBe(report.uncatalogued);
  });
});
