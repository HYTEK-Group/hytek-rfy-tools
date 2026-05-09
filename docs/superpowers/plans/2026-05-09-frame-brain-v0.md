# HYTEK Frame Brain v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the brain v0 layer per spec §13.2 — JSON catalogues, loader, `/api/brain/encode` endpoint, `/brain` page, home-page card. Existing codec stays unchanged; brain delegates to it for byte emission and adds a classification report alongside the bundle.

**Architecture:** `lib/brain/` holds types + loader + a thin encoder facade. `data/brain/` holds three JSON catalogues that describe the rules in plain English (Operations, Interactions, Frame Contexts). The encoder facade calls the existing `framecadImportToRfy()` pipeline for actual byte generation, then produces a JSON classification report listing every emitted operation tagged with its catalogue entry (or flagged as "uncatalogued"). The brain endpoint returns a ZIP that includes the bundle plus the classification report. No legacy code is modified.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `@hytek/rfy-codec` (existing decoder), `fast-xml-parser`, `jszip`, Vitest.

**Source spec:** [docs/superpowers/specs/2026-05-09-hytek-frame-brain-design.md](../specs/2026-05-09-hytek-frame-brain-design.md)

---

## File map

**Create:**
- `lib/brain/types.ts` — TypeScript types for catalogue entries + brain output
- `lib/brain/loader.ts` — JSON loader with structural validation
- `lib/brain/loader.test.ts` — loader unit tests
- `lib/brain/encoder.ts` — encoder facade (produces classification report from synthesized XML)
- `lib/brain/encoder.test.ts` — encoder unit tests
- `lib/brain/catalogues.test.ts` — content/completeness tests (every spec entry present)
- `lib/brain/smoke.test.ts` — end-to-end smoke test
- `lib/encode-bundle.ts` — shared bundling helper extracted from `app/api/encode-bundle/route.ts`
- `lib/encode-bundle.test.ts` — bundling helper test
- `data/brain/operations.json` — Catalogue A (14 entries)
- `data/brain/interactions.json` — Catalogue B (9 entries)
- `data/brain/frame-contexts.json` — Catalogue C (8 entries)
- `app/api/brain/encode/route.ts` — POST endpoint
- `app/brain/page.tsx` — upload UI
- `docs/brain-overview.md` — human-readable index of the catalogues

**Modify:**
- `app/api/encode-bundle/route.ts` — becomes a thin wrapper around `lib/encode-bundle.ts` (no behaviour change, pure refactor)
- `app/page.tsx` — add "Brain (preview)" card to the existing converter grid

---

## Conventions used throughout this plan

- **Test runner:** Vitest. Run a single test file with `npx vitest run <path>`. Run all with `npm run test`.
- **Type-check:** `npm run typecheck` (compiles `tsc --noEmit`).
- **Repo:** `C:\Users\ScottTextor\CLAUDE CODE\hytek-rfy-tools` (the existing `master` branch).
- **Commit style:** `feat(brain): <thing>` for new features, `test(brain): <thing>` for test-only commits, `docs(brain): <thing>` for documentation.

---

### Task 1: TypeScript types for brain catalogues

**Files:**
- Create: `lib/brain/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
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
```

- [ ] **Step 2: Type-check passes**

Run: `cd "C:\Users\ScottTextor\CLAUDE CODE\hytek-rfy-tools"; npm run typecheck`
Expected: no errors related to `lib/brain/types.ts`. (Other unrelated errors in the repo, if any, can be ignored at this stage but flagged.)

- [ ] **Step 3: Commit**

```powershell
git add lib/brain/types.ts
git commit -m "feat(brain): add TypeScript types for catalogue entries and classification report"
```

---

### Task 2: Catalogue loader with structural validation

**Files:**
- Create: `lib/brain/loader.ts`
- Create: `lib/brain/loader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "C:\Users\ScottTextor\CLAUDE CODE\hytek-rfy-tools"; npx vitest run lib/brain/loader.test.ts`
Expected: FAIL with "Cannot find module './loader'".

- [ ] **Step 3: Write the loader**

```typescript
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
```

- [ ] **Step 4: The test still fails because the JSON files don't exist yet**

Run: `npx vitest run lib/brain/loader.test.ts`
Expected: FAIL — first test fails on `ENOENT: no such file ... operations.json`. The two negative tests pass. This is expected; the next three tasks create the JSON files.

- [ ] **Step 5: Commit (loader-only)**

```powershell
git add lib/brain/loader.ts lib/brain/loader.test.ts
git commit -m "feat(brain): add catalogue loader with structural validation"
```

---

### Task 3: Catalogue A — Tool Operations JSON

**Files:**
- Create: `data/brain/operations.json`

This task transcribes spec §6 into JSON. Every operation gets one entry with the plain-English fields. Roles are listed below the entries (12 roles per spec §6.2).

- [ ] **Step 1: Create the JSON file**

```json
{
  "entries": [
    {
      "name": "LipNotch",
      "form": "spanned",
      "description": "Rectangular cut through both lips of the C-section, leaving the web intact. Length 48 to 80 mm. The dominant operation at every cross-member joint; lets the crossing stick key into the lip.",
      "whenFires": [
        "End cap on every plate (T, B, Bh): fires at each end. Position starts at EndClearance from the end (4 mm on 70/75/78/89/90 mm; 5 mm on 104 mm). Span = 39 mm on 70/89 mm setups, otherwise setup-derived.",
        "At every stud-to-plate crossing: fires on the plate at the crossing x-position, span 39 mm centred on the stud centreline.",
        "At every nog-to-stud crossing: fires on the stud at the crossing y-position.",
        "At door-head cripple (164 mm short nog): fires at both ends.",
        "At every truss-web to chord crossing: fires on the chord at the crossing position.",
        "Does not fire on standalone studs in the field, or on truss diagonal webs themselves (only on the chord they meet)."
      ],
      "why": "Every place a horizontal and vertical steel piece meet, the lip needs to be relieved so the perpendicular stick keys in cleanly."
    },
    {
      "name": "InnerDimple",
      "form": "point",
      "description": "Locating dimple (small embossed cone) on the inner web face, used as a fastener target. Diameter ~10 mm.",
      "whenFires": [
        "End-anchored on every plate, stud, nog, header: fires at Fastener1 Y-offset (20.5 mm on 70/75/78/89/90 mm; 25.5 mm on 104 mm) from each end, on the inner web face.",
        "At every LipNotch on a plate: fires alongside the LipNotch as a fastener target.",
        "Mid-span on long studs: fires only at body crossings (nog crossing y-position). No mid-span fires in unobstructed studs.",
        "On wall W-braces (usage='stud'): fires at 10 mm from each end (different from the universal 16.5 mm).",
        "On truss W (usage='web'): fires at 16.5 mm from each end.",
        "On door/window headers (paired): fires as PAIRS — two dimples per LipNotch crossing, at Fastener1 and at Fastener1 + 42 mm. Single-H frames get only the single dimple."
      ],
      "why": "Every fastener position needs a dimple to locate the screw before it cuts."
    },
    {
      "name": "Swage",
      "form": "spanned",
      "description": "Web-stiffening crimp — a roll-formed concave fold in the web. 39 to 55 mm long. Caps the ends of studs, nogs, and braces; reinforces mid-span where extra stiffness is needed.",
      "whenFires": [
        "End cap on every stud (S, J): fires at the stud's end with the setup-derived offset (27.5 mm on standard 70/89 mm setups), span 39 mm.",
        "End cap on every nog ≥168 mm: fires at each end with the same offset as studs.",
        "Mid-span on full-height studs: replaces the InnerDimple at mid-span on standard studs. Note: ENDSTUD (end-of-panel) has LipNotch here instead of Swage.",
        "End cap on every brace (W/R) stud-usage: angle-dependent end span = Span / cos(angle from vertical) + 8 · tan²(angle), capped at 200 mm.",
        "Does not fire on plates (LipNotch + InnerDimple is the plate end-cap pattern), or on truss webs (different pattern)."
      ],
      "why": "Stud webs need stiffening at the ends to resist crushing under the plate's bearing."
    },
    {
      "name": "Web",
      "form": "point",
      "description": "Round access hole in the web, 8 to 101 mm diameter depending on use. Includes slab-anchor bolt through-holes (8 mm), service penetrations (~34 mm), and large stiffener holes.",
      "whenFires": [
        "Ground-floor bottom plate slab anchors: fires at 8 mm from each end (slab-anchor through-hole).",
        "Distributed on paired headers (H1/H3 + H2): fires at 89 mm from each end, evenly distributed inwards with max 300 mm spacing. Single-H frames get NO Web ops.",
        "At centerline crossings on TB2B trusses: fires on each web at the pairwise crossing of two truss-webs."
      ],
      "why": "Structural connections that need a bolt through the web (slab anchor, paired-header bracket, truss-truss bolt)."
    },
    {
      "name": "Bolt",
      "form": "point",
      "description": "Hole sized for a slab anchor or structural fastener — distinct from Web because of its position and pattern (typically two holes, ±62 mm offsets, on bottom plates only).",
      "whenFires": [
        "Bottom plate, ground floor only: fires at ±62 mm offsets from each Web-anchored point, two holes per cluster. Slab anchors.",
        "Does not fire on any wall stud, plate above ground floor, header, or truss member."
      ],
      "why": "These are the actual hold-down fasteners that secure the frame to the slab."
    },
    {
      "name": "Chamfer",
      "form": "start_end",
      "description": "Bevelled cut at the end of a stick, removing one corner. Used on diagonal braces and angled cripples to make the stick fit flush against its bearing.",
      "whenFires": [
        "End of every wall W-brace ≥28° from vertical: fires at the angled end.",
        "End of every header H, 70 mm: fires at both ends (H trimmed 1 mm/end vs studs at 2 mm).",
        "End of every Kb (cripple) — start only: fires at the lower end of vertical Kbs (where they sit on the plate). Upper end gets no Chamfer.",
        "End of every Kb diagonal: depends on ChamferTolerance (4 mm on standard, 2 mm on B2B) — if true cut angle exceeds tolerance, Chamfer fires."
      ],
      "why": "The chamfer relieves the corner that would otherwise interfere with the bearing surface."
    },
    {
      "name": "TrussChamfer",
      "form": "start_end",
      "description": "Larger end-bevel for truss members — different geometry from Chamfer. Tooling carries a 5-point curve specific to truss chord ends.",
      "whenFires": [
        "End of every truss-W (usage='web'), every truss-V: fires at both ends.",
        "Does not fire on anything outside a truss frame."
      ],
      "why": "Truss webs need a more aggressive corner removal because the angles are sharper."
    },
    {
      "name": "InnerNotch",
      "form": "spanned",
      "description": "Full rectangular cut through the web (deeper than LipNotch — actually penetrates the web), 39 to 48 mm long. Used at door-head cripples and short nogs where the crossing stick must pass entirely through.",
      "whenFires": [
        "At door-head cripple (164 mm short N): fires at both ends — full-web cut so the header's connecting bolt can pass through.",
        "At raised-B sill (Bh) ends: fires at both ends — the sill is a half-height plate that has to fit between two trim studs.",
        "At header H end caps (some configs): fires when H is paired and the flange-cut alone isn't enough.",
        "Does not fire on standard nogs (LipNotch is enough) or standard plates."
      ],
      "why": "When a cross-member must pass entirely through a stick, only a web-deep notch will do."
    },
    {
      "name": "InnerService",
      "form": "point",
      "description": "Service-hole variant of Web — Ø34 mm round hole at predictable positions on full-height studs for electrical conduit. Same tool as Web but rule-emitted for utility access.",
      "whenFires": [
        "Full-height wall studs (S): fires at 296 mm and 446 mm from one end (electrical conduit positions). Dynamic: which end is 'service end' depends on wall layout — set per-stud by the wall-service rule.",
        "Does not fire on plates, headers, nogs, or truss members."
      ],
      "why": "Electrical and plumbing penetrations need predictable, code-compliant openings."
    },
    {
      "name": "ScrewHoles",
      "form": "point",
      "description": "Small fastener pilot holes (Ø5 mm pattern) on truss chords and bottom-chord clusters. Used for connection plates between trusses.",
      "whenFires": [
        "Truss bottom-chord clusters (TB2B): fires at the chord-on-chord box-piece positions for connecting trusses to bottom-chord brackets.",
        "Does not fire on anything outside truss frames."
      ],
      "why": "Inter-truss connection plates fasten into these pilot holes."
    },
    {
      "name": "LeftFlange",
      "form": "spanned",
      "description": "Flange-mount cut on the left flange (rotation-aware). Optional tool, not all setups have it.",
      "whenFires": [
        "Reserved for future profile-specific tooling. Not yet used by any active rule."
      ],
      "why": "Future expansion."
    },
    {
      "name": "RightFlange",
      "form": "spanned",
      "description": "Mirror of LeftFlange for the right flange.",
      "whenFires": [
        "Reserved for future profile-specific tooling. Not yet used by any active rule."
      ],
      "why": "Future expansion."
    },
    {
      "name": "LeftPartialFlange",
      "form": "spanned",
      "description": "Reduced LeftFlange cut, partial-assembly tooling.",
      "whenFires": [
        "Reserved for future profile-specific tooling. Not yet used by any active rule."
      ],
      "why": "Future expansion."
    },
    {
      "name": "RightPartialFlange",
      "form": "spanned",
      "description": "Mirror of LeftPartialFlange.",
      "whenFires": [
        "Reserved for future profile-specific tooling. Not yet used by any active rule."
      ],
      "why": "Future expansion."
    }
  ],
  "roles": [
    { "code": "S",  "name": "Stud",            "description": "Full-height vertical wall member. Most common stick." },
    { "code": "J",  "name": "Jack stud",       "description": "Short vertical at door/window opening, head-to-sill or head-to-top." },
    { "code": "T",  "name": "Top plate",       "description": "Continuous horizontal top of a wall panel. Member ID prefix 'Tp'." },
    { "code": "B",  "name": "Bottom plate",    "description": "Continuous horizontal base of a wall panel. Slab-anchor bolts here. Member ID prefix 'Bp'." },
    { "code": "Bh", "name": "Raised bottom plate", "description": "Rough-opening sill — a B-style horizontal at sill height (one flange-height above slab B)." },
    { "code": "N",  "name": "Nog",             "description": "Short horizontal cross-member between studs (fire blocking, mid-height stiffener)." },
    { "code": "H",  "name": "Header",          "description": "Horizontal opening-top member. Often paired (H1+H2 box header). Member ID prefix 'Hd'." },
    { "code": "Kb", "name": "Cripple / king brace", "description": "Short vertical at header corners; can be vertical or angled." },
    { "code": "W",  "name": "Web / brace",     "description": "Diagonal stiffener. Two distinct usages: truss web (in trusses) and wall brace (X-brace in wall panels)." },
    { "code": "L",  "name": "Lintel / sill",   "description": "Horizontal opening-bottom member. 70 mm uses header pattern; 89 mm uses sill pattern. Member ID prefix 'Sl'." },
    { "code": "R",  "name": "Ribbon / brace",  "description": "Secondary diagonal stiffener (non-truss). Member ID prefix 'Br'." },
    { "code": "V",  "name": "Vertical web",    "description": "Truss vertical (FJ joist) — same operations as W with usage='web'." }
  ]
}
```

- [ ] **Step 2: The first loader test now passes**

Run: `npx vitest run lib/brain/loader.test.ts`
Expected: All 3 tests PASS once the other two JSON files exist (next two tasks). For now, only the first test depends on this file's existence; the negative tests already passed.

- [ ] **Step 3: Commit**

```powershell
git add data/brain/operations.json
git commit -m "feat(brain): add Catalogue A operations.json (14 entries + 12 roles)"
```

---

### Task 4: Catalogue B — Stick Interactions JSON

**Files:**
- Create: `data/brain/interactions.json`

Transcribes spec §7 into JSON.

- [ ] **Step 1: Create the JSON file**

```json
{
  "entries": [
    {
      "name": "T-junction",
      "description": "End-to-side meeting: stick A's end coordinate falls on stick B's centreline (within 1 mm tolerance).",
      "participants": "Stud meeting top plate; stud meeting bottom plate; nog meeting stud; truss diagonal meeting chord.",
      "emits": [
        "On B (the receiving stick): LipNotch centred on A's centreline + InnerDimple at the LipNotch position.",
        "On A (the entering stick): no extra ops at this end — its standard end-cap rule already handles it."
      ],
      "why": "The lip of B must be relieved so A keys in cleanly without binding; the dimple gives the connection screw a target."
    },
    {
      "name": "X-crossing",
      "description": "Two sticks' centreline projections intersect inside both bounding boxes.",
      "participants": "Truss webs crossing each other (linear truss scissor joint); wall X-bracing in a brace bay; bottom-chord bolt cluster on a TB2B truss.",
      "emits": [
        "On the longer / structural primary stick: LipNotch + InnerDimple at the crossing point.",
        "On the shorter / secondary stick: typically nothing — the primary's notch accommodates the secondary's pass-through."
      ],
      "why": "When one stick crosses another at angle, only one of them needs the relief — the one carrying the connection."
    },
    {
      "name": "End-butt",
      "description": "The end of one stick meets the end of another, both on the same line, with a small gap (≤30 mm).",
      "participants": "Continuous plates split by a panel break; nog continuing across a stud (treated as two nogs after frame-context detection).",
      "emits": [
        "On both sticks: standard end-cap operation (e.g. Swage for studs, LipNotch for plates) at each end. No special joint-specific operation."
      ],
      "why": "End-butts are framing convenience, not structural connections — the standard end-caps suffice."
    },
    {
      "name": "Lap",
      "description": "Two sticks parallel within a tight angle threshold, with overlapping length, separated by less than one flange height (~41 mm).",
      "participants": "Double-stud at panel join (pair at X and X+43); paired-header H1+H2 box header.",
      "emits": [
        "On both sticks at the overlap zone: Web @8 mm slab-anchor pattern (if at slab) or Bolt cluster (if structural connection).",
        "Otherwise: nothing — passive lap, dealt with by adjacent structural connections."
      ],
      "why": "Laps are usually structural connection zones; the operation depends on what's being connected."
    },
    {
      "name": "B2B partner pair",
      "description": "Two studs at the same x-position (within 1 mm), in the same frame, mirrored. Detected as a B2B context.",
      "participants": "TB2B truss chords; double-jamb at large openings.",
      "emits": [
        "Web @spacing on both studs: 7 holes spaced 447 mm, anchored 38 mm from each end.",
        "All other operations standard per-stick."
      ],
      "why": "B2B pairs need additional fasteners at regular intervals because they share the load path."
    },
    {
      "name": "Header-cripple (Kb meets H)",
      "description": "A Kb's upper end coincides with a header's underside.",
      "participants": "Every cripple at every door/window opening corner.",
      "emits": [
        "On H at the Kb's x-position: LipNotch + paired InnerDimple (the paired-dimple rule fires when the frame has paired headers).",
        "On Kb's lower end: Chamfer @start (so it sits flat on the plate below).",
        "On Kb's upper end: standard Swage + InnerDimple end-cap."
      ],
      "why": "The cripple is short and angled; it needs the chamfer to bear, and the header needs the notch + dimples for the cripple-to-header bolt."
    },
    {
      "name": "Truss-vertical-at-chord",
      "description": "A truss-W (vertical, usage='web') meets a horizontal chord. Detected as a truss interaction (frame-type check: 'truss' in plan name).",
      "participants": "Every interior vertical web on a TIN linear truss.",
      "emits": [
        "On chord: LipNotch + InnerDimple at the W's centreline.",
        "On W: TrussChamfer @start and TrussChamfer @end (truss webs always get truss-chamfer at both ends, irrespective of angle)."
      ],
      "why": "The truss-chamfer is the manufacturer-specified end-cut for truss webs; the chord notch is identical to the wall T-junction rule but flagged for truss processing."
    },
    {
      "name": "Truss-diagonal-at-chord",
      "description": "A truss-W meets a chord at an angle. Use line-intersection in the XZ plane to find the meeting point, project to chord y-level, convert to local position along the chord.",
      "participants": "Every diagonal web on every truss.",
      "emits": [
        "On chord at the projected point: LipNotch + InnerDimple.",
        "On W: TrussChamfer at both ends; Swage @end with span = 39 / cos(angle), capped at 200 mm."
      ],
      "why": "Diagonal webs need the same chord notch but their own end-spans depend on cut angle."
    },
    {
      "name": "Wall-W-at-plate",
      "description": "A wall-W brace stick (not a truss web — wall-frame, not truss-frame) hits a plate at angle ≥28° from vertical.",
      "participants": "The X-brace in a wall brace bay (typically L1/L3 first and last bays).",
      "emits": [
        "On plate at the meeting point: LipNotch + InnerDimple.",
        "On W at this end: Chamfer (wall-style chamfer, not TrussChamfer) + Swage 41 mm + InnerDimple @10 mm."
      ],
      "why": "Wall braces use a different chamfer geometry from truss webs; the angle threshold prevents the chamfer firing on near-vertical W's that don't need it."
    }
  ]
}
```

- [ ] **Step 2: Loader test moves forward**

Run: `npx vitest run lib/brain/loader.test.ts`
Expected: First test still partially fails because `frame-contexts.json` is missing. Other tests already passed.

- [ ] **Step 3: Commit**

```powershell
git add data/brain/interactions.json
git commit -m "feat(brain): add Catalogue B interactions.json (9 entries)"
```

---

### Task 5: Catalogue C — Frame Contexts JSON

**Files:**
- Create: `data/brain/frame-contexts.json`

Transcribes spec §8 into JSON.

- [ ] **Step 1: Create the JSON file**

```json
{
  "entries": [
    {
      "name": "Door opening",
      "trigger": "An opening in the wall XML with door-class dimensions (typical 2055 × 935 mm).",
      "members": [
        "2 × TRIMSTUD (Ts) — full height, flank the opening.",
        "2 × JACKSTUD lower (J) — head height to slab.",
        "2 × JACKSTUD upper (J) — top plate to head.",
        "1 × HEADPLATE (H) — spans opening at head height.",
        "Optional 1 × H2 paired header (box configuration).",
        "FILLER rows near braces if a brace bay is interrupted.",
        "No SILL (door has no sill)."
      ],
      "operations": [
        "Trim studs get Swage at head/sill heights (additional to the standard stud pattern).",
        "Header gets the paired-dimple rule (two dimples per LipNotch)."
      ]
    },
    {
      "name": "Window opening",
      "trigger": "Opening with window-class dimensions and a sill height (typical 1000 mm or 1250 mm).",
      "members": [
        "2 × TRIMSTUD (Ts).",
        "2 × JACKSTUD upper (head to top).",
        "2 × JACKSTUD lower (sill to slab).",
        "Optional 2 × short studs above sill (in opening width).",
        "1 × SILL (L) at opening bottom.",
        "1 × HEADPLATE (H).",
        "FILLER rows where applicable."
      ],
      "operations": [
        "Standard per-stick rules for each member.",
        "Header gets paired-dimple rule when paired with H2."
      ]
    },
    {
      "name": "AC / utility opening",
      "trigger": "Opening with small dimensions (typical 440 × 670 mm) on an otherwise blank wall.",
      "members": [
        "Standard wall studs (no trim/jack stud overhead).",
        "A specially-named nog: AC Ng1 at AC unit height."
      ],
      "operations": [
        "AC Ng1 follows standard nog rules at its mounting height."
      ]
    },
    {
      "name": "Brace bay",
      "trigger": "A wall panel section where two diagonal braces (Br1/Br2 or W) cross to form an X.",
      "members": [
        "2 × BRACE (Br) at the bay's top-left to bottom-right and top-right to bottom-left diagonals."
      ],
      "operations": [
        "Each brace gets the wall-W pattern (Chamfer + Swage 41 + InnerDimple @10).",
        "The plates above and below the bay get LipNotch + InnerDimple at the brace meeting points (per Wall-W-at-plate interaction)."
      ]
    },
    {
      "name": "B2B partner pair",
      "trigger": "Two studs at the same x-position (within 1 mm) in the same frame, mirrored.",
      "members": [
        "2 × stud paired flange-on-flange."
      ],
      "operations": [
        "See B2B partner pair interaction (Catalogue B). Web @spacing pattern fires on both studs."
      ]
    },
    {
      "name": "TIN linear truss panel",
      "trigger": "Plan name contains '-TIN-' or '-LIN-'.",
      "members": [
        "2 × top chord (T), 2 × bottom chord (B) (or 1 of each for inline trusses).",
        "N × W (truss webs, usage='web') — verticals and diagonals.",
        "0 to 4 × V (truss verticals, FJ joist style)."
      ],
      "operations": [
        "All truss-Ws get TrussChamfer at both ends (per Truss-vertical-at-chord and Truss-diagonal-at-chord interactions).",
        "Centerline crossings of webs (where two W's meet between chords) get a 3-hole bolt-cluster pattern.",
        "Bottom chords get reduced operation set vs top chords (no service holes, simplified)."
      ]
    },
    {
      "name": "TB2B back-to-back truss panel",
      "trigger": "Plan name contains '-TB2B-'.",
      "members": [
        "Same as TIN but chords are paired (B2B pattern).",
        "Box pieces between chord pairs."
      ],
      "operations": [
        "Centerline crossings get Web @pt instead of just InnerDimple.",
        "Box pieces get ScrewHoles clusters.",
        "Header/chord cap-stacks fire."
      ]
    },
    {
      "name": "Roof panel (flat)",
      "trigger": "Plan name contains '-RP-' (and roof is flat — the only tested case).",
      "members": [
        "Top chord, bottom chord, intermediate verticals, end blocking pieces (Bx)."
      ],
      "operations": [
        "Top/bottom plates get Chamfer + InnerDimple @10 instead of standard Swage at end caps (the RP-specific rule).",
        "Studs get LipNotch 56..101 + InnerDimple @78.5 at end caps."
      ]
    }
  ]
}
```

- [ ] **Step 2: Loader test passes fully**

Run: `npx vitest run lib/brain/loader.test.ts`
Expected: ALL 3 tests PASS.

- [ ] **Step 3: Commit**

```powershell
git add data/brain/frame-contexts.json
git commit -m "feat(brain): add Catalogue C frame-contexts.json (8 entries)"
```

---

### Task 6: Content tests — every spec entry is present

**Files:**
- Create: `lib/brain/catalogues.test.ts`

These tests guard against accidental deletion or rename of catalogue entries.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run lib/brain/catalogues.test.ts`
Expected: ALL tests PASS.

- [ ] **Step 3: Commit**

```powershell
git add lib/brain/catalogues.test.ts
git commit -m "test(brain): assert all spec-listed catalogue entries are present"
```

---

### Task 7: Brain encoder facade

**Files:**
- Create: `lib/brain/encoder.ts`
- Create: `lib/brain/encoder.test.ts`

The encoder facade walks the synthesized RFY document and produces a `ClassificationReport` tagging every emitted operation against Catalogue A. The bundle itself is built by the shared `lib/encode-bundle.ts` helper (Task 8); the brain encoder is report-only.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/brain/encoder.test.ts`
Expected: FAIL with "Cannot find module './encoder'".

- [ ] **Step 3: Write the encoder facade**

```typescript
// lib/brain/encoder.ts
//
// Walks a FrameCAD XML through the existing decode pipeline and produces a
// ClassificationReport — every emitted operation tagged "catalogued" or
// "uncatalogued" against Catalogue A. v0 does NOT modify the codec's
// behaviour; the bundle (RFY + CSV files) is produced separately by
// lib/encode-bundle.ts.

import { decodeXml } from "@hytek/rfy-codec";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { loadCatalogues } from "./loader";
import type { ClassificationReport, ClassifiedOp } from "./types";

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

  const classifiedOps: ClassifiedOp[] = [];
  const perPlanMap = new Map<string, { totalOps: number; uncatalogued: number }>();

  for (const plan of doc.project.plans) {
    perPlanMap.set(plan.name, { totalOps: 0, uncatalogued: 0 });
    for (const stick of plan.sticks) {
      for (const op of stick.toolingOps ?? []) {
        const classification: ClassifiedOp["classification"] =
          knownOpNames.has(op.name) ? "catalogued" : "uncatalogued";
        classifiedOps.push({
          name: op.name,
          stickName: stick.name,
          planName: plan.name,
          position: op.position ?? 0,
          classification,
        });
        const tally = perPlanMap.get(plan.name)!;
        tally.totalOps += 1;
        if (classification === "uncatalogued") tally.uncatalogued += 1;
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
```

- [ ] **Step 4: Verify type-check**

Run: `npm run typecheck`
Expected: type-check passes. If `op.position` or `stick.toolingOps` don't exist on the decoded types, inspect `node_modules/@hytek/rfy-codec/dist/index.d.ts` for the actual shape and adjust the field names. Common alternates: `op.start`, `op.pos`, `stick.tooling`. Fix and re-run typecheck until it passes.

- [ ] **Step 5: Run the encoder test**

Run: `npx vitest run lib/brain/encoder.test.ts`
Expected: PASS if a fixture exists at `lib/brain/fixtures/small.xml`, otherwise SKIP with a console warning. (We add a fixture in Task 12.)

- [ ] **Step 6: Commit**

```powershell
git add lib/brain/encoder.ts lib/brain/encoder.test.ts
git commit -m "feat(brain): encoder produces classification report from FrameCAD XML"
```

---

### Task 8: Extract encode-bundle bundling into a shared helper

The brain endpoint must produce a ZIP that's byte-identical to `/api/encode-bundle`'s output (per-plan RFYs, oracle cache integration, partial-hit handling), plus an extra `classification.json`. The cleanest way to share the bundling logic is to extract it from the route into a helper that both endpoints call. This is a pure refactor — no behaviour change to `/api/encode-bundle`.

**Files:**
- Create: `lib/encode-bundle.ts`
- Create: `lib/encode-bundle.test.ts`
- Modify: `app/api/encode-bundle/route.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "C:\Users\ScottTextor\CLAUDE CODE\hytek-rfy-tools"; npx vitest run lib/encode-bundle.test.ts`
Expected: FAIL with "Cannot find module './encode-bundle'".

- [ ] **Step 3: Read the existing route to understand its body**

Read: `app/api/encode-bundle/route.ts` from line 1 to end. Note:
- It validates the XML contains `<framecad_import`.
- It calls `oracleLookup(xml)` and `oracleLookupPerPlan(xml)`.
- It calls `framecadImportToRfy(xml)`.
- It calls `decodeXml(result.xml)` and `documentToCsvs(doc)`.
- It assembles a ZIP with per-plan RFYs (single-plan / all-hit / partial-hit / no-hits branches), per-plan CSVs, and a README.
- It builds response headers (`x-plan-count`, `x-stick-count`, `x-oracle-hit`, etc.).

The helper extracts this logic and returns `{ zipBytes, headers }`.

- [ ] **Step 4: Write `lib/encode-bundle.ts`**

```typescript
// lib/encode-bundle.ts
//
// Shared helper containing the FrameCAD-XML → production-bundle ZIP logic.
// Both /api/encode-bundle and /api/brain/encode call this. Behaviour is
// identical to the original route — this is a pure refactor.

import JSZip from "jszip";
import { decodeXml, documentToCsvs } from "@hytek/rfy-codec";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { oracleLookup, oracleLookupPerPlan } from "@/lib/oracle-cache";

export interface BundleResult {
  zipBytes: Uint8Array;
  headers: Record<string, string>;
}

export async function buildBundle(xml: string, filename: string): Promise<BundleResult> {
  const trimmed = xml.trim();
  if (!trimmed) throw new Error("Empty input");
  if (!trimmed.toLowerCase().includes("<framecad_import")) {
    throw new Error(
      "Expected <framecad_import> XML at the top level. " +
      "If you have a Detailer schedule XML instead, use 'Plain Text or XML → RFY' to encode it directly."
    );
  }

  // Oracle cache lookup (same logic as the original route).
  const oracle = oracleLookup(trimmed);
  let oracleHit = oracle.hit;
  let oracleMissReason: string | null = oracle.hit ? null : oracle.reason;
  if (!oracle.hit) console.log(`[encode-bundle] single-plan oracle miss: ${oracle.reason}`);

  const perPlan = oracleLookupPerPlan(trimmed);
  const perPlanHits = perPlan.results.filter(r => r.hit).length;
  if (perPlan.totalPlans > 1) {
    console.log(
      `[encode-bundle] per-plan oracle: ${perPlanHits}/${perPlan.totalPlans} hit ` +
      `(${perPlan.allHit ? "all hit — bit-exact bundle" : "mixed"})`
    );
  }

  // Synthesize: parse XML → ParsedProject → RfyDocument → encrypted RFY.
  const result = framecadImportToRfy(trimmed);
  if (result.stickCount === 0) {
    throw new Error("No sticks found in <framecad_import> document.");
  }
  const doc = decodeXml(result.xml);

  // Filename helpers.
  const baseName = filename.replace(/\.(xml|txt)$/i, "");
  const safeJob = (result.jobnum || baseName).replace(/[^A-Za-z0-9]/g, "");
  const planNames = doc.project.plans.map(p => p.name);
  const csvs = documentToCsvs(doc);

  const zip = new JSZip();
  const wrote: string[] = [];

  // RFY emission (single-plan / all-hit / partial-hit / no-hits) — same
  // branching logic as the original route.
  if (doc.project.plans.length === 1) {
    const planName = planNames[0]!.replace(/[^A-Za-z0-9._-]/g, "");
    const rfyName = `${safeJob}_${planName}.rfy`;
    const rfyBytes = oracle.hit ? oracle.rfyBytes : result.rfy;
    zip.file(rfyName, new Uint8Array(rfyBytes));
    wrote.push(rfyName);
  } else if (perPlan.allHit && perPlan.totalPlans > 0) {
    for (const r of perPlan.results) {
      const safePlanName = r.planName.replace(/[^A-Za-z0-9._-]/g, "");
      const rfyName = `${safeJob}_${safePlanName}.rfy`;
      zip.file(rfyName, new Uint8Array(r.rfyBytes!));
      wrote.push(rfyName);
    }
    oracleHit = true;
    oracleMissReason = null;
  } else if (perPlanHits > 0) {
    for (const r of perPlan.results) {
      if (!r.hit) continue;
      const safePlanName = r.planName.replace(/[^A-Za-z0-9._-]/g, "");
      const rfyName = `${safeJob}_${safePlanName}.rfy`;
      zip.file(rfyName, new Uint8Array(r.rfyBytes!));
      wrote.push(rfyName);
    }
    const combinedName = `${safeJob}.rfy`;
    zip.file(combinedName, new Uint8Array(result.rfy));
    wrote.push(combinedName);
    oracleHit = false;
    oracleMissReason = `partial: ${perPlanHits}/${perPlan.totalPlans} plans hit cache; combined codec .rfy included for misses`;
  } else {
    oracleHit = false;
    oracleMissReason = oracleMissReason ?? perPlan.firstMissReason ?? "multi-plan input — no cache hits";
    const rfyName = `${safeJob}.rfy`;
    zip.file(rfyName, new Uint8Array(result.rfy));
    wrote.push(rfyName);
  }

  // Per-plan CSVs.
  for (const [planName, csvText] of Object.entries(csvs)) {
    const safePlanName = planName.replace(/[^A-Za-z0-9._-]/g, "_");
    const csvName = `${safeJob}#1-1_${safePlanName}.csv`;
    zip.file(csvName, csvText);
    wrote.push(csvName);
  }

  zip.file(
    "README.txt",
    `HYTEK RFY Tools — production bundle\n` +
    `===================================\n\n` +
    `Generated from: ${filename}\n` +
    `Project:        ${result.projectName}\n` +
    `Job number:     ${result.jobnum || "<unset>"}\n` +
    `Plans:          ${result.planCount}\n` +
    `Frames:         ${result.frameCount}\n` +
    `Sticks:         ${result.stickCount}\n\n` +
    `Files in this bundle (${wrote.length}):\n` +
    wrote.map(f => `  ${f}`).join("\n") + "\n\n" +
    `RFY files:   load on the F300i rollformer via USB.\n` +
    `CSV files:   per-plan rollforming sequence (matches Detailer output).\n`
  );

  const zipBytes = await zip.generateAsync({ type: "uint8array" });

  const headers: Record<string, string> = {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${safeJob}_bundle.zip"`,
    "x-plan-count": String(result.planCount),
    "x-stick-count": String(result.stickCount),
    "x-oracle-hit": String(oracleHit),
  };
  if (!oracleHit && oracleMissReason) headers["x-oracle-miss-reason"] = oracleMissReason;
  if (oracleHit && oracle.hit) headers["x-oracle-source"] = oracle.rfyPath;
  if (perPlan.totalPlans > 1) {
    headers["x-oracle-per-plan-hits"] = String(perPlanHits);
    headers["x-oracle-per-plan-total"] = String(perPlan.totalPlans);
  }

  return { zipBytes, headers };
}
```

- [ ] **Step 5: Replace the route body with a thin wrapper**

Edit `app/api/encode-bundle/route.ts`. Replace the entire file with:

```typescript
// FrameCAD <framecad_import> XML → ZIP containing the production bundle:
//   <jobnum>_<plan>.rfy           — encrypted file the F300i loads
//   <jobnum>#1-1_<plan>.csv       — per-plan rollforming CSV (one per plan)
//   README.txt                    — quick reference for what's inside
//
// Bundling logic lives in lib/encode-bundle.ts so /api/brain/encode can
// reuse it. This route is a thin wrapper.

import { NextResponse } from "next/server";
import { buildBundle } from "@/lib/encode-bundle";
import { readBodyText } from "@/lib/read-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.xml");
    const xml = await readBodyText(req);
    const { zipBytes, headers } = await buildBundle(xml, filename);
    return new NextResponse(new Uint8Array(zipBytes), { status: 200, headers });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
```

- [ ] **Step 6: Type-check + run the test**

Run: `npm run typecheck && npx vitest run lib/encode-bundle.test.ts`
Expected: type-check passes; test passes (assumes Task 11's fixture exists, otherwise the first test skips).

- [ ] **Step 7: Manual regression — encode-bundle still works identically**

Start dev server (`npm run dev`). Upload the same XML to `/api/encode-bundle` before and after this refactor. Diff the output ZIPs:

```powershell
$xml = Get-Content "<path-to-known-good.xml>" -Raw
Invoke-WebRequest -Method POST -Uri "http://localhost:3000/api/encode-bundle" -Body $xml -ContentType "application/xml" -OutFile "after.zip"
# Compare against a previously-saved before.zip if you have one, or against a known reference.
$h = (Get-FileHash "after.zip" -Algorithm SHA256).Hash
"After-refactor SHA256: $h"
```

If the byte content of the ZIP differs (excluding ZIP timestamps which JSZip embeds), investigate.

- [ ] **Step 8: Commit**

```powershell
git add lib/encode-bundle.ts lib/encode-bundle.test.ts app/api/encode-bundle/route.ts
git commit -m "refactor(encode-bundle): extract bundling logic into shared helper"
```

---

### Task 9: `/api/brain/encode` endpoint

**Files:**
- Create: `app/api/brain/encode/route.ts`

The brain endpoint calls `buildBundle()` for the byte-identical bundle, then `brainEncode()` for the classification report, and adds `classification.json` to the ZIP.

- [ ] **Step 1: Write the route**

```typescript
// app/api/brain/encode/route.ts
//
// POST a FrameCAD <framecad_import> XML body. Returns the same ZIP that
// /api/encode-bundle returns (byte-identical bundle), with one extra file:
//   classification.json — every emitted operation tagged against Catalogue A.
//
// v0: brain delegates byte-emission to the shared bundling helper; the only
// NEW output is classification.json.

import { NextResponse } from "next/server";
import JSZip from "jszip";
import { buildBundle } from "@/lib/encode-bundle";
import { brainEncode } from "@/lib/brain/encoder";
import { readBodyText } from "@/lib/read-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.xml");
    const xml = await readBodyText(req);

    // 1. Existing bundle (byte-identical to /api/encode-bundle output).
    const { zipBytes, headers: bundleHeaders } = await buildBundle(xml, filename);

    // 2. Classification report from the brain layer.
    const { report } = brainEncode(xml);

    // 3. Add classification.json to the ZIP without changing existing files.
    const zip = await JSZip.loadAsync(zipBytes);
    zip.file("classification.json", JSON.stringify(report, null, 2));

    const newZipBytes = await zip.generateAsync({ type: "uint8array" });

    // 4. Forward the bundle's x-* headers + brain-specific headers.
    const safeBase = filename.replace(/\.(xml|txt)$/i, "");
    const responseHeaders: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(bundleHeaders).filter(([k]) => k.startsWith("x-") || k === "content-type")
      ),
      "content-disposition": `attachment; filename="${safeBase}_brain.zip"`,
      "x-brain-classified": String(report.catalogued),
      "x-brain-uncatalogued": String(report.uncatalogued),
    };

    return new NextResponse(new Uint8Array(newZipBytes), { status: 200, headers: responseHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual sanity check**

Start dev server. POST a known-good XML to `/api/brain/encode`. Confirm the response is a ZIP. Open it; confirm it contains the same files as `/api/encode-bundle`'s output PLUS `classification.json`.

```powershell
$xml = Get-Content "<path-to-known-good.xml>" -Raw
Invoke-WebRequest -Method POST -Uri "http://localhost:3000/api/brain/encode" -Body $xml -ContentType "application/xml" -OutFile "out-brain.zip"
Expand-Archive -Path "out-brain.zip" -DestinationPath ".\out-brain-extracted" -Force
Get-Content ".\out-brain-extracted\classification.json"
```

- [ ] **Step 4: Commit**

```powershell
git add app/api/brain/encode/route.ts
git commit -m "feat(brain): POST /api/brain/encode — bundle + classification report"
```

---

### Task 10: `/brain` page — upload UI

**Files:**
- Create: `app/brain/page.tsx`

A minimal page that uploads an XML and downloads the brain ZIP. Mirrors the existing converter card pattern.

- [ ] **Step 1: Write the page**

```tsx
// app/brain/page.tsx
"use client";

import { useState } from "react";

export default function BrainPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResultMsg(null);
    try {
      const xml = await file.text();
      const res = await fetch("/api/brain/encode", {
        method: "POST",
        headers: {
          "content-type": "application/xml",
          "x-filename": encodeURIComponent(file.name),
        },
        body: xml,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = file.name.replace(/\.(xml|txt)$/i, "") + "_brain.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setResultMsg("Bundle downloaded. classification.json inside the ZIP shows which ops are catalogued.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8 text-stone-100">
      <h1 className="mb-2 text-2xl font-semibold">Frame Brain (preview)</h1>
      <p className="mb-6 text-sm text-stone-400">
        Upload a FrameCAD <code>{`<framecad_import>`}</code> XML. The brain delegates encoding to
        the existing pipeline and adds a <code>classification.json</code> report listing every
        emitted operation tagged against Catalogue A. v0 — read-only; no rule changes yet.
      </p>

      <label className="block cursor-pointer rounded-lg border border-dashed border-stone-600 bg-stone-900/50 p-8 text-center hover:bg-stone-900">
        <input
          type="file"
          accept=".xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
          disabled={busy}
        />
        {busy ? "Encoding…" : "Click to choose an XML file"}
      </label>

      {error && (
        <div className="mt-4 rounded border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {resultMsg && (
        <div className="mt-4 rounded border border-emerald-700 bg-emerald-950/50 p-3 text-sm text-emerald-200">
          {resultMsg}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual sanity check**

Start dev server (`npm run dev`), open `http://localhost:3000/brain`, upload a known XML. ZIP should download.

- [ ] **Step 4: Commit**

```powershell
git add app/brain/page.tsx
git commit -m "feat(brain): /brain page with upload + download"
```

---

### Task 11: Add "Brain (preview)" card to the home page

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Read the current home page to find the converter list**

Run: `Read app/page.tsx` and find:
- the `Mode` union type
- the `MODE_LABELS` record
- the rendered list of `<ConverterCard>`s

- [ ] **Step 2: Add the new mode**

Edit `app/page.tsx`:

Find:
```tsx
type Mode = "encode-bundle" | "decode-bundle" | "encode-auto" | "rfy-to-csv" | "csv-to-rfy" | "forge-encode";
```

Replace with:
```tsx
type Mode = "encode-bundle" | "decode-bundle" | "encode-auto" | "rfy-to-csv" | "csv-to-rfy" | "forge-encode" | "brain-encode";
```

Find the closing `}` of `MODE_LABELS` and add a new entry just before it:
```tsx
  "brain-encode": {
    title: "Frame Brain → Bundle + Classification (preview)",
    subtitle: "Upload <framecad_import>.xml → ZIP with the .rfy + per-plan .csv files PLUS a classification.json that tags each emitted operation against the Tool Operations catalogue. v0 — bytes identical to encode-bundle; new output is the report.",
    from: ".xml",
    accept: ".xml",
    endpoint: "/api/brain/encode",
  },
```

If there is a section in the page that renders the cards as a list (e.g. `["encode-bundle", "decode-bundle", ...].map(...)`), append `"brain-encode"` to that list.

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual sanity check**

Start dev server, visit `http://localhost:3000/`, confirm the new card appears and links work.

- [ ] **Step 5: Commit**

```powershell
git add app/page.tsx
git commit -m "feat(brain): add 'Frame Brain' card to home page"
```

---

### Task 12: End-to-end smoke test

**Files:**
- Create: `lib/brain/fixtures/small.xml` — a small known-good FrameCAD XML committed to the repo
- Create: `lib/brain/smoke.test.ts`

- [ ] **Step 1: Pick or create a small fixture XML**

Source candidates (use the smallest one available):
- An existing test fixture in the repo (search `fixture` / `test-fixtures` / `.xml` in `tests/`)
- The HG260001 LBW input cached at `OneDrive/CLAUDE DATA FILE/memory/reference_data/HG260001/HG260001-LBW-INPUT.xml`
- Any small `<framecad_import>` XML the team has on hand

Copy the chosen XML to `lib/brain/fixtures/small.xml`. Aim for under 100 KB so the test runs fast.

- [ ] **Step 2: Write the failing test**

```typescript
// lib/brain/smoke.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brainEncode } from "./encoder";
import { buildBundle } from "@/lib/encode-bundle";

const fixturePath = join(process.cwd(), "lib", "brain", "fixtures", "small.xml");

describe("brain smoke test", () => {
  it("buildBundle produces non-empty ZIP bytes for the fixture", async () => {
    const xml = readFileSync(fixturePath, "utf8");
    const { zipBytes, headers } = await buildBundle(xml, "small.xml");
    expect(zipBytes.length).toBeGreaterThan(100);
    expect(Number(headers["x-stick-count"])).toBeGreaterThan(0);
  });

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
```

- [ ] **Step 3: Run to see what happens**

Run: `npx vitest run lib/brain/smoke.test.ts`
Expected: PASS — but if the codec emits an op name not in Catalogue A, the test will surface it explicitly. Resolve any discrepancy by updating Catalogue A (Task 3 file).

- [ ] **Step 4: Commit**

```powershell
git add lib/brain/fixtures/small.xml lib/brain/smoke.test.ts
git commit -m "test(brain): end-to-end smoke test with checked-in fixture XML"
```

---

### Task 13: Brain overview documentation

**Files:**
- Create: `docs/brain-overview.md`

A short human-readable index of the catalogues, linking back to the spec.

- [ ] **Step 1: Write the doc**

```markdown
# Frame Brain — overview

The brain v0 layer lives at `lib/brain/` and reads three JSON catalogues from `data/brain/`. The catalogues describe HYTEK's tooling rules in plain English. v0 doesn't yet drive the rule engine — the existing codec is unchanged — but the catalogues are the input the settings UI (Phase 3) will read and edit, and the rule engine (Phase 5 cutover) will consume.

**Spec:** [docs/superpowers/specs/2026-05-09-hytek-frame-brain-design.md](superpowers/specs/2026-05-09-hytek-frame-brain-design.md)

## Catalogues

| File | Spec § | Entries |
|---|---|---|
| [data/brain/operations.json](../data/brain/operations.json) | §6 — Catalogue A — Tool Operations | 14 operations + 12 stick roles |
| [data/brain/interactions.json](../data/brain/interactions.json) | §7 — Catalogue B — Stick Interactions | 9 interactions |
| [data/brain/frame-contexts.json](../data/brain/frame-contexts.json) | §8 — Catalogue C — Frame Contexts | 8 frame contexts |

## API

`POST /api/brain/encode` — body: FrameCAD `<framecad_import>` XML. Returns a ZIP containing the RFY bytes (same as `/api/encode-bundle`), per-plan CSVs, and a `classification.json` report tagging every emitted operation against Catalogue A.

## UI

`/brain` — upload page that calls the endpoint above and downloads the ZIP.

## Editing rules

v0 is read-only. Catalogue editing comes in Phase 3 (Settings UI). For now, edit the JSON files directly and re-deploy.

## Tests

- `lib/brain/loader.test.ts` — loader + structural validation.
- `lib/brain/catalogues.test.ts` — every spec-listed entry is present.
- `lib/brain/encoder.test.ts` — encoder facade shape.
- `lib/brain/smoke.test.ts` — end-to-end on a fixture XML.

Run: `npm run test`
```

- [ ] **Step 2: Commit**

```powershell
git add docs/brain-overview.md
git commit -m "docs(brain): overview index of catalogues, API, and tests"
```

---

## Verification — full plan acceptance

After all 13 tasks complete:

- [ ] **Run all brain tests:**

```powershell
cd "C:\Users\ScottTextor\CLAUDE CODE\hytek-rfy-tools"
npm run test -- lib/brain
```
Expected: every test PASSES.

- [ ] **Run type-check:**

```powershell
npm run typecheck
```
Expected: no errors.

- [ ] **Manual end-to-end:**

Start dev server. Upload an XML to `/brain`. Confirm the ZIP downloads with `classification.json` inside.

- [ ] **Validate against an existing oracle-cache hit:**

Pick one of the 383 cached jobs (any XML from `OneDrive/CLAUDE DATA FILE/detailer-oracle-cache/<job>/`). Encode it via `/api/encode-bundle` and via `/api/brain/encode`. The .rfy bytes inside both ZIPs must be byte-identical (since v0 delegates encoding). Diff:

```powershell
$ref = ".\out-encode-bundle\<job>_<plan>.rfy"
$brain = ".\out-brain\<job>_<plan>.rfy"
$h1 = (Get-FileHash $ref -Algorithm SHA256).Hash
$h2 = (Get-FileHash $brain -Algorithm SHA256).Hash
if ($h1 -eq $h2) { "MATCH" } else { "DIFF — investigate" }
```

If hashes differ, brainEncode is doing something the legacy bundle is not — debug.

- [ ] **Final commit (optional — if doc updates landed during verification):**

```powershell
git status
git push origin master
```

---

## Out of scope for this plan

These belong to subsequent plans:

- **Settings UI** — three-tab editor for the catalogues, JSON persistence, hot-reload. Phase 3 (next plan).
- **PDF emitter** — drawing-set renderer with operations marked per stick. Phase 4.
- **Validation harness against the Forge cache** — full 383-entry sweep with classification per cache entry. Phase 4 / Phase 5.
- **Migrating rules from legacy code into catalogues** — Phase 5 cutover, multi-plan effort. The catalogues become the source of truth, the legacy rule engine is gradually emptied.
- **Profile expansion** — filling 75/78/90/104 mm coverage in the catalogues with empirically-validated constants. Open question §14.1 in the spec.

End of plan.
