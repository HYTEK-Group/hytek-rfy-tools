"use client";

// Generate Manufacturing PDF — drag/drop a FrameCAD XML, get a frame-
// elevation PDF (one page per frame). Replaces Detailer's PDF export.

import { useState, useRef } from "react";

type Status = "idle" | "uploading" | "ready" | "error";

interface PdfMeta {
  blobUrl: string;
  filename: string;
  sizeBytes: number;
  frameCount: number;
  planCount: number;
}

export default function GeneratePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<PdfMeta | null>(null);
  const [pageSize, setPageSize] = useState<"A3" | "A4" | "letter">("A3");
  const [showDims, setShowDims] = useState(true);
  const [showTooling, setShowTooling] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    if (meta?.blobUrl) URL.revokeObjectURL(meta.blobUrl);
    setMeta(null);

    try {
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".xml")) {
        throw new Error(`Expected .xml, got "${file.name}".`);
      }
      const buf = await file.arrayBuffer();
      const params = new URLSearchParams({
        pageSize,
        dimensions: showDims ? "1" : "0",
        tooling: showTooling ? "1" : "0",
      });
      const res = await fetch(`/api/generate-pdf?${params.toString()}`, {
        method: "POST",
        headers: { "x-filename": encodeURIComponent(file.name) },
        body: new Blob([buf], { type: "application/octet-stream" }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`${res.status}: ${msg}`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const dispo = res.headers.get("content-disposition") ?? "";
      const m = dispo.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : "frames.pdf";
      const frameCount = Number(res.headers.get("x-frame-count") ?? 0);
      const planCount = Number(res.headers.get("x-plan-count") ?? 0);
      setMeta({ blobUrl, filename, sizeBytes: blob.size, frameCount, planCount });
      setStatus("ready");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setStatus("error");
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function download() {
    if (!meta) return;
    const a = document.createElement("a");
    a.href = meta.blobUrl;
    a.download = meta.filename;
    a.click();
  }

  return (
    <main className="min-h-screen p-8 max-w-5xl mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <img src="/hytek-group-logo.png" alt="HYTEK GROUP" className="h-10" />
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-bold">
            <span className="text-yellow-400">HYTEK</span> Frame PDF Generator
          </h1>
          <a
            href="/"
            className="text-sm px-3 py-1.5 rounded border border-zinc-700 hover:border-yellow-400 hover:text-yellow-400 text-zinc-300 transition"
          >
            ← Back
          </a>
        </div>
        <p className="text-zinc-400 mt-1">
          FrameCAD <code className="text-yellow-400">.xml</code> → Manufacturing PDF (one page per frame).
          Replaces Detailer's PDF export.
        </p>
      </header>

      {/* Options bar */}
      <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 mb-6 flex flex-wrap items-center gap-6 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-zinc-400">Page size:</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value as "A3" | "A4" | "letter")}
            className="bg-zinc-800 text-zinc-200 border border-zinc-700 rounded px-2 py-1"
          >
            <option value="A3">A3 (landscape)</option>
            <option value="A4">A4 (landscape)</option>
            <option value="letter">Letter (landscape)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-zinc-300">
          <input
            type="checkbox"
            checked={showDims}
            onChange={(e) => setShowDims(e.target.checked)}
            className="accent-yellow-400"
          />
          Dimension lines
        </label>
        <label className="flex items-center gap-2 text-zinc-300">
          <input
            type="checkbox"
            checked={showTooling}
            onChange={(e) => setShowTooling(e.target.checked)}
            className="accent-yellow-400"
          />
          Tooling marks
        </label>
      </div>

      {/* Drop zone */}
      <div
        className={`rounded-2xl p-12 text-center transition mb-6 border-2 border-dashed ${
          dragActive
            ? "border-yellow-400 bg-zinc-800/60"
            : "border-yellow-400/50 bg-zinc-900/40 hover:border-yellow-400 hover:bg-zinc-800/40"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {status === "uploading" ? (
          <p className="text-zinc-300">Generating PDF…</p>
        ) : (
          <>
            <p className="text-yellow-400 font-medium text-lg mb-2">
              Drop your FrameCAD .xml here
            </p>
            <p className="text-zinc-500 text-sm">
              Accepts <code className="text-yellow-400">&lt;framecad_import&gt;</code> or
              decoded <code className="text-yellow-400">&lt;schedule&gt;</code> XML.
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-700 bg-red-950/40 p-4 mb-6 text-red-300 text-sm break-words">
          {error}
        </div>
      )}

      {meta && status === "ready" && (
        <>
          <div className="rounded-xl border border-green-800 bg-green-950/30 p-4 mb-4 flex items-center justify-between gap-4">
            <div className="text-sm text-green-200">
              <strong className="text-green-300">Ready:</strong> {meta.filename} —
              {" "}{meta.planCount} plan{meta.planCount === 1 ? "" : "s"},
              {" "}{meta.frameCount} frame{meta.frameCount === 1 ? "" : "s"},
              {" "}{(meta.sizeBytes / 1024).toFixed(1)} KB
            </div>
            <button
              onClick={download}
              className="px-4 py-2 rounded bg-yellow-400 text-black font-medium hover:bg-yellow-300 transition"
            >
              Download PDF
            </button>
          </div>
          <iframe
            src={meta.blobUrl}
            title="Generated PDF preview"
            className="w-full h-[80vh] rounded-xl border border-zinc-700 bg-zinc-900"
          />
        </>
      )}

      <section className="mt-10 rounded-xl border border-zinc-700 bg-zinc-900/50 p-5 text-sm text-zinc-400">
        <h3 className="font-semibold text-zinc-200 mb-2">What's in the PDF?</h3>
        <ul className="space-y-1 list-disc pl-5">
          <li>One page per frame across all plans, in plan order.</li>
          <li>Title block: project, job, plan, frame name, dimensions, weight, stick count.</li>
          <li>Stick outlines drawn from the codec's elevation polygons (not just bbox lines).</li>
          <li>Tooling marks color-coded per type (lip notch / dimple / swage / bolt / etc.) — same palette as the wall viewer.</li>
          <li>Overall length + height dimensions on each page.</li>
        </ul>
      </section>
    </main>
  );
}
