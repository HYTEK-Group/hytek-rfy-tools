// lib/brain/types.ts
//
// Brain catalogue types. Each catalogue is a JSON file shaped like { entries: [...] }
// with one entry per operation / interaction / frame context. The English fields
// (`description`, `whenSeen`, etc.) are the source of truth — they're what shows
// up in the settings UI in Phase 3.

export type GeometricForm = "point" | "spanned" | "start_end";

export interface OperationEntry {
  /** Canonical name as emitted by the codec (e.g. "LipNotch"). */
  name: string;
  /** "point" | "spanned" | "start_end". */
  form: GeometricForm;
  /** Plain-English description: what this operation physically does. */
  description: string;
  /** Plain-English rule statements for when this operation fires. Each is
   *  one trigger condition — readable as a bulleted list in the settings UI. */
  whenFires: string[];
  /** Plain-English why-statement. */
  why: string;
}

export interface StickRoleEntry {
  /** Code used in stick names — e.g. "S", "T", "B", "Kb". */
  code: string;
  /** Plain-English name (e.g. "Stud"). */
  name: string;
  /** What kind of stick this is, in plain English. */
  description: string;
}

export interface InteractionEntry {
  /** Canonical name (e.g. "T-junction", "X-crossing"). */
  name: string;
  /** Plain-English description of the geometric configuration. */
  description: string;
  /** Plain-English: which roles can participate (e.g. "S meeting T"). */
  participants: string;
  /** Plain-English: what fires, on which stick. */
  emits: string[];
  /** Plain-English: why this rule exists. */
  why: string;
}

export interface FrameContextEntry {
  /** Canonical name (e.g. "Door opening"). */
  name: string;
  /** Plain-English: when this context is recognised. */
  trigger: string;
  /** Plain-English: members generated. */
  members: string[];
  /** Plain-English: operations beyond the standard per-stick rules. */
  operations: string[];
}

export interface OperationsCatalogue {
  entries: OperationEntry[];
  /** Stick role codes referenced by this catalogue and the others. */
  roles: StickRoleEntry[];
}

export interface InteractionsCatalogue {
  entries: InteractionEntry[];
}

export interface FrameContextsCatalogue {
  entries: FrameContextEntry[];
}

export interface BrainCatalogues {
  operations: OperationsCatalogue;
  interactions: InteractionsCatalogue;
  frameContexts: FrameContextsCatalogue;
}

/** A single emitted operation tagged with its catalogue entry. */
export interface ClassifiedOp {
  /** The operation name as emitted by the codec. */
  name: string;
  /** Stick the operation was emitted on. */
  stickName: string;
  /** Plan name the stick belongs to. */
  planName: string;
  /** Position-along-stick (or start, for spanned ops) in mm. */
  position: number;
  /** "catalogued" if the op name matches a Catalogue A entry; "uncatalogued" otherwise. */
  classification: "catalogued" | "uncatalogued";
}

/** The classification report returned alongside the bundle. */
export interface ClassificationReport {
  totalOps: number;
  catalogued: number;
  uncatalogued: number;
  /** Names of any operations the codec emitted that don't appear in Catalogue A.
   *  In a well-formed v0 this should be empty. */
  uncataloguedNames: string[];
  /** Per-plan summary. */
  perPlan: Array<{ planName: string; totalOps: number; uncatalogued: number }>;
}
