// InteractionScene — single Canvas that displays ONE interaction at a
// time. The gallery uses a sidebar/tab picker to switch between
// interactions, so we only need ONE WebGL context for the whole page
// (avoiding the 8-16 context limit that would break a multi-canvas
// gallery).
//
// Each scene gets its own camera + OrbitControls because the camera is
// parameterised by the interaction's bbox.

"use client";
import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Stick3DOps } from "./Stick3DOps";
import type { InteractionConfig } from "../data/types";

interface InteractionSceneProps {
  config: InteractionConfig;
}

export function InteractionScene({ config }: InteractionSceneProps) {
  // CRITICAL: r3f's Canvas uses a ResizeObserver to auto-fit its parent.
  // On initial mount, the observer sometimes doesn't fire because the
  // parent's layout is still settling. The Canvas then renders at its
  // default 300×150 even though its parent is 1500×1500. Forcing a
  // window resize event right after mount triggers the observer.
  useEffect(() => {
    const t = window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 50);
    return () => window.clearTimeout(t);
  }, [config.id]);

  // Compute scene bounding box from each stick's start AND end position.
  // For each stick, after its rotation is applied, the extrusion +Z axis
  // points along the length direction. We compute that direction in world
  // space and take both endpoints.
  const { target, distance } = useMemo(() => {
    if (config.cameraTarget && config.cameraDistance) {
      return { target: config.cameraTarget, distance: config.cameraDistance };
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const lengthVec = new THREE.Vector3();
    const euler = new THREE.Euler();
    for (const stick of config.sticks) {
      const [px, py, pz] = stick.position;
      // Apply the stick's rotation (Three.js default Euler order = XYZ)
      // to the unit length vector (0, 0, length).
      euler.set(stick.rotation[0], stick.rotation[1], stick.rotation[2], "XYZ");
      lengthVec.set(0, 0, stick.length).applyEuler(euler);
      const ex = px + lengthVec.x;
      const ey = py + lengthVec.y;
      const ez = pz + lengthVec.z;
      // Include both ends + a profile-radius padding (~50mm)
      const r = 60;
      minX = Math.min(minX, px - r, ex - r);
      minY = Math.min(minY, py - r, ey - r);
      minZ = Math.min(minZ, pz - r, ez - r);
      maxX = Math.max(maxX, px + r, ex + r);
      maxY = Math.max(maxY, py + r, ey + r);
      maxZ = Math.max(maxZ, pz + r, ez + r);
    }
    if (!isFinite(minX)) {
      return { target: [0, 0, 0] as [number, number, number], distance: 2000 };
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    return {
      target: [cx, cy, cz] as [number, number, number],
      // Distance: fits the scene's largest dimension into the canvas
      // viewport at FOV 35°, with 30% extra padding for breathing room.
      // size / (2·tan(fov/2)) ≈ size * 1.55 at fov=35°, so 1.6× gives a
      // comfortable margin without cutting things off.
      distance: size * 1.6 + 400,
    };
  }, [config]);

  return (
    <div
      className="bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden relative"
      style={{ width: "100%", height: "100%", minHeight: 0 }}
    >
      {/* Key the Canvas by id so React re-mounts it when the user picks
          a different interaction — gives a clean reset of camera +
          OrbitControls state per scene. */}
      <Canvas
        style={{ width: "100%", height: "100%" }}
        key={config.id}
        dpr={[1, 1.5]}
        gl={{ antialias: true }}
        // Pass camera directly to Canvas — bypasses the PerspectiveCamera
        // component's setup which can race against frame-1 render.
        camera={{
          fov: 35,
          near: 1,
          far: distance * 10,
          // Camera position: 3/4 angle from the front-right looking
          // slightly down. The flange-direction (+X profile axis) maps
          // to world +X for vertical sticks, so a position with both
          // +X and +Z components reveals the C-section profile clearly.
          position: [
            target[0] + distance * 0.55,
            target[1] + distance * 0.25,
            target[2] + distance * 0.85,
          ],
          up: [0, 1, 0],
        }}
      >
        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          target={target}
          panSpeed={1.2}
          zoomSpeed={1.0}
        />

        {/* Lighting — bright key light + fills + back light. */}
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[
            target[0] + distance * 0.6,
            target[1] + distance * 0.8,
            target[2] + distance * 0.6,
          ]}
          intensity={1.3}
        />
        <directionalLight
          position={[
            target[0] - distance * 0.4,
            target[1] + distance * 0.5,
            target[2] + distance * 0.4,
          ]}
          intensity={0.55}
        />
        <directionalLight
          position={[target[0], target[1] - distance * 0.3, target[2] - distance * 0.5]}
          intensity={0.35}
        />

        {/* Subtle ground plane below the scene gives the user a reference
            for "down". Lays flat well below the lowest stick. */}
        <mesh
          position={[target[0], target[1] - distance * 0.55, target[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[distance * 4, distance * 4]} />
          <meshStandardMaterial color="#0a0a0a" roughness={1} metalness={0} />
        </mesh>

        {/* The sticks. */}
        {config.sticks.map((stick, i) => (
          <Stick3DOps key={i} config={stick} />
        ))}
      </Canvas>
    </div>
  );
}
