// InteractionScene — full Three.js Canvas for ONE interaction.
//
// Renders all of the interaction's sticks (each with its baked tool-op
// geometry + overlay markers) and provides OrbitControls + lighting +
// a ground plane. Each scene gets its own Canvas, so the user can rotate
// each interaction independently while scrolling the page.

"use client";
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Stick3DOps } from "./Stick3DOps";
import type { InteractionConfig } from "../data/types";

interface InteractionSceneProps {
  config: InteractionConfig;
}

export function InteractionScene({ config }: InteractionSceneProps) {
  // Compute scene bounding box from stick positions (rough — we ignore
  // rotation for camera framing but it's good enough for autofit).
  const { target, distance } = useMemo(() => {
    if (config.cameraTarget && config.cameraDistance) {
      return { target: config.cameraTarget, distance: config.cameraDistance };
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const stick of config.sticks) {
      const [px, py, pz] = stick.position;
      // Approximate the stick's bbox by including its end points after
      // rotation. Simpler: use position ± length as a rough envelope.
      const half = stick.length / 2;
      minX = Math.min(minX, px - half);
      minY = Math.min(minY, py - half);
      minZ = Math.min(minZ, pz - half);
      maxX = Math.max(maxX, px + half);
      maxY = Math.max(maxY, py + half);
      maxZ = Math.max(maxZ, pz + half);
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
      distance: size * 1.4 + 500,
    };
  }, [config]);

  return (
    <div className="w-full h-[480px] bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
      <Canvas shadows>
        <PerspectiveCamera
          makeDefault
          fov={45}
          near={1}
          far={distance * 10}
          position={[
            target[0] + distance * 0.7,
            target[1] - distance * 0.3,
            target[2] + distance * 0.7,
          ]}
          up={[0, -1, 0]}
        />
        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          target={target}
          panSpeed={1.2}
          zoomSpeed={1.0}
        />

        {/* Lighting — bright key light + softer fill, matching Wall3D. */}
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[
            target[0] + distance * 0.6,
            target[1] - distance * 0.6,
            target[2] + distance * 0.8,
          ]}
          intensity={1.3}
          castShadow
        />
        <directionalLight
          position={[
            target[0] - distance * 0.4,
            target[1] + distance * 0.3,
            target[2] + distance * 0.4,
          ]}
          intensity={0.6}
        />
        <directionalLight
          position={[target[0], target[1] + distance, target[2]]}
          intensity={0.3}
        />

        {/* All sticks for this interaction. */}
        {config.sticks.map((stick, i) => (
          <Stick3DOps key={i} config={stick} />
        ))}
      </Canvas>
    </div>
  );
}
