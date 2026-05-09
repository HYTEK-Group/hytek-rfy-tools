// JointHardware — fasteners (#10 screws) + reinforcing connector plates
// rendered at the points where sticks meet, per the HYTEK FrameCAD
// "Use 1×10g screws for all connections" standard.
//
// A "joint" lives in WORLD space. Screws are short dark cylinders driven
// perpendicular to the touching flanges. Connector plates are flat
// rectangular sheets sandwiching the joint on both sides of the truss/
// wall plane.

"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { JointConfig } from "../data/types";

interface JointHardwareProps {
  joint: JointConfig;
}

/** Length of a #10g screw (visual approximation). */
const SCREW_LENGTH = 22;
/** Diameter of a #10g screw shank (≈4.8mm) — slightly enlarged for visibility. */
const SCREW_DIAMETER = 4.6;
/** Connector plate thickness (mm). 1mm BMT galv plate per FrameCAD. */
const PLATE_THICKNESS = 1.0;

export function JointHardware({ joint }: JointHardwareProps) {
  const {
    position,
    axis,
    spanAxis,
    halfThickness,
    screwsPerSide,
    screwSpacing = 18,
    connectorPlate = false,
    plateSize = [150, 80],
  } = joint;

  // Compute orthonormal frame at the joint:
  //   nAxis: through-axis (screw direction, plate normal)
  //   nSpan: along-stick-length axis (screws spaced this way)
  //   nUp:   the third axis, perpendicular to both — used as plate's
  //          short dimension and the "second screw row" axis when
  //          screwsPerSide >= 4.
  const { nAxis, nSpan, nUp } = useMemo(() => {
    const a = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
    const s = new THREE.Vector3(spanAxis[0], spanAxis[1], spanAxis[2]).normalize();
    // Re-orthogonalise span against axis
    const sProj = s.clone().sub(a.clone().multiplyScalar(s.dot(a))).normalize();
    const u = new THREE.Vector3().crossVectors(a, sProj).normalize();
    return { nAxis: a, nSpan: sProj, nUp: u };
  }, [axis, spanAxis]);

  // Compute screw positions per side. For screwsPerSide:
  //   1 → centred at joint position
  //   2 → spaced ±screwSpacing/2 along spanAxis
  //   4 → 2×2 grid (spanAxis × upAxis)
  //   6 → 3×2 grid
  //   8+ → 4×2 grid
  const screwOffsets = useMemo(() => {
    const offsets: Array<[number, number]> = []; // [spanOffset, upOffset]
    const n = screwsPerSide;
    if (n === 1) {
      offsets.push([0, 0]);
    } else if (n === 2) {
      const half = screwSpacing / 2;
      offsets.push([-half, 0]);
      offsets.push([+half, 0]);
    } else if (n === 4) {
      const halfS = screwSpacing / 2;
      const halfU = screwSpacing / 2;
      offsets.push([-halfS, -halfU]);
      offsets.push([+halfS, -halfU]);
      offsets.push([-halfS, +halfU]);
      offsets.push([+halfS, +halfU]);
    } else {
      // Generic n×2 grid
      const cols = Math.ceil(n / 2);
      const startS = -((cols - 1) * screwSpacing) / 2;
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < cols; col++) {
          if (offsets.length >= n) break;
          offsets.push([
            startS + col * screwSpacing,
            (row === 0 ? -1 : +1) * (screwSpacing / 2),
          ]);
        }
      }
    }
    return offsets;
  }, [screwsPerSide, screwSpacing]);

  // Quaternions for the two screw orientations (one per side). A default
  // cylinder is axis-aligned with +Y; we rotate it so its +Y axis points
  // INWARD (toward joint centre). For the +nAxis side, +Y → -nAxis. For
  // the -nAxis side, +Y → +nAxis. This makes the screw HEAD (at +Y end
  // of the cylinder) sit on the OUTSIDE of the joint and the TIP (at -Y
  // end) sit INSIDE.
  const quatPlus = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        nAxis.clone().multiplyScalar(-1),
      ),
    [nAxis],
  );
  const quatMinus = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        nAxis.clone(),
      ),
    [nAxis],
  );

  // Connector plate orientation — plate is rendered as a thin box. Box
  // default axes are (X, Y, Z); we want X→span, Y→up, Z→axis. Build a
  // basis matrix.
  const plateMatrix = useMemo(
    () => new THREE.Matrix4().makeBasis(nSpan, nUp, nAxis),
    [nSpan, nUp, nAxis],
  );

  // Where the screw cylinder's CENTRE should sit. We want the head-end
  // (cylinder's +Y end after orientation) to be at the OUTSIDE of the
  // joint material, with the cylinder extending INWARD by SCREW_LENGTH.
  //
  // Head position (on outside): joint.position + side * (halfThickness +
  // platePresenceOffset + smallProud) along nAxis
  // Cylinder centre = head - SCREW_LENGTH/2 along (head→tip direction)
  // Head→tip direction = -side along nAxis (pointing inward)
  // So centre = head + side * SCREW_LENGTH/2 along nAxis
  //           = joint.position + side * (halfThickness + offset + SCREW_LENGTH/2 - small) along nAxis
  //
  // Effective offset (from joint.position along nAxis, signed by side):
  const platePresence = connectorPlate ? PLATE_THICKNESS : 0;
  const headOuter = halfThickness + platePresence + 0.5; // small "stand-proud" of head
  // We want head-end at headOuter, tip-end at headOuter - SCREW_LENGTH.
  // Cylinder centre at midpoint = headOuter - SCREW_LENGTH / 2.
  const cylCenterOffset = headOuter - SCREW_LENGTH / 2;

  const screws: Array<{
    pos: [number, number, number];
    quat: THREE.Quaternion;
  }> = [];
  for (const [spanOff, upOff] of screwOffsets) {
    for (const side of [-1, +1] as const) {
      const v = new THREE.Vector3(position[0], position[1], position[2]);
      v.add(nAxis.clone().multiplyScalar(side * cylCenterOffset));
      v.add(nSpan.clone().multiplyScalar(spanOff));
      v.add(nUp.clone().multiplyScalar(upOff));
      screws.push({
        pos: [v.x, v.y, v.z],
        quat: side === +1 ? quatPlus : quatMinus,
      });
    }
  }

  return (
    <group>
      {/* Reinforcing plates — TWO, one each side of the joint. */}
      {connectorPlate && (
        <>
          {[-1, +1].map((side) => {
            // Plate sits BETWEEN the joint material and the screw head,
            // i.e. just outside the receiving stick's outer flange.
            // For now we place the plate on the outside of halfThickness,
            // gauged by the plate's thickness so its outer face is at
            // halfThickness + PLATE_THICKNESS / 2.
            const offset = side * (halfThickness + PLATE_THICKNESS / 2);
            const center = new THREE.Vector3(
              position[0],
              position[1],
              position[2],
            ).add(nAxis.clone().multiplyScalar(offset));
            return (
              <mesh
                key={`plate-${side}`}
                position={[center.x, center.y, center.z]}
                rotation={
                  new THREE.Euler().setFromRotationMatrix(plateMatrix)
                }
                castShadow
                receiveShadow
              >
                <boxGeometry args={[plateSize[0], plateSize[1], PLATE_THICKNESS]} />
                <meshStandardMaterial
                  color="#a0a0a8"
                  metalness={0.6}
                  roughness={0.5}
                />
              </mesh>
            );
          })}
        </>
      )}

      {/* Screws — small dark cylinders perpendicular to the touching flanges. */}
      {screws.map((s, i) => (
        <ScrewMesh key={i} pos={s.pos} quat={s.quat} />
      ))}
    </group>
  );
}

/** Render a single #10g screw as a small dark cylinder + a flat hex-head disc. */
function ScrewMesh({
  pos,
  quat,
}: {
  pos: [number, number, number];
  quat: THREE.Quaternion;
}) {
  const euler = useMemo(() => new THREE.Euler().setFromQuaternion(quat), [quat]);

  return (
    <group position={pos} rotation={euler}>
      {/* Shank (cylinder along +Y) */}
      <mesh castShadow>
        <cylinderGeometry
          args={[SCREW_DIAMETER / 2, SCREW_DIAMETER / 2, SCREW_LENGTH, 12]}
        />
        <meshStandardMaterial
          color="#15151a"
          metalness={0.7}
          roughness={0.4}
        />
      </mesh>
      {/* Hex head — slightly larger flat cylinder at the +Y end */}
      <mesh position={[0, SCREW_LENGTH / 2 + 0.5, 0]} castShadow>
        <cylinderGeometry
          args={[SCREW_DIAMETER * 0.85, SCREW_DIAMETER * 0.85, 1.5, 6]}
        />
        <meshStandardMaterial
          color="#1f1f24"
          metalness={0.65}
          roughness={0.45}
        />
      </mesh>
    </group>
  );
}
