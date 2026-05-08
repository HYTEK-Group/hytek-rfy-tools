# hytek-rfy-tools

Web tooling for HYTEK's FrameCAD RFY pipeline.
[Production deploy: `https://hytek-rfy-tools.vercel.app`](https://hytek-rfy-tools.vercel.app)

## Pages

| Path | Purpose |
| --- | --- |
| `/` | Root — round-trip `.rfy` ↔ `.txt` / `.xml` / `.csv` converters |
| `/hd1` | **HD1 — XML → RFY + CSV + PDF (frozen 2026-05-09)** |
| `/viewer` | 3D wall viewer |
| `/regression` | Codec diff harness |
| `/rules` + `/rules/tooling` | Rules CRUD UI |
| `/forge/review` | Operator review of forge runs |

## HD1 — Detailer-replacement workflow

**Why:** FrameCAD Detailer reaches end-of-life 2026-05-14. HD1 produces every
artifact the factory currently expects from a Detailer "Generate Manufacturing"
run, from a single FrameCAD `<framecad_import>` XML.

**URL:** `/hd1` (linked from the HYTEK Hub portal as the "HD1" tile).

**Inputs:** drag-and-drop one or more `.xml` files (multiple OK).

**Outputs (per file):**

| Button | Output | Endpoint | Notes |
| --- | --- | --- | --- |
| RFY | `<job>.rfy` | `POST /api/hd1/encode-rfy` | Single combined RFY. Oracle-cache hit returns Detailer-bit-exact bytes |
| CSV | `<job>.csv` | `POST /api/hd1/encode-csv` | Per-plan CSV; multi-plan inputs concatenate with `# === <plan> ===` separators |
| PDF | `<job>_frames.pdf` | `POST /api/hd1/encode-pdf` | A3 frame-elevation drawing — one page per frame |
| ZIP | `<job>_bundle.zip` | `POST /api/hd1/encode-zip` | All three above + `README.txt` |

**Cache badge:**

- **Cached (Detailer-blessed, 100% match)** — input matches a captured
  reference job; the RFY bytes returned are byte-identical to Detailer's.
- **Codec-generated (~80% match)** — codec rule engine produced the output;
  recommend reviewing in `/forge/review` before steel-cut.

**Recent activity log:** last 10 jobs (timestamp, jobnum, plan, outputs)
stored in browser localStorage under `hd1_activity_log_v1`.

**Mobile-first:**

- Drop zone tap-target ≥160px tall.
- All buttons ≥44×44 (Apple HIG); inputs `font-size: 16px+` to prevent iOS
  auto-zoom.
- Layout collapses to single column under `sm:` breakpoint.

## Other endpoints

The pre-existing `/api/encode-bundle` endpoint remains and emits the same
RFY+CSV bundle without the PDF; HD1's `/api/hd1/encode-zip` extends this
with the frame-elevation PDF.

## Development

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
```

The `@hytek/rfy-codec` package is pinned to a specific commit hash in
`package.json`; pull a new commit there to update the codec.

## Deployment

Auto-deploys to Vercel on push to `master`. The HD1 page is linked from the
HYTEK Hub portal at `https://hub.hytekframing.com.au/portal`.

## Reference

- Brand: yellow `#FFCB05`, black `#231F20`, `hytek-group-logo.png` in header.
- Date format: DD/MM/YYYY.
- See `docs/HD1-USER-GUIDE.md` for the full HD1 walkthrough.
