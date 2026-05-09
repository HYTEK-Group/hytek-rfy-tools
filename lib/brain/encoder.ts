// lib/brain/encoder.ts
//
// Walks a FrameCAD XML through the existing decode pipeline and produces a
// ClassificationReport — every emitted operation tagged "catalogued" or
// "uncatalogued" against Catalogue A. v0 does NOT modify the codec's
// behaviour; the bundle (RFY + CSV files) is produced separately by
// lib/encode-bundle.ts.

import { decodeXml } from "@hytek/rfy-codec";
import type { RfyToolingOp } from "@hytek/rfy-codec";
import { framecadImportToRfy } from "../framecad-import";
import { loadCatalogues } from "./loader";
import type { ClassificationReport, ClassifiedOp } from "./types";

export interface BrainOutput {
  report: ClassificationReport;
}

/** Extract a representative position from a tooling op. Point ops carry
 *  `pos`, spanned ops carry `startPos` (the start of the span), and edge
 *  ops have no position — they fire at the stick's start/end edge, so we
 *  report 0 to keep the field numeric. */
function positionOf(op: RfyToolingOp): number {
  if (op.kind === "point") return op.pos;
  if (op.kind === "spanned") return op.startPos;
  return 0;
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

  const classifiedOps: ClassifiedOp[] = [];
  const perPlanMap = new Map<string, { totalOps: number; uncatalogued: number }>();

  for (const plan of doc.project.plans) {
    perPlanMap.set(plan.name, { totalOps: 0, uncatalogued: 0 });
    for (const frame of plan.frames) {
      for (const stick of frame.sticks) {
        for (const op of stick.tooling ?? []) {
          const classification: ClassifiedOp["classification"] =
            knownOpNames.has(op.type) ? "catalogued" : "uncatalogued";
          classifiedOps.push({
            name: op.type,
            stickName: stick.name,
            planName: plan.name,
            position: positionOf(op),
            classification,
          });
          const tally = perPlanMap.get(plan.name)!;
          tally.totalOps += 1;
          if (classification === "uncatalogued") tally.uncatalogued += 1;
        }
      }
    }
  }

  const totalOps = classifiedOps.length;
  const catalogued = classifiedOps.filter(c => c.classification === "catalogued").length;
  const uncatalogued = totalOps - catalogued;
  const uncataloguedNames = Array.from(
    new Set(
      classifiedOps.filter(c => c.classification === "uncatalogued").map(c => c.name)
    )
  ).sort();

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
