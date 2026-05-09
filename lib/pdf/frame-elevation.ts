// Frame-elevation PDF generator.
//
// Renders each frame in an RfyDocument as one PDF page: a 2D elevation
// drawing showing every stick (positioned via outlineCorners in mm) with
// every tooling op marked at its `pos` (or startPos..endPos for spanned
// ops) along the stick's midline.
//
// Replaces FrameCAD Detailer's Manufacturing PDFs (Detailer EOL 2026-05-14).
//
// One page per frame. Auto-fits to A3 (default), A4, or letter, with a
// 25mm margin and a title block at the top showing job/plan/frame metadata.
//
// pdf-lib is the only PDF dep — runs server-side (Node) or client-side
// without binary native modules. No Puppeteer (heavy + slow on Vercel).
//
// Coordinate systems:
//   - Stick data:  elevation mm, +y up (FrameCAD convention from XML)
//   - PDF page:    points (1pt = 1/72 inch), origin bottom-left, +y up
//
// We pick a uniform mm→pt scale per page so the frame fills the drawing
// area, then translate so the frame's bbox.minX/minY map to the drawing
// area's bottom-left.

import {
  PDFDocument,
  PDFPage,
  StandardFonts,
  rgb,
  type RGB,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  closePath,
  fillAndStroke,
  fill,
  stroke,
  setFillingColor,
  setStrokingColor,
  setLineWidth,
} from "pdf-lib";
import type {
  RfyDocument,
  RfyFrame,
  RfyStick,
  RfyToolingOp,
  ToolType,
} from "@hytek/rfy-codec";

// ---------- Public API ----------

export type PdfPageSize = "A3" | "A4" | "letter";

export interface PdfOptions {
  /** Page size — A3 default for readability. */
  pageSize?: PdfPageSize;
  /**
   * Override mm→pt scale. Default: auto-fit to drawing area. Specifying
   * forces a uniform scale (useful for at-scale plots). Units: pt per mm.
   */
  scale?: number;
  /** Show overall length + height dimension labels. Default true. */
  showDimensions?: boolean;
  /** Show tooling-mark symbols. Default true. */
  showToolingMarks?: boolean;
}

/**
 * Generate a multi-page PDF from a parsed RFY document. One page per
 * frame across all plans. Returns a Uint8Array of PDF bytes.
 */
export async function generateFramePdf(
  doc: RfyDocument,
  options: PdfOptions = {}
): Promise<Uint8Array> {
  const opts: Required<PdfOptions> = {
    pageSize: options.pageSize ?? "A3",
    scale: options.scale ?? 0,
    showDimensions: options.showDimensions ?? true,
    showToolingMarks: options.showToolingMarks ?? true,
  };

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.project.name} — Frame Elevations`);
  pdf.setAuthor("HYTEK RFY Tools");
  pdf.setProducer("hytek-rfy-tools / pdf-lib");
  pdf.setCreator("hytek-rfy-tools");

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let pageCount = 0;
  for (const plan of doc.project.plans) {
    for (const frame of plan.frames) {
      const page = pdf.addPage(pageDims(opts.pageSize));
      drawFramePage(page, doc, plan.name, frame, helv, helvBold, opts);
      pageCount++;
    }
  }

  // Empty doc safeguard — pdf-lib refuses to save 0-page PDFs.
  if (pageCount === 0) {
    const page = pdf.addPage(pageDims(opts.pageSize));
    page.drawText("No frames in this document.", {
      x: 60,
      y: page.getHeight() - 60,
      size: 14,
      font: helv,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  return await pdf.save();
}

// ---------- Page dimensions ----------

const PAGE_DIMS: Record<PdfPageSize, [number, number]> = {
  // pdf-lib units are points; standard ISO/letter sizes:
  A3: [841.89, 1190.55], // 297 × 420 mm
  A4: [595.28, 841.89],  // 210 × 297 mm
  letter: [612, 792],     // 8.5 × 11 in
};

function pageDims(size: PdfPageSize): [number, number] {
  // Landscape orientation — frames are typically wider than tall.
  const [a, b] = PAGE_DIMS[size];
  return [b, a]; // swap to landscape (width > height)
}

// ---------- Tool color palette ----------
// Mirror of app/viewer/lib/tool-colors.ts but as RGB tuples for pdf-lib.
// Kept in-sync manually — both files document the same palette decision.

const TOOL_COLOR: Record<ToolType, RGB> = {
  LipNotch: rgb(0.94, 0.27, 0.27),       // #ef4444
  LeftFlange: rgb(0.98, 0.45, 0.09),      // #f97316
  RightFlange: rgb(0.93, 0.28, 0.6),      // #ec4899
  LeftPartialFlange: rgb(0.98, 0.44, 0.52), // #fb7185
  RightPartialFlange: rgb(0.99, 0.64, 0.69), // #fda4af
  InnerDimple: rgb(0.98, 0.8, 0.08),       // #facc15 (HYTEK yellow-adjacent)
  Swage: rgb(0.96, 0.62, 0.04),            // #f59e0b
  InnerNotch: rgb(0.66, 0.33, 0.97),       // #a855f7
  Web: rgb(0.02, 0.71, 0.83),              // #06b6d4
  Bolt: rgb(0.23, 0.51, 0.96),             // #3b82f6
  ScrewHoles: rgb(0.13, 0.77, 0.37),       // #22c55e
  InnerService: rgb(0.08, 0.72, 0.65),     // #14b8a6
  Chamfer: rgb(0.52, 0.8, 0.09),           // #84cc16
  TrussChamfer: rgb(0.52, 0.8, 0.09),      // same — same physical op
};

// ---------- Geometry helpers (mirror app/viewer/lib/geometry.ts) ----------

interface Pt { x: number; y: number; }
interface Midline {
  start: Pt;
  end: Pt;
  length: number;
  angle: number; // radians
  thickness: number;
}
interface BBox { minX: number; minY: number; maxX: number; maxY: number; }

function stickMidline(stick: RfyStick): Midline | null {
  const corners = stick.outlineCorners;
  if (!corners || corners.length !== 4) return null;
  const edges = [0, 1, 2, 3].map(i => {
    const a = corners[i]!, b = corners[(i + 1) % 4]!;
    return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  const sorted = [...edges].sort((x, y) => x.len - y.len);
  const short1 = sorted[0]!, short2 = sorted[1]!;
  const mid = (e: typeof short1): Pt => ({
    x: (e.a.x + e.b.x) / 2,
    y: (e.a.y + e.b.y) / 2,
  });
  const m1 = mid(short1), m2 = mid(short2);
  const [s, e] = m1.y < m2.y || (m1.y === m2.y && m1.x < m2.x) ? [m1, m2] : [m2, m1];
  const length = Math.hypot(e.x - s.x, e.y - s.y);
  const angle = Math.atan2(e.y - s.y, e.x - s.x);
  return { start: s, end: e, length, angle, thickness: short1.len };
}

function posAlongStick(m: Midline, pos: number): Pt {
  const t = m.length === 0 ? 0 : pos / m.length;
  return {
    x: m.start.x + (m.end.x - m.start.x) * t,
    y: m.start.y + (m.end.y - m.start.y) * t,
  };
}

/**
 * Compute web-direction overrides for vertical studs in a wall frame.
 *
 * The structural rule (Scott, 2026-05-09): for end studs at frame
 * extremes AND for jamb studs at door/window openings, the WEB always
 * faces inward — toward the frame interior or the opening interior —
 * regardless of what FrameCAD writes in `<flipped>`. Lips face outward
 * (toward the wall edge or away from the opening).
 *
 * Without this override, the C-marker and thicker-web-edge indicators
 * point the wrong way on these specific studs (FrameCAD's flipped
 * attribute alone is not enough to recover the structural orientation).
 *
 * Returned map: stick.name → lipSign (+1 or -1). Sticks not in the map
 * fall back to FrameCAD's `flipped` attribute. Convention:
 *   lipSign = +1 → lips on +perp side (LEFT for vertical stud)  → web on RIGHT
 *   lipSign = -1 → lips on -perp side (RIGHT for vertical stud) → web on LEFT
 *
 * Detection rules:
 *   1. FRAME ENDS — leftmost & rightmost vertical studs in the frame.
 *      Leftmost  → lips on LEFT (lipSign=+1) → web faces RIGHT (interior).
 *      Rightmost → lips on RIGHT (lipSign=-1) → web faces LEFT (interior).
 *   2. OPENING JAMBS — vertical studs whose cross-stick X coincides
 *      (within tolerance) with the END of any partial-width horizontal
 *      member (sill, header, nog at opening). The horizontal member's
 *      MIN-X side is the LEFT jamb (lips on LEFT, web faces opening to
 *      the RIGHT); MAX-X side is the RIGHT jamb (lips on RIGHT, web
 *      faces opening to the LEFT).
 */
function computeWebOverrides(
  frame: RfyFrame,
  bbox: BBox,
): Map<string, 1 | -1> {
  const overrides = new Map<string, 1 | -1>();

  // Index every stick once with its midline; bail early if a stick has
  // no outline corners (can't classify or position).
  type SM = { stick: RfyStick; m: Midline; crossX: number };
  const sticks: SM[] = [];
  for (const stick of frame.sticks) {
    const m = stickMidline(stick);
    if (!m) continue;
    sticks.push({ stick, m, crossX: (m.start.x + m.end.x) / 2 });
  }

  // Same threshold as isStudStyleStick — must agree with the rendering
  // path, otherwise overrides target the wrong sticks.
  const isVertical = (m: Midline) => Math.abs(Math.sin(m.angle)) > 0.5;
  const verticals = sticks.filter(s => isVertical(s.m));
  const horizontals = sticks.filter(s => !isVertical(s.m));
  if (verticals.length === 0) return overrides;

  // Sort vertical studs by cross-stick X.
  const sortedV = [...verticals].sort((a, b) => a.crossX - b.crossX);

  // RULE 1 — frame-end studs.
  // Pick the leftmost stud(s) and rightmost stud(s) that sit within
  // EXTREME_TOL_MM of the frame's bbox extreme — handles double-stacked
  // corner studs (two studs at the same end position both qualify).
  const EXTREME_TOL_MM = 25;
  const leftEdgeX = sortedV[0]!.crossX;
  const rightEdgeX = sortedV[sortedV.length - 1]!.crossX;
  for (const v of sortedV) {
    if (v.crossX <= leftEdgeX + EXTREME_TOL_MM) {
      overrides.set(v.stick.name, +1); // left-end: lips LEFT, web RIGHT (interior)
    }
    if (v.crossX >= rightEdgeX - EXTREME_TOL_MM) {
      overrides.set(v.stick.name, -1); // right-end: lips RIGHT, web LEFT (interior)
    }
  }

  // RULE 2 — opening jambs.
  // A horizontal stick whose elevation length is significantly less than
  // the frame's width is an opening member (sill, header, infill nog).
  // Vertical studs whose X coincides with that horizontal's start-X or
  // end-X are jambs.
  const frameWidth = bbox.maxX - bbox.minX;
  const PARTIAL_THRESHOLD = 0.85; // member spanning <85% of width = opening
  const JAMB_TOL_MM = 30;          // jamb stud within 30mm of horizontal endpoint

  for (const h of horizontals) {
    const hLen = Math.abs(h.m.end.x - h.m.start.x);
    if (hLen / frameWidth >= PARTIAL_THRESHOLD) continue;

    const hMin = Math.min(h.m.start.x, h.m.end.x);
    const hMax = Math.max(h.m.start.x, h.m.end.x);

    for (const v of verticals) {
      if (overrides.has(v.stick.name)) continue; // frame-end takes priority
      if (Math.abs(v.crossX - hMin) < JAMB_TOL_MM) {
        // Stud sits at LEFT end of opening — its web should face RIGHT
        // (into opening). lips on LEFT.
        overrides.set(v.stick.name, +1);
      } else if (Math.abs(v.crossX - hMax) < JAMB_TOL_MM) {
        // Stud sits at RIGHT end of opening — web faces LEFT (into opening).
        overrides.set(v.stick.name, -1);
      }
    }
  }

  return overrides;
}

function frameBBox(frame: RfyFrame): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (const stick of frame.sticks) {
    if (!stick.outlineCorners) continue;
    for (const c of stick.outlineCorners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
      any = true;
    }
  }
  if (!any) {
    // Fall back to frame.length × frame.height
    if (frame.length && frame.height) {
      return { minX: 0, minY: 0, maxX: frame.length, maxY: frame.height };
    }
    return null;
  }
  return { minX, minY, maxX, maxY };
}

// ---------- Page rendering ----------

interface PageLayout {
  /** mm → pt scale factor. */
  s: number;
  /** Drawing-area origin in pt: corresponds to (bbox.minX, bbox.minY). */
  ox: number;
  oy: number;
  /** Title block bottom-y in pt — drawing area is below this. */
  titleBottomPt: number;
}

const MARGIN_PT = 36;          // ~12.7mm — page margin
const TITLE_HEIGHT_PT = 60;    // title block at top
const FOOTER_HEIGHT_PT = 24;   // optional footer

/**
 * True iff the plan is a wall plan whose sticks should render in
 * "wall-elevation" style — thin outlined rectangles (no fill for studs).
 *
 * Pattern matches `-LBW-` and `-NLBW-` (load-bearing + non-load-bearing
 * wall) plan suffixes case-insensitively. Same regex used elsewhere in the
 * codec (`isWallServicePlanName` in @hytek/rfy-codec/src/simplify-wall-service.ts)
 * so behaviour stays consistent if/when more plan types adopt the wall
 * convention.
 *
 * For walls the operator's view is perpendicular to the wall face — the
 * 89mm web is INTO the page and only the 41mm flange edge is visible.
 * Detailer renders this convention as thin hairline-ish outlined rectangles;
 * we mirror that here so the PDFs read the same as the EOL Detailer output
 * Scott's been using for years.
 */
function isWallPlan(planName: string): boolean {
  return /-(N?LBW)-/i.test(planName);
}

/**
 * True iff the stick should render in stud-style (outlined hairline +
 * C-section orientation marker) inside a wall elevation. False = plate-style
 * (filled rectangle, no marker).
 *
 * Detection is **angle-based**, not usage-based. Reason: the codec's
 * `inferStickType` only classifies top/bottom/head plates as "plate" and
 * lumps EVERYTHING else (studs, nogs, sills, braces, jackstuds, trimstuds)
 * under "stud". That misses horizontal members at openings:
 *
 *   - Sills (bottom of window openings)   — horizontal C-channel
 *   - Nogs (stiffeners between studs)     — horizontal C-channel
 *   - Trim/jack studs at door/window jambs — vertical C-channel
 *   - Braces (Kb1, Kb2)                    — diagonal C-channel
 *
 * Detailer's elevation rule is: anything running HORIZONTALLY in the wall
 * face (top/bottom plates, headers, sills, nogs) gets the filled-rectangle
 * "plate" treatment because the operator sees its full flange edge across
 * the wall. Anything VERTICAL or DIAGONAL (studs, jacks, trims, braces)
 * gets the hairline + C-marker treatment because the operator only sees
 * its 41mm flange edge end-on.
 *
 * Threshold: 45° (|sin(angle)| > 0.5). Anything more vertical than
 * horizontal → stud-style. Braces at typical 30-60° diagonal → stud-style
 * (matches Detailer — braces render as hairlines, not filled rectangles).
 */
function isStudStyleStick(midline: Midline): boolean {
  return Math.abs(Math.sin(midline.angle)) > 0.5;
}

function drawFramePage(
  page: PDFPage,
  doc: RfyDocument,
  planName: string,
  frame: RfyFrame,
  font: any,
  fontBold: any,
  opts: Required<PdfOptions>
): void {
  const W = page.getWidth();
  const H = page.getHeight();

  // Title block at top.
  drawTitleBlock(page, doc, planName, frame, font, fontBold, W, H);

  // Drawing-area bbox in pt.
  const drawX0 = MARGIN_PT;
  const drawY0 = MARGIN_PT + FOOTER_HEIGHT_PT;
  const drawX1 = W - MARGIN_PT;
  const drawY1 = H - MARGIN_PT - TITLE_HEIGHT_PT;
  const drawW = drawX1 - drawX0;
  const drawH = drawY1 - drawY0;

  const bb = frameBBox(frame);
  if (!bb) {
    page.drawText(`Frame ${frame.name}: no geometry.`, {
      x: drawX0 + 10,
      y: drawY1 - 20,
      size: 12,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    return;
  }

  // mm → pt scale: fit-to-area (with 5% inner pad) unless overridden.
  const widthMm = bb.maxX - bb.minX;
  const heightMm = bb.maxY - bb.minY;
  const padFrac = 0.04;
  const sFit =
    Math.min(drawW / widthMm, drawH / heightMm) * (1 - padFrac * 2);
  const s = opts.scale > 0 ? opts.scale : sFit;

  // Center the frame in the drawing area at the chosen scale.
  const renderedWidth = widthMm * s;
  const renderedHeight = heightMm * s;
  const ox = drawX0 + (drawW - renderedWidth) / 2 - bb.minX * s;
  const oy = drawY0 + (drawH - renderedHeight) / 2 - bb.minY * s;

  const layout: PageLayout = { s, ox, oy, titleBottomPt: drawY1 };

  // Frame outline (light reference rectangle for the bbox).
  page.drawRectangle({
    x: ox + bb.minX * s,
    y: oy + bb.minY * s,
    width: widthMm * s,
    height: heightMm * s,
    borderColor: rgb(0.85, 0.85, 0.85),
    borderWidth: 0.5,
  });

  // Sticks.
  // wallStyle = render vertical/diagonal sticks as outline-only thin
  // rectangles with C-section orientation marker (matches Detailer's wall
  // elevation convention: web into the page, only the flange edge visible —
  // reads as a hairline at scale). Horizontal sticks (plates, headers,
  // sills, nogs) stay filled. Truss/floor plans keep the current
  // filled-rectangle look for everything since the 89mm web IS in the
  // elevation plane there.
  //
  // webOverrides: for wall plans, force web direction on frame-end studs
  // and opening jamb studs — they always face inward regardless of
  // FrameCAD's `flipped` attribute (structural rule, see
  // computeWebOverrides docstring).
  const wallStyle = isWallPlan(planName);
  const webOverrides = wallStyle ? computeWebOverrides(frame, bb) : new Map<string, 1 | -1>();
  for (const stick of frame.sticks) {
    drawStick(page, stick, layout, font, opts, wallStyle, webOverrides);
  }

  // Dimension lines (simple — overall width + height of bbox).
  if (opts.showDimensions) {
    drawOverallDimensions(page, bb, layout, font);
  }
}

function drawTitleBlock(
  page: PDFPage,
  doc: RfyDocument,
  planName: string,
  frame: RfyFrame,
  font: any,
  fontBold: any,
  W: number,
  H: number
): void {
  const x0 = MARGIN_PT;
  const y1 = H - MARGIN_PT;
  const y0 = y1 - TITLE_HEIGHT_PT;
  const x1 = W - MARGIN_PT;

  // Title block border.
  page.drawRectangle({
    x: x0,
    y: y0,
    width: x1 - x0,
    height: TITLE_HEIGHT_PT,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
    color: rgb(1, 0.95, 0.7), // light HYTEK yellow tint
  });

  // HYTEK brand bar on the right.
  page.drawRectangle({
    x: x1 - 110,
    y: y0,
    width: 110,
    height: TITLE_HEIGHT_PT,
    color: rgb(0.137, 0.122, 0.125), // HYTEK black #231F20
  });
  page.drawText("HYTEK", {
    x: x1 - 95,
    y: y0 + TITLE_HEIGHT_PT / 2 - 4,
    size: 18,
    font: fontBold,
    color: rgb(1, 0.796, 0.02), // HYTEK yellow #FFCB05
  });

  // Left-side metadata.
  const padX = 10;
  const lineH = 12;
  let cy = y1 - 16;
  page.drawText(`Frame: ${frame.name}`, {
    x: x0 + padX,
    y: cy,
    size: 13,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  cy -= lineH;
  page.drawText(`Plan: ${planName}`, {
    x: x0 + padX,
    y: cy,
    size: 9,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  cy -= lineH;

  const lengthM = (frame.length ?? 0) / 1000;
  const heightM = (frame.height ?? 0) / 1000;
  page.drawText(
    `Length: ${lengthM.toFixed(3)} m   Height: ${heightM.toFixed(3)} m   Weight: ${(frame.weight ?? 0).toFixed(1)} kg`,
    {
      x: x0 + padX,
      y: cy,
      size: 9,
      font,
      color: rgb(0.2, 0.2, 0.2),
    }
  );

  // Center: project + job number.
  const centerX = x0 + (x1 - x0) / 2 - 100;
  page.drawText(`Project: ${truncate(doc.project.name, 60)}`, {
    x: centerX,
    y: y1 - 16,
    size: 9,
    font: fontBold,
    color: rgb(0, 0, 0),
    maxWidth: 200,
  });
  page.drawText(`Job: ${doc.project.jobNum || "-"}   Date: ${doc.project.date || "-"}`, {
    x: centerX,
    y: y1 - 28,
    size: 9,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText(`Sticks: ${frame.sticks.length}`, {
    x: centerX,
    y: y1 - 40,
    size: 9,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
}

function drawStick(
  page: PDFPage,
  stick: RfyStick,
  layout: PageLayout,
  font: any,
  opts: Required<PdfOptions>,
  wallStyle: boolean,
  webOverrides: Map<string, 1 | -1>
): void {
  const m = stickMidline(stick);
  if (!m) return;

  const corners = stick.outlineCorners!;
  const { s, ox, oy } = layout;

  // Stick body — polygon from outline corners.
  //
  // BUG (2026-05-09): pdf-lib's `drawSvgPath` applies `scale(1, -1)` to
  // flip the SVG Y axis (SVG = Y-down, PDF = Y-up). Without an explicit
  // `y:` translate option that defaults to `0`, polygon coordinates land
  // at NEGATIVE Y on the PDF page — i.e. off-page, completely invisible.
  // Verified against HG260002 5 MOSSIP COURT WELLINGTON POINT-GF-LBW
  // production XML (1431 sticks rendered to nowhere).
  //
  // Fix: emit raw PDF path operators directly. PDF native moveto/lineto
  // operate in PDF coordinate space (Y-up, origin bottom-left), no flip.
  const polyPts = corners.map(c => ({
    x: ox + c.x * s,
    y: oy + c.y * s,
  }));

  // Render style:
  //   - Wall plan + VERTICAL/DIAGONAL stick (studs, jack/trim/end studs,
  //     braces) → outline only, no fill, plus a C-section orientation
  //     marker below the start end and a thicker stroke on the web edge.
  //     The 41mm flange-edge thickness reads as a hairline at typical
  //     page scale, matching Detailer's wall-elevation convention
  //     (verified side-by-side against HG260002 GF-NLBW-89.075 frame
  //     N37 reference PDF, 2026-05-09).
  //   - Wall plan + HORIZONTAL stick (top/bottom plates, headers, sills,
  //     nogs) → keep the filled rectangle look. Detailer also draws
  //     these as visible filled members because the operator sees their
  //     full flange edge across the wall face. They don't get a C-marker
  //     (orientation is implied by their installation context).
  //   - Truss/floor plans → keep filled rectangle. The 89mm web IS in the
  //     elevation plane there, so the wider visual presence is correct.
  const studOutlineOnly = wallStyle && isStudStyleStick(m);
  drawFilledPolygon(
    page,
    polyPts,
    studOutlineOnly ? null : rgb(0.85, 0.86, 0.88),  // light steel grey fill (omit for wall studs)
    rgb(0.27, 0.27, 0.3),                             // darker grey outline
    0.5
  );

  // Wall-stud orientation indicators — match Detailer's elevation convention:
  //   1. Web edge (closed back of the C-section) drawn THICKER than the lip
  //      edge. Operator can see at a glance which way the C is facing on
  //      the assembled wall.
  //   2. Small C-section symbol below the start end, opening toward the
  //      LIPS (= away from the web).
  //
  // The two markers always agree: web side and lip side are opposite faces
  // of the stick, so their directions are slaved to a single sign.
  //
  // Sign convention (verified against the rectangle CCW corner ordering
  // produced by buildStickElevationGraphics in the codec):
  //   corners[0] = start + perp × half     ←  +perp side
  //   corners[1] = end   + perp × half     ←  +perp side
  //   corners[2] = end   - perp × half     ←  -perp side
  //   corners[3] = start - perp × half     ←  -perp side
  // where perp = (-dirY, dirX) — i.e. 90° CCW of stick direction.
  // For a vertical stud going up: +perp = LEFT (in elevation), -perp = RIGHT.
  //
  // Default (interior studs): use FrameCAD's `flipped` attribute
  //   flipped=false → lips on +perp (LEFT)  → web on -perp (RIGHT)
  //   flipped=true  → lips on -perp (RIGHT) → web on +perp (LEFT)
  //
  // OVERRIDE (frame-end studs and opening jamb studs): force lipSign
  // by structural position so the web faces inward regardless of what
  // FrameCAD wrote in `<flipped>`. See computeWebOverrides.
  if (studOutlineOnly) {
    const fallback = stick.flipped ? -1 : +1;
    const lipSign: 1 | -1 = webOverrides.get(stick.name) ?? (fallback as 1 | -1);
    // Web edge = the long edge OPPOSITE the lip side.
    // lipSign=+1 → lips on +perp (edge 0-1) → web on -perp (edge 2-3)
    // lipSign=-1 → lips on -perp (edge 2-3) → web on +perp (edge 0-1)
    const webEdge = lipSign === +1
      ? { a: polyPts[2]!, b: polyPts[3]! }
      : { a: polyPts[0]!, b: polyPts[1]! };
    page.drawLine({
      start: webEdge.a,
      end: webEdge.b,
      thickness: 1.4,                       // ~3× the regular outline (0.5pt)
      color: rgb(0.1, 0.1, 0.1),
    });
    drawCSectionMarker(page, m, lipSign, layout);
  }

  // Stick label at midpoint.
  const labelMid = posAlongStick(m, m.length / 2);
  const labelPt = { x: ox + labelMid.x * s, y: oy + labelMid.y * s };
  const labelSize = 5;
  // Rotate the label along the stick angle, but keep upright if vertical.
  const angleDeg = (m.angle * 180) / Math.PI;
  // Skip rotation: pdf-lib supports rotate via degrees(); but the label is
  // small enough that horizontal-only is readable. Future TODO: rotate.
  page.drawText(stick.name, {
    x: labelPt.x - (stick.name.length * labelSize * 0.3),
    y: labelPt.y - labelSize / 2,
    size: labelSize,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });

  // Tooling marks.
  if (opts.showToolingMarks) {
    for (const op of stick.tooling) {
      drawToolOp(page, op, m, layout);
    }
  }
}

function drawToolOp(
  page: PDFPage,
  op: RfyToolingOp,
  midline: Midline,
  layout: PageLayout
): void {
  const { s, ox, oy } = layout;
  const color = TOOL_COLOR[op.type] ?? rgb(0.5, 0.5, 0.5);
  // Marker radius in pt — small but visible. Scales weakly with overall scale.
  const r = Math.max(1.2, Math.min(3, 1.5 + s * 6));

  if (op.kind === "point") {
    const p = posAlongStick(midline, op.pos);
    const pt = { x: ox + p.x * s, y: oy + p.y * s };
    drawMarker(page, pt, op.type, r, color);
  } else if (op.kind === "spanned") {
    // Draw start, end, and a connecting line at the midline.
    const a = posAlongStick(midline, op.startPos);
    const b = posAlongStick(midline, op.endPos);
    const aPt = { x: ox + a.x * s, y: oy + a.y * s };
    const bPt = { x: ox + b.x * s, y: oy + b.y * s };
    page.drawLine({
      start: aPt,
      end: bPt,
      thickness: 0.8,
      color,
    });
    drawMarker(page, aPt, op.type, r * 0.9, color);
    drawMarker(page, bPt, op.type, r * 0.9, color);
  } else {
    // Edge tool — draw at start or end of stick.
    const p = op.kind === "start"
      ? midline.start
      : midline.end;
    const pt = { x: ox + p.x * s, y: oy + p.y * s };
    drawMarker(page, pt, op.type, r * 1.1, color);
  }
}

/**
 * Draw a tool-type-specific symbol at point pt.
 *
 * Symbol shapes (loosely match Detailer's conventions):
 *   InnerDimple, Bolt, Web, ScrewHoles → small filled circle
 *   Swage                              → small filled rectangle (rib)
 *   LipNotch + flange variants         → small triangle (V-cut)
 *   InnerNotch                         → square outline (web cutout)
 *   InnerService                       → oval (slot)
 *   Chamfer / TrussChamfer             → small ✕
 */
function drawMarker(
  page: PDFPage,
  pt: { x: number; y: number },
  type: ToolType,
  r: number,
  color: RGB
): void {
  switch (type) {
    case "InnerDimple":
    case "Bolt":
    case "Web":
    case "ScrewHoles":
      page.drawCircle({ x: pt.x, y: pt.y, size: r, color, borderWidth: 0 });
      break;
    case "Swage":
      page.drawRectangle({
        x: pt.x - r * 1.4,
        y: pt.y - r * 0.5,
        width: r * 2.8,
        height: r,
        color,
        borderWidth: 0,
      });
      break;
    case "LipNotch":
    case "LeftFlange":
    case "RightFlange":
    case "LeftPartialFlange":
    case "RightPartialFlange": {
      // V-shape (filled triangle) — drawn via raw operators to avoid the
      // pdf-lib `drawSvgPath` Y-flip bug (see drawStick comment).
      drawFilledPolygon(
        page,
        [
          { x: pt.x - r, y: pt.y - r },
          { x: pt.x, y: pt.y + r },
          { x: pt.x + r, y: pt.y - r },
        ],
        color,
        null,
        0
      );
      break;
    }
    case "InnerNotch":
      page.drawRectangle({
        x: pt.x - r,
        y: pt.y - r,
        width: r * 2,
        height: r * 2,
        borderColor: color,
        borderWidth: 0.8,
      });
      break;
    case "InnerService": {
      // Stretched oval — pdf-lib has drawEllipse.
      page.drawEllipse({
        x: pt.x,
        y: pt.y,
        xScale: r * 1.6,
        yScale: r * 0.7,
        color,
        borderWidth: 0,
      });
      break;
    }
    case "Chamfer":
    case "TrussChamfer": {
      // X-shape (two crossed lines) — pdf-lib's drawLine works in native
      // PDF coords (no Y flip), so this is safe.
      page.drawLine({
        start: { x: pt.x - r, y: pt.y - r },
        end: { x: pt.x + r, y: pt.y + r },
        thickness: 1.2,
        color,
      });
      page.drawLine({
        start: { x: pt.x - r, y: pt.y + r },
        end: { x: pt.x + r, y: pt.y - r },
        thickness: 1.2,
        color,
      });
      break;
    }
    default:
      page.drawCircle({ x: pt.x, y: pt.y, size: r, color, borderWidth: 0 });
  }
}

function drawOverallDimensions(
  page: PDFPage,
  bb: BBox,
  layout: PageLayout,
  font: any
): void {
  const { s, ox, oy } = layout;
  const widthMm = bb.maxX - bb.minX;
  const heightMm = bb.maxY - bb.minY;

  // Width dim — horizontal line below frame.
  const yLine = oy + bb.minY * s - 14;
  const xL = ox + bb.minX * s;
  const xR = ox + bb.maxX * s;
  page.drawLine({
    start: { x: xL, y: yLine },
    end: { x: xR, y: yLine },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  });
  // End ticks.
  page.drawLine({ start: { x: xL, y: yLine - 3 }, end: { x: xL, y: yLine + 3 }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
  page.drawLine({ start: { x: xR, y: yLine - 3 }, end: { x: xR, y: yLine + 3 }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
  // Label.
  const label = `${widthMm.toFixed(0)} mm`;
  page.drawText(label, {
    x: (xL + xR) / 2 - label.length * 2.5,
    y: yLine - 10,
    size: 8,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });

  // Height dim — vertical line right of frame.
  const xLine = ox + bb.maxX * s + 14;
  const yB = oy + bb.minY * s;
  const yT = oy + bb.maxY * s;
  page.drawLine({
    start: { x: xLine, y: yB },
    end: { x: xLine, y: yT },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  });
  page.drawLine({ start: { x: xLine - 3, y: yB }, end: { x: xLine + 3, y: yB }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
  page.drawLine({ start: { x: xLine - 3, y: yT }, end: { x: xLine + 3, y: yT }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
  const hLabel = `${heightMm.toFixed(0)} mm`;
  page.drawText(hLabel, {
    x: xLine + 5,
    y: (yB + yT) / 2 - 4,
    size: 8,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
}

// ---------- Utilities ----------

/**
 * Draw a small C-section orientation marker outside one end of a stud's
 * midline. Matches Detailer's elevation convention: a bracket-shape
 * symbol that tells the operator which way the open side of the
 * C-channel faces (lip direction).
 *
 * Geometry (3-segment polyline forming a bracket):
 *   - Web on one side (vertical line, closed back of the C)
 *   - Two flanges extending toward the lips (top + bottom horizontal lines)
 *   - Open side (no line) = where the lips face
 *
 * `lipSign` parameter: +1 if lips face +perp (90° CCW of stick direction),
 * -1 if lips face -perp. Caller derives this from `stick.flipped` and
 * passes the SAME sign used to pick the thicker web edge on the stick
 * outline — guaranteeing the two indicators always agree.
 *
 * Placed at the stick's start end, offset OUTSIDE the stick by OFFSET_PT
 * so it sits clear of the outline and doesn't overlap tooling marks. Size
 * is fixed in PDF points so the marker reads at any page scale.
 */
function drawCSectionMarker(
  page: PDFPage,
  m: Midline,
  lipSign: 1 | -1,
  layout: PageLayout,
): void {
  const { s, ox, oy } = layout;

  // Marker size in PDF points — fixed visual size regardless of frame scale.
  const SIZE = 7;             // overall bracket height (web length, in stick-local "along" axis)
  const FLANGE = SIZE * 0.6;  // flange-arm length (lips direction)
  const OFFSET_PT = 12;       // gap between stick start and marker centre

  // Direction along the stick (start → end) and its perpendicular.
  const dirX = Math.cos(m.angle);
  const dirY = Math.sin(m.angle);

  // Place marker centre OUTSIDE the start end (one OFFSET_PT step opposite
  // the stick's forward direction). For a vertical stud this puts the
  // marker BELOW the bottom of the stud.
  const cx = ox + m.start.x * s - dirX * OFFSET_PT;
  const cy = oy + m.start.y * s - dirY * OFFSET_PT;

  // Bracket points in stick-LOCAL coords (lx = along stick, ly = across):
  //   top-flange-tip = (+halfWeb, lipSign*FLANGE)
  //   web-top        = (+halfWeb, 0)
  //   web-bot        = (-halfWeb, 0)
  //   bot-flange-tip = (-halfWeb, lipSign*FLANGE)
  // Polyline goes top-flange-tip → web-top → web-bot → bot-flange-tip,
  // which is the 3 strokes (top flange, web, bottom flange) of the bracket.
  // The "open" side faces +lipSign × perp = the lip direction. ✓
  const halfWeb = SIZE / 2;
  const pts = [
    { lx: +halfWeb, ly: lipSign * FLANGE },
    { lx: +halfWeb, ly: 0 },
    { lx: -halfWeb, ly: 0 },
    { lx: -halfWeb, ly: lipSign * FLANGE },
  ].map(({ lx, ly }) => ({
    // Rotate (lx, ly) into PDF coords using stick angle, then translate
    // to (cx, cy). local-x maps along (dirX, dirY); local-y maps along
    // (-dirY, dirX) (90° CCW perpendicular = +perp).
    x: cx + lx * dirX + ly * (-dirY),
    y: cy + lx * dirY + ly * dirX,
  }));

  for (let i = 0; i < pts.length - 1; i++) {
    page.drawLine({
      start: pts[i]!,
      end: pts[i + 1]!,
      thickness: 0.7,
      color: rgb(0.15, 0.15, 0.15),
    });
  }
}

/**
 * Draw a filled+stroked polygon using raw PDF path operators.
 *
 * Why not `page.drawSvgPath()`? Because pdf-lib's drawSvgPath applies a
 * `scale(1, -1)` Y-flip (since SVG's Y axis is opposite PDF's), and without
 * an explicit `y:` translation option the polygon coordinates land at
 * NEGATIVE Y — i.e. off the visible page. This silently broke every PDF
 * the renderer produced (Agent 2's tests only checked byte length and
 * page count, never that anything was visible).
 *
 * Raw moveto/lineto operate in PDF user-space directly, so coordinates
 * are interpreted exactly as we computed them (origin bottom-left, Y-up).
 *
 * @param fill   Fill colour, or null for no fill (stroke-only).
 * @param stroke Stroke colour, or null for fill-only.
 * @param strokeWidth Border width in PDF points; 0 = no stroke.
 */
function drawFilledPolygon(
  page: PDFPage,
  pts: Pt[],
  fillColor: RGB | null,
  strokeColor: RGB | null,
  strokeWidth: number
): void {
  if (pts.length < 3) return;
  const ops: any[] = [pushGraphicsState()];
  if (fillColor) ops.push(setFillingColor(fillColor));
  if (strokeColor && strokeWidth > 0) {
    ops.push(setStrokingColor(strokeColor));
    ops.push(setLineWidth(strokeWidth));
  }
  ops.push(moveTo(pts[0]!.x, pts[0]!.y));
  for (let i = 1; i < pts.length; i++) {
    ops.push(lineTo(pts[i]!.x, pts[i]!.y));
  }
  ops.push(closePath());
  if (fillColor && strokeColor && strokeWidth > 0) {
    ops.push(fillAndStroke());
  } else if (fillColor) {
    ops.push(fill());
  } else if (strokeColor && strokeWidth > 0) {
    ops.push(stroke());
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
