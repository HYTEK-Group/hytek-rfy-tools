// /brain/interactions — Stick Interactions Gallery
//
// Single-Canvas architecture: a sidebar lists all the interactions, and
// clicking one swaps the 3D scene shown in the main viewport. This
// avoids the WebGL context exhaustion you'd hit with 18 separate
// canvases on the same page.
//
// Each interaction is a real 3D scene with one or more C-section sticks
// rendered as extruded steel, with the actual tool operations cut /
// embossed / notched into the geometry.

"use client";

import { useState } from "react";
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
  const [selectedId, setSelectedId] = useState(INTERACTIONS[0]!.id);
  const selected =
    INTERACTIONS.find((i) => i.id === selectedId) ?? INTERACTIONS[0]!;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 border-b border-zinc-800 flex-none">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img
              src="/hytek-group-logo.png"
              alt="HYTEK GROUP"
              className="h-8"
            />
            <h1 className="text-xl font-semibold">
              <span className="text-yellow-400">Stick</span> Interactions
            </h1>
            <span className="text-xs text-zinc-500 hidden md:inline">
              every way two C-section sticks come together
            </span>
          </div>
          <a
            href="/"
            className="text-sm px-3 py-1.5 rounded border border-zinc-700 hover:border-yellow-400 hover:text-yellow-400 text-zinc-300 transition"
          >
            ← Home
          </a>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar — list of interactions */}
        <aside className="w-72 border-r border-zinc-800 bg-zinc-900/30 overflow-y-auto flex-none">
          <ul>
            {INTERACTIONS.map((interaction) => (
              <li key={interaction.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(interaction.id)}
                  className={`w-full text-left px-4 py-3 border-b border-zinc-800/60 transition ${
                    selectedId === interaction.id
                      ? "bg-yellow-400/10 border-l-4 border-l-yellow-400 text-yellow-100"
                      : "hover:bg-zinc-800/50 text-zinc-300 border-l-4 border-l-transparent"
                  }`}
                >
                  <div
                    className={`text-sm font-medium ${
                      selectedId === interaction.id
                        ? "text-yellow-400"
                        : "text-zinc-200"
                    }`}
                  >
                    {interaction.name}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {interaction.sticks.length} stick
                    {interaction.sticks.length === 1 ? "" : "s"}
                    {" · "}
                    {interaction.sticks.reduce(
                      (sum, s) => sum + s.ops.length,
                      0,
                    )}{" "}
                    ops
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Main viewport */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Description */}
          <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/20 flex-none">
            <h2 className="text-2xl font-semibold text-yellow-400">
              {selected.name}
            </h2>
            <p className="text-sm text-zinc-400 mt-2 leading-relaxed max-w-4xl">
              {selected.description}
            </p>
          </div>

          {/* The 3D viewport */}
          <div className="flex-1 p-4 overflow-hidden min-h-0">
            <InteractionScene config={selected} />
          </div>

          {/* Caption — what tools fire on each stick */}
          <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-900/30 flex-none max-h-48 overflow-y-auto">
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Operations on each stick
            </div>
            <ul className="text-xs space-y-1.5">
              {selected.sticks.map((stick, i) => (
                <li key={i}>
                  <span className="text-zinc-200 font-medium">
                    {stick.label ?? `Stick ${i + 1}`}
                  </span>
                  {" — "}
                  <span className="text-zinc-500">
                    {stick.profile.metricLabel} ·{" "}
                    {Math.round(stick.length)}mm
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
            <div className="text-xs text-zinc-600 mt-2 italic">
              Drag to orbit · right-drag to pan · wheel to zoom
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
