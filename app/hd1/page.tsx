"use client";

// HD1 — HYTEK Detailer 1 (frozen 2026-05-09)
//
// Single-page workflow: drag XML in → get RFY + CSV + PDF + ZIP downloads.
// Drop-in replacement for the post-EOL Detailer workflow.
//
// Design constraints (CLAUDE.md / AGENTS.md):
//  - Brand: yellow #FFCB05 + black #231F20 + hytek-group-logo.png in header.
//  - Mobile-first: drop zone min-tap-target 44×44, font-size 16px+ on inputs.
//  - <3 taps from cold-start to download. Drop file → click "Generate All" → done.
//  - All useState before any conditional return (React hooks rule).
//  - Use stub PDF endpoint until Agent 2's `/api/encode-pdf` lands; CSV uses
//    the codec's existing documentToCsvs() until Agent 1's `generateCsv()` ships.

import { useEffect, useRef, useState } from "react";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface UploadedXml {
  id: string;            // client UUID
  file: File;
  size: number;
  jobnum: string | null;
  planNames: string[];
  cacheStatus: "checking" | "hit" | "miss" | "error";
  cacheReason?: string;
  // Per-output state
  rfy: OutputState;
  csv: OutputState;
  pdf: OutputState;
  zip: OutputState;
}

interface OutputState {
  status: "idle" | "running" | "ready" | "error";
  blob?: Blob;
  filename?: string;
  error?: string;
}

interface ActivityEntry {
  ts: number;            // unix ms
  jobnum: string | null;
  plan: string | null;
  outputs: string;       // e.g. "RFY+CSV+PDF"
  cacheStatus: "hit" | "miss" | "unknown";
}

const ACTIVITY_KEY = "hd1_activity_log_v1";
const ACTIVITY_LIMIT = 10;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Quick scan of XML text for jobnum + plan names.
 * Doesn't fully parse — just regex enough to populate the UI before send.
 */
function scanXml(xml: string): { jobnum: string | null; planNames: string[] } {
  let jobnum: string | null = null;
  const m = xml.match(/<job_number[^>]*>([^<]+)<\/job_number>/i)
        ?? xml.match(/<jobnum[^>]*>([^<]+)<\/jobnum>/i)
        ?? xml.match(/<jobnumber[^>]*>([^<]+)<\/jobnumber>/i);
  if (m) jobnum = m[1].trim();
  // <plan name="..."> attribute or <plan_name>...</plan_name>
  const planNames: string[] = [];
  const planAttrRe = /<plan\b[^>]*\sname=["']([^"']+)["']/gi;
  let pm: RegExpExecArray | null;
  while ((pm = planAttrRe.exec(xml))) planNames.push(pm[1].trim());
  if (planNames.length === 0) {
    const planTagRe = /<plan_name[^>]*>([^<]+)<\/plan_name>/gi;
    while ((pm = planTagRe.exec(xml))) planNames.push(pm[1].trim());
  }
  return { jobnum, planNames };
}

async function loadActivity(): Promise<ActivityEntry[]> {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActivityEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, ACTIVITY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveActivity(entry: ActivityEntry) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const arr: ActivityEntry[] = raw ? JSON.parse(raw) : [];
    arr.unshift(entry);
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(arr.slice(0, ACTIVITY_LIMIT)));
  } catch {
    // ignore quota errors
  }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  // DD/MM/YYYY HH:MM (Australian per CLAUDE.md)
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mn = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mn}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Post the XML file to the given endpoint. Returns the response blob and
 * filename extracted from content-disposition (or a default).
 */
async function postXml(file: File, endpoint: string, defaultName: string): Promise<{ blob: Blob; filename: string; cacheHit: boolean | null }> {
  const buf = await file.arrayBuffer();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "x-filename": encodeURIComponent(file.name) },
    body: new Blob([buf], { type: "application/octet-stream" }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`${res.status}: ${msg}`);
  }
  const blob = await res.blob();
  const dispo = res.headers.get("content-disposition") ?? "";
  const m = dispo.match(/filename="([^"]+)"/);
  const filename = m ? m[1] : defaultName;
  const cacheHeader = res.headers.get("x-oracle-hit");
  let cacheHit: boolean | null = null;
  if (cacheHeader === "true") cacheHit = true;
  else if (cacheHeader === "false") cacheHit = false;
  return { blob, filename, cacheHit };
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export default function Hd1Page() {
  // All useState BEFORE any conditional returns — React hooks rule.
  const [uploads, setUploads] = useState<UploadedXml[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadActivity().then(setActivity);
  }, []);

  // ─── File handling ────────────────────────────────────────────────────────

  async function ingestFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".xml"));
    if (arr.length === 0) return;

    const additions: UploadedXml[] = [];
    for (const file of arr) {
      const text = await file.text();
      const scan = scanXml(text);
      additions.push({
        id: uuid(),
        file,
        size: file.size,
        jobnum: scan.jobnum,
        planNames: scan.planNames,
        cacheStatus: "checking",
        rfy: { status: "idle" },
        csv: { status: "idle" },
        pdf: { status: "idle" },
        zip: { status: "idle" },
      });
    }
    setUploads(prev => [...prev, ...additions]);

    // Cache check is implicit on first encode-bundle call (server reads headers).
    // We do a lightweight HEAD-style probe by calling encode-bundle for each file,
    // but that's heavy — defer cache status until "Generate All" runs.
    // For now mark as "miss" optimistically; "Generate All" updates with real status.
    setTimeout(() => {
      setUploads(prev => prev.map(u =>
        additions.find(a => a.id === u.id) ? { ...u, cacheStatus: "miss", cacheReason: "not yet probed — click Generate" } : u
      ));
    }, 200);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer?.files) void ingestFiles(e.dataTransfer.files);
  }

  function removeUpload(id: string) {
    setUploads(prev => prev.filter(u => u.id !== id));
  }

  // ─── Generation ───────────────────────────────────────────────────────────

  function patchUpload(id: string, patch: Partial<UploadedXml>) {
    setUploads(prev => prev.map(u => (u.id === id ? { ...u, ...patch } : u)));
  }

  function patchOutput(id: string, key: "rfy" | "csv" | "pdf" | "zip", patch: Partial<OutputState>) {
    setUploads(prev => prev.map(u => (u.id === id ? { ...u, [key]: { ...u[key], ...patch } } : u)));
  }

  async function generateOne(upload: UploadedXml, kind: "rfy" | "csv" | "pdf" | "zip") {
    patchOutput(upload.id, kind, { status: "running", error: undefined });
    try {
      const baseName = upload.file.name.replace(/\.xml$/i, "");
      let endpoint = "";
      let defaultName = "";
      if (kind === "rfy") {
        endpoint = "/api/hd1/encode-rfy";
        defaultName = `${baseName}.rfy`;
      } else if (kind === "csv") {
        endpoint = "/api/hd1/encode-csv";
        defaultName = `${baseName}.csv`;
      } else if (kind === "pdf") {
        endpoint = "/api/hd1/encode-pdf";
        defaultName = `${baseName}.pdf`;
      } else {
        endpoint = "/api/hd1/encode-zip";
        defaultName = `${baseName}_bundle.zip`;
      }
      const { blob, filename, cacheHit } = await postXml(upload.file, endpoint, defaultName);
      patchOutput(upload.id, kind, { status: "ready", blob, filename });
      // RFY/ZIP responses carry the oracle-hit header — use that to update badge.
      if (cacheHit !== null && (kind === "rfy" || kind === "zip")) {
        patchUpload(upload.id, {
          cacheStatus: cacheHit ? "hit" : "miss",
          cacheReason: cacheHit ? "Detailer-blessed bytes" : "codec-generated",
        });
      }
    } catch (e) {
      patchOutput(upload.id, kind, { status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function generateAll(upload: UploadedXml) {
    // RFY first (drives cache status). CSV+PDF in parallel.
    await generateOne(upload, "rfy");
    await Promise.all([generateOne(upload, "csv"), generateOne(upload, "pdf")]);
    await generateOne(upload, "zip");
    const outputs = [
      upload.id && "RFY",
      "CSV",
      "PDF",
      "ZIP",
    ].filter(Boolean).join("+");
    const entry: ActivityEntry = {
      ts: Date.now(),
      jobnum: upload.jobnum,
      plan: upload.planNames[0] ?? null,
      outputs,
      cacheStatus: upload.cacheStatus === "hit" ? "hit" : upload.cacheStatus === "miss" ? "miss" : "unknown",
    };
    saveActivity(entry);
    void loadActivity().then(setActivity);
  }

  async function generateAllForAll() {
    for (const u of uploads) {
      await generateAll(u);
    }
  }

  function downloadOutput(upload: UploadedXml, kind: "rfy" | "csv" | "pdf" | "zip") {
    const out = upload[kind];
    if (out.status === "ready" && out.blob && out.filename) {
      downloadBlob(out.blob, out.filename);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#231F20] text-zinc-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            {/* Required HYTEK brand logo — yellow on black per brand manual.
                Standing directive: must appear in EVERY HYTEK app header. */}
            <img src="/hytek-group-logo.png" alt="HYTEK GROUP" className="h-10" />
          </div>
          <div className="flex items-baseline justify-between flex-wrap gap-3">
            <h1 className="text-3xl sm:text-4xl font-bold">
              <span className="text-[#FFCB05]">HYTEK</span> Detailer 1{" "}
              <span className="text-zinc-400 text-2xl sm:text-3xl">(HD1)</span>
            </h1>
            <a
              href="/"
              className="text-sm px-3 py-2 rounded border border-zinc-700 hover:border-[#FFCB05] hover:text-[#FFCB05] text-zinc-300 transition"
            >
              ← All RFY tools
            </a>
          </div>
          <p className="text-zinc-400 mt-2 text-base">
            XML → RFY + CSV + PDF — frozen 2026-05-09
          </p>
          <p className="text-zinc-500 text-sm mt-1">
            Drop one or more HYTEK <code className="text-[#FFCB05]">framecad_import</code> XMLs
            → get the rollformer <code>.rfy</code>, the per-plan <code>.csv</code>, and a printable
            elevation <code>.pdf</code>. Bundle them all as a ZIP for one-click handoff.
            <span className="block text-zinc-600 mt-1">
              (the <code>framecad_import</code> tag is the XML schema's element name —
              kept as-is since renaming it would break input parsing)
            </span>
          </p>
        </header>

        {/* Drop zone — hot path, big tap target, font-size ≥16px */}
        <section
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={`rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition cursor-pointer ${
            dragActive
              ? "border-[#FFCB05] bg-[#FFCB05]/10"
              : "border-zinc-700 hover:border-[#FFCB05]/60 bg-zinc-900/40"
          }`}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop XML files or click to choose"
          style={{ minHeight: 160 }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xml"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void ingestFiles(e.target.files);
              // Reset so the same file can be re-picked.
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
          <div className="text-lg sm:text-xl font-semibold text-zinc-200">
            Drop HYTEK XML files here
          </div>
          <div className="text-sm text-zinc-400 mt-2" style={{ fontSize: 16 }}>
            or tap to choose · multiple files OK
          </div>
        </section>

        {/* Generate-all bar */}
        {uploads.length > 0 && (
          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-zinc-400">
              {uploads.length} file{uploads.length === 1 ? "" : "s"} ready
            </p>
            <button
              onClick={() => void generateAllForAll()}
              className="px-5 py-3 rounded-lg bg-[#FFCB05] text-[#231F20] font-bold hover:bg-yellow-300 transition min-h-[44px]"
              style={{ fontSize: 16 }}
            >
              Generate All ({uploads.length})
            </button>
          </div>
        )}

        {/* Per-upload cards */}
        <div className="mt-6 space-y-4">
          {uploads.map((u) => (
            <UploadCard
              key={u.id}
              upload={u}
              onGenerateAll={() => void generateAll(u)}
              onGenerate={(k) => void generateOne(u, k)}
              onDownload={(k) => downloadOutput(u, k)}
              onRemove={() => removeUpload(u.id)}
            />
          ))}
        </div>

        {/* Recent activity */}
        {activity.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xs uppercase tracking-wider text-[#FFCB05] mb-3">
              Recent activity (last {activity.length})
            </h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/80 text-zinc-400">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">When</th>
                    <th className="text-left px-3 py-2 font-medium">Job</th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Plan</th>
                    <th className="text-left px-3 py-2 font-medium">Outputs</th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Cache</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((a, i) => (
                    <tr key={i} className="border-t border-zinc-800/80">
                      <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{formatTimestamp(a.ts)}</td>
                      <td className="px-3 py-2 text-zinc-300">{a.jobnum ?? "—"}</td>
                      <td className="px-3 py-2 text-zinc-400 hidden sm:table-cell">{a.plan ?? "—"}</td>
                      <td className="px-3 py-2 text-zinc-300">{a.outputs}</td>
                      <td className="px-3 py-2 hidden sm:table-cell">
                        {a.cacheStatus === "hit" && <span className="text-emerald-400">cached</span>}
                        {a.cacheStatus === "miss" && <span className="text-sky-400">codec</span>}
                        {a.cacheStatus === "unknown" && <span className="text-zinc-500">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="mt-16 text-xs text-zinc-500">
          HD1 — frozen 2026-05-09 · powered by{" "}
          <a href="https://github.com/scotttextor/hytek-rfy-codec" className="text-[#FFCB05] hover:underline">
            @hytek/rfy-codec
          </a>
        </footer>
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Per-upload card
// ────────────────────────────────────────────────────────────────────────────

function UploadCard({
  upload,
  onGenerateAll,
  onGenerate,
  onDownload,
  onRemove,
}: {
  upload: UploadedXml;
  onGenerateAll: () => void;
  onGenerate: (k: "rfy" | "csv" | "pdf" | "zip") => void;
  onDownload: (k: "rfy" | "csv" | "pdf" | "zip") => void;
  onRemove: () => void;
}) {
  return (
    <article className="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-4 sm:p-6">
      {/* File header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-zinc-100 truncate" title={upload.file.name}>
            {upload.file.name}
          </h3>
          <div className="mt-1 flex items-center gap-3 flex-wrap text-sm text-zinc-400">
            <span>{formatBytes(upload.size)}</span>
            {upload.jobnum && <span>· job <span className="text-zinc-200">{upload.jobnum}</span></span>}
            {upload.planNames.length > 0 && (
              <span>· {upload.planNames.length} plan{upload.planNames.length === 1 ? "" : "s"}</span>
            )}
          </div>
          {upload.planNames.length > 0 && (
            <p className="mt-1 text-xs text-zinc-500 truncate">
              {upload.planNames.slice(0, 4).join(", ")}
              {upload.planNames.length > 4 && ` · +${upload.planNames.length - 4} more`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <CacheBadge status={upload.cacheStatus} reason={upload.cacheReason} />
          <button
            onClick={onRemove}
            aria-label="Remove file"
            className="text-zinc-500 hover:text-red-400 transition px-2 py-1"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Action buttons grid */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <ActionButton label="RFY" state={upload.rfy} onGenerate={() => onGenerate("rfy")} onDownload={() => onDownload("rfy")} />
        <ActionButton label="CSV" state={upload.csv} onGenerate={() => onGenerate("csv")} onDownload={() => onDownload("csv")} />
        <ActionButton label="PDF" state={upload.pdf} onGenerate={() => onGenerate("pdf")} onDownload={() => onDownload("pdf")} />
        <ActionButton label="ZIP" state={upload.zip} onGenerate={() => onGenerate("zip")} onDownload={() => onDownload("zip")} />
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={onGenerateAll}
          className="px-4 py-3 rounded-lg bg-[#FFCB05] text-[#231F20] font-bold hover:bg-yellow-300 transition min-h-[44px]"
          style={{ fontSize: 16 }}
        >
          Generate All →
        </button>
      </div>
    </article>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Cache badge
// ────────────────────────────────────────────────────────────────────────────

function CacheBadge({ status, reason }: { status: UploadedXml["cacheStatus"]; reason?: string }) {
  if (status === "checking") {
    return <span className="text-xs px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">checking…</span>;
  }
  if (status === "hit") {
    return (
      <span
        title={reason ?? "Detailer-blessed bytes — 100% match"}
        className="text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
      >
        Cached (Detailer-blessed, 100% match)
      </span>
    );
  }
  if (status === "miss") {
    return (
      <span
        title={reason ?? "Generated by codec rules — review recommended"}
        className="text-xs px-2 py-1 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40"
      >
        Codec-generated (~80% match)
      </span>
    );
  }
  return <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">cache error</span>;
}

// ────────────────────────────────────────────────────────────────────────────
// Action button (per output type)
// ────────────────────────────────────────────────────────────────────────────

function ActionButton({
  label,
  state,
  onGenerate,
  onDownload,
}: {
  label: string;
  state: OutputState;
  onGenerate: () => void;
  onDownload: () => void;
}) {
  const isReady = state.status === "ready";
  const isRunning = state.status === "running";
  const isError = state.status === "error";

  const onClick = isReady ? onDownload : onGenerate;
  const text = isRunning
    ? `${label} …`
    : isReady
      ? `↓ ${label}`
      : isError
        ? `${label} — retry`
        : label;

  return (
    <button
      onClick={onClick}
      disabled={isRunning}
      title={isError ? state.error : isReady ? `Download ${state.filename ?? ""}` : `Generate ${label}`}
      className={`px-3 py-3 rounded-lg font-semibold transition border min-h-[44px] ${
        isReady
          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/20"
          : isError
            ? "bg-red-500/10 text-red-300 border-red-500/40 hover:bg-red-500/20"
            : isRunning
              ? "bg-zinc-800 text-zinc-400 border-zinc-700 cursor-wait"
              : "bg-zinc-800 text-zinc-200 border-zinc-700 hover:border-[#FFCB05] hover:text-[#FFCB05]"
      }`}
      style={{ fontSize: 16 }}
    >
      {text}
    </button>
  );
}
