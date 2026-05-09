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

// Common rotations
const ROT_HORIZONTAL_X: [number, number, number] = [0, Math.PI / 2, 0]; // extrudes +X
const ROT_VERTICAL_Y: [number, number, number] = [-Math.PI / 2, 0, 0]; // extrudes +Y
const ROT_DIAGONAL_45: [number, number, number] = [-Math.PI / 4, 0, 0]; // 45° from horizontal in XY plane

// Helper: rotation for a stick at angle θ from horizontal in the XY plane,
// extrusion direction = (cos θ, sin θ, 0)
function rotForXYAngle(theta: number): [number, number, number] {
  // Start: extrusion +Z = (0,0,1)
  // Target: extrusion = (cos θ, sin θ, 0)
  // Rotate by π/2 about Y to get +X, then by θ about Z. Equivalent:
  // rotation [angleX, angleY, angleZ] → R = Rz·Ry·Rx
  // We want the final extrusion vector: Ry(π/2) sends +Z to +X; then
  // Rz(θ) sends +X to (cos θ, sin θ, 0). So [0, π/2, θ] works.
  return [0, Math.PI / 2, theta];
}

export const INTERACTIONS: InteractionConfig[] = [
  // ──────────────────────────────────────────────────────────────────
  // A1 — T-junction (orthogonal): stud meets top plate
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A1",
    name: "A1 — T-junction (orthogonal)",
    description:
      "A vertical stud meets a horizontal top plate at 90°. The stud is end-capped with a Swage + InnerDimple at its top end. The plate gets a LipNotch at the stud's centreline, plus an InnerDimple to receive the stud's dimple. This is the most common joint in HYTEK panel framing.",
    sticks: [
      // Stud — vertical, 2400mm long, starts at floor level
      {
        profile: PROFILE_70S41,
        length: 2400,
        position: [0, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Stud (S)",
        ops: [
          // Swage end-cap at top end (last 39mm of stick)
          { type: "Swage", spanStart: 2361, spanEnd: 2400 },
          // InnerDimple at fastener position (top end - 20mm)
          { type: "InnerDimple", pos: 2380 },
        ],
      },
      // Top plate — horizontal, 1200mm long, centered above the stud
      {
        profile: PROFILE_70S41,
        length: 1200,
        position: [-600, 2400, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Top plate (P)",
        ops: [
          // LipNotch centered at x=600 (where stud meets), 39mm wide
          {
            type: "LipNotch",
            spanStart: 580,
            spanEnd: 620,
            flangeSide: "both",
          },
          // InnerDimple at the centerline of the lip notch
          { type: "InnerDimple", pos: 600 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // A2 — T-junction (angled, 60° from vertical)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A2",
    name: "A2 — T-junction (angled, 60°)",
    description:
      "An angled brace meeting a horizontal plate at 60° from vertical. The brace gets a Chamfer at its end (so it sits flush on the plate) plus an elongated Swage end-cap and InnerDimple. The plate gets the same LipNotch + InnerDimple as the orthogonal case.",
    sticks: [
      // Brace — at 60° from vertical (= 30° from horizontal)
      {
        profile: PROFILE_70S41,
        length: 1500,
        position: [0, 0, 0],
        rotation: rotForXYAngle((Math.PI / 180) * 30),
        label: "Brace (B)",
        ops: [
          { type: "Chamfer", end: "end" },
          { type: "Swage", spanStart: 1440, spanEnd: 1500 },
          { type: "InnerDimple", pos: 1480 },
        ],
      },
      // Plate — horizontal, runs along +X starting from -300
      {
        profile: PROFILE_70S41,
        length: 2200,
        position: [-300, 1300, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Plate",
        ops: [
          {
            type: "LipNotch",
            spanStart: 1280,
            spanEnd: 1330,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1305 },
        ],
      },
    ],
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
      {
        profile: PROFILE_70S41,
        length: 400,
        position: [0, 0, 0],
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
  // A4 — Truss vertical web at chord
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A4",
    name: "A4 — Truss vertical web at chord",
    description:
      "A vertical truss web meets a horizontal chord at 90°. The web has TrussChamfers at both ends (so it sits cleanly between top and bottom chords). The chord gets a LipNotch + InnerDimple at the web's centreline.",
    sticks: [
      // Truss web — vertical, 600mm
      {
        profile: PROFILE_70S41,
        length: 600,
        position: [0, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Web (W)",
        ops: [
          { type: "TrussChamfer", end: "start" },
          { type: "TrussChamfer", end: "end" },
        ],
      },
      // Chord — horizontal
      {
        profile: PROFILE_70S41,
        length: 2000,
        position: [-1000, 600, 0],
        rotation: ROT_HORIZONTAL_X,
        label: "Chord",
        ops: [
          {
            type: "LipNotch",
            spanStart: 980,
            spanEnd: 1020,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1000 },
        ],
      },
    ],
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
      {
        profile: PROFILE_70S41,
        length: 1000,
        position: [0, 0, 0],
        rotation: rotForXYAngle(Math.PI / 4),
        label: "Diagonal web (W)",
        ops: [
          { type: "TrussChamfer", end: "start" },
          { type: "TrussChamfer", end: "end" },
          { type: "Swage", spanStart: 945, spanEnd: 1000 },
          { type: "InnerDimple", pos: 980 },
        ],
      },
      // Chord — horizontal, sits across the top
      {
        profile: PROFILE_70S41,
        length: 2500,
        position: [-500, 707, 0], // 707 = 1000 × sin 45°
        rotation: ROT_HORIZONTAL_X,
        label: "Chord",
        ops: [
          {
            type: "LipNotch",
            spanStart: 1180,
            spanEnd: 1240,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1210 },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // A6 — Wall W-brace at plate (≥28°)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "A6",
    name: "A6 — Wall W-brace at plate (≥28°)",
    description:
      "A wall W-brace at 30° from vertical meeting a sole/top plate. The brace gets a Chamfer (smaller wedge than TrussChamfer — wall version) plus a 41mm Swage and an InnerDimple at 10mm from the cut end. Plate gets the standard LipNotch + InnerDimple.",
    sticks: [
      // Wall W-brace at 30° from vertical (60° from horizontal)
      {
        profile: PROFILE_70S41,
        length: 1800,
        position: [0, 0, 0],
        rotation: rotForXYAngle((Math.PI / 180) * 60),
        label: "Wall brace (W)",
        ops: [
          { type: "Chamfer", end: "start" },
          { type: "Chamfer", end: "end" },
          { type: "Swage", spanStart: 1759, spanEnd: 1800 },
          { type: "InnerDimple", pos: 1790 },
        ],
      },
      // Plate — horizontal sole plate
      {
        profile: PROFILE_70S41,
        length: 2400,
        position: [-200, 1559, 0], // 1800 × sin60° = 1559
        rotation: ROT_HORIZONTAL_X,
        label: "Plate",
        ops: [
          {
            type: "LipNotch",
            spanStart: 1080,
            spanEnd: 1120,
            flangeSide: "both",
          },
          { type: "InnerDimple", pos: 1100 },
        ],
      },
    ],
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
  // D2 — B2B partner pair (KEY visual — sticks face each other)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "D2",
    name: "D2 — B2B partner pair (back-to-back, flange-on-flange)",
    description:
      "Two studs paired flange-on-flange — webs facing OUT, lips touching down the centreline. The flange directions of the two sticks are MIRRORED (one default, one flipped). Both sticks get the same Web-hole pattern: 7 holes at 447mm spacing, anchored 38mm from each end, for the through-bolts that connect the pair. This is the signature 'partner pair' construction.",
    sticks: [
      // Stud A — webs facing -Z (default flangeDir), positioned at z = -45
      {
        profile: PROFILE_70S41,
        length: 2700,
        position: [0, 0, -45],
        rotation: ROT_VERTICAL_Y,
        label: "Stud A (front)",
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
      // Stud B — flange direction flipped, positioned at z = +45
      {
        profile: PROFILE_70S41,
        length: 2700,
        position: [0, 0, 45],
        rotation: ROT_VERTICAL_Y,
        flangeDir: "flipped",
        label: "Stud B (back)",
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
  // D3 — Side-by-side double stud (web-on-web)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "D3",
    name: "D3 — Side-by-side double stud (web-on-web)",
    description:
      "The other 'double stud' configuration — webs touching, flanges OUT to opposite sides. Same 7-hole web pattern as D2 but the visual layout is dramatically different: the bolt line is on the shared web seam rather than between the inner faces of two opposing C-sections.",
    sticks: [
      // Stud A — web back at x=0, normal orientation
      {
        profile: PROFILE_70S41,
        length: 2700,
        position: [0, 0, 0],
        rotation: ROT_VERTICAL_Y,
        label: "Stud A (left flange-out)",
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
      // Stud B — web back at x=0 too but flipped flange so flanges open the OTHER way
      // Their webs touch at x=0 (z = some offset to avoid coplanar mesh)
      {
        profile: PROFILE_70S41,
        length: 2700,
        position: [-1.5, 0, 0],
        rotation: ROT_VERTICAL_Y,
        flangeDir: "flipped",
        label: "Stud B (right flange-out)",
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
