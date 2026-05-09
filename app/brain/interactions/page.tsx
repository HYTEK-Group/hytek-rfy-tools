// /brain/interactions — Stick Interactions Gallery
//
// Visual catalogue of every distinct way two C-section steel sticks
// can interact, rendered as REAL 3D extruded sticks with the actual
// tool operations cut/embossed/notched into the geometry.
//
// One Canvas per interaction, each with its own OrbitControls so the
// user can rotate / zoom each scene independently while scrolling.

"use client";

import { INTERACTIONS } from "./data/interactions";
import { InteractionScene } from "./components/InteractionScene";
import type { OpConfig } from "./data/types";

function describeOp(op: OpConfig): string {
  switch (op.type) {
    case "LipNotch":
      return `LipNotch (${op.flangeSide}, ${Math.round(op.spanEnd - op.spanStart)}mm)`;
    case "Swage":
      return `Swage (${Math.round(op.spanEnd - op.spanStart)}mm)`;
    case "InnerDimple":
      return `InnerDimple @ ${Math.round(op.pos)}mm`;
    case "InnerNotch":
      return `InnerNotch (${Math.round(op.spanEnd - op.spanStart)}mm)`;
    case "InnerService":
      return `InnerService Ø${op.diameter} @ ${Math.round(op.pos)}mm`;
    case "Web":
      return `Web Ø${op.diameter} @ ${Math.round(op.pos)}mm`;
    case "Bolt":
      return `Bolt Ø${op.diameter} @ ${Math.round(op.pos)}mm`;
    case "Chamfer":
      return `Chamfer @ ${op.end}`;
    case "TrussChamfer":
      return `TrussChamfer @ ${op.end}`;
    case "ScrewHoles":
      return `ScrewHoles @ ${Math.round(op.pos)}mm (×${op.pattern.length})`;
  }
}

export default function InteractionsGalleryPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <img
              src="/hytek-group-logo.png"
              alt="HYTEK GROUP"
              className="h-10"
            />
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-3xl font-bold">
              <span className="text-yellow-400">Stick</span> Interactions
            </h1>
            <a
              href="/"
              className="text-sm px-3 py-1.5 rounded border border-zinc-700 hover:border-yellow-400 hover:text-yellow-400 text-zinc-300 transition"
            >
              ← Home
            </a>
          </div>
          <p className="text-zinc-400 mt-2">
            Every distinct way two HYTEK C-section steel sticks come together —
            shown as real 3D meshes with the actual tool operations cut,
            embossed, and notched into the steel.
          </p>
          <p className="text-zinc-500 text-sm mt-3">
            Drag = orbit · right-drag = pan · wheel = zoom · each scene is
            independent.
          </p>
        </header>

        {/* Gallery — one section per interaction. */}
        <div className="space-y-12">
          {INTERACTIONS.map((interaction) => (
            <section
              key={interaction.id}
              className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/30"
            >
              <div className="px-5 py-4 border-b border-zinc-800">
                <h2 className="text-xl font-semibold text-yellow-400">
                  {interaction.name}
                </h2>
                <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
                  {interaction.description}
                </p>
              </div>

              <div className="p-3">
                <InteractionScene config={interaction} />
              </div>

              {/* Caption — what tools fire on each stick */}
              <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-900/50">
                <ul className="text-xs text-zinc-400 space-y-1.5">
                  {interaction.sticks.map((stick, i) => (
                    <li key={i}>
                      <span className="text-zinc-200 font-medium">
                        {stick.label ?? `Stick ${i + 1}`}
                      </span>
                      {" — "}
                      <span className="text-zinc-500">
                        {stick.profile.metricLabel} · {Math.round(stick.length)}mm
                      </span>
                      {stick.ops.length > 0 && (
                        <>
                          {" · "}
                          <span className="text-zinc-300">
                            {stick.ops.map(describeOp).join(", ")}
                          </span>
                        </>
                      )}
                      {stick.ops.length === 0 && (
                        <span className="text-zinc-600 italic">
                          {" · no ops (passes through primary's cut)"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-12 text-xs text-zinc-500 text-center">
          {INTERACTIONS.length} interactions · all sticks 70S41 / 75S41 / 89S41
          C-section · meshes built via THREE.BufferGeometry from segmented
          profiles
        </footer>
      </div>
    </main>
  );
}
