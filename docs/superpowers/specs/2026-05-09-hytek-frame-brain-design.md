# HYTEK Frame Brain — Design Spec

**Date:** 2026-05-09
**Author:** Scott Textor (HYTEK Framing) + Claude
**Supersedes:** the "match Detailer byte-for-byte" goal that has driven RFY codec work for the prior 13 sessions.
**Status:** Draft for review. No code written yet. This document IS the design.

---

## 0. Read this first

This spec defines a new app — the **HYTEK Frame Brain** — that takes a FrameCAD XML file and produces three correct outputs (RFY for the rollformer, CSV for the rollformer, PDF for shop-floor reading) by applying plain-English rules about how steel sticks meet each other.

It is not "version 2 of the codec." It is a strategic re-framing. The codec we have today reaches ~75% parity against Detailer's outputs and plateaus there. The plateau is structural, not a tuning problem — see §1.

The brain replaces "what does Detailer emit?" with "**what should fire when stick A meets stick B?**" That second question has a finite, enumerable answer. This document enumerates it.

You should be able to read this cover to cover, point at any rule, and either say "yes, that's right" or "no, change it to X." The rules are the source of truth.

---

## 1. Why this exists

Two diagnostic insights forced the pivot:

**1.1 Detailer's outputs are not all rule-derived.** The reference RFYs we've been benchmarking against — both on Y: drive and via Frida-captured Detailer traces — contain human one-off edits. A detailer modifies an output by hand for a specific job (override a notch, suppress a hole, shift a swage). Those edits don't follow any rule. They cannot be replicated by any rule engine, by construction. Attempting to do so will plateau forever — which is exactly what 13 sessions of work observed.

**1.2 Steel-stick interactions are physically bounded.** Two sticks of cold-formed steel, in a HYTEK frame, can only meet each other in a finite set of geometric configurations: end-to-side (T-junction), side-to-side at angle (X-crossing), end-to-end (butt), parallel adjacent (lap or B2B pair), and a small handful more. We already know — from manufacturing experience and from the existing codec — what tooling fires for each one.

Putting (1.1) and (1.2) together: the right target is **"correct steel"**, not **"matching Detailer bytes"**. The former has a knowable answer. The latter does not.

**1.3 Rule-derivation methodology has been independently validated.** A separate HYTEK reverse-engineering effort (different project, different scope) produced a generated output that matched its production target byte-for-byte once the rules were derived from first principles rather than copied from the source tool. That's empirical proof rule-derivation can yield correct files when the target is correctness, not parity.

**1.4 The Detailer EOL deadline (2026-05-15) becomes irrelevant.** If our brain is the source of truth, the date Detailer dies stops mattering. We are no longer dependent on Detailer producing comparison output.

---

## 2. What we're building

A web app (extends `hytek-rfy-tools`) with three user-visible parts:

1. **Encoder** — upload XML, get RFY + CSV + PDF back.
2. **Settings area** — read and edit the rules in plain English. Three catalogues: Tool Operations, Stick Interactions, Frame Contexts. Edit any rule, the next encode behaves differently.
3. **Drawing viewer** — see every operation rendered on top of the frame drawing, per stick. The PDF output is this view, exported.

Behind those three: the brain itself — the rule engine that walks the parsed XML, detects every stick-to-stick interaction, applies the rules, and emits the operation list per stick.

---

## 3. Non-goals

- **Bit-exact Detailer parity.** Permanently dropped. We are not chasing it again.
- **Replicating Detailer's hand-edited outputs.** Where a cached Detailer RFY contains a human override, the brain will disagree with it. That's correct behaviour, not a regression.
- **Replacing the existing codec immediately.** The 75%-parity codec remains as the back-end the brain calls into for now. The brain is the new front-end and rule layer; codec internals get refactored over time as the brain's catalogues become authoritative.
- **Migration of legacy tooling output.** Cached RFYs in the Forge cache stay as-is for historical jobs. New jobs go through the brain.

---

## 4. The pipeline

```
FrameCAD XML
    ↓
[1] XML parser  →  RawProject (sticks, profiles, lengths, positions, frame layout)
    ↓
[2] Interaction detector  →  per-frame list of every pairwise stick meeting
                              + frame-context patterns (door, window, brace bay, …)
    ↓
[3] Rule engine  →  for each stick, the operation list it should receive
                    (rules consult the three catalogues in §6, §7, §8)
    ↓
[4] Three emitters in parallel
        ├─ RFY emitter  →  encrypted machine file (existing codec back-end)
        ├─ CSV emitter  →  rollformer per-plan CSV (see §10.2)
        └─ PDF emitter  →  drawing set with operations marked per stick
```

Each step has one clear job. Boundaries are clean enough that any one step can be re-implemented or unit-tested without touching the others.

---

## 5. Data model

### 5.1 Operation

```
Operation {
    name              # e.g. "LipNotch"
    geometric_form    # "point" | "spanned" | "start_end"
    description       # plain English
    parameters        # mm values resolved from the active machine setup
}
```

There are exactly **14 operations** (§6). The list is closed — we are not adding new ones, only adjusting when each fires.

### 5.2 Stick role

```
Stick {
    role            # one of 12 (S, J, T, B, Bh, N, H, Kb, W, L, R, V) — see §6.2
    profile         # 70S41, 89S41, 75S44, 78S44, 90S41, 104S51 (six families)
    gauge           # 0.55 / 0.75 / 0.95 / 1.15 mm
    length          # mm
    bbox            # 3D corners in frame-local coordinates
    flipped         # orientation flag
}
```

### 5.3 Interaction

```
Interaction {
    type            # one of 9 (§7) — T-junction, X-cross, end-butt, lap, B2B pair,
                    #                  header-cripple, truss-vertical-at-chord,
                    #                  truss-diagonal-at-chord, wall-W-at-plate
    sticks          # the 2+ sticks involved
    geometry        # crossing point(s), angle(s), overlap span
    operations      # per-stick op lists this interaction triggers
}
```

### 5.4 Frame context

```
FrameContext {
    pattern         # one of 8 (§8) — door, window, AC, brace bay, B2B pair,
                    #                  TIN truss, TB2B truss, roof panel
    members         # the sticks that make up this pattern
    operations      # per-member op lists this pattern triggers
}
```

### 5.5 Rule

A rule is a record with three plain-English fields and an action:

```
Rule {
    when_seen       # plain-English description of the trigger
    on_which_stick  # plain-English description of which stick(s) get the ops
    fires_what      # the operation(s) emitted, with their parameters
    why             # plain-English explanation (why this rule exists)
}
```

Rules are stored as JSON in source control. They are also rendered in the settings UI as plain English. **The plain English IS the spec, not the JSON.** Editing the plain English changes the JSON; the engine re-loads.

---

## 6. Catalogue A — Tool Operations

The 14 operations the F325iT rollformer can emit. Every operation in any HYTEK RFY/CSV is one of these.

### 6.1 Reference table

| # | Name | Form | What it physically does |
|---|------|------|-------------------------|
| 1 | **LipNotch** | spanned | Rectangular cut through both lips of the C-section, leaving the web intact. Length 48–80mm. The dominant operation at every cross-member joint; lets the crossing stick "key" into the lip. |
| 2 | **InnerDimple** | point | Locating dimple (small embossed cone) on the inner web face, used as a fastener target. Diameter ~10mm. Sits at fixed offsets from each end (16.5mm / 20.5mm depending on profile) and at every cross-member crossing. |
| 3 | **Swage** | spanned | Web-stiffening crimp — a roll-formed concave fold in the web. 39–55mm long. Caps the ends of studs/nogs/braces and reinforces mid-span where extra stiffness is needed. |
| 4 | **Web** | point | Round access hole in the web, 8–101mm diameter depending on use. Includes slab-anchor bolt through-holes (8mm), service penetrations (~34mm = `InnerService`), and large stiffener holes. |
| 5 | **Bolt** | point | Hole sized for a slab anchor or structural fastener — distinct from `Web` because of its position and pattern (typically two holes, ±62mm offsets, on bottom plates only). |
| 6 | **Chamfer** | start/end | Bevelled cut at the end of a stick, removing one corner. Used on diagonal braces and angled cripples to make the stick fit flush against its bearing. |
| 7 | **TrussChamfer** | start/end | Larger end-bevel for truss members — different geometry from `Chamfer`. Tooling carries a 5-point curve specific to truss chord ends. |
| 8 | **InnerNotch** | spanned | Full rectangular cut through the web (deeper than LipNotch — actually penetrates the web), 39–48mm long. Used at door-head crippes and short nogs where the crossing stick must pass entirely through. |
| 9 | **InnerService** | point | The service-hole variant of `Web` — Ø34mm round hole at predictable positions on full-height studs (296 / 446 / mid-span) for electrical conduit. Same tool as `Web` but rule-emitted for utility access. |
| 10 | **ScrewHoles** | point | Small fastener pilot holes (Ø5mm pattern) on truss chords and bottom-chord clusters. Used for connection plates between trusses. |
| 11 | **LeftFlange** | spanned | Flange-mount cut on the left flange (rotation-aware). Optional tool, not all setups have it. |
| 12 | **RightFlange** | spanned | Mirror of LeftFlange for the right flange. |
| 13 | **LeftPartialFlange** | spanned | Reduced LeftFlange cut, partial-assembly tooling. |
| 14 | **RightPartialFlange** | spanned | Mirror of LeftPartialFlange. |

### 6.2 Stick role codes (referenced throughout this catalogue)

| Code | Name | What it is |
|------|------|------------|
| **S** | Stud | Full-height vertical wall member. Most common stick. |
| **J** | Jack stud | Short vertical at door/window opening, head-to-sill or head-to-top. |
| **T** | Top plate (`Tp`) | Continuous horizontal top of a wall panel. |
| **B** | Bottom plate (`Bp`) | Continuous horizontal base of a wall panel. Slab anchor bolts here. |
| **Bh** | Raised bottom plate | Rough-opening sill — a B-style horizontal at sill height (one flange-height above slab B). |
| **N** | Nog | Short horizontal cross-member between studs (fire blocking, mid-height stiffener). |
| **H** | Header | Horizontal opening-top member (`Hd` = head plate). Often paired (H1+H2 box header). |
| **Kb** | Cripple / king brace | Short vertical at header corners; can be vertical or angled. |
| **W** | Web / brace | Diagonal stiffener. Two distinct usages: truss web (in trusses) and wall brace (X-brace in wall panels). |
| **L** | Lintel / sill (`Sl`) | Horizontal opening-bottom member. 70mm = header pattern, 89mm = sill pattern. |
| **R** | Ribbon / brace (`Br`) | Secondary diagonal stiffener (non-truss). |
| **V** | Vertical web | Truss vertical (FJ joist) — same operations as W with usage="web". |

These 12 codes cover everything HYTEK rolls. New role codes only get added if a new physical member type enters the build set.

### 6.3 Per-operation rules (the "when fires" half)

Below, each operation gets the plain-English rule for **when it fires**. Parameters are pulled from the active machine setup (one of ten — see HYTEK-MACHINE-TYPES.json). Where a value is hardcoded irrespective of setup, that's flagged.

#### LipNotch
- **End cap, every plate (T/B/Bh):** fires at each end of every continuous plate. Position: starts at `EndClearance` (4mm on 70/75/78/89/90mm; 5mm on 104mm), span = 39mm (70/89mm) or setup-derived.
- **At every stud-to-plate crossing:** fires on the plate at the crossing x-position, span = 39mm centred on the stud centreline.
- **At every nog-to-stud crossing:** fires on the stud at the crossing y-position.
- **At door-head cripple (164mm short nog):** fires at both ends — different from a normal short nog because the cripple has to receive the header.
- **At every truss-web to chord crossing:** fires on the chord at the crossing position.
- **NOT on:** standalone studs in the field (only at their own ends if rule says so), trusses' diagonal webs themselves (only on the chord they meet), Bh plates above an opening (separate rule).
- **Why:** every place a horizontal and vertical steel piece meet, the lip needs to be relieved so the perpendicular stick keys in cleanly.

#### InnerDimple
- **End-anchored on every plate, stud, nog, header:** fires at `Fastener1` Y-offset (20.5mm on 70/75/78/89/90; 25.5mm on 104mm) from each end, on the inner web face.
- **At every LipNotch on a plate:** fires alongside the LipNotch as a fastener target for the connection. Position = LipNotch centre, offset = `Fastener1` + `EndClearance`.
- **Mid-span on long studs:** fires at body crossings only (e.g. nog crossing y-position). No mid-span fires in unobstructed studs.
- **On wall W-braces (usage="stud"):** fires at 10mm from each end (different from the universal 16.5mm — distinct rule for wall-brace endpoints).
- **On truss W (usage="web"):** fires at 16.5mm from each end (universal).
- **On door/window HEADERS (paired):** fires as PAIRS — two dimples per LipNotch crossing, at `Fastener1` and at `Fastener1 + 42mm`. Single-H frames get only the single dimple.
- **Why:** every fastener position needs a dimple to locate the screw before it cuts.

#### Swage
- **End cap, every stud (S/J):** fires at the stud's end with the setup-derived offset (27.5mm on standard 70/89mm setups), span = 39mm.
- **End cap, every nog ≥168mm:** fires at each end with the same offset as studs.
- **Mid-span, full-height studs:** fires at the stud's mid-span — replaces the InnerDimple at mid-span on standard studs. Note: ENDSTUD (end-of-panel) has LipNotch here instead of Swage.
- **End cap, every brace (W/R) "stud" usage:** angle-dependent end span = `Span / cos(angle from vertical) + 8 · tan²(angle)`. Capped at 200mm.
- **NOT on:** plates (LipNotch + InnerDimple is the plate end-cap pattern), truss webs (Chamfer + Swage 41 + Dimple 10 is the wall-W pattern; truss-W gets Swage 39 + Dimple 16.5).
- **Why:** stud webs need stiffening at the ends to resist crushing under the plate's bearing.

#### Web
- **Ground-floor bottom plate slab anchors:** fires at 8mm from each end (slab-anchor through-hole). Two holes per anchor cluster, ±62mm offsets.
- **Distributed on paired headers (H1/H3 + H2):** fires at 89mm from each end, evenly distributed inwards with max 300mm spacing. Single-H frames get NO Web ops.
- **At centerline crossings on TB2B trusses:** fires on each web at the pairwise crossing of two truss-webs — InnerDimple as the marker, but `Web` is the through-hole.
- **Why:** structural connections that need a bolt through the web (slab anchor, paired-header bracket, truss-truss bolt).

#### Bolt
- **Bottom plate, ground floor only:** fires at ±62mm offsets from each `Web`-anchored point, two holes per cluster. Slab anchors.
- **NOT on:** any wall stud, plate above ground floor, header, or truss member.
- **Why:** these are the actual hold-down fasteners that secure the frame to the slab.

#### Chamfer
- **End of every wall W-brace ≥28° from vertical:** fires at the angled end. Threshold = 28°.
- **End of every header H, 70mm:** fires at both ends (H trimmed 1mm/end vs studs at 2mm — see §11.4).
- **End of every Kb (cripple) — start only:** fires at the lower end of vertical Kbs (where they sit on the plate). Upper end gets no Chamfer.
- **End of every Kb diagonal:** depends on `ChamferTolerance` (4mm on standard, 2mm on B2B) — if true cut angle exceeds tolerance, Chamfer fires.
- **Why:** the chamfer relieves the corner that would otherwise interfere with the bearing surface.

#### TrussChamfer
- **End of every truss-W (usage="web"), every truss-V:** fires at both ends. Different geometry from Chamfer (5-point curve from machine setup `TrussChamferDetail`).
- **NOT on:** anything outside a truss frame.
- **Why:** truss webs need a more aggressive corner removal because the angles are sharper.

#### InnerNotch
- **At door-head cripple (164mm short N):** fires at both ends — full-web cut so the header's connecting bolt can pass through.
- **At raised-B sill (Bh) ends:** fires at both ends — the sill is a half-height plate that has to fit between two trim studs.
- **At header H end caps (some configs):** fires when H is paired and the flange-cut alone isn't enough.
- **NOT on:** standard nogs (LipNotch is enough), standard plates.
- **Why:** when a cross-member must pass entirely through a stick, only a web-deep notch will do.

#### InnerService
- **Full-height wall studs (S):** fires at 296mm and 446mm from one end (electrical conduit positions). Dynamic: which end is "service end" depends on wall layout — set per-stud by `simplify-wall-service.ts` rule.
- **NOT on:** plates, headers, nogs, truss members.
- **Why:** electrical and plumbing penetrations need predictable, code-compliant openings.

#### ScrewHoles
- **Truss bottom-chord clusters (TB2B):** fires at the chord-on-chord box-piece positions for connecting trusses to bottom-chord brackets.
- **NOT on:** anything outside truss frames.

#### LeftFlange / RightFlange / LeftPartialFlange / RightPartialFlange
- **Optional, machine-setup-specific.** Currently rare in HYTEK config.
- Reserved for future profile-specific tooling. Not yet used by any active rule.

---

## 7. Catalogue B — Stick Interactions

The finite set of geometric configurations in which two HYTEK steel sticks can meet. For each: the configuration, the operations that fire, and on which stick.

### 7.1 T-junction (end-to-side)

```
        |           ← stick A (e.g. stud)
        |
   ─────┼──────     ← stick B (e.g. plate) — A's end touches B's side
```

**Trigger:** stick A's end coordinate falls on stick B's centreline (within 1mm tolerance).

**Operations:**
- On B (the receiving stick): `LipNotch` centred on A's centreline + `InnerDimple` at the LipNotch position.
- On A (the entering stick): no extra ops at this end — its standard end-cap rule (Swage + InnerDimple at 16.5mm) already handles it.

**Examples:** stud meeting top plate; stud meeting bottom plate; nog meeting stud; truss diagonal meeting chord.

**Why this rule:** the lip of B must be relieved so A keys in cleanly without binding; the dimple gives the connection screw a target.

### 7.2 X-crossing (side-to-side at angle)

```
    \   /
     \ /
      X            ← two sticks pass across each other at an angle
     / \
    /   \
```

**Trigger:** two sticks' centreline projections intersect inside both bounding boxes.

**Operations:**
- On the longer/structural stick (the "primary"): `LipNotch` + `InnerDimple` at the crossing point.
- On the shorter/secondary stick: typically nothing — the primary's notch accommodates the secondary's pass-through.

**Examples:** truss webs crossing each other (linear truss "scissor" joint); wall X-bracing in a brace bay; bottom-chord bolt cluster on a TB2B truss.

**Why this rule:** when one stick crosses another at angle, only one of them needs the relief — the one carrying the connection.

### 7.3 End-butt (end-to-end)

```
   ───────┤├───────     ← two sticks abut end-to-end on the same axis
```

**Trigger:** the end of one stick meets the end of another, both on the same line, with a small gap (≤30mm).

**Operations:**
- On both sticks: standard end-cap operation (e.g. `Swage` for studs, `LipNotch` for plates) at each end. No special joint-specific operation.

**Examples:** continuous plates split by a panel break; nog continuing across a stud (treated as two nogs after frame-context detection).

**Why this rule:** end-butts are framing convenience, not structural connections — the standard end-caps suffice.

### 7.4 Lap (parallel overlap)

```
   ───────────         ← stick A
       ───────────     ← stick B partially overlaps A in parallel
```

**Trigger:** two sticks parallel within a tight angle threshold, with overlapping length, separated by less than one flange height (~41mm).

**Operations:**
- On both sticks at the overlap zone: `Web @8mm` slab-anchor pattern (if at slab) or `Bolt` cluster (if structural connection).
- Otherwise: nothing — passive lap, dealt with by adjacent structural connections.

**Examples:** double-stud at panel join (pair at X and X+43); paired-header H1+H2 box header.

**Why this rule:** laps are usually structural connection zones; the operation depends on what's being connected.

### 7.5 B2B partner pair

```
   ═══════════         ← stick A (primary)
   ═══════════         ← stick B (back-to-back partner) — flange-on-flange
```

**Trigger:** two studs at the same x-position (within 1mm), in the same frame, mirrored. Detected as a B2B context.

**Operations:**
- Web@spacing on both studs: 7 holes spaced 447mm, anchored 38mm from each end.
- All other ops standard per-stick.

**Examples:** TB2B truss chords; double-jamb at large openings.

**Why this rule:** B2B pairs need additional fasteners at regular intervals because they share the load path.

### 7.6 Header-cripple (Kb meets H)

```
   ═══════════         ← H header (top of opening)
       │
       ┃               ← Kb cripple drops down from header to plate
       │
```

**Trigger:** a Kb's upper end coincides with a header's underside.

**Operations:**
- On H at the Kb's x-position: `LipNotch` + paired `InnerDimple` (the paired-dimple rule fires when frame has paired headers).
- On Kb's lower end: `Chamfer @start` (so it sits flat on the plate below).
- On Kb's upper end: standard `Swage + InnerDimple` end-cap.

**Examples:** every cripple at every door/window opening corner.

**Why this rule:** the cripple is short and angled; it needs the chamfer to bear, and the header needs the notch + dimples for the cripple-to-header bolt.

### 7.7 Truss web at chord (vertical chord crossing)

```
   ───────────────     ← chord (T or B)
        |
        |              ← truss W (vertical web, usage="web")
        |
```

**Trigger:** a truss-W stick meets a horizontal chord. Detected as a truss interaction (frame-type check: "truss" in plan name).

**Operations:**
- On chord: `LipNotch` + `InnerDimple` at the W's centreline.
- On W: `TrussChamfer @start` and `TrussChamfer @end` (truss webs always get truss-chamfer at both ends, irrespective of angle).

**Examples:** every interior vertical web on a TIN linear truss.

**Why this rule:** the truss-chamfer is the manufacturer-specified end-cut for truss webs; the chord notch is identical to the wall T-junction rule but flagged for truss processing.

### 7.8 Truss web at chord (diagonal chord crossing)

```
   ───────────────     ← chord
        \
         \             ← diagonal truss W
          \
```

**Trigger:** a truss-W meets a chord at an angle. Use line-intersection in XZ-plane to find the meeting point, project to chord y-level, convert to local position along chord.

**Operations:**
- On chord at the projected point: `LipNotch` + `InnerDimple`.
- On W: `TrussChamfer` at both ends; `Swage @end` with span = `39 / cos(angle)` capped at 200mm.

**Examples:** every diagonal web on every truss.

**Why this rule:** diagonal webs need the same chord notch but their own end-spans depend on cut angle.

### 7.9 Wall-W brace meeting plate (above opening)

```
   ────────────       ← T plate
       /
      /               ← wall W brace (usage="stud") meets T at angle
     /
```

**Trigger:** a wall-W brace stick (not a truss web — wall-frame, not truss-frame) hits a plate at angle ≥28° from vertical.

**Operations:**
- On plate at the meeting point: `LipNotch` + `InnerDimple`.
- On W at this end: `Chamfer` (wall-style chamfer, not TrussChamfer) + `Swage 41mm` + `InnerDimple @10mm`.

**Examples:** the X-brace in a wall brace bay (typically L1/L3 first and last bays).

**Why this rule:** wall braces use a different chamfer geometry from truss webs; angle threshold prevents the chamfer firing on near-vertical W's that don't need it.

---

## 8. Catalogue C — Frame Contexts

Higher-level patterns that group multiple sticks into a recognisable assembly. When the brain sees a frame context, it generates the canonical member set with the canonical operations.

### 8.1 Door opening

```
   ════════════════════════════
   ║   T   ║   T   ║   T   ║      ← top plate continuous over opening
   ║       ║       ║       ║
   T  J↓  Ts      Ts  J↓   T      ← Ts = trim stud, J = jack stud
   T       ╔═══H═══╗       T      ← H = header (paired with H2 below)
   T       ║       ║       T
   T       ║       ║       T
   T       ║       ║       T
   ════════════════════════════   ← B plate runs uninterrupted
```

**Trigger:** an opening in the wall XML with door-class dimensions (typical 2055 × 935mm).

**Members generated:**
- 2 × `TRIMSTUD` (Ts) — full height, flank the opening.
- 2 × `JACKSTUD lower` (J) — head height to slab.
- 2 × `JACKSTUD upper` (J) — top plate to head.
- 1 × `HEADPLATE` (H) — spans opening at head height.
- Optional 1 × `H2` paired header (box configuration).
- `FILLER` rows near braces if a brace bay is interrupted.
- No `SILL` (door has no sill).

**Operations beyond standard:**
- Trim studs get `Swage` at head/sill heights (additional to the standard stud pattern).
- Header gets the paired-dimple rule (two dimples per LipNotch).

### 8.2 Window opening

```
   ════════════════════════════
   T  J↑  Ts      Ts  J↑   T
   T       ╔═══H═══╗       T      ← H = header
   T       ║       ║       T
   T  J↓   ║       ║   J↓  T
   T       ╚═══L═══╝       T      ← L = sill (lintel)
   T  J↓  Ts      Ts  J↓   T
   ════════════════════════════
```

**Trigger:** opening with window-class dimensions and a sill height (typical 1000mm or 1250mm).

**Members generated:**
- 2 × `TRIMSTUD` (Ts).
- 2 × `JACKSTUD upper` (head to top).
- 2 × `JACKSTUD lower` (sill to slab).
- Optional 2 × short studs above sill (in opening width).
- 1 × `SILL` (L) at opening bottom.
- 1 × `HEADPLATE` (H).
- `FILLER` rows where applicable.

### 8.3 AC / utility opening

**Trigger:** opening with small dimensions (typical 440 × 670mm) on an otherwise blank wall.

**Members generated:**
- Standard wall studs (no trim/jack stud overhead).
- A specially-named nog: `AC Ng1` at AC unit height.

**Why:** AC units bolt to a single nog, not a full opening frame.

### 8.4 Brace bay

**Trigger:** a wall panel section where two diagonal braces (Br1/Br2 or W) cross to form an X.

**Members generated:**
- 2 × `BRACE` (Br) at the bay's top-left to bottom-right and top-right to bottom-left diagonals.

**Operations:**
- Each brace gets the wall-W pattern (Chamfer + Swage 41 + InnerDimple @10).
- The plates above and below the bay get LipNotch + InnerDimple at the brace meeting points (per §7.9).

**Note:** large openings can eliminate a braced bay — Set 3 L3 has 2 braces instead of 6 because of an extra-wide opening.

### 8.5 B2B partner pair (already detailed in §7.5)

### 8.6 Linear truss panel (TIN)

**Trigger:** plan name contains `-TIN-` or `-LIN-`.

**Members generated:**
- 2 × top chord (T), 2 × bottom chord (B) (or 1 of each for inline trusses).
- N × W (truss webs, usage="web") — verticals and diagonals.
- 0–4 × V (truss verticals, FJ joist style).

**Operations:**
- All truss-Ws get TrussChamfer at both ends (§7.7, §7.8).
- Centerline crossings of webs (where two W's meet between chords) get a 3-hole bolt-cluster pattern per `simplify-linear-truss.ts`.
- Bottom chords get reduced operation set vs top chords (no service holes, simplified).

### 8.7 TB2B (back-to-back) truss panel

**Trigger:** plan name contains `-TB2B-`.

**Members generated:**
- Same as TIN but chords are paired (B2B pattern §7.5).
- Box pieces between chord pairs.

**Operations:**
- Centerline crossings get `Web @pt` instead of just InnerDimple.
- Box pieces get `ScrewHoles` clusters.
- Header/chord cap-stacks fire (per `simplify-tb2b-truss.ts`).

### 8.8 Roof panel (flat 0°)

**Trigger:** plan name contains `-RP-` (and roof is flat, the only tested case).

**Members generated:**
- Top chord, bottom chord, intermediate verticals, end blocking pieces (Bx).

**Operations:**
- Top/bottom plates get `Chamfer + InnerDimple @10` instead of standard Swage at end caps (the RP-specific rule).
- Studs get `LipNotch 56..101 + InnerDimple @78.5` at end caps.

**Note:** pitched roofs are unverified — see §13.2.

---

## 9. The Settings Area (the editable brain)

A web UI in `hytek-rfy-tools` with three tabs corresponding to the three catalogues:

### 9.1 Tab 1 — Tool Operations

Lists all 14 operations. For each, shows:
- Name + short description.
- Form (point / spanned / start-end).
- Parameters from the active machine setup.
- The list of trigger rules ("when fires") in plain English.

Each rule is an editable card with three fields:
- `When seen` — plain-English description of the trigger.
- `On which stick` — which stick gets the operation.
- `Fires what` — operation + parameters.
- `Why` — plain-English explanation.

### 9.2 Tab 2 — Stick Interactions

Lists all 8 interaction types. For each, shows:
- Name + ASCII sketch (or rendered SVG, see §11).
- Which sticks/roles trigger it.
- Operations emitted, on which stick.

Edit any rule, and the brain re-runs the next encode with the new behaviour.

### 9.3 Tab 3 — Frame Contexts

Lists all 8 frame contexts. For each, shows:
- Name + a sample frame thumbnail.
- Trigger conditions (plan-name pattern, member-set check, opening dimensions).
- Members generated.
- Operations attached to each member.

### 9.4 Persistence model

All rules stored as JSON in `hytek-rfy-tools/data/brain/rules.json`. Source-controlled. Edits via the UI write through to JSON (with audit trail — every change is a commit message line).

The brain loads `rules.json` at boot. Hot-reload on file change.

### 9.5 What the settings area is NOT

- It is NOT a code editor. No JavaScript, no DSL — only the four plain-English fields per rule.
- It is NOT a runtime override. Edits are persisted and version-controlled.
- It is NOT a Detailer-parity tuner. Rules describe what's correct, not what matches Detailer.

---

## 10. Outputs

The brain emits three files per XML.

### 10.1 RFY (rollformer machine file)

The encrypted binary the F325iT consumes. Identical encoder to the existing codec — AES-128-CBC with the HYTEK key. The brain just supplies the operation list per stick; the encoder doesn't change.

Filename: `<jobref>_<plan>.rfy`.

### 10.2 CSV (rollformer CSV)

The rollformer also reads a per-plan CSV alongside the RFY. The existing codec already emits these. Format is FrameCAD's standard: one CSV per plan, DETAILS row + one COMPONENT row per stick with its profile, length, position, and the operation list.

Filename: `<jobnum>#1-1_<plan>.csv` (matches the existing codec).

### 10.3 PDF (drawing set)

A drawing of every frame with every operation marked at its position. One page per frame. Operations rendered as labelled markers at their position-along-stick.

The PDF is the human-readable check before steel cuts. Looking at it, you should see every notch, every dimple, every swage, in plain visual form, on the actual frame outline.

PDF generator: TBD (likely server-side via a headless renderer of the existing `/wall-viewer` page, or a dedicated SVG → PDF pipeline).

---

## 11. Validation methodology

Diff-and-fix, with the Forge cache repurposed.

### 11.1 The validation loop

```
1.  Generate the three outputs from XML using current rules.
2.  For EACH output (RFY, CSV, PDF), run byte-level diff against
    the cached "ground-truth" file (Forge cache for RFY,
    historical CSV for CSV, no PDF baseline yet).
3.  diff exit code 0 = match. Anything else = investigate.
4.  For each diff line, classify:
       (a) RULE ERROR     — our rule is wrong, fix the rule.
       (b) MISSING RULE   — our brain doesn't know about this case yet,
                            add the rule.
       (c) HUMAN EDIT     — the cached file was hand-modified by a
                            detailer; record in the human-edit register
                            and DO NOT replicate.
5.  Update rules → regenerate → re-diff → exit code 0 or repeat.
```

### 11.2 The Forge cache as regression corpus

The 383-entry Forge cache (`OneDrive/CLAUDE DATA FILE/detailer-oracle-cache`) stops being a *target to match*. It becomes a *regression test corpus* against which the brain runs after every rule change. When the brain disagrees with a cached RFY, the diff classifies into (a)/(b)/(c) above.

Critically: when (c) is found, the cache entry is annotated as "human-edited" so future runs don't keep re-flagging it. This builds an explicit register of which cached files contain non-rule edits.

### 11.3 Empirical proof we can hit exit code 0

Our existing codec already gets close to byte-exact on some plan types — close enough that the remaining gap is a small number of specific rules, not a fundamental misalignment. The brain's job is to close those gaps cleanly via the catalogues, not to chase Detailer's hand-edited outputs.

### 11.4 Diagnostic patterns we already know

| Symptom in diff | Likely cause |
|-----------------|--------------|
| Missing `LipNotch` at panel point | Plate split detection wrong; check frame-context boundary logic. |
| Wrong `Swage` span at stud end | Wrong machine setup selected (check profile resolution). |
| `InnerDimple` at slightly wrong position | Profile-specific Y-offset (e.g. 16.5 vs 20.5) — check Fastener1 lookup. |
| Spurious `Web@spacing` on regular S studs | B2B pair detection over-triggering. |
| Missing `Chamfer` on diagonal Kb | ChamferTolerance threshold wrong for current setup. |
| `LipNotch` instead of `Swage` at stud-nog crossing (or vice versa) | Termination geometry rule — interior vs edge stud distinction (§7.x). |

---

## 12. What NOT to do (locked dead ends)

These have been investigated, ruled out, and must not be re-introduced without overwhelming new evidence. Each one cost a session.

1. **Don't try to match Detailer byte-for-byte across all jobs.** The 13-session plateau is structural. Cached files contain human edits.
2. **Don't reintroduce `simplify-rp.ts` as a global default.** A/B test 2026-05-06 showed -0.8pp net on overall match (over-emits 292 spurious Chamfers + mis-positions 376 ops on HG260043). Currently disabled by `CODEC_DISABLE_RP=1` env var.
3. **Don't bleed simplifiers across plan types.** Each simplifier (TIN / RP / TB2B / wall-service / linear-truss) must check plan name and no-op if the plan isn't its target. Verified test exists (`scripts/ab-test-simplifiers.test.ts`).
4. **Don't add new Detailer-parity work** when the diff is HUMAN EDIT class. Record it, move on. Use the human-edit register.
5. **Don't merge frame-context crossing logic with per-stick rules.** They are two distinct passes; merging them creates double-emission bugs (verified empirically).

This list grows. Every disproven hypothesis adds an entry.

---

## 13. Roll-out plan

Phased so no production cut is at risk.

### 13.1 Phase 1 — Spec sign-off (this document)

- Scott reviews the spec.
- Iterate on the catalogues, especially §7 (interactions) and §8 (frame contexts), until Scott can read each rule and either say "yes" or correct it.
- Commit final spec.

**Output:** approved spec doc.

### 13.2 Phase 2 — Brain v0 (read-only)

- Build the rule-engine layer in `hytek-rfy-tools/lib/brain/` that loads the catalogues from JSON and applies them.
- The existing codec stays unchanged — the brain calls into it for raw operation emission.
- A new endpoint `/api/brain/encode` runs the brain and returns RFY + CSV + PDF.
- The home page gets a "Brain (preview)" card.

**Validation:** run brain against the 383-entry Forge cache. Classify every diff. Confirm structural correctness on the worked-through profiles (70mm + 89mm).

**Output:** working brain endpoint, classification report.

### 13.3 Phase 3 — Settings UI

- Build the three-tab settings area in `hytek-rfy-tools` per §9.
- Wire edits → JSON → brain hot-reload.
- Audit log of every rule change.

**Output:** Scott can read every rule, edit any rule, see the encode result update.

### 13.4 Phase 4 — PDF emitter

- Build the drawing-set PDF renderer.
- One page per frame; every operation marked.
- Full-job PDF export from the encoder result page.

**Output:** the third leg of the tripod (RFY, CSV already done; PDF added).

### 13.5 Phase 5 — Production cutover

- Run brain in parallel with codec for 1 week of new jobs.
- Compare outputs; investigate every diff.
- Switch the production endpoint when brain is at parity-or-better with the codec on every test job.

**Output:** brain is the production path. Codec remains as the back-end emitter for RFY bytes.

### 13.6 Profile expansion

After Phase 5, fill in the 75/78/90/104mm profile columns of the catalogues. Each profile is a focused session: derive constants from `HYTEK-MACHINE-TYPES.json`, validate on whatever ground-truth we have for that profile, lock in.

**Output:** all 6 profile families covered.

---

## 14. Open questions

Things only Scott can decide. Each gets a § in the next iteration.

1. **Profile expansion priority.** After 70mm + 89mm, which goes first — 75mm, 78mm, 90mm Perth, 104mm? Driven by upcoming job mix.
2. **PDF drawing format.** What does the drawing-set PDF need to look like? Layered like a Detailer drawing? Simpler? Tabular operation list per stick?
3. **Settings UI deployment.** Local-only (work-PC + home-PC), or hosted on Vercel for any device? Rule edits go straight into production — local-only is safer initially.
4. **Human-edit register.** Where does it live? A separate JSON in the brain config, or annotated alongside the cache entry?
5. **Gauge as a first-class axis.** Should the catalogue treat gauge (0.55 / 0.75 / 0.95 / 1.15mm) as a separate dimension alongside profile family, or fold it into profile-family as a parameter? Affects how rules are organised in the settings UI.

---

## 15. Glossary

- **Brain** — the rule engine + catalogues that decide what operations fire where.
- **Catalogue** — a plain-English list (Operations / Interactions / Frame Contexts).
- **Forge cache** — the 383-entry oracle cache of historical Detailer-emitted RFYs.
- **Frame context** — a higher-level frame pattern (door, window, brace bay, truss panel, etc.).
- **Human edit** — a hand-modification a detailer made to a Detailer output, not following any rule.
- **Interaction** — a geometric configuration in which two sticks meet.
- **Operation** — a tooling action the F325iT performs (LipNotch, Swage, etc.).
- **Plain-English rule** — a rule expressed in English with `When seen`, `On which stick`, `Fires what`, `Why` fields.
- **Profile family** — the cross-section type (70S41, 89S41, 75S44, 78S44, 90S41, 104S51).
- **Role** — the structural function of a stick (S, T, B, H, etc.).

---

## 16. Appendix A — Operational constants reference

Pulled from `HYTEK-MACHINE-TYPES.json`. Quote these in rules; don't hardcode.

| Constant | 70mm | 75mm | 78mm | 89mm | 90mm | 104mm |
|----------|-----:|-----:|-----:|-----:|-----:|------:|
| Web (mm) | 70 | 75 | 78 | 89 | 89 (Perth) | 104 |
| Left flange (mm) | 41 | 44 | 44 | 41 | 41 | 47.5 |
| Right flange (mm) | 38 | 41 | 41 | 38 | 38 | 51 |
| Fastener1 Y (mm) | 20.5 | 20.5 | 20.5 | 20.5 | 20.5 | **25.5** |
| TripleSpacing (mm) | **15** | 17 | 17 | 17 | 17 | **26.5** |
| EndClearance (mm) | 4 | 4 | 4 | 4 | 4 | **5** |
| BoltHoleToEnd (mm) | 20 | **5** | **5** | 20 | 20 | 20 |
| BoxDimpleSpacing (mm) | 1200 | 1200 | 600 | 1200 | 1200 | 600 |
| BraceToDimple (mm) | 50 | 55 | 55 | 50 | 50 | 60 |
| Swage tool length (mm) | 55 | 55 | 55 | 55 | 55 | 60 |
| LipNotch tool length (mm) | 48 | 48 | 48 | 48 | 48 | 75 |
| ChamferTolerance (mm) | 4 | 4 | 4 | 4 | 4 | 4 |

Bold = profile is the outlier from the rest. 104mm is consistently the outlier (larger fasteners, wider triple spacing). 70mm has a tighter triple spacing (15 vs 17). 75/78mm have a smaller bolt-hole-to-end (5 vs 20).

Source paths in the JSON:
- Fastener1 Y: `MachineSetups[i].SectionSetups[j].SectionOptions.Fastener1`
- TripleSpacing: `MachineSetups[i].SectionSetups[j].SectionOptions.TripleHoleSpacing`
- EndClearance: `MachineSetups[i].EndClearance`
- BoltHoleToEnd: `MachineSetups[i].BoltHoleToEnd`
- BoxDimpleSpacing: `MachineSetups[i].BoxDimpleSpacing`
- BraceToDimple: `MachineSetups[i].BraceToDimple`
- Swage tool length: `MachineSetups[i].ToolSetup.FixedTools."4".Length`
- LipNotch tool length: `MachineSetups[i].ToolSetup.FixedTools."1".Length`
- ChamferTolerance: `MachineSetups[i].ChamferTolerance`

---

## 17. Appendix B — Frame type inventory

All 38 HYTEK frame types from `HYTEK-FRAME-TYPES.json`, grouped by profile:

- **70mm (7):** Ceiling Panel, External Wall, Internal LBW, Internal NLBW, Roof Panel, Truss B2B, Truss Inline
- **75mm (6):** Ceiling Panel, External Wall, Internal LBW, Internal NLBW, Joist, Roof Panel
- **78mm (3):** Joist, Roof Panel, Truss
- **78mm compound (4):** 7810 Ceiling Panel, 7810 Wall, 7812 Ceiling Panel, 7812 Wall
- **89mm (7):** Ceiling Panel, External Wall, Internal LBW, Internal NLBW, Joist, Roof Panel, Truss B2B
- **90mm Perth (4):** 9010 Ceiling Panel, 9010 Wall, 9012 Ceiling Panel, 9012 Wall
- **104mm (3):** Joist, Roof Panel, Truss
- **104mm compound (4):** 104055 Wall, 10410 Wall, 10415 Ceiling Panel, 10415 Wall

Each frame type maps to a default machine setup via GUID. The brain resolves this at frame-load time and uses the resolved setup's constants throughout.

---

End of spec.
