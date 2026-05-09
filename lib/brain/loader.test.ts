// lib/brain/loader.test.ts
import { describe, it, expect } from "vitest";
import { loadCatalogues, validateOperations } from "./loader";

describe("brain loader", () => {
  it("loads all three catalogues from disk and returns a populated structure", () => {
    const cat = loadCatalogues();
    expect(cat.operations.entries.length).toBeGreaterThan(0);
    expect(cat.interactions.entries.length).toBeGreaterThan(0);
    expect(cat.frameContexts.entries.length).toBeGreaterThan(0);
  });

  it("rejects an operations catalogue with a missing required field", () => {
    const bad = { entries: [{ name: "LipNotch", form: "spanned" /* missing description, whenFires, why */ }] };
    expect(() => validateOperations(bad)).toThrow(/description/);
  });

  it("rejects an unknown geometric form", () => {
    const bad = {
      entries: [
        { name: "Foo", form: "invalid_form", description: "x", whenFires: ["x"], why: "x" },
      ],
      roles: [],
    };
    expect(() => validateOperations(bad)).toThrow(/form/);
  });
});
