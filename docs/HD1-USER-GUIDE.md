# HD1 — User Guide

**HD1** = HYTEK Detailer 1 — the in-house replacement for FrameCAD Detailer's
"Generate Manufacturing" workflow, frozen 2026-05-09.

**URL:** `https://hytek-rfy-tools.vercel.app/hd1`
**Hub tile:** "HD1 — RFY/CSV/PDF Generator" (top of the portal grid).

---

## 1. What it does

| Old workflow (Detailer) | HD1 workflow |
| --- | --- |
| Open Detailer, load XML, hit Generate, copy 3 file types out of `01 XML OUTPUT/Manufacturing` | Open HD1, drop XML, click "Generate All", download ZIP |
| 30-60 seconds + Detailer license | 5-15 seconds, browser-only |
| EOL 2026-05-14 | Frozen and supported in-house |

The factory rollformer (F300i) needs three artifacts per job:

1. **`.rfy`** — the encrypted file the F300i reads via USB.
2. **`.csv`** — per-plan rollforming sequence (one CSV per plan).
3. **`.pdf`** — frame elevation drawing (replaces Detailer's "Manufacturing PDF").

HD1 generates all three from a single `<framecad_import>` XML.

---

## 2. The flow (3 taps cold-launch → save)

```
┌───────────────────────────────────────────────────────────────────┐
│  HYTEK GROUP  [logo]                                              │
│                                                                   │
│  HYTEK Detailer 1 (HD1)                          [← All RFY tools]│
│  XML → RFY + CSV + PDF — frozen 2026-05-09                        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                                                             │  │
│  │            Drop FrameCAD XML files here                     │  │
│  │            or tap to choose · multiple files OK             │  │
│  │                                                             │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│                                          [ Generate All (3) ]     │
└───────────────────────────────────────────────────────────────────┘
```

After dropping files, each one renders as a card:

```
┌───────────────────────────────────────────────────────────────────┐
│  HG260044_GF-LBW.xml                                              │
│  142 KB · job HG260044 · 6 plans                                  │
│  GF-LBW-70.075, GF-RP-70.075, GF-TB2B-70.075, GF-LIN-70.075 · +2  │
│                                  ┌──────────────────────────────┐ │
│                                  │ Cached (Detailer-blessed,    │ │
│                                  │ 100% match)                  │ │
│                                  └──────────────────────────────┘ │
│                                                                   │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐                               │
│  │ RFY │  │ CSV │  │ PDF │  │ ZIP │                               │
│  └─────┘  └─────┘  └─────┘  └─────┘                               │
│                                                                   │
│                                            [ Generate All →   ]   │
└───────────────────────────────────────────────────────────────────┘
```

**Tap 1:** drop a file (or click to pick).
**Tap 2:** click "Generate All".
**Tap 3:** click "↓ ZIP" once it goes green — file downloads to disk.

Total taps to RFY/CSV/PDF: **3**.

---

## 3. Cache hit vs codec-generated

The badge under each upload tells you which path produced the RFY:

- **Green — Cached (Detailer-blessed, 100% match):** the input matches a
  captured reference job (HG260001, HG260023, HG260044, or any job pre-rolled
  through the Forge oracle cache). The RFY bytes returned are byte-for-byte
  identical to what Detailer would have produced. Safe to send to the
  rollformer.
- **Blue — Codec-generated (~80% match):** the codec rule engine produced
  the output. Most ops match Detailer exactly; some may differ in count or
  position. Open the file in `/forge/review` before steel-cut on a new job.

The cache lives on Scott's OneDrive at
`CLAUDE DATA FILE/detailer-oracle-cache/` and is shared via Y: drive
references for the 3 captured corpora.

---

## 4. Multi-file workflow

Drop multiple XMLs at once. The page renders one card per file, plus a
top-level **Generate All (N)** button that processes them sequentially. Each
card's outputs are independent — clicking RFY on one card only affects that
card.

---

## 5. Recent activity

The bottom of the page shows the last 10 jobs you processed:

| When | Job | Plan | Outputs | Cache |
| --- | --- | --- | --- | --- |
| 09/05/2026 14:32 | HG260044 | GF-LBW-70.075 | RFY+CSV+PDF+ZIP | cached |
| 09/05/2026 14:18 | HG260023 | PK1-GF-LBW | RFY+CSV+PDF+ZIP | cached |
| 09/05/2026 14:05 | HG260100 | GF-RP-70.075 | RFY+CSV+PDF+ZIP | codec |

Stored in browser localStorage (`hd1_activity_log_v1`). Cleared when you
clear browser data; not synced across devices.

---

## 6. Supported formats

**Input (required):** FrameCAD `<framecad_import>` XML (the file Detailer's
"CNC Input" generates). Both single-plan and multi-plan packed XMLs are
supported.

**Not supported:** decoded `<schedule>` XMLs — use the round-trip page (`/`)
instead, since those are usually edited mid-stream and the round-trip path
preserves more.

---

## 7. Endpoints (for external automation)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/api/hd1/encode-rfy` | XML bytes | `application/octet-stream` (`.rfy`) |
| `POST` | `/api/hd1/encode-csv` | XML bytes | `text/csv` |
| `POST` | `/api/hd1/encode-pdf` | XML bytes | `application/pdf` |
| `POST` | `/api/hd1/encode-zip` | XML bytes | `application/zip` |

Send the raw XML bytes as the request body and set
`x-filename: <encoded-name>` so HD1 can derive sensible output filenames.

Response headers:

- `x-oracle-hit: true|false` — cache hit indicator (RFY/ZIP only).
- `x-oracle-source: <path>` — which reference RFY produced the bytes.
- `x-oracle-miss-reason: <text>` — why the cache missed.
- `x-plan-count: N` — plans in the input.
- `x-stick-count: N` — sticks in the input.
- `x-pdf-source: frame-elevation|placeholder` — which PDF renderer ran.

---

## 8. Mobile

The page is mobile-first per HYTEK conventions:

- Drop zone is a 160px-tall tap target — easy on phones.
- All buttons ≥44×44 (Apple HIG).
- Inputs use `font-size: 16px+` so iOS doesn't auto-zoom on focus.
- Single-column layout under the `sm:` breakpoint (640px).

You can drop XMLs from a mobile file picker (Safari + Chrome both work).

---

## 9. Troubleshooting

- **"Expected `<framecad_import>` XML at the top level":** you uploaded the
  wrong file type. HD1 expects the CNC Input XML, not a decoded schedule.
- **"No sticks found in `<framecad_import>` document":** the XML is well-formed
  but has no frame data. Re-export from FrameCAD.
- **PDF placeholder badge:** falls back to a placeholder PDF if the renderer
  fails. Check the server logs for the underlying error.

---

## 10. Source layout

- `app/hd1/page.tsx` — the HD1 page UI.
- `app/api/hd1/encode-{rfy,csv,pdf,zip}/route.ts` — API routes.
- `lib/pdf/frame-elevation.ts` — PDF renderer (shared with `/api/generate-pdf`).
- `lib/oracle-cache.ts` — Detailer-bit-exact cache layer.
- `lib/framecad-import.ts` — XML → RFY synthesis.

---

_Frozen 2026-05-09. Pin to top of HYTEK Hub portal grid; do not unpin until
Detailer parity is at 100% via the codec rule engine._
