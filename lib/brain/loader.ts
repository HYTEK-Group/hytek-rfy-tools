// lib/brain/loader.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BrainCatalogues,
  OperationsCatalogue,
  InteractionsCatalogue,
  FrameContextsCatalogue,
  GeometricForm,
} from "./types";

const VALID_FORMS: GeometricForm[] = ["point", "spanned", "start_end"];

function dataDir(): string {
  return join(process.cwd(), "data", "brain");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function validateOperations(raw: unknown): OperationsCatalogue {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("operations.json: top-level must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) {
    throw new Error("operations.json: missing 'entries' array");
  }
  for (const entry of obj.entries) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("operations.json: every entry must be an object");
    }
    const e = entry as Record<string, unknown>;
    for (const field of ["name", "form", "description", "why"]) {
      if (typeof e[field] !== "string" || (e[field] as string).length === 0) {
        throw new Error(`operations.json: entry missing required string field '${field}'`);
      }
    }
    if (!VALID_FORMS.includes(e.form as GeometricForm)) {
      throw new Error(`operations.json: invalid form '${String(e.form)}' on entry '${String(e.name)}'`);
    }
    if (!Array.isArray(e.whenFires) || e.whenFires.some(s => typeof s !== "string")) {
      throw new Error(`operations.json: 'whenFires' must be an array of strings on entry '${String(e.name)}'`);
    }
  }
  if (!Array.isArray(obj.roles)) {
    throw new Error("operations.json: missing 'roles' array");
  }
  return obj as unknown as OperationsCatalogue;
}

export function validateInteractions(raw: unknown): InteractionsCatalogue {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("interactions.json: top-level must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) {
    throw new Error("interactions.json: missing 'entries' array");
  }
  for (const entry of obj.entries) {
    const e = entry as Record<string, unknown>;
    for (const field of ["name", "description", "participants", "why"]) {
      if (typeof e[field] !== "string" || (e[field] as string).length === 0) {
        throw new Error(`interactions.json: entry missing required string field '${field}'`);
      }
    }
    if (!Array.isArray(e.emits) || e.emits.some(s => typeof s !== "string")) {
      throw new Error(`interactions.json: 'emits' must be an array of strings on entry '${String(e.name)}'`);
    }
  }
  return obj as unknown as InteractionsCatalogue;
}

export function validateFrameContexts(raw: unknown): FrameContextsCatalogue {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("frame-contexts.json: top-level must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) {
    throw new Error("frame-contexts.json: missing 'entries' array");
  }
  for (const entry of obj.entries) {
    const e = entry as Record<string, unknown>;
    for (const field of ["name", "trigger"]) {
      if (typeof e[field] !== "string" || (e[field] as string).length === 0) {
        throw new Error(`frame-contexts.json: entry missing required string field '${field}'`);
      }
    }
    if (!Array.isArray(e.members) || e.members.some(s => typeof s !== "string")) {
      throw new Error(`frame-contexts.json: 'members' must be an array of strings on entry '${String(e.name)}'`);
    }
    if (!Array.isArray(e.operations) || e.operations.some(s => typeof s !== "string")) {
      throw new Error(`frame-contexts.json: 'operations' must be an array of strings on entry '${String(e.name)}'`);
    }
  }
  return obj as unknown as FrameContextsCatalogue;
}

export function loadCatalogues(): BrainCatalogues {
  const operations = validateOperations(readJson(join(dataDir(), "operations.json")));
  const interactions = validateInteractions(readJson(join(dataDir(), "interactions.json")));
  const frameContexts = validateFrameContexts(readJson(join(dataDir(), "frame-contexts.json")));
  return { operations, interactions, frameContexts };
}
