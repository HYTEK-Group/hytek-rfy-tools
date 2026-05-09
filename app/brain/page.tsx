// app/brain/page.tsx
"use client";

import { useState } from "react";

export default function BrainPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResultMsg(null);
    try {
      const xml = await file.text();
      const res = await fetch("/api/brain/encode", {
        method: "POST",
        headers: {
          "content-type": "application/xml",
          "x-filename": encodeURIComponent(file.name),
        },
        body: xml,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = file.name.replace(/\.(xml|txt)$/i, "") + "_brain.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setResultMsg("Bundle downloaded. classification.json inside the ZIP shows which ops are catalogued.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8 text-zinc-100">
      <h1 className="mb-2 text-2xl font-semibold">
        <span className="text-yellow-400">Frame Brain</span> (preview)
      </h1>
      <p className="mb-6 text-sm text-zinc-400">
        Upload a FrameCAD <code className="text-yellow-400">{`<framecad_import>`}</code> XML. The brain delegates encoding to
        the existing pipeline and adds a <code className="text-yellow-400">classification.json</code> report listing every
        emitted operation tagged against Catalogue A. v0 — read-only; no rule changes yet.
      </p>

      <label className="block cursor-pointer rounded-lg border border-dashed border-zinc-600 bg-zinc-900/50 p-8 text-center hover:bg-zinc-900">
        <input
          type="file"
          accept=".xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
          disabled={busy}
        />
        {busy ? "Encoding…" : "Click to choose an XML file"}
      </label>

      {error && (
        <div className="mt-4 rounded border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {resultMsg && (
        <div className="mt-4 rounded border border-green-700 bg-green-950/50 p-3 text-sm text-green-200">
          {resultMsg}
        </div>
      )}
    </main>
  );
}
