// Geometry helpers for the interactions gallery.
//
// These helpers build a stick mesh as a SEGMENTED extrusion: the stick's
// length axis is divided into intervals based on where each spanned op
// fires, and each interval gets its own profile shape. Then the segments
// are concatenated into a single BufferGeometry.
//
// This lets us render REAL CUTS into the steel:
//   - LipNotch: segments inside the span use a profile WITHOUT the affected lip
//   - Swage: segments inside the span use a profile with the web pressed inward
//   - InnerNotch: segments inside the span use a profile WITHOUT the web entirely (open C)
//
// For Chamfer / TrussChamfer, we post-process the END vertices of the
// extrusion to bevel a corner off the stick's tip. Done by manipulating
// the front-cap (or back-cap) face of the geometry.

import * as THREE from "three";
import type { RfyProfile } from "@hytek/rfy-codec";
import type { OpConfig } from "../data/types";

/**
 * 2D profile point. The profile is in the XY plane; the extrusion runs
 * along +Z. (Different from app/viewer — there the extrusion was set up
 * via THREE.Shape extending into +Z, here we use the same convention.)
 */
export interface Point2 {
  x: number;
  y: number;
}

/**
 * Build the standard outer perimeter of a HYTEK C-section profile, with
 * optional modifications for cut/pressed segments.
 *
 * Same path as app/viewer/lib/profile-extrude.ts but extended with
 * modifier flags. Outer perimeter is traced anti-clockwise looking down
 * +z (so face normals point outwards via THREE's right-hand rule).
 *
 * Profile axes (cross-section):
 *   x: 0 at web back, +x = flange depth (out toward lips)
 *   y: 0 at web midpoint, +y up to top lip, −y down to bottom lip
 */
export function buildProfileShape(
  profile: RfyProfile,
  options: {
    /** Drop the upper (+y) lip — used inside LipNotch (top) span. */
    dropTopLip?: boolean;
    /** Drop the lower (−y) lip — used inside LipNotch (bottom) span. */
    dropBottomLip?: boolean;
    /** Press web inward — used inside Swage span. mm of inward press. */
    swagePress?: number;
    /** Remove the web entirely — used inside InnerNotch span. */
    notchWeb?: boolean;
  } = {},
): Point2[] {
  const w = profile.web;
  const lf = profile.lFlange;
  const rf = profile.rFlange;
  const lip = profile.lip || 12;
  const t = Math.max(0.4, parseFloat(profile.gauge) || 0.75);

  const yTop = +w / 2;
  const yBot = -w / 2;

  // For Swage: webX is the X-coord of the web back face. Normally 0;
  // when pressed, we push it INWARD (positive x, toward the flange-open
  // side) by `swagePress` mm.
  const webX = options.swagePress ?? 0;

  // If the web is fully notched out, we render an open profile — just
  // the two flanges as separate strokes. Easier to model as two thin
  // rectangles than a single closed shape. For simplicity we DO close
  // the shape but with a very narrow "hairline" connection across the
  // web midpoint that sits beneath the flange thickness — visually the
  // notch reads as an open mouth.
  if (options.notchWeb) {
    return [
      { x: webX, y: yBot },
      { x: rf, y: yBot },
      { x: rf, y: yBot + lip },
      { x: rf - t, y: yBot + lip },
      { x: rf - t, y: yBot + t },
      { x: webX + t, y: yBot + t }, // bottom flange inner end at web side
      { x: webX + t, y: -1.5 }, // dive in
      { x: webX, y: -1.5 }, // small notch into web
      { x: webX, y: 1.5 },
      { x: webX + t, y: 1.5 },
      { x: webX + t, y: yTop - t },
      { x: lf - t, y: yTop - t },
      { x: lf - t, y: yTop - lip },
      { x: lf, y: yTop - lip },
      { x: lf, y: yTop },
      { x: webX, y: yTop },
    ];
  }

  // For LipNotch: drop the lip on the affected flange. The flange end
  // becomes a flat termination instead of an inward turn.
  const points: Point2[] = [];
  points.push({ x: webX, y: yBot });
  points.push({ x: rf, y: yBot });

  if (options.dropBottomLip) {
    // No lip — just go up the inside of the flange directly.
    points.push({ x: rf, y: yBot + t });
    points.push({ x: webX + t, y: yBot + t });
  } else {
    points.push({ x: rf, y: yBot + lip });
    points.push({ x: rf - t, y: yBot + lip });
    points.push({ x: rf - t, y: yBot + t });
    points.push({ x: webX + t, y: yBot + t });
  }

  points.push({ x: webX + t, y: yTop - t });

  if (options.dropTopLip) {
    points.push({ x: lf, y: yTop - t });
    points.push({ x: lf, y: yTop });
  } else {
    points.push({ x: lf - t, y: yTop - t });
    points.push({ x: lf - t, y: yTop - lip });
    points.push({ x: lf, y: yTop - lip });
    points.push({ x: lf, y: yTop });
  }

  points.push({ x: webX, y: yTop });

  return points;
}

/**
 * One segment of a segmented stick — a slice along the stick's length
 * with a particular profile shape.
 */
export interface StickSegment {
  /** Start of the segment (mm along stick length). */
  zStart: number;
  /** End of the segment (mm along stick length). */
  zEnd: number;
  /** 2D profile path. */
  profile: Point2[];
}

/**
 * Compute the segments needed to render a stick with all of its spanned
 * cut ops baked into the geometry.
 *
 * Algorithm:
 *   1. Collect all "split points" — the spanStart and spanEnd of each
 *      cut/press op (LipNotch, Swage, InnerNotch).
 *   2. Sort + dedupe to form the segment boundaries.
 *   3. For each segment, compute the profile by checking which spans
 *      cover the segment's midpoint.
 */
export function computeStickSegments(
  profile: RfyProfile,
  length: number,
  ops: OpConfig[],
): StickSegment[] {
  const splitPoints = new Set<number>();
  splitPoints.add(0);
  splitPoints.add(length);

  for (const op of ops) {
    if (op.type === "LipNotch" || op.type === "Swage" || op.type === "InnerNotch") {
      // Clamp to stick range
      splitPoints.add(Math.max(0, Math.min(length, op.spanStart)));
      splitPoints.add(Math.max(0, Math.min(length, op.spanEnd)));
    }
  }

  const sorted = [...splitPoints].sort((a, b) => a - b);
  const segments: StickSegment[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const zStart = sorted[i]!;
    const zEnd = sorted[i + 1]!;
    if (zEnd - zStart < 0.01) continue; // skip degenerate

    const mid = (zStart + zEnd) / 2;

    // Determine which mods apply at this z-midpoint
    let dropTop = false;
    let dropBottom = false;
    let swagePress = 0;
    let notchWeb = false;

    for (const op of ops) {
      if (op.type === "LipNotch" && mid >= op.spanStart && mid <= op.spanEnd) {
        if (op.flangeSide === "top" || op.flangeSide === "both") dropTop = true;
        if (op.flangeSide === "bottom" || op.flangeSide === "both") dropBottom = true;
      }
      if (op.type === "Swage" && mid >= op.spanStart && mid <= op.spanEnd) {
        swagePress = 5; // 5mm press (visible but not exaggerated)
      }
      if (op.type === "InnerNotch" && mid >= op.spanStart && mid <= op.spanEnd) {
        notchWeb = true;
      }
    }

    segments.push({
      zStart,
      zEnd,
      profile: buildProfileShape(profile, {
        dropTopLip: dropTop,
        dropBottomLip: dropBottom,
        swagePress,
        notchWeb,
      }),
    });
  }

  return segments;
}

/**
 * Build a single BufferGeometry by extruding each segment's profile
 * along its z-range and concatenating into one mesh.
 *
 * For each segment we generate:
 *   - Side walls (one quad per profile edge × the segment's z-extent)
 *   - Front + back caps (closed polygon at zStart and zEnd)
 *
 * To keep the mesh closed, only the FIRST segment gets a front cap and
 * only the LAST segment gets a back cap. Internal segment boundaries
 * are joined directly (sides only) — but if profiles change shape, we
 * also need a "transition cap" that bridges the two profiles. We handle
 * this by adding both sides' caps at the boundary, so the user sees
 * the cut/notch as actual depth.
 */
export function buildSegmentedStickGeometry(
  segments: StickSegment[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // For each segment, push side walls + caps where needed.
  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx]!;
    const isFirst = segIdx === 0;
    const isLast = segIdx === segments.length - 1;
    const prevSeg = segIdx > 0 ? segments[segIdx - 1]! : null;
    const nextSeg = segIdx < segments.length - 1 ? segments[segIdx + 1]! : null;

    // Side walls — one quad per edge of the profile polygon
    pushSideWalls(positions, normals, indices, seg.profile, seg.zStart, seg.zEnd);

    // Front cap (zStart) — push if this is the first segment OR if the
    // previous segment had a different profile (so the cut is visible).
    if (isFirst || (prevSeg && !profilesEqual(prevSeg.profile, seg.profile))) {
      // Front cap normal points -Z (away from extrusion direction)
      pushCap(positions, normals, indices, seg.profile, seg.zStart, /*facingPositiveZ=*/ false);
    }

    // Back cap (zEnd) — push if last OR profile changes
    if (isLast || (nextSeg && !profilesEqual(nextSeg.profile, seg.profile))) {
      pushCap(positions, normals, indices, seg.profile, seg.zEnd, /*facingPositiveZ=*/ true);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

function profilesEqual(a: Point2[], b: Point2[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]!.x - b[i]!.x) > 0.01) return false;
    if (Math.abs(a[i]!.y - b[i]!.y) > 0.01) return false;
  }
  return true;
}

/**
 * Push side walls for a segment. Each profile edge becomes a quad.
 * Quads are split into 2 triangles each.
 *
 * Profile points are anti-clockwise (looking down +Z), so the right-hand
 * rule gives outward-pointing normals when we wind:
 *   triangle 1: (i, i+1, i+1_top)
 *   triangle 2: (i, i+1_top, i_top)
 * where _top means the same x,y but at zEnd.
 */
function pushSideWalls(
  positions: number[],
  normals: number[],
  indices: number[],
  profile: Point2[],
  zStart: number,
  zEnd: number,
): void {
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const p1 = profile[i]!;
    const p2 = profile[(i + 1) % n]!;
    // Skip degenerate edges
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.01) continue;

    // Normal — perpendicular to edge in the XY plane, pointing OUTWARDS.
    // Outward = right-hand rule with anti-clockwise winding.
    // For an anti-clockwise polygon, the outward normal of edge (p1→p2)
    // is (dy, -dx) NORMALISED.
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len;
    const ny = -dx / len;
    const nz = 0;

    // 4 vertices of the quad
    const baseIdx = positions.length / 3;
    positions.push(p1.x, p1.y, zStart);
    positions.push(p2.x, p2.y, zStart);
    positions.push(p2.x, p2.y, zEnd);
    positions.push(p1.x, p1.y, zEnd);
    for (let k = 0; k < 4; k++) normals.push(nx, ny, nz);

    // Two triangles
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
  }
}

/**
 * Push a cap (front or back) for a segment.
 *
 * Triangulates the profile polygon using THREE.ShapeUtils.triangulateShape.
 * If facingPositiveZ, normal is +Z and winding is reversed.
 */
function pushCap(
  positions: number[],
  normals: number[],
  indices: number[],
  profile: Point2[],
  z: number,
  facingPositiveZ: boolean,
): void {
  // Triangulate using THREE.ShapeUtils
  // ShapeUtils.triangulateShape needs an array of THREE.Vector2 as the
  // first arg and a list of holes as the second. Here we have no holes.
  const contour = profile.map((p) => new THREE.Vector2(p.x, p.y));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);

  const baseIdx = positions.length / 3;
  for (const p of profile) {
    positions.push(p.x, p.y, z);
    normals.push(0, 0, facingPositiveZ ? 1 : -1);
  }

  for (const tri of triangles) {
    const a = tri[0]!;
    const b = tri[1]!;
    const c = tri[2]!;
    if (facingPositiveZ) {
      indices.push(baseIdx + a, baseIdx + b, baseIdx + c);
    } else {
      // Reverse winding so normal faces -Z
      indices.push(baseIdx + a, baseIdx + c, baseIdx + b);
    }
  }
}

/**
 * Apply a chamfer to one end of a segmented geometry.
 *
 * Approach: after building the geometry, find vertices near the end face
 * (z ≈ zEnd or z ≈ 0) and at the LIP CORNER (max +x, max +y) and pull
 * them back along Z by `chamferDepth` mm. This bevels the corner.
 *
 * We simplify by NOT modifying the existing geometry — instead, we add
 * an extra "chamfer slice" via the segments approach by trimming the
 * profile near the end. Easier and cleaner.
 *
 * For our purposes, we'll handle Chamfer via a different mechanism:
 * after the segmented mesh is built, we add a separate small "wedge"
 * mesh of dark material that visually "fills" the chamfered area.
 * That keeps the geometry simple and the visual reads as a beveled
 * corner. See createChamferOverlay below.
 */

/**
 * Build a small wedge mesh that visually represents a chamfer cut on
 * one end of a stick. Returns a BufferGeometry positioned in the stick's
 * local frame.
 *
 * The wedge sits in the +x +y corner (where the upper lip meets the
 * stick end) — this is the typical Chamfer location for a Kb / W brace
 * meeting a plate.
 */
export function buildChamferWedge(
  profile: RfyProfile,
  z: number,
  end: "start" | "end",
  size: "regular" | "truss",
): THREE.BufferGeometry {
  const lf = profile.lFlange;
  const lip = profile.lip || 12;
  const w = profile.web;
  const yTop = w / 2;

  // Chamfer dimensions
  const wedgeLen = size === "truss" ? 35 : 20; // along stick length
  const wedgeHeight = size === "truss" ? 25 : 15; // depth into the flange

  // Direction along z — if 'start', the wedge cuts INTO +z; if 'end', cuts INTO -z.
  const zDir = end === "start" ? 1 : -1;

  // The wedge is a triangular prism placed at the lip corner, occupying
  // the volume that the chamfer "removes". We render it as a DARK mesh
  // (visually distinct from the stick) so the user reads it as a cut.
  //
  // Triangle shape (in the XY plane, at z, then extruded along Z by 0.5
  // to give it a tiny thickness):
  //   - point A: (lf, yTop, z)
  //   - point B: (lf - wedgeHeight, yTop, z)
  //   - point C: (lf, yTop - wedgeHeight, z)
  //
  // Then extruded to (z + zDir * wedgeLen) ... but actually, the wedge
  // is a CORNER cut, so it goes from z=z to z=z+zDir*wedgeLen, with the
  // triangle shrinking linearly to a point. So it's a tetrahedron:
  //   - apex at (lf, yTop, z + zDir*wedgeLen) — the deepest point of the cut
  //   - base 1 at (lf, yTop, z) — corner of the stick at the end face
  //   - base 2 at (lf - wedgeHeight, yTop, z) — slid inward along x at end face
  //   - base 3 at (lf, yTop - wedgeHeight, z) — slid down along y at end face
  //
  // Actually, simpler model: a triangular wedge prism, lying along the
  // +x flange depth direction, that occupies the chamfered volume.

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // 3 vertices at the BASE (z = z), 3 at the APEX (z = z + zDir*wedgeLen)
  // forming a triangular prism.
  // Base triangle (cuts into the +y +x corner of the stick):
  const v0 = [lf, yTop, z]; // outermost corner
  const v1 = [lf - wedgeHeight, yTop, z]; // along -x
  const v2 = [lf, yTop - wedgeHeight, z]; // along -y

  const apexZ = z + zDir * wedgeLen;
  const v3 = [lf, yTop, apexZ];
  const v4 = [lf - wedgeHeight, yTop, apexZ];
  const v5 = [lf, yTop - wedgeHeight, apexZ];

  positions.push(...v0, ...v1, ...v2, ...v3, ...v4, ...v5);
  for (let i = 0; i < 6; i++) normals.push(0, 0, 0); // placeholder; computeVertexNormals later

  // Triangulate the prism
  // Base (z = z, facing -zDir)
  if (zDir > 0) {
    indices.push(0, 2, 1);
  } else {
    indices.push(0, 1, 2);
  }
  // Top (z = apexZ, facing +zDir)
  if (zDir > 0) {
    indices.push(3, 4, 5);
  } else {
    indices.push(3, 5, 4);
  }
  // Sides — three quads
  // 0-1 / 3-4
  indices.push(0, 1, 4);
  indices.push(0, 4, 3);
  // 1-2 / 4-5
  indices.push(1, 2, 5);
  indices.push(1, 5, 4);
  // 2-0 / 5-3
  indices.push(2, 0, 3);
  indices.push(2, 3, 5);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}
