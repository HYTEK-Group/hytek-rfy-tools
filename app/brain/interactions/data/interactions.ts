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

export const INTERACTIONS: InteractionConfig[] = [
  // ──────────────────────────────────────────────────────────────────
  // A1 — T-junction (orthogonal): stud meets top plate
  //   Per FrameCAD FC-W2: the stud's top end NESTS INSIDE the plate's
  //   open mouth. The plate's flanges hug the stud's web from front and
  //   back. The plate's lips are notched out across the stud's entry
  //   width so the stud's flange ends can pass through. The stud's last
  //   ~50mm is swaged (profile compressed) so it physically fits inside
  //   the plate's interior cavity. 1× #10g screw per side at the joint.
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A1",
    name: "A1 — T-junction (orthogonal)",
    description:
      "A vertical stud nests INSIDE a horizontal top plate at 90°. The stud's top 50mm is swaged (profile compressed) so it fits inside the plate's interior cavity. The plate's open mouth faces DOWN, its flanges hug the stud's web from front and back, and its lips are notched out across the stud's entry width. 1× #10g screw per side per FrameCAD FC-W2.",
    sticks: [
      // Stud — vertical, top end NESTED inside plate. Length 2398 →
      // tip at world Y=2398, just below the plate's web inner face
      // (Y=2400-t≈2399.25). The last 50mm (z=2348-2398) is swaged.
      // Position offset by -lf/2 = -20.5 in world X so the stud's
      // CENTRELINE (not its web back) sits on the joint axis at X=0.
      // Without this offset the stud was offset to one side of the
      // plate's LipNotch and the stud's flange tip clipped through the
      // plate's intact lip on the other side. (Bug fix 2026-05-09.)
      {
        profile: PROFILE_70S41,
        length: 2398,
        position: [-20.5, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Stud (S)",
        ops: [
          // Swage compresses the top 50mm so it fits inside plate cavity
          { type: "Swage", spanStart: 2348, spanEnd: 2398 },
          // InnerDimple — locks stud into the plate's matching dimple
          { type: "InnerDimple", pos: 2378 },
        ],
      },
      // Top plate — horizontal, mouth opens DOWNWARD so the stud nests
      // inside. Position chosen so plate's web is at world Y=2400.
      // Plate length 1200 centred over the stud at world X=0.
      {
        profile: PROFILE_70S41,
        length: 1200,
        position: [-600, 2400, 0],
        rotation: ROT_HORIZONTAL_X_DOWN,
        label: "Top plate (P)",
        ops: [
          // LipNotch — cuts both lips of the plate over the stud's
          // entry width (~45mm with clearance). Stud is at plate-local
          // z=600 (world X=0).
          {
            type: "LipNotch",
            spanStart: 575,
            spanEnd: 625,
            flangeSide: "both",
          },
          // Dimple in plate's web aligns with stud's dimple for register
          { type: "InnerDimple", pos: 600 },
        ],
      },
    ],
    joints: [
      // 1× #10g screw per side at the joint (2 total, front and back).
      // Through-axis is world Z (the touching-flange direction).
      // Half-thickness = plate web/2 = 35mm + plate flange thickness.
      {
        position: [0, 2380, 0],
        axis: [0, 0, 1],
        spanAxis: [0, 1, 0],
        halfThickness: 35,
        screwsPerSide: 1,
        label: "stud-to-top-plate",
      },
    ],
    // Camera focuses on the joint area at the top of the stud.
    cameraTarget: [0, 2360, 0],
    cameraDistance: 380,
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
          // Dimple registers brace into plate's matching dimple
          { type: "InnerDimple", pos: 1780 },
        ],
      },
      // Plate — horizontal, mouth opens DOWNWARD. Plate's web positioned
      // just above brace's tip so the brace's swaged section nests fully
      // inside the cavity. Brace tip Y = 1800·sin60° = 1559.4. Place
      // plate's web at Y = 1561. Cavity from Y = 1520 (lip-tip,
      // notched open) to Y = 1560.25 (web inner face).
      {
        profile: PROFILE_70S41,
        length: 2400,
        position: [-300, 1561, 0],
        rotation: ROT_HORIZONTAL_X_DOWN,
        label: "Top plate (P)",
        ops: [
          // Lipnotch centered where brace passes through. Brace's world
          // X position at the lip-tip Y level (Y=1520) is z=1755 along
          // brace, so world X = 1755·cos60° = 877. Plate-local z =
          // 877-(-300) = 1177. Brace's flange depth at that level
          // covers ~50mm of plate length, so span 1145-1210 = 65mm.
          {
            type: "LipNotch",
            spanStart: 1145,
            spanEnd: 1210,
            flangeSide: "both",
          },
          // Dimple at the brace's tip projection on plate
          { type: "InnerDimple", pos: 1200 },
        ],
      },
    ],
    joints: [
      {
        // Joint centre — at brace's z=1775, inside plate cavity.
        // World: 1775·cos60° = 887, 1775·sin60° = 1537. Inside cavity
        // (Y=1520 to 1560.25).
        position: [887, 1537, 0],
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
      // Kb (cripple stud) — vertical, 400mm long
      // Position offset by -lf/2 = -20.5 in world X so centreline at X=0.
      {
        profile: PROFILE_70S41,
        length: 400,
        position: [-20.5, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Cripple (Kb)",
        ops: [
          { type: "Chamfer", end: "start" },
          { type: "Swage", spanStart: 361, spanEnd: 400 },
          { type: "InnerDimple", pos: 380 },
        ],
      },
      // H header — horizontal, 2055mm long
      {
        profile: PROFILE_70S41,
        length: 2055,
        position: [-1027, 400, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Header (H)",
        ops: [
          {
            type: "LipNotch",
            spanStart: 1007,
            spanEnd: 1067,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1015 },
          { type: "InnerDimple", pos: 1057 }, // 42mm offset (paired-dimple rule)
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
          { type: "InnerDimple", pos: 578 },
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
        // Joint centre — at the web's tip inside the chord cavity
        position: [0, 580, 0],
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
          { type: "InnerDimple", pos: 578 },
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
        position: [0, 580, 0],
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
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A5",
    name: "A5 — Truss diagonal web at chord (45°)",
    description:
      "A 45° diagonal truss web meeting a chord. The web has TrussChamfers at both ends and a Swage end-cap with elongated span (cos compensation) plus an InnerDimple. The chord gets the standard LipNotch + InnerDimple at the projected meeting point.",
    sticks: [
      // Diagonal web — 45° from horizontal
      // Note: rotForXYAngle uses flangeOpen = (0,0,-1), so flange tips
      // are in world -Z. Offset by -lf/2 along that direction = (0,0,+20.5)
      // so the centreline lies in the elevation (Z=0) plane.
      {
        profile: PROFILE_70S41,
        length: 1000,
        position: [0, 0, 20.5],
        rotation: rotForXYAngle(Math.PI / 4),
        label: "Diagonal web (W)",
        ops: [
          { type: "TrussChamfer", end: "start" },
          { type: "TrussChamfer", end: "end" },
          { type: "Swage", spanStart: 945, spanEnd: 1000 },
          { type: "InnerDimple", pos: 980 },
        ],
      },
      // Chord — horizontal, sits across the top of the web's tip
      {
        profile: PROFILE_70S41,
        length: 2500,
        position: [-500, 707, 0], // 707 = 1000 × sin 45°
        rotation: ROT_HORIZONTAL_X,
        label: "Chord",
        ops: [
          // Tip lands at world (707, 707) → chord position 707 + 500 = 1207
          {
            type: "LipNotch",
            spanStart: 1180,
            spanEnd: 1240,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1207 },
        ],
      },
    ],
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
          { type: "InnerDimple", pos: 1780 },
        ],
      },
      // Top plate — horizontal, mouth opens DOWN. Plate's web at
      // Y = 1561, just above brace tip Y = 1559.4. Cavity from Y =
      // 1520 (lipnotch open) to Y = 1560.25 (web inner face).
      {
        profile: PROFILE_70S41,
        length: 2400,
        position: [-300, 1561, 0],
        rotation: ROT_HORIZONTAL_X_DOWN,
        label: "Top plate",
        ops: [
          {
            type: "LipNotch",
            spanStart: 1145,
            spanEnd: 1210,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1200 },
        ],
      },
    ],
    joints: [
      {
        position: [887, 1537, 0],
        axis: [0, 0, 1],
        spanAxis: [0, 1, 0],
        halfThickness: 35,
        screwsPerSide: 1,
        label: "wall-brace-to-plate",
      },
    ],
    cameraTarget: [880, 1540, 0],
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
];
