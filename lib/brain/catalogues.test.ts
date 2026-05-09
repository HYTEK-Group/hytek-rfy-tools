// lib/brain/catalogues.test.ts
import { describe, it, expect } from "vitest";
import { loadCatalogues } from "./loader";

const EXPECTED_OPERATIONS = [
  "LipNotch", "InnerDimple", "Swage", "Web", "Bolt",
  "Chamfer", "TrussChamfer", "InnerNotch", "InnerService", "ScrewHoles",
  "LeftFlange", "RightFlange", "LeftPartialFlange", "RightPartialFlange",
];

const EXPECTED_ROLES = ["S", "J", "T", "B", "Bh", "N", "H", "Kb", "W", "L", "R", "V"];

const EXPECTED_INTERACTIONS = [
  "T-junction", "X-crossing", "End-butt", "Lap", "B2B partner pair",
  "Header-cripple (Kb meets H)", "Truss-vertical-at-chord",
  "Truss-diagonal-at-chord", "Wall-W-at-plate",
];

const EXPECTED_FRAME_CONTEXTS = [
  "Door opening", "Window opening", "AC / utility opening", "Brace bay",
  "B2B partner pair", "TIN linear truss panel",
  "TB2B back-to-back truss panel", "Roof panel (flat)",
];

describe("brain catalogues — content completeness", () => {
  const cat = loadCatalogues();

  it("Catalogue A contains all 14 expected operations", () => {
    const names = cat.operations.entries.map(e => e.name);
    for (const expected of EXPECTED_OPERATIONS) {
      expect(names).toContain(expected);
    }
    expect(names.length).toBe(EXPECTED_OPERATIONS.length);
  });

  it("Catalogue A contains all 12 stick role codes", () => {
    const codes = cat.operations.roles.map(r => r.code);
    for (const expected of EXPECTED_ROLES) {
      expect(codes).toContain(expected);
    }
    expect(codes.length).toBe(EXPECTED_ROLES.length);
  });

  it("Catalogue B contains all 9 expected interactions", () => {
    const names = cat.interactions.entries.map(e => e.name);
    for (const expected of EXPECTED_INTERACTIONS) {
      expect(names).toContain(expected);
    }
    expect(names.length).toBe(EXPECTED_INTERACTIONS.length);
  });

  it("Catalogue C contains all 8 expected frame contexts", () => {
    const names = cat.frameContexts.entries.map(e => e.name);
    for (const expected of EXPECTED_FRAME_CONTEXTS) {
      expect(names).toContain(expected);
    }
    expect(names.length).toBe(EXPECTED_FRAME_CONTEXTS.length);
  });

  it("every operation entry has at least one whenFires statement", () => {
    for (const entry of cat.operations.entries) {
      expect(entry.whenFires.length, `${entry.name} has no whenFires`).toBeGreaterThan(0);
    }
  });

  it("every interaction entry has at least one emits statement", () => {
    for (const entry of cat.interactions.entries) {
      expect(entry.emits.length, `${entry.name} has no emits`).toBeGreaterThan(0);
    }
  });
});
