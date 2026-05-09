// Stick3DOps — render a SINGLE stick with its tool operations cut /
// embossed / notched into the geometry.
//
// Approach:
//   1. Compute segmented profile shapes via geometry-helpers — spanned
//      cut ops (LipNotch / Swage / InnerNotch) bake straight into the
//      mesh as profile changes per z-segment.
//   2. Build a single segmented BufferGeometry from those segments.
//   3. Layer on small overlay meshes for point-ops (Dimple / Web /
//      Bolt / InnerService / ScrewHoles) — embossed cones for dimples,
//      dark cylinders for holes.
//   4. Layer on chamfer wedges (dark mesh) at stick ends if Chamfer or
//      TrussChamfer ops are present.
//
// The whole thing is wrapped in a <group> at the stick's world position
// + rotation so the caller can orient the stick however they want.

"use client";
import { useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { StickConfig, OpConfig } from "../data/types";
import {
  buildProfileShape,
  computeStickSegments,
  buildSegmentedStickGeometry,
  buildChamferWedge,
} from "./geometry-helpers";

interface Stick3DOpsProps {
  config: StickConfig;
}

export function Stick3DOps({ config }: Stick3DOpsProps) {
  const { profile, length, position, rotation, ops } = config;

  // ─── 1. Segmented stick geometry ────────────────────────────────────
  // For a flange-flipped stick (B2B partner pair second member), we
  // build the geometry from a profile mirrored about its Y axis (negate
  // X coords), then REVERSE the winding so face normals stay outward.
  const flipped = config.flangeDir === "flipped";
  const stickGeometry = useMemo(() => {
    let segments = computeStickSegments(profile, length, ops);
    if (flipped) {
      // Mirror each profile's points about x=0; reverse the winding.
      segments = segments.map((seg) => ({
        ...seg,
        profile: [...seg.profile].reverse().map((p) => ({ x: -p.x, y: p.y })),
      }));
    }
    const geom = buildSegmentedStickGeometry(segments);
    geom.computeVertexNormals();
    return geom;
  }, [profile, length, ops, flipped]);

  // ─── 2. Per-op overlay meshes ───────────────────────────────────────
  // Each overlay is positioned in the stick's LOCAL frame (z = along
  // length, x = flange depth, y = web height). The parent <group> handles
  // world transformation.

  const overlays = useMemo(() => buildOverlayMeshes(profile, ops, length), [profile, ops, length]);

  // Edge geometry — gives a thin black outline on every sharp edge of
  // the stick, making the C-section profile + cut boundaries readable
  // at any zoom level. Without this, the steel reads as a shaded blob.
  const edgesGeometry = useMemo(() => {
    return new THREE.EdgesGeometry(stickGeometry, 30); // 30° threshold
  }, [stickGeometry]);

  return (
    <group position={position} rotation={rotation}>
      {/* Stick mesh — geometry is already pre-mirrored if flipped.
          Slightly brighter tone (#c8c8cc instead of #a8a8b0) and a touch
          less metalness so the steel shows up clearly under the gallery
          lighting and reads as worked galv steel rather than chrome. */}
      <mesh geometry={stickGeometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={config.tint ?? "#c0c0c8"}
          metalness={0.55}
          roughness={0.45}
        />
      </mesh>
      {/* Edge outlines — thin dark lines over every detected sharp edge.
          Makes the C-section profile + LipNotch / Swage / InnerNotch
          boundaries visible from any angle. */}
      <lineSegments geometry={edgesGeometry}>
        <lineBasicMaterial color="#202024" linewidth={1} />
      </lineSegments>
      {/* Overlays — wrapped in a group with scale flip for flipped sticks
          so overlay positions (e.g. innerWebX) move to the mirrored side. */}
      <group scale={flipped ? [-1, 1, 1] : [1, 1, 1]}>
        {overlays}
      </group>
    </group>
  );
}

/**
 * Build the array of overlay <mesh> elements for a stick's point-ops.
 *
 * Each overlay is positioned in stick-local coordinates:
 *   z: along the stick length (0 = start)
 *   x: flange depth direction (0 = web back, +x toward flange opening)
 *   y: web height (-w/2 to +w/2)
 *
 * Inner-web ops (dimple, web bolt, service, etc.) sit on the WEB INNER
 * face — that's at x = t (wall thickness, ~0.75mm) since the web back
 * is at x=0 and the inner face is `t` inward. We snap them to x = 0.5
 * to avoid z-fighting with the inner web face.
 *
 * Lip ops would sit on the lip surfaces but most lip operations are
 * spanned cuts that already bake into the profile.
 */
function buildOverlayMeshes(
  profile: { web: number; lFlange: number; rFlange: number; lip: number; gauge: string; metricLabel: string; shape: string },
  ops: OpConfig[],
  length: number,
): ReactElement[] {
  const elements: ReactElement[] = [];
  const t = Math.max(0.4, parseFloat(profile.gauge) || 0.75);
  // Inner-web face position (web-side, at x = t)
  const innerWebX = t + 0.1;

  ops.forEach((op, idx) => {
    const key = `${op.type}-${idx}`;
    switch (op.type) {
      case "InnerDimple":
        elements.push(<DimpleMesh key={key} pos={op.pos} innerWebX={innerWebX} />);
        break;

      case "Web":
        elements.push(
          <WebHoleMesh
            key={key}
            pos={op.pos}
            diameter={op.diameter}
            webX={innerWebX}
          />,
        );
        break;

      case "Bolt":
        elements.push(
          <BoltHoleMesh
            key={key}
            pos={op.pos}
            diameter={op.diameter}
            webX={innerWebX}
          />,
        );
        break;

      case "InnerService":
        elements.push(
          <ServiceSlotMesh
            key={key}
            pos={op.pos}
            diameter={op.diameter}
            innerWebX={innerWebX}
          />,
        );
        break;

      case "ScrewHoles":
        for (let i = 0; i < op.pattern.length; i++) {
          const offset = op.pattern[i]!;
          elements.push(
            <ScrewHoleMesh
              key={`${key}-${i}`}
              pos={op.pos + offset}
              webX={innerWebX}
            />,
          );
        }
        break;

      case "Chamfer":
      case "TrussChamfer": {
        // Chamfer wedge: a small dark filled-in volume sitting in the
        // corner where the stick's lip meets its end face. Rendered as
        // VERY DARK steel (almost black) so it reads as "this corner is
        // cut away" rather than as added geometry.
        const z = op.end === "start" ? 0 : length;
        const wedgeGeom = buildChamferWedge(
          profile as never,
          z,
          op.end,
          op.type === "TrussChamfer" ? "truss" : "regular",
        );
        elements.push(
          <mesh key={key} geometry={wedgeGeom} castShadow receiveShadow>
            <meshStandardMaterial
              color="#0d0d0d"
              metalness={0.2}
              roughness={0.95}
              emissive="#000000"
            />
          </mesh>,
        );
        break;
      }

      // Spanned cut/press ops are handled by the segmented mesh — no
      // overlay needed here.
      case "LipNotch":
      case "Swage":
      case "InnerNotch":
        break;
    }
  });

  return elements;
}

// ─── Dimple — small embossed cone on the inner web face ───────────────
function DimpleMesh({ pos, innerWebX }: { pos: number; innerWebX: number }) {
  // 5mm tall, 10mm wide cone, base flush on web inner face (x = innerWebX),
  // apex pointing TOWARDS the flange opening (+x).
  return (
    <group position={[innerWebX, 0, pos]} rotation={[0, 0, -Math.PI / 2]}>
      <mesh castShadow receiveShadow>
        <coneGeometry args={[5, 5, 16]} />
        <meshStandardMaterial color="#facc15" metalness={0.6} roughness={0.5} />
      </mesh>
    </group>
  );
}

// ─── Web hole — bolt / fastener through the web ────────────────────────
function WebHoleMesh({ pos, diameter, webX }: { pos: number; diameter: number; webX: number }) {
  // Cylinder axis along +x (perpendicular to web), positioned at z = pos
  // and y = 0 (web midpoint). Length = enough to clearly punch through
  // both inner and outer web faces (we just use 2mm — visual reads as a
  // hole because the cylinder is darker than the surrounding steel).
  return (
    <group position={[webX, 0, pos]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow={false}>
        <cylinderGeometry args={[diameter / 2, diameter / 2, 4, 16]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.1} roughness={0.95} />
      </mesh>
      {/* Outer ring — slightly larger and lighter, gives a bevel hint. */}
      <mesh position={[-1, 0, 0]}>
        <cylinderGeometry args={[diameter / 2 + 0.5, diameter / 2 + 0.5, 0.5, 16]} />
        <meshStandardMaterial color="#5a5a60" metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
}

// ─── Bolt anchor — bigger hole with darker centre ─────────────────────
function BoltHoleMesh({ pos, diameter, webX }: { pos: number; diameter: number; webX: number }) {
  return (
    <group position={[webX, 0, pos]} rotation={[0, 0, Math.PI / 2]}>
      <mesh>
        <cylinderGeometry args={[diameter / 2, diameter / 2, 4, 20]} />
        <meshStandardMaterial color="#050505" metalness={0.05} roughness={0.98} />
      </mesh>
      {/* Bolt head ring — visible darker outer */}
      <mesh position={[-0.5, 0, 0]}>
        <cylinderGeometry args={[diameter / 2 + 1, diameter / 2 + 1, 0.5, 20]} />
        <meshStandardMaterial color="#3a3a40" metalness={0.5} roughness={0.6} />
      </mesh>
    </group>
  );
}

// ─── Service slot — oval cable / pipe pass-through ────────────────────
function ServiceSlotMesh({
  pos,
  diameter,
  innerWebX,
}: {
  pos: number;
  diameter: number;
  innerWebX: number;
}) {
  // Render as elongated cylinder along the stick length (z direction),
  // showing the oval slot as seen from the inside of the stick.
  // We use a flattened box with rounded ends — easier than custom geom.
  // Approximation: an extruded ellipse along x.
  // Use a torus-flat as marker: actually simplest is a dark rectangle
  // mesh sitting on the web inner face.
  const slotLen = diameter * 1.8;
  return (
    <group position={[innerWebX, 0, pos]}>
      {/* Dark recess showing the slot */}
      <mesh>
        <boxGeometry args={[1, diameter, slotLen]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.1} roughness={0.95} />
      </mesh>
      {/* Outer rim — slightly raised */}
      <mesh position={[-0.5, 0, 0]}>
        <boxGeometry args={[0.5, diameter + 1.5, slotLen + 1.5]} />
        <meshStandardMaterial color="#5a5a60" metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
}

// ─── Screw hole — small hole, typically Ø3.8 ───────────────────────────
function ScrewHoleMesh({ pos, webX }: { pos: number; webX: number }) {
  return (
    <group position={[webX, 0, pos]} rotation={[0, 0, Math.PI / 2]}>
      <mesh>
        <cylinderGeometry args={[1.9, 1.9, 4, 12]} />
        <meshStandardMaterial color="#050505" metalness={0.05} roughness={0.98} />
      </mesh>
    </group>
  );
}
