// lib/brain/encoder.ts
//
// Walks a FrameCAD XML through the existing decode pipeline and produces a
// ClassificationReport — every emitted operation tagged "catalogued" or
// "uncatalogued" against Catalogue A. v0 does NOT modify the codec's
// behaviour; the bundle (RFY + CSV files) is produced separately by
// lib/encode-bundle.ts.

import { decodeXml } from "@hytek/rfy-codec";
import { framecadImportToRfy } from "../framecad-import";
import { loadCatalogues } from "./loader";
import type { ClassificationReport } from "./types";

export interface BrainOutput {
  report: ClassificationReport;
}

export function brainEncode(xml: string): BrainOutput {
  const catalogues = loadCatalogues();
  const knownOpNames = new Set(catalogues.operations.entries.map(e => e.name));

  // Existing pipeline produces the RFY bytes + the synthesized inner XML.
  const result = framecadImportToRfy(xml);
  if (result.stickCount === 0) {
    throw new Error("No sticks found in <framecad_import> document.");
  }

  // Decode the synthesized inner XML so we can iterate every operation
  // emitted on every stick of every plan.
  const doc = decodeXml(result.xml);

  let totalOps = 0;
  let uncatalogued = 0;
  const uncataloguedNamesSet = new Set<string>();
  const perPlanMap = new Map<string, { totalOps: number; uncatalogued: number }>();

  for (const plan of doc.project.plans) {
    const tally = { totalOps: 0, uncatalogued: 0 };
    perPlanMap.set(plan.name, tally);
    for (const frame of plan.frames) {
      for (const stick of frame.sticks) {
        for (const op of stick.tooling) {
          totalOps += 1;
          tally.totalOps += 1;
          if (!knownOpNames.has(op.type)) {
            uncatalogued += 1;
            tally.uncatalogued += 1;
            uncataloguedNamesSet.add(op.type);
          }
        }
      }
    }
  }

  const catalogued = totalOps - uncatalogued;
  const uncataloguedNames = Array.from(uncataloguedNamesSet).sort();

  const report: ClassificationReport = {
    totalOps,
    catalogued,
    uncatalogued,
    uncataloguedNames,
    perPlan: Array.from(perPlanMap.entries()).map(([planName, tally]) => ({
      planName,
      totalOps: tally.totalOps,
      uncatalogued: tally.uncatalogued,
    })),
  };

  return { report };
}
