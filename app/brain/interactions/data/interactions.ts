// Catalogue of stick-interaction scenes for the gallery.
//
// Each entry positions 1-3 sticks in 3D scene space and configures the
// tool operations that fire at the interaction point. The Stick3DOps
// component renders each stick with the listed ops baked into its mesh.
//
// Coordinate system per scene:
//   x: horizontal in the elevation plane
//   y: vertical (up = +y, but camera-up is flipped to (0,-1,0) so
//      visually "up on screen" = world -y, matching the 2D viewer).
//      For these scenes, we use +y = "up the wall" since each scene
//      has its own Canvas with its own camera framing.
//   z: depth out of the elevation plane (flange direction)
//
// Stick rotation Euler angles:
//   The unrotated stick extrudes its profile along +Z. So a horizontal
//   stick that runs along the +X axis needs rotation [0, π/2, 0]
//   (rotate the +Z extrusion direction by 90° around Y so it points +X).
//   A vertical stick going up the +Y axis needs rotation [-π/2, 0, 0]
//   (rotate +Z to +Y, which is a -90° rotation about X).
//
//   Position is the START of the stick (z=0 end of the extrusion). After
//   rotation, the END of the stick is offset by length × (rotated +Z).

import {
  PROFILE_70S41,
  PROFILE_75S41,
  PROFILE_89S41,
  PROFILE_89S39,
  type InteractionConfig,
} from "./types";

// ──────────────────────────────────────────────────────────────────
// Common rotations
// ──────────────────────────────────────────────────────────────────
//
// Each rotation maps the LOCAL profile axes to WORLD axes as follows.
// (Profile +X = flange-opening direction; profile +Y = web-up direction;
// profile +Z = extrusion direction.)
//
// ROT_HORIZONTAL_X         (open mouth faces world -Z, extrudes +X)
// ROT_HORIZONTAL_X_DOWN    (open mouth faces world -Y, extrudes +X) ← top plate / top chord
// ROT_HORIZONTAL_X_UP      (open mouth faces world +Y, extrudes +X) ← bottom plate / bottom chord
// ROT_VERTICAL_Y           (open mouth faces world +X, extrudes +Y)
// ROT_VERTICAL_Y_FLIP_X    (open mouth faces world -X, extrudes +Y)
//
// The "_DOWN" / "_UP" variants are critical for nested-joint geometry:
// for the entering stick (e.g. a vertical stud) to nest INSIDE the
// receiving stick (top plate), the receiving stick's open mouth must face
// the entering stick's tip. A plate with the standard ROT_HORIZONTAL_X
// rotation has its mouth facing world -Z, which is wrong for a vertical
// stud meeting it from below.

// Note: ROT_HORIZONTAL_X / VERTICAL_Y are kept on their literal values for
// continuity with existing scenes; they're equivalent to the eulerFromAxes
// output for the same world-direction pair. The "_DOWN" / "_UP" rotations
// for top-plate / bottom-plate are computed via eulerFromAxes below.
const ROT_HORIZONTAL_X: [number, number, number] = [0, Math.PI / 2, 0];
const ROT_VERTICAL_Y: [number, number, number] = [-Math.PI / 2, 0, 0];

// Helper: build an XYZ Euler tuple from a 2-axis world-space basis.
//
//   extrusion  = world-space direction the stick extrudes along
//                (where local +Z gets mapped after rotation)
//   flangeOpen = world-space direction the stick's open mouth faces
//                (where local +X gets mapped after rotation)
//
// This gives full control of both the stick's length axis AND its
// flange-opening direction. The third axis (web-up direction = local +Y)
// is determined by orthogonality. We orthogonalise `flangeOpen` against
// `extrusion` so callers can pass approximate vectors — only the
// component perpendicular to extrusion matters.
//
// Rotation matrix: M = [flangePerp | third | ext] (column-major), so
// applying M to local +X gives flangePerp, +Y gives third, +Z gives ext.
// We then extract the XYZ-order Euler angles from M using the standard
// rotation-matrix-to-Euler conversion (matches THREE.Euler.setFromRotationMatrix).
function eulerFromAxes(
  extrusion: [number, number, number],
  flangeOpen: [number, number, number],
): [number, number, number] {
  // Normalise extrusion
  const eLen = Math.hypot(extrusion[0], extrusion[1], extrusion[2]) || 1;
  const ex = extrusion[0] / eLen;
  const ey = extrusion[1] / eLen;
  const ez = extrusion[2] / eLen;
  // Project flangeOpen onto extrusion, subtract, normalise
  const dot = flangeOpen[0] * ex + flangeOpen[1] * ey + flangeOpen[2] * ez;
  let fx = flangeOpen[0] - dot * ex;
  let fy = flangeOpen[1] - dot * ey;
  let fz = flangeOpen[2] - dot * ez;
  const fLen = Math.hypot(fx, fy, fz) || 1;
  fx /= fLen;
  fy /= fLen;
  fz /= fLen;
  // Third axis = ext × flangePerp
  const tx = ey * fz - ez * fy;
  const ty = ez * fx - ex * fz;
  const tz = ex * fy - ey * fx;
  // Build rotation matrix (column-major):
  //   col0 = (fx, fy, fz)
  //   col1 = (tx, ty, tz)
  //   col2 = (ex, ey, ez)
  // Matrix elements m[row][col]:
  //   m11=fx, m12=tx, m13=ex
  //   m21=fy, m22=ty, m23=ey
  //   m31=fz, m32=tz, m33=ez
  const m13 = ex;
  const m23 = ey;
  const m33 = ez;
  const m11 = fx;
  const m12 = tx;
  // Use the same XYZ-order extraction as THREE.Euler.setFromRotationMatrix:
  //   y = asin(clamp(m13))
  //   if |m13| < 0.9999999:
  //     x = atan2(-m23, m33)
  //     z = atan2(-m12, m11)
  //   else (gimbal lock):
  //     x = atan2(m32, m22) (where m22 = ty, m32 = tz)
  //     z = 0
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));
  const y = Math.asin(clamp(m13, -1, 1));
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(tz, ty);
    z = 0;
  }
  return [x, y, z];
}

// Helper: rotation for a stick at angle θ from horizontal in the XY plane,
// extrusion direction = (cos θ, sin θ, 0). The flange-opening direction
// is forced to face world -Z (standard "viewer faces flange" orientation).
//
// (Note: the previous implementation `[0, π/2, θ]` was buggy under
// Three.js XYZ Euler — it always produced extrusion along world +X
// regardless of θ. This implementation correctly produces an angled
// extrusion using a 2-axis basis.)
function rotForXYAngle(theta: number): [number, number, number] {
  const ext: [number, number, number] = [Math.cos(theta), Math.sin(theta), 0];
  return eulerFromAxes(ext, [0, 0, -1]);
}

// Helper: rotation for an angled brace going from a low point UP to a
// high point at angle θ from horizontal — with the open mouth facing
// the receiving plate above. The flange-opening direction is the
// perpendicular-in-XY-plane that points "up and to the side" (above
// the brace's centreline).
//
// mouthSide:
//   "above" → mouth opens toward (-sin θ, cos θ, 0) — for a brace
//             going up-right at angle θ, open mouth faces upward
//             (perpendicular to the brace, pointing toward the plate
//             above). Use this for braces meeting a top plate.
//   "below" → mouth opens toward (sin θ, -cos θ, 0).
function rotForAngledIntoPlate(
  theta: number,
  mouthSide: "above" | "below" = "above",
): [number, number, number] {
  const ext: [number, number, number] = [Math.cos(theta), Math.sin(theta), 0];
  const sign = mouthSide === "above" ? +1 : -1;
  const flangeOpen: [number, number, number] = [
    -sign * Math.sin(theta),
    +sign * Math.cos(theta),
    0,
  ];
  return eulerFromAxes(ext, flangeOpen);
}

// Top plate / top chord: extrudes along world +X, mouth opens DOWN
// (world -Y) so a vertical stud entering from below nests inside.
const ROT_HORIZONTAL_X_DOWN: [number, number, number] = eulerFromAxes(
  [1, 0, 0],
  [0, -1, 0],
);
// Bottom plate / bottom chord: extrudes +X, mouth opens UP (world +Y)
// so a vertical stud entering from above nests inside.
const ROT_HORIZONTAL_X_UP: [number, number, number] = eulerFromAxes(
  [1, 0, 0],
  [0, 1, 0],
);

// ──────────────────────────────────────────────────────────────────
// Bench-flat orientations (FrameCAD/HYTEK fabrication convention)
// ──────────────────────────────────────────────────────────────────
//
// FrameCAD walls and trusses are FABRICATED bench-flat: every stick
// lies with its web touching the bench and its flanges pointing UP
// (out of the bench, toward the operator). When the 3D viewer shows
// the assembly this way, all sticks share the same bench plane (the
// world X-Y plane at Z=0 for the centreline) and all flanges go +Z.
//
// In this orientation:
//   - Stick's web back surface at world Z = -lf/2 (the bench).
//   - Stick's CL passes through world Z = 0 (lf/2 above the web back
//     in the flange-open direction = world +Z).
//   - Two intersecting sticks both have CLs in the Z=0 plane → their
//     CLs meet at a single world (X, Y, 0) point.
//
// ROT_BENCH_X            (extrudes +X, flanges UP)  ← chord / plate running in X
// ROT_BENCH_Y            (extrudes +Y, flanges UP)  ← stud / vertical web
// rotForBenchAngle(θ)    (extrudes (cos θ, sin θ, 0), flanges UP)
//                                                  ← angled brace / diagonal
const ROT_BENCH_X: [number, number, number] = eulerFromAxes(
  [1, 0, 0],
  [0, 0, 1],
);
const ROT_BENCH_Y: [number, number, number] = eulerFromAxes(
  [0, 1, 0],
  [0, 0, 1],
);
function rotForBenchAngle(theta: number): [number, number, number] {
  const ext: [number, number, number] = [Math.cos(theta), Math.sin(theta), 0];
  return eulerFromAxes(ext, [0, 0, 1]);
}

// "Inverted bench": web sits ABOVE the bench plane (Z=+lf/2), mouth opens
// DOWN (-Z). Used for the upper half of a boxed-member pair where two
// C-sections face each other mouth-to-mouth to form a closed rectangle
// (the parent chord uses ROT_BENCH_X, the Box piece uses ROT_BENCH_X_INV).
const ROT_BENCH_X_INV: [number, number, number] = eulerFromAxes(
  [1, 0, 0],
  [0, 0, -1],
);

export const INTERACTIONS: InteractionConfig[] = [
  // ──────────────────────────────────────────────────────────────────
  // A1 — T-junction (orthogonal): stud meets top plate (BENCH-FLAT)
  //   Per FrameCAD FC-W2: in assembly, the stud's top end NESTS INSIDE
  //   the plate's open mouth — the plate's lips are notched out where
  //   the stud's flange ends pass through, and the stud's last ~50mm
  //   is swaged so its compressed profile fits inside the plate cavity.
  //
  //   In bench-flat layout, both sticks lie web-on-bench (web back at
  //   Z=-20.5, CL on Z=0, flanges UP +Z). Stud's local +Y → world +X,
  //   so the stud's web spans world X ∈ [-35, +35] and its two flanges
  //   sit at world X=+35 (local Y=+35 = lFlange = "top") and X=-35
  //   (local Y=-35 = rFlange = "bottom"). Plate's local +Y → world -Y,
  //   so the plate's two flanges sit at world Y=2344.5 (local Y=+35 =
  //   "top") and Y=2414.5 (local Y=-35 = "bottom"). The stud's two
  //   flanges therefore cross the plate's two flanges at SEPARATE
  //   plate-local z positions — one per flange — not a single shared
  //   notch span. This is unlike A5 (45° diagonal) where both flange
  //   projections fall inside a single 50mm chord-z window.
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A1",
    name: "A1 — T-junction (orthogonal)",
    description:
      "A vertical stud nests INSIDE a horizontal top plate at 90°, BENCH-FLAT (both sticks lie web-on-bench, flanges UP). The stud's top 50mm is swaged so its compressed profile fits inside the plate cavity when assembled. The plate gets TWO separate LipNotches — one per flange — each centred where the corresponding stud flange (world X=±35) crosses the plate flange (world Y=2344.5 / 2414.5). InnerDimples land at the CL–CL meeting (0, 2379.5, 0). 1× #10g screw per side per FrameCAD FC-W2.",
    sticks: [
      // Stud — bench-flat, length axis +Y, web back on Z=-20.5, flanges
      // UP +Z. Length 2398, CL at world (X=0, Y∈[0, 2398], Z=0). Profile
      // origin (web-back midline) sits at world X=0 because the stud's
      // CL X-position is at X=0 and ROT_BENCH_Y does not shift CL in X
      // (local +Y → world +X is symmetric about local Y=0).
      {
        profile: PROFILE_70S41,
        length: 2398,
        position: [0, 0, -20.5],
        rotation: ROT_BENCH_Y,
        label: "Stud (S)",
        ops: [
          // Swage on top 50mm — stick-local position unchanged from old
          // A1 (Swage is along length axis, independent of cross-section
          // orientation). When assembled the swaged section nests inside
          // the plate's cavity.
          { type: "Swage", spanStart: 2348, spanEnd: 2398 },
          // Dimple at CL–CL intersection: stud CL crosses plate CL at
          // world (0, 2379.5, 0). Stud-local z = 2379.5.
          { type: "InnerDimple", pos: 2379.5 },
        ],
      },
      // Top plate — bench-flat, length axis +X, web back on Z=-20.5,
      // flanges UP +Z. Length 1200 centred over the stud (start at X=-600).
      // Position Y = CL Y = 2379.5 (ROT_BENCH_X maps local +Y → world -Y
      // symmetrically about local Y=0, so position Y is the CL Y directly,
      // not the web-back Y — different from the old _DOWN rotation which
      // put the web on +Y above the CL).
      {
        profile: PROFILE_70S41,
        length: 1200,
        position: [-600, 2379.5, -20.5],
        rotation: ROT_BENCH_X,
        label: "Top plate (P)",
        ops: [
          // Stud's flange at world X=-35 crosses plate's rFlange at world
          // Y=2414.5 (local Y=-35 = "bottom"). Plate-local z = -35 -
          // (-600) = 565. 50mm-wide LipNotch on bottom flange only.
          {
            type: "LipNotch",
            spanStart: 540,
            spanEnd: 590,
            flangeSide: "bottom",
          },
          // Stud's flange at world X=+35 crosses plate's lFlange at world
          // Y=2344.5 (local Y=+35 = "top"). Plate-local z = 35 - (-600)
          // = 635. 50mm-wide LipNotch on top flange only.
          {
            type: "LipNotch",
            spanStart: 610,
            spanEnd: 660,
            flangeSide: "top",
          },
          // Dimple at CL–CL intersection: stud CL X=0 → plate-local z =
          // 0 - (-600) = 600.
          { type: "InnerDimple", pos: 600 },
        ],
      },
    ],
    joints: [
      // 1× #10g screw per side at the joint, at CL–CL intersection
      // (0, 2379.5, 0). spanAxis follows the receiving stick (plate)
      // length direction = world +X in bench-flat.
      {
        position: [0, 2379.5, 0],
        axis: [0, 0, 1],
        spanAxis: [1, 0, 0],
        halfThickness: 35,
        screwsPerSide: 1,
        label: "stud-to-top-plate",
      },
    ],
    cameraTarget: [0, 2379.5, 0],
    cameraDistance: 450,
  },

  // ──────────────────────────────────────────────────────────────────
  // A2 — T-junction (angled): brace meets plate at 60° from horizontal
  //   Per FrameCAD FC-W2: same nesting rule as A1 but the entering stick
  //   arrives at an angle. Brace's tip nests inside the plate; the
  //   brace's last 50mm is swaged + chamfered to fit cleanly.
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A2",
    name: "A2 — T-junction (angled, 60°)",
    description:
      "An angled brace meets a horizontal top plate at 60° from horizontal. The brace's tip NESTS INSIDE the plate's open mouth (mouth faces down). The brace's last 50mm is swaged so its compressed profile fits inside the plate cavity, plus a Chamfer at the very end to clear the plate's web. The plate gets a LipNotch over the brace's entry width. 1× #10g screw per side.",
    sticks: [
      // Brace at 60° from horizontal, 1800mm. Tip at world
      // (1800·cos60°, 1800·sin60°, 0) = (900, 1559, 0).
      // Open mouth oriented to face TOWARD the plate above (perpendicular
      // to brace, "above-side" = direction toward plate).
      // Position offset by -lf/2 in the flange-open direction so the
      // brace CENTRELINE passes through origin (not its web back).
      // For 60° "above", flangeOpen = (-sin60, cos60, 0), so offset = -20.5
      // along that direction = (+17.75, -10.25, 0).
      {
        profile: PROFILE_70S41,
        length: 1800,
        position: [17.75, -10.25, 0],
        rotation: rotForAngledIntoPlate((Math.PI / 180) * 60, "above"),
        label: "Brace (B)",
        ops: [
          // Swage compression at the tip (last 50mm) so brace's profile
          // fits inside plate's interior cavity
          { type: "Swage", spanStart: 1750, spanEnd: 1800 },
          // Chamfer at very end so the corner doesn't scrape plate web
          { type: "Chamfer", end: "end" },
          // Dimple at CL–CL intersection: brace-CL crosses plate-CL at
          // world Y = 1561 - 20.5 = 1540.5; brace t at that Y =
          // 1540.5 / sin60° = 1778.5.
          { type: "InnerDimple", pos: 1778.5 },
        ],
      },
      // Plate — horizontal, mouth opens DOWNWARD. Plate's web positioned
      // just above brace's tip so the brace's swaged section nests fully
      // inside the cavity. Brace tip Y = 1800·sin60° = 1559.4. Place
      // plate's web at Y = 1561.
      {
        profile: PROFILE_70S41,
        length: 2400,
        position: [-300, 1561, 0],
        rotation: ROT_HORIZONTAL_X_DOWN,
        label: "Top plate (P)",
        ops: [
          // CL–CL intersection in world: (1778.5·cos60°, 1540.5, 0) =
          // (889.25, 1540.5, 0). Plate-local z = 889.25 - (-300) = 1189.25.
          // 50mm-wide LipNotch centred on 1189.25 → 1164.25..1214.25.
          {
            type: "LipNotch",
            spanStart: 1164.25,
            spanEnd: 1214.25,
            flangeSide: "both",
          },
          // Dimple at CL–CL intersection.
          { type: "InnerDimple", pos: 1189.25 },
        ],
      },
    ],
    joints: [
      {
        // Joint centre at CL–CL intersection: (889.25, 1540.5, 0).
        position: [889.25, 1540.5, 0],
        axis: [0, 0, 1],
        spanAxis: [0, 1, 0],
        halfThickness: 35,
        screwsPerSide: 1,
        label: "brace-to-top-plate",
      },
    ],
    cameraTarget: [880, 1540, 0],
    cameraDistance: 420,
  },

  // ──────────────────────────────────────────────────────────────────
  // A3 — Header-cripple: short Kb meets H header from below
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A3",
    name: "A3 — Header-cripple (Kb meets H from below)",
    description:
      "A short cripple stud (Kb) sits between the slab/sole plate and the bottom of an H header. The Kb is chamfered at its lower end and end-capped (Swage + InnerDimple) at its upper end where it meets the header. The header gets a paired-dimple LipNotch — TWO dimples per cut, at Fastener1 and Fastener1+42mm — to register the Kb in both axes.",
    sticks: [
      // Kb (cripple stud) — vertical, 398mm long so top tip sits 1.25mm
      // below the header's web inner face (header web at Y=400, inner at
      // 400-t≈399.25). Top 50mm (z=348-398) is swaged to fit inside.
      // Position offset by -lf/2 = -20.5 in world X so centreline at X=0.
      {
        profile: PROFILE_70S41,
        length: 398,
        position: [-20.5, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Cripple (Kb)",
        ops: [
          { type: "Chamfer", end: "start" },
          { type: "Swage", spanStart: 348, spanEnd: 398 },
          // Dimple at CL–CL intersection: cripple-CL = X=0, header-CL = Y=379.5
          // → dimple at pos = 379.5 along cripple's length axis.
          { type: "InnerDimple", pos: 379.5 },
        ],
      },
      // H header — horizontal, 2055mm long, mouth opens DOWNWARD
      // so the cripple's swaged top end nests INSIDE the header's
      // open cavity from below. (Was ROT_HORIZONTAL_X — mouth faced
      // -Z into the page, so cripple just butted against header's
      // flange edge instead of nesting inside.)
      {
        profile: PROFILE_70S41,
        length: 2055,
        position: [-1027, 400, 0],
        rotation: ROT_HORIZONTAL_X_DOWN,
        label: "Header (H)",
        ops: [
          // LipNotch centred on CL–CL intersection: cripple-CL crosses
          // header at world X=0 → header-local z = 0 - (-1027) = 1027.
          // 60mm-wide notch centred on 1027 → 997..1057.
          {
            type: "LipNotch",
            spanStart: 997,
            spanEnd: 1057,
            flangeSide: "both",
          },
          // Paired dimples symmetric about the CL–CL intersection (1027),
          // 42mm apart → 1006 and 1048. Per FrameCAD paired-header rule.
          { type: "InnerDimple", pos: 1006 },
          { type: "InnerDimple", pos: 1048 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // A4 — Truss vertical web at chord (single-screw variant)
  //   Per FrameCAD FC-R3 left-side detail: truss web NESTS INSIDE the
  //   top chord's open mouth (mouth faces down). Web has TrussChamfers
  //   at both ends. 1× or 2× #10g screws per side at the joint.
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A4",
    name: "A4 — Truss vertical web at chord",
    description:
      "A vertical truss web NESTS INSIDE a horizontal top chord at 90°. The web's top tip enters through the chord's downward-facing open mouth. Web has TrussChamfers at both ends. The chord's lips are notched over the entry width and a screw fastens the joint per FrameCAD FC-R3 (left-side single-screw variant).",
    sticks: [
      // Truss web — vertical, top end at world Y=598 (just below chord's
      // web inner face at Y≈599.25). Top 50mm swaged so web's profile
      // fits inside chord's interior cavity.
      // Position offset by -lf/2 = -20.5 in world X so web's centreline
      // at X=0 (aligns with chord's LipNotch and joint screws).
      {
        profile: PROFILE_70S41,
        length: 598,
        position: [-20.5, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Web (W)",
        ops: [
          { type: "TrussChamfer", end: "start" },
          { type: "TrussChamfer", end: "end" },
          { type: "Swage", spanStart: 548, spanEnd: 598 },
          // Dimple at CL–CL intersection: web-CL crosses chord-CL at
          // world Y = 600 - 20.5 = 579.5.
          { type: "InnerDimple", pos: 579.5 },
        ],
      },
      // Chord — horizontal, mouth opens DOWNWARD so the web tip nests
      // inside. Chord's web at world Y=600, length 2000 centred at X=0.
      {
        profile: PROFILE_70S41,
        length: 2000,
        position: [-1000, 600, 0],
        rotation: ROT_HORIZONTAL_X_DOWN,
        label: "Top chord",
        ops: [
          {
            type: "LipNotch",
            spanStart: 975,
            spanEnd: 1025,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1000 },
        ],
      },
    ],
    joints: [
      {
        // Joint centre at CL–CL intersection: (0, 579.5, 0).
        position: [0, 579.5, 0],
        axis: [0, 0, 1],
        spanAxis: [0, 1, 0],
        halfThickness: 35,
        screwsPerSide: 1,
        label: "web-to-top-chord",
      },
    ],
    cameraTarget: [0, 590, 0],
    cameraDistance: 360,
  },

  // ──────────────────────────────────────────────────────────────────
  // A4R — Reinforced truss joint (FC-R4 apex / heel detail)
  //   Per FrameCAD FC-R4: high-load joint adds a flat connector plate
  //   sandwiching the joint on BOTH sides of the truss, with multi-screw
  //   cluster fastening through both members. Same nesting geometry as
  //   A4 but with reinforcing hardware.
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A4R",
    name: "A4R — Reinforced truss joint (FC-R4)",
    description:
      "Same nesting geometry as A4 but with REINFORCING CONNECTOR PLATES sandwiching the joint on both sides of the truss. 4 screws per side passing through plate + chord flange + web flange + (other) chord flange. Used at apex / heel joints where load concentration requires reinforcement per FrameCAD FC-R4.",
    sticks: [
      {
        profile: PROFILE_70S41,
        length: 598,
        position: [0, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Web (W)",
        ops: [
          { type: "TrussChamfer", end: "start" },
          { type: "TrussChamfer", end: "end" },
          { type: "Swage", spanStart: 548, spanEnd: 598 },
          // Dimple at CL–CL intersection: web-CL crosses chord-CL at
          // world Y = 600 - 20.5 = 579.5.
          { type: "InnerDimple", pos: 579.5 },
        ],
      },
      {
        profile: PROFILE_70S41,
        length: 2000,
        position: [-1000, 600, 0],
        rotation: ROT_HORIZONTAL_X_DOWN,
        label: "Top chord",
        ops: [
          {
            type: "LipNotch",
            spanStart: 975,
            spanEnd: 1025,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1000 },
        ],
      },
    ],
    joints: [
      {
        // Joint centre at CL–CL intersection: (0, 579.5, 0).
        position: [0, 579.5, 0],
        axis: [0, 0, 1],
        spanAxis: [0, 1, 0],
        halfThickness: 35,
        screwsPerSide: 4,
        screwSpacing: 30,
        connectorPlate: true,
        plateSize: [120, 90],
        label: "reinforced web-to-top-chord",
      },
    ],
    cameraTarget: [0, 590, 0],
    cameraDistance: 380,
  },

  // ──────────────────────────────────────────────────────────────────
  // A5 — Truss diagonal web at chord (45°)
  //   Bench-flat: chord and diagonal both lie web-on-bench (Z=-20.5),
  //   flanges pointing UP (+Z). Both centrelines in the Z=0 plane.
  //   Diagonal CL crosses chord CL at world (707, 707, 0).
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A5",
    name: "A5 — Truss diagonal web at chord (45°)",
    description:
      "A 45° diagonal truss web meeting a chord, BENCH-FLAT (both sticks lie web-on-bench, flanges UP). Diagonal has TrussChamfers at both ends, plus a Swage + InnerDimple at the tip. The chord gets the LipNotch + InnerDimple at the CL–CL intersection point.",
    sticks: [
      // Diagonal web — 45° in the bench plane (X-Y), flanges UP +Z.
      // CL goes from world (0,0,0) to (707, 707, 0) for length 1000.
      // Web back at Z=-20.5 → CL at Z=0 (offset by lf/2 along flange-open).
      {
        profile: PROFILE_70S41,
        length: 1000,
        position: [0, 0, -20.5],
        rotation: rotForBenchAngle(Math.PI / 4),
        label: "Diagonal web (W)",
        ops: [
          { type: "TrussChamfer", end: "start" },
          { type: "TrussChamfer", end: "end" },
          // Swage the last 55mm before tip — compresses the diagonal's
          // flange depth so it clears the chord's lip turn-back where
          // the diagonal crosses the chord's flange span.
          { type: "Swage", spanStart: 945, spanEnd: 1000 },
          // InnerDimple at the tip = CL–CL intersection.
          { type: "InnerDimple", pos: 1000 },
        ],
      },
      // Chord — horizontal along +X, bench-flat (web on Z=-20.5,
      // flanges UP +Z, CL on Z=0). CL at world Y=707, length 2500
      // centred on the meeting point (X=707) → start X=-543.
      {
        profile: PROFILE_70S41,
        length: 2500,
        position: [-543, 707, -20.5],
        rotation: ROT_BENCH_X,
        label: "Chord",
        ops: [
          // Meeting point at chord-local z = 707 - (-543) = 1250.
          // 50mm-wide LipNotch centred on 1250 → 1225..1275.
          {
            type: "LipNotch",
            spanStart: 1225,
            spanEnd: 1275,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1250 },
        ],
      },
    ],
    joints: [
      // 1× #10g screw per side at the joint, at CL–CL intersection.
      {
        position: [707, 707, 0],
        axis: [0, 0, 1],
        spanAxis: [1, 0, 0],
        halfThickness: 35,
        screwsPerSide: 1,
        label: "diagonal-to-chord",
      },
    ],
    cameraTarget: [600, 600, 0],
    cameraDistance: 1400,
  },

  // ──────────────────────────────────────────────────────────────────
  // A5L — Linear-truss diagonal web at chord (89×41 LIN-only variant)
  //   Same physical layout as A5 but uses HYTEK's Linear-truss simplifier
  //   output instead of the FrameCAD-baseline LipNotch+Swage+InnerDimple
  //   pattern. The 4-layer gate fires (frame.type === "Truss" + plan
  //   /-LIN-/i + every stick 89×41 LC 0.75 + has chord+web), the
  //   centreline-intersection rule rewrites the joint:
  //
  //     • 3× M6 BOLT HOLES at 17 mm pitch on the WEB of EACH stick at
  //       the CL–CL crossing (web-to-web back-to-back contact at the
  //       joint location).
  //     • NO LipNotch on chord. NO Swage on diagonal. NO InnerDimple.
  //       Those FrameCAD outputs are stripped/replaced by the BOLT
  //       HOLES rule for linear-truss web-to-chord crossings.
  //     • TrussChamfer at both ends of the diagonal stays from the
  //       FrameCAD baseline (the simplifier doesn't touch chamfers).
  //
  //   Strict isolation: NEVER fires on walls, floors, non-LIN trusses,
  //   non-89×41 designs. Walls / floors etc. use the regular A5 with
  //   LipNotch + Swage + InnerDimple.
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A5L",
    name: "A5L — Linear-truss diagonal web at chord (89×41)",
    description:
      "HYTEK Linear-truss variant of A5. Bench-flat 45° diagonal meets a chord on an 89×41 LC truss whose plan name contains '-LIN-'. The simplifier's centreline-intersection rule fires: 3× M6 BOLT HOLES at 17 mm pitch through the WEB of EACH stick at the CL–CL crossing point. NO LipNotch / NO Swage / NO InnerDimple at the joint — they're stripped/replaced by the BOLT HOLES rule. TrussChamfer at the diagonal's ends remains from the FrameCAD baseline. Strictly isolated to LIN trusses on 89×41 LC 0.75 — never fires elsewhere.",
    sticks: [
      // Diagonal web — 45°, bench-flat (web back at Z=-20.5, flanges
      // UP +Z, CL on Z=0). CL goes from (0,0,0) to (707, 707, 0).
      {
        profile: PROFILE_89S41,
        length: 1000,
        position: [0, 0, -20.5],
        rotation: rotForBenchAngle(Math.PI / 4),
        label: "Diagonal web (W) — 89×41",
        ops: [
          { type: "TrussChamfer", end: "start" },
          { type: "TrussChamfer", end: "end" },
          // 3× M6 BOLT HOLES at the CL–CL crossing on the diagonal.
          // pos = 1000 (the tip = CL crossing), pattern = 17mm pitch
          // along the diagonal's length axis.
          { type: "ScrewHoles", pos: 1000, pattern: [-17, 0, 17] },
        ],
      },
      // Chord — bench-flat along +X. CL at world Y=707, length 2500
      // centred on the meeting point (X=707) → start X=-543.
      {
        profile: PROFILE_89S41,
        length: 2500,
        position: [-543, 707, -20.5],
        rotation: ROT_BENCH_X,
        label: "Chord — 89×41",
        ops: [
          // Same 3× M6 BOLT HOLES pattern at the CL–CL crossing on the
          // chord. Chord-local pos = 707 - (-543) = 1250.
          { type: "ScrewHoles", pos: 1250, pattern: [-17, 0, 17] },
        ],
      },
    ],
    joints: [
      // 3× M6 self-drilling per side at the CL–CL crossing, distributed
      // along the chord's length axis with 17 mm pitch. Driven through
      // back-to-back web contact between diagonal and chord.
      {
        position: [707, 707, 0],
        axis: [0, 0, 1],
        spanAxis: [1, 0, 0],
        halfThickness: 44.5, // 89mm web depth ÷ 2
        screwsPerSide: 3,
        screwSpacing: 17,
        label: "linear-truss web-to-chord (3× M6 @ 17mm)",
      },
    ],
    cameraTarget: [600, 600, 0],
    cameraDistance: 1400,
  },

  // ──────────────────────────────────────────────────────────────────
  // A6 — Wall W-brace at top plate (≥28°)
  //   Per FrameCAD FC-W11: K-brace meets top plate at angle. Brace's
  //   tip nests inside plate's open mouth. Chamfered + swaged at end.
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A6",
    name: "A6 — Wall W-brace at plate (≥28°)",
    description:
      "A wall W-brace at 60° from horizontal NESTS INSIDE a top plate. The brace's top end is swaged (profile compressed) over its last 50mm so it fits inside the plate's downward-facing open mouth, plus a Chamfer at the very tip. The plate gets a LipNotch over the brace's entry width and a #10g screw fastens the joint per FC-W11.",
    sticks: [
      // Wall W-brace at 60° from horizontal, 1800mm. Tip at world
      // (1800·cos60°, 1800·sin60°, 0) = (900, 1559, 0).
      // Same centreline-offset fix as A2: shift by +17.75, -10.25.
      {
        profile: PROFILE_70S41,
        length: 1800,
        position: [17.75, -10.25, 0],
        rotation: rotForAngledIntoPlate((Math.PI / 180) * 60, "above"),
        label: "Wall brace (W)",
        ops: [
          // Chamfer at start (where brace meets bottom plate, not shown)
          { type: "Chamfer", end: "start" },
          // Chamfer at tip (so brace's lip corner doesn't gouge plate's web)
          { type: "Chamfer", end: "end" },
          // Swage compresses brace's profile to fit inside plate cavity
          { type: "Swage", spanStart: 1750, spanEnd: 1800 },
          // Dimple at CL–CL intersection (same calc as A2): pos 1778.5.
          { type: "InnerDimple", pos: 1778.5 },
        ],
      },
      // Top plate — horizontal, mouth opens DOWN. Plate's web at Y=1561.
      {
        profile: PROFILE_70S41,
        length: 2400,
        position: [-300, 1561, 0],
        rotation: ROT_HORIZONTAL_X_DOWN,
        label: "Top plate",
        ops: [
          // LipNotch centred on CL–CL intersection (plate-local z=1189.25).
          {
            type: "LipNotch",
            spanStart: 1164.25,
            spanEnd: 1214.25,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1189.25 },
        ],
      },
    ],
    joints: [
      {
        // Joint centre at CL–CL intersection: (889.25, 1540.5, 0).
        position: [889.25, 1540.5, 0],
        axis: [0, 0, 1],
        spanAxis: [0, 1, 0],
        halfThickness: 35,
        screwsPerSide: 1,
        label: "wall-brace-to-plate",
      },
    ],
    cameraTarget: [890, 1540, 0],
    cameraDistance: 420,
  },

  // ──────────────────────────────────────────────────────────────────
  // B2 — Truss scissor cross (TIN — two diagonals at ±45°)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "B2",
    name: "B2 — Truss scissor cross (TIN)",
    description:
      "Two truss webs forming an X at ±45°, crossing at their midpoints. Only the PRIMARY (longer / first-encountered) gets the LipNotch + InnerDimple at the crossing — the secondary passes through the cut without modification. This pattern shows up across linear-truss panels.",
    sticks: [
      // Diagonal A: +45° from horizontal
      {
        profile: PROFILE_70S41,
        length: 1414, // sqrt(2) * 1000
        position: [-500, -500, 0],
        rotation: rotForXYAngle(Math.PI / 4),
        label: "Web A (primary)",
        ops: [
          {
            type: "LipNotch",
            spanStart: 687,
            spanEnd: 727,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 707 },
        ],
      },
      // Diagonal B: -45° from horizontal
      {
        profile: PROFILE_70S41,
        length: 1414,
        position: [-500, 500, 0],
        rotation: rotForXYAngle(-Math.PI / 4),
        label: "Web B (secondary)",
        ops: [],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // C1 — End-butt with small gap (panel break)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "C1",
    name: "C1 — End-butt with small gap",
    description:
      "Two horizontal plates ending near each other with a 30mm gap — the typical panel-break in a long wall run. Each plate has a standard end-cap (LipNotch + InnerDimple at each end). No special joining op — just shows two end-caps side by side.",
    sticks: [
      // Plate 1 — left half
      {
        profile: PROFILE_70S41,
        length: 1500,
        position: [-1500, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Plate 1",
        ops: [
          { type: "LipNotch", spanStart: 0, spanEnd: 39, flangeSide: "both" },
          { type: "LipNotch", spanStart: 1461, spanEnd: 1500, flangeSide: "both" },
          { type: "InnerDimple", pos: 20 },
          { type: "InnerDimple", pos: 1480 },
        ],
      },
      // Plate 2 — right half (30mm gap)
      {
        profile: PROFILE_70S41,
        length: 1500,
        position: [30, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Plate 2",
        ops: [
          { type: "LipNotch", spanStart: 0, spanEnd: 39, flangeSide: "both" },
          { type: "LipNotch", spanStart: 1461, spanEnd: 1500, flangeSide: "both" },
          { type: "InnerDimple", pos: 20 },
          { type: "InnerDimple", pos: 1480 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // D2 — B2B partner pair (lip-to-lip, web facing out)
  //   Per FrameCAD FC-W3: two studs face each other lip-to-lip with
  //   webs facing OUT to opposite sides of the wall. Through-screws
  //   alternate sides of the web at max 6" (152mm) spacing per FC-W3.
  // ──────────────────────────────────────────────────────────────────
  {
    id: "D2",
    name: "D2 — B2B partner pair (back-to-back, flange-on-flange)",
    description:
      "Two studs paired flange-on-flange — lips touching down the centreline, webs facing OUT to opposite sides of the wall. Per FrameCAD FC-W3, screws alternate sides of the web at max 6\" (152mm) spacing connecting the pair. (The Web-hole pattern shows where through-bolts pass through both webs in heavier-load configurations.)",
    sticks: [
      // Stud A — flanges extending toward x=0 (lips at world x=-1.5)
      // web at world x=-42.5
      {
        profile: PROFILE_70S41,
        length: 2700,
        position: [-42.5, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Stud A (web -X)",
        ops: [
          { type: "Web", pos: 38, diameter: 8 },
          { type: "Web", pos: 38 + 447, diameter: 8 },
          { type: "Web", pos: 38 + 894, diameter: 8 },
          { type: "Web", pos: 38 + 1341, diameter: 8 },
          { type: "Web", pos: 38 + 1788, diameter: 8 },
          { type: "Web", pos: 38 + 2235, diameter: 8 },
          { type: "Web", pos: 2700 - 38, diameter: 8 },
        ],
      },
      // Stud B — flange flipped, web at world x=+42.5, lips at world x=+1.5
      {
        profile: PROFILE_70S41,
        length: 2700,
        position: [42.5, 0, 0],
        rotation: ROT_VERTICAL_Y,
        flangeDir: "flipped",
        label: "Stud B (web +X)",
        ops: [
          { type: "Web", pos: 38, diameter: 8 },
          { type: "Web", pos: 38 + 447, diameter: 8 },
          { type: "Web", pos: 38 + 894, diameter: 8 },
          { type: "Web", pos: 38 + 1341, diameter: 8 },
          { type: "Web", pos: 38 + 1788, diameter: 8 },
          { type: "Web", pos: 38 + 2235, diameter: 8 },
          { type: "Web", pos: 2700 - 38, diameter: 8 },
        ],
      },
    ],
    // Screw rows down the joint at max 152mm (6") spacing — alternating
    // sides of the web per FC-W3. Screws driven THROUGH both lips at the
    // centreline. axis = world X (perpendicular to lips). For this scene
    // we drop screws at 5 representative heights — visualisation, not
    // a complete fastener set.
    joints: [
      // halfThickness=1.5 puts each screw HEAD just outside the touching
      // lip at world x=±1.5; the 22mm shank extends INWARD into the
      // OTHER stud. For the partner-pair connection, screws on both
      // sides at the same Y height visually approximate the alternating
      // pattern from FC-W3.
      {
        position: [0, 200, 0],
        axis: [1, 0, 0],
        spanAxis: [0, 1, 0],
        halfThickness: 1.5,
        screwsPerSide: 1,
        label: "B2B partner-pair screw 1",
      },
      {
        position: [0, 700, 0],
        axis: [1, 0, 0],
        spanAxis: [0, 1, 0],
        halfThickness: 1.5,
        screwsPerSide: 1,
        label: "B2B partner-pair screw 2",
      },
      {
        position: [0, 1200, 0],
        axis: [1, 0, 0],
        spanAxis: [0, 1, 0],
        halfThickness: 1.5,
        screwsPerSide: 1,
        label: "B2B partner-pair screw 3",
      },
      {
        position: [0, 1700, 0],
        axis: [1, 0, 0],
        spanAxis: [0, 1, 0],
        halfThickness: 1.5,
        screwsPerSide: 1,
        label: "B2B partner-pair screw 4",
      },
      {
        position: [0, 2200, 0],
        axis: [1, 0, 0],
        spanAxis: [0, 1, 0],
        halfThickness: 1.5,
        screwsPerSide: 1,
        label: "B2B partner-pair screw 5",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // D3 — Side-by-side double stud (web-on-web)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "D3",
    name: "D3 — Side-by-side double stud (web-on-web)",
    description:
      "The other 'double stud' configuration — webs TOUCHING in the centre, flanges OUT to opposite sides. Same 7-hole web pattern as D2 but the visual layout is dramatically different: the through-bolts pass through both webs at once, and the two C-sections form a closed-tube cross-section.",
    sticks: [
      // Stud A — web back at x=0, flanges extending +X
      {
        profile: PROFILE_70S41,
        length: 2700,
        position: [0, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Stud A (flanges +X)",
        ops: [
          { type: "Web", pos: 38, diameter: 8 },
          { type: "Web", pos: 38 + 447, diameter: 8 },
          { type: "Web", pos: 38 + 894, diameter: 8 },
          { type: "Web", pos: 38 + 1341, diameter: 8 },
          { type: "Web", pos: 38 + 1788, diameter: 8 },
          { type: "Web", pos: 38 + 2235, diameter: 8 },
          { type: "Web", pos: 2700 - 38, diameter: 8 },
        ],
      },
      // Stud B — flipped so flanges extend -X, web back at x=-1.5 (small offset to avoid z-fighting)
      {
        profile: PROFILE_70S41,
        length: 2700,
        position: [-1.5, 0, 0],
        rotation: ROT_VERTICAL_Y,
        flangeDir: "flipped",
        label: "Stud B (flanges -X)",
        ops: [
          { type: "Web", pos: 38, diameter: 8 },
          { type: "Web", pos: 38 + 447, diameter: 8 },
          { type: "Web", pos: 38 + 894, diameter: 8 },
          { type: "Web", pos: 38 + 1341, diameter: 8 },
          { type: "Web", pos: 38 + 1788, diameter: 8 },
          { type: "Web", pos: 38 + 2235, diameter: 8 },
          { type: "Web", pos: 2700 - 38, diameter: 8 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // E1 — Nested (smaller stick passes through larger profile)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "E1",
    name: "E1 — Nested (inner stick passes through outer)",
    description:
      "An 89mm horizontal outer plate has a smaller 70mm vertical stud passing THROUGH it. The outer's lip is fully removed (LipNotch over the entry zone) so the inner can pass through unobstructed. The inner stick gets a Swage along the section that sits inside the outer — that compressed segment is what 'nests' inside.",
    sticks: [
      // Outer plate — 89S41 horizontal
      {
        profile: PROFILE_89S41,
        length: 2000,
        position: [-1000, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Outer plate (89S41)",
        ops: [
          // LipNotch on top lip over the inner stick's full width (~70mm + clearance)
          {
            type: "LipNotch",
            spanStart: 950,
            spanEnd: 1050,
            flangeSide: "top",
          },
          { type: "InnerDimple", pos: 1000 },
        ],
      },
      // Inner stud — 70S41 vertical, passes through the outer's web
      {
        profile: PROFILE_70S41,
        length: 800,
        position: [0, -400, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Inner stud (70S41)",
        ops: [
          // Swage where it nests through the outer (mid-section)
          { type: "Swage", spanStart: 350, spanEnd: 450 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // E2 — Nested telescope (collinear splice)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "E2",
    name: "E2 — Nested telescope (collinear splice)",
    description:
      "Two horizontal sticks splice end-to-end with overlap — the smaller 70S41 inner slides INTO the 89S41 outer along the same axis. 300mm overlap zone. The outer gets a LipNotch + InnerDimple at the overlap. The inner gets a Swage along the overlap length — that compressed portion is what fits inside the outer's bore.",
    sticks: [
      // Outer (89S41) — left half
      {
        profile: PROFILE_89S41,
        length: 1500,
        position: [-1500, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Outer (89S41)",
        ops: [
          {
            type: "LipNotch",
            spanStart: 1200,
            spanEnd: 1500,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1350 },
        ],
      },
      // Inner (70S41) — right half, sliding into the outer with 300mm overlap
      {
        profile: PROFILE_70S41,
        length: 1500,
        position: [-300, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Inner (70S41)",
        ops: [
          { type: "Swage", spanStart: 0, spanEnd: 300 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // F1 — Slab anchor (bottom plate with hold-downs)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "F1",
    name: "F1 — Slab anchor (bottom plate)",
    description:
      "An 89mm bottom plate anchored to a concrete slab. Web holes are punched 8mm in from each end (small fastener holes), and the actual hold-down anchors are larger Bolts at ±62mm offsets from each Web hole. Together these 4 anchor points hold the wall down through earthquake loading.",
    sticks: [
      // Bottom plate — 89S41
      {
        profile: PROFILE_89S41,
        length: 2400,
        position: [-1200, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Bottom plate (89S41)",
        ops: [
          // Web holes near each end (small)
          { type: "Web", pos: 8, diameter: 6 },
          { type: "Web", pos: 2392, diameter: 6 },
          // Hold-down bolts at ±62mm from each Web (bigger)
          { type: "Bolt", pos: 70, diameter: 14 },
          { type: "Bolt", pos: 2330, diameter: 14 },
        ],
      },
      // Optional: a stud above to give context
      {
        profile: PROFILE_70S41,
        length: 2400,
        position: [0, 89, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Stud (context)",
        ops: [],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // F2 — Paired header (H1+H2 box header)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "F2",
    name: "F2 — Paired header (H1+H2 box header)",
    description:
      "Two stacked headers form a box header above an opening. Each header has end-caps (LipNotch + InnerDimple) at both ends, plus a Web hole 89mm from each end and additional Web stiffeners distributed along the length (max 300mm spacing). The two headers are typically bolted together via the web stiffener line.",
    sticks: [
      // H1 — top header
      {
        profile: PROFILE_70S41,
        length: 2055,
        position: [-1027, 70, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Header H1 (top)",
        ops: [
          { type: "LipNotch", spanStart: 0, spanEnd: 39, flangeSide: "both" },
          { type: "LipNotch", spanStart: 2016, spanEnd: 2055, flangeSide: "both" },
          { type: "InnerDimple", pos: 20 },
          { type: "InnerDimple", pos: 2035 },
          // Web stiffeners — Ø8 holes spaced ≤300mm
          { type: "Web", pos: 89, diameter: 8 },
          { type: "Web", pos: 389, diameter: 8 },
          { type: "Web", pos: 689, diameter: 8 },
          { type: "Web", pos: 1027, diameter: 8 },
          { type: "Web", pos: 1366, diameter: 8 },
          { type: "Web", pos: 1666, diameter: 8 },
          { type: "Web", pos: 2055 - 89, diameter: 8 },
        ],
      },
      // H2 — bottom header
      {
        profile: PROFILE_70S41,
        length: 2055,
        position: [-1027, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Header H2 (bottom)",
        ops: [
          { type: "LipNotch", spanStart: 0, spanEnd: 39, flangeSide: "both" },
          { type: "LipNotch", spanStart: 2016, spanEnd: 2055, flangeSide: "both" },
          { type: "InnerDimple", pos: 20 },
          { type: "InnerDimple", pos: 2035 },
          { type: "Web", pos: 89, diameter: 8 },
          { type: "Web", pos: 389, diameter: 8 },
          { type: "Web", pos: 689, diameter: 8 },
          { type: "Web", pos: 1027, diameter: 8 },
          { type: "Web", pos: 1366, diameter: 8 },
          { type: "Web", pos: 1666, diameter: 8 },
          { type: "Web", pos: 2055 - 89, diameter: 8 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // B1 — Orthogonal cross
  // ──────────────────────────────────────────────────────────────────
  {
    id: "B1",
    name: "B1 — Orthogonal cross (bracing)",
    description:
      "Two sticks crossing at 90° in their middles — a horizontal nog meeting a vertical stud at its centerline. Only the primary stick (here the horizontal) gets the LipNotch + InnerDimple — the other passes through.",
    sticks: [
      // Horizontal — primary
      {
        profile: PROFILE_70S41,
        length: 1500,
        position: [-750, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Nog (primary)",
        ops: [
          {
            type: "LipNotch",
            spanStart: 730,
            spanEnd: 770,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 750 },
        ],
      },
      // Vertical — secondary, no operations
      {
        profile: PROFILE_70S41,
        length: 1500,
        position: [0, -750, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Stud (secondary)",
        ops: [],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // C2 — Mitred corner (45° angled end joint)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "C2",
    name: "C2 — Mitred wall corner",
    description:
      "Two horizontal plates meeting at a 90° corner with mitred ends. Each plate has a Chamfer at the meeting end and an InnerDimple just inside. This is how external wall corners are formed in HYTEK panel sets.",
    sticks: [
      // Plate A — runs along +X
      {
        profile: PROFILE_70S41,
        length: 1200,
        position: [0, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Plate A",
        ops: [
          { type: "Chamfer", end: "end" },
          { type: "InnerDimple", pos: 1180 },
        ],
      },
      // Plate B — runs along +Y, perpendicular
      {
        profile: PROFILE_70S41,
        length: 1200,
        position: [1200, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Plate B",
        ops: [
          { type: "Chamfer", end: "start" },
          { type: "InnerDimple", pos: 20 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // C3 — Service hole (cable pass-through)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "C3",
    name: "C3 — Service hole pass-through",
    description:
      "A horizontal nog with a service slot cut into its web — typical for routing cables or pipes through a wall. The slot is an oval cutout sized for the service (here Ø45 for typical electrical conduit).",
    sticks: [
      {
        profile: PROFILE_70S41,
        length: 1500,
        position: [-750, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Nog with service hole",
        ops: [
          { type: "InnerService", pos: 750, diameter: 45 },
          // Plus end-caps
          { type: "LipNotch", spanStart: 0, spanEnd: 39, flangeSide: "both" },
          { type: "LipNotch", spanStart: 1461, spanEnd: 1500, flangeSide: "both" },
          { type: "InnerDimple", pos: 20 },
          { type: "InnerDimple", pos: 1480 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // D1 — Single chord with screw cluster
  // ──────────────────────────────────────────────────────────────────
  {
    id: "D1",
    name: "D1 — Chord-pair screw cluster",
    description:
      "A truss chord with a cluster of small screw holes — used to fasten two chord sticks together along the length. Pattern is three Ø3.8mm holes per cluster, repeated along the joint.",
    sticks: [
      {
        profile: PROFILE_70S41,
        length: 1500,
        position: [-750, 0, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Chord with screw clusters",
        ops: [
          { type: "ScrewHoles", pos: 250, pattern: [-8, 0, 8] },
          { type: "ScrewHoles", pos: 750, pattern: [-8, 0, 8] },
          { type: "ScrewHoles", pos: 1250, pattern: [-8, 0, 8] },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // D4 — Linear-truss boxed chord segment (Box piece + parent chord)
  //   A high-load segment of a Linear-truss chord can be "boxed" by
  //   nesting a second 89×41 C-section MOUTH-TO-MOUTH with the parent,
  //   forming a closed rectangular tube. ~3-4× the section modulus,
  //   much higher buckling/torsion resistance. The Box piece is
  //   SHORTER than the parent — only spans the high-moment zone.
  //   A single chord can have multiple Box zones along its length
  //   (e.g. B1 (Box1) + B1 (Box2) on one chord).
  //
  //   Geometry in bench-flat:
  //     Parent chord: web on bench (Z=-20.5), flanges UP +Z, mouth UP.
  //     Box piece:    web above (Z=+20.5), flanges DOWN -Z, mouth DOWN.
  //     They meet flange-to-flange at world Y = ±44.5 (89mm web ÷ 2),
  //     forming a closed tube from Z=-20.5 to Z=+20.5.
  //
  //   Registration + fastening:
  //     • Box's flanges have OUTWARD-pressed dimples; parent's flanges
  //       have INWARD-pressed dimples. The bumps interlock at the
  //       flange-to-flange seam (operator measures nothing — the
  //       dimples self-align the slide-in).
  //     • A 10g-16mm flathead screw is driven through every paired
  //       dimple. Countersunk so the head sits flush with the flange
  //       face. Screw passes through Box flange (0.75) + parent flange
  //       (0.75) = 1.5 mm steel grip.
  //
  //   Spacing rule (canonical 2026-05-10):
  //     • First / last dimple = 15 mm from each end of the Box piece
  //     • Maximum gap between adjacent dimples = 900 mm
  //
  //   Both pieces (Box AND parent) get matching dimples at the same
  //   world positions — paired across the seam.
  //
  //   Strict isolation: only fires on LIN trusses + 89×41 LC 0.75 +
  //   chord+web members. The wall B2B partner pair (D2) is GEOMETRICALLY
  //   similar (also flange-on-flange) but uses a different fastener
  //   pattern (Web @8 slab anchors, alternating screws per FC-W3).
  // ──────────────────────────────────────────────────────────────────
  {
    id: "D4",
    name: "D4 — Linear-truss boxed chord segment",
    description:
      "Two C-sections with ASYMMETRIC flange heights nest together to form a closed rectangular tube, used on high-load segments of a Linear-truss chord. The OUTER stick (89S41, lFlange=41mm) is the parent — it runs the full length. The INNER stick (89S39, lFlange=39mm) is the Box piece — it spans only the high-moment zone (here 2000mm centred on a 4000mm parent). The 2mm flange-height delta lets the inner's smaller flanges nest INSIDE the outer's cavity with overlapping flange surfaces. Paired flange dimples (outward-pressed on inner, inward-pressed on outer) self-register the slide-in; 10g-16mm flathead screws through each pair give 1.5mm steel grip. Spacing: 15mm from each Box end, max 900mm between adjacent. ~3-4× the single-C section modulus. Strict isolation: LIN trusses + 89×41 LC 0.75 only.",
    sticks: [
      // Parent chord (OUTER, larger flanges) — bench-flat along +X. Web
      // on bench (Z=-20.5), flanges UP +Z, mouth UP. Length 4000, CL
      // spans X = -2000 to +2000. Profile 89S41: lFlange=41 (top),
      // rFlange=38 (bottom), web=89.
      {
        profile: PROFILE_89S41,
        length: 4000,
        position: [-2000, 0, -20.5],
        rotation: ROT_BENCH_X,
        label: "Parent chord — 89S41 (outer, full length)",
        tint: "#9ca3af",
        ops: [
          // (Future: paired flange dimples along the Box overlap zone.
          // Joint markers below show the screw positions on flange seams.)
        ],
      },
      // Box piece (INNER, smaller flanges) — bench-flat along +X but
      // INVERTED (web above, mouth DOWN) so it closes the tube mouth-to-
      // mouth with the parent. Web back at Z=+20.5 (sits at parent's
      // flange-tip line), flanges going DOWN by 39mm to Z=-18.5 (just
      // shy of parent's web at Z=-20.5+0.75=-19.75 inner face → snug
      // 1mm clearance). Profile 89S39: lFlange=rFlange=39mm, 2mm
      // shorter than parent's flanges so inner nests cleanly INSIDE
      // parent's cavity with ~1mm clearance to outer lip turn-back.
      {
        profile: PROFILE_89S39,
        length: 2000,
        position: [-1000, 0, 20.5],
        rotation: ROT_BENCH_X_INV,
        label: "Box piece — 89S39 (inner, 2000mm)",
        tint: "#facc15",
        ops: [],
      },
    ],
    // 10g-16mm flathead screws at the paired-dimple positions.
    // Box piece spans X = -1000 to +1000 (2000 mm).
    // 15 mm-from-each-end → first dimple at -985, last at +985.
    // 1970 mm available between → 4 gaps × 492.5 mm each = 5 dimples
    // total per flange seam (well under the 900 mm max).
    // Each dimple position gets a screw on BOTH flange seams
    // (world Y = -44.5 AND world Y = +44.5).
    joints: [-985, -492.5, 0, 492.5, 985].flatMap((x) => [
      {
        // Top flange seam: parent's top flange + Box's "bottom" flange
        // share world Y = -44.5. Screw axis = world Y (perpendicular
        // to flange faces).
        position: [x, -44.5, 0] as [number, number, number],
        axis: [0, 1, 0] as [number, number, number],
        spanAxis: [1, 0, 0] as [number, number, number],
        halfThickness: 0.75, // 1.5 mm grip ÷ 2
        screwsPerSide: 1,
        label: `box-flange-screw-Y-44 x=${x}`,
      },
      {
        // Bottom flange seam at world Y = +44.5.
        position: [x, 44.5, 0] as [number, number, number],
        axis: [0, 1, 0] as [number, number, number],
        spanAxis: [1, 0, 0] as [number, number, number],
        halfThickness: 0.75,
        screwsPerSide: 1,
        label: `box-flange-screw-Y+44 x=${x}`,
      },
    ]),
    cameraTarget: [0, 0, 0],
    cameraDistance: 1500,
  },
];
