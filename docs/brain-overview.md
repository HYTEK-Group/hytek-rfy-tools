# Frame Brain — overview

The brain v0 layer lives at `lib/brain/` and reads three JSON catalogues from `data/brain/`. The catalogues describe HYTEK's tooling rules in plain English. v0 doesn't yet drive the rule engine — the existing codec is unchanged — but the catalogues are the input the settings UI (Phase 3) will read and edit, and the rule engine (Phase 5 cutover) will consume.

**Spec:** [docs/superpowers/specs/2026-05-09-hytek-frame-brain-design.md](superpowers/specs/2026-05-09-hytek-frame-brain-design.md)

## Catalogues

| File | Spec § | Entries |
|---|---|---|
| [data/brain/operations.json](../data/brain/operations.json) | §6 — Catalogue A — Tool Operations | 14 operations + 12 stick roles |
| [data/brain/interactions.json](../data/brain/interactions.json) | §7 — Catalogue B — Stick Interactions | 9 interactions |
| [data/brain/frame-contexts.json](../data/brain/frame-contexts.json) | §8 — Catalogue C — Frame Contexts | 8 frame contexts |

## API

`POST /api/brain/encode` — body: FrameCAD `<framecad_import>` XML. Returns a ZIP containing the RFY bytes (same as `/api/encode-bundle`), per-plan CSVs, and a `classification.json` report tagging every emitted operation against Catalogue A.

## UI

`/brain` — upload page that calls the endpoint above and downloads the ZIP.

## Editing rules

v0 is read-only. Catalogue editing comes in Phase 3 (Settings UI). For now, edit the JSON files directly and re-deploy.

## Tests

- `lib/brain/loader.test.ts` — loader + structural validation.
- `lib/brain/catalogues.test.ts` — every spec-listed entry is present.
- `lib/brain/encoder.test.ts` — encoder facade shape.
- `lib/brain/smoke.test.ts` — end-to-end on a fixture XML.

Run: `npm run test`
