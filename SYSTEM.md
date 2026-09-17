---
app: hytek-rfy-tools
url: https://hytek-rfy-tools.vercel.app
status: side-tool                    # Scott, 17/09/2026 (side-tool decision) — not archived; NOT part of the live business system
live_system: false
role: none                           # no database at all
unattended: none                     # no cron, no vercel.json, no scheduled task — it only runs when a person drops a file on it
shared_tables_owned: []
credential_names: []                 # no .env file, no Vercel environment variables (checked 17/09/2026). Environment names read are local paths/switches only: FORGE_PYTHON, FORGE_CACHE_DIR, DISABLE_ORACLE_CACHE, CORPUS_DIR, CODEC_DIR
supabase:
  project_refs: []
  env: []
tables:
  owns: []
  reads: []
  rpcs: []
hosts:
  approved: []
env:
  privileged: []
crons: []
events:
  out: []
  in: []
exemptions: []
rule9_ok:                            # rule 9: developer-machine fallbacks only; absent on Vercel; nothing scheduled or unattended reads them
  - { path: lib/forge-paths.ts, reason: "developer-machine fallback folder for the FrameCAD Detailer oracle cache, used only when FORGE_CACHE_DIR and the profile OneDrive are absent; absent on Vercel; nothing scheduled" }
  - { path: lib/oracle-cache.ts, reason: "developer-machine fallback folders for the Detailer oracle cache and the HG260044 reference copy; absent on Vercel, where the cache is simply missing; nothing scheduled" }
  - { path: lib/regression.ts, reason: "developer-machine default for the rfy-codec test corpus (CORPUS_DIR overrides it), read by the /regression page a person opens; absent on Vercel; nothing scheduled" }
---

# hytek-rfy-tools — passport

**Status: side tool (Scott, 17/09/2026) — not archived; not part of the live system.**

**Last checked: 17/09/2026**

## What it is

A web page of file converters for FrameCAD rollformer files: `.rfy` to and from
XML, text and CSV, a 3D wall viewer, and **HD1** (`/hd1`), which turns a FrameCAD
XML export into the `.rfy`, CSV and frame PDF the rollformer needs. All the file
work is done by `@hytek/rfy-codec` (pinned to commit `742c0ad6`).

## Who uses it

People reach it from two Hub portal tiles, both behind the owner login
(`ownerOnly` in hytek-hub `lib/apps.ts`): **HD1 — RFY/CSV/PDF Generator** for
admins, supervisors and detailers, and **RFY Tools** for admins and detailers
only. A person drops a file in and downloads the result.

**Worth knowing:** the Hub's own tile comment calls HD1 "critical factory
infrastructure", because the rollformer needs the files it makes. "Side tool"
here means it has no connection to the live system: no database, no events, no
schedule, nothing the Hub calls. It does not mean nobody relies on it. If it
breaks, people lose a way to make machine files, but no other app's data is
affected.

## What it touches

- **Databases and credentials:** none.
- **Local files:** the "oracle cache" (`lib/oracle-cache.ts`) looks for saved
  FrameCAD Detailer outputs in `FORGE_CACHE_DIR` or the user's profile folder.
  The `/forge` pages start a local Python process (`FORGE_PYTHON`). Both are for
  a developer's machine; on Vercel the cache is simply absent.
- **Schedules:** none. The GitHub repo holds only the `ANTHROPIC_API_KEY` secret
  for the org-wide "ai-fix" workflow (runs only when an issue is labelled).

## Checks

`npm test` (vitest) and `npm run typecheck`. Some tests need the Y: drive or the
local Detailer cache and time out on a machine without them. Measured on
17/09/2026 on the work PC: 56 passed, 12 failed and 11 skipped. All 12 failures
were those cache and Y: drive tests, where the OneDrive cache files could not be
read. `npm run typecheck` failed there only because that clone's installed
modules predate `next-themes` and `lucide-react`; `npm ci` fixes it. The canonical
`hytek-brain/tool/architecture-check.ts --root <this repo>` passes against this
passport (checked 17/09/2026). Three files name a `C:\Users\Scott\...` folder as
a developer-machine fallback, so they are listed under `rule9_ok` with the
reason: `lib/forge-paths.ts`, `lib/oracle-cache.ts` and `lib/regression.ts`.
