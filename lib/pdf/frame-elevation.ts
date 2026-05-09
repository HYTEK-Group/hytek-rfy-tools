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
  degrees,
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
  /**
   * Optional frameName → frame.type map from the source framecad_import XML
   * (e.g. "ExternalWall", "InternalWall", "Truss", "Floor", "RoofPanel").
   *
   * The renderer prefers this signal when present — it's the most reliable
   * way to know which frames need wall-style presentation (outline studs +
   * C-marker) vs truss/floor presentation (filled rectangles). When absent,
   * falls back to plan-name regex (LBW/NLBW), which only catches a subset
   * of wall plans.
   *
   * Why not on RfyFrame directly? The codec's synthesize/decode roundtrip
   * doesn't preserve the type attribute. HD1 collects it from the source
   * XML in framecadImportToRfy and threads it here.
   */
  frameTypes?: Map<string, string>;
  /**
   * Optional frameName → diagonal lines map. Lines are in elevation-mm
   * coords (already projected to the frame's local plane by HD1's
   * framecad-import). Source: `<line layer="0">` elements in the framecad
   * XML — strap-brace diagonals + anchor marks (the X-pattern Detailer
   * draws on bracing pages). Most frames have zero entries; bracing frames
   * carry ~12 lines each.
   */
  frameDiagonals?: Map<string, { start: { x: number; y: number }; end: { x: number; y: number } }[]>;
  /**
   * Optional frameName → fastener positions in elevation-mm coords.
   * Source: `<fastener>` elements in the framecad XML. M6 self-drillers
   * (SKU 001792) cluster at every stud×plate junction; heavy fasteners
   * (count >= 10, e.g. 001539) get a larger marker.
   */
  frameFasteners?: Map<string, { pos: { x: number; y: number }; name: string; count: number }[]>;
  /**
   * Optional frameName → text callouts in elevation-mm coords. Source:
   * `<label>` elements in the framecad XML. Each carries text + size (mm)
   * + rotation angle (deg).
   */
  frameLabels?: Map<string, { pos: { x: number; y: number }; text: string; size: number; angle: number }[]>;
  /**
   * Optional frameName → frame elevation (Z-floor) in mm. The codec doesn't
   * preserve frame.elevation through encode/decode; this side-channel mirrors
   * the frameTypes pattern. Used in the title block "Panel RL" field.
   */
  frameElevations?: Map<string, number>;
  /**
   * Optional frameName → cross-frame join references (which other frames
   * meet this one at its left/right ends). Computed in framecadImportToRfy
   * by matching envelope-bottom corner endpoints in 3D world space.
   * Renders as `<<< Joins L4` and `Joins N3 >>>` in the footer; absent
   * sides render as a literal `?`.
   */
  frameJoins?: Map<string, { left?: string; right?: string }>;
  /**
   * Optional engineering specs that don't live in the per-job framecad
   * XML (they come from the FrameCAD configuration .dat file). Caller
   * supplies them so the PDF footer matches what Detailer would print.
   * Defaults match HYTEK's typical Australian residential setup.
   */
  specs?: {
    /** FrameCAD configuration file name, e.g. "FC_Textor_Qld". */
    systemName?: string;
    /** Wind speed in m/s, e.g. 45. */
    windSpeed?: number;
    /** Design code reference, e.g. "AS/NZS 4600:2018". */
    designCode?: string;
    /** Loading code reference, e.g. "AS/NZS 1170:2021". */
    loadingCode?: string;
    /** Material grade reduction, e.g. "Not Applied". */
    materialGradeReduction?: string;
    /** Compass direction the wall faces, e.g. "E-W" or "N-S". */
    direction?: string;
  };
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
    frameTypes: options.frameTypes ?? new Map(),
    frameDiagonals: options.frameDiagonals ?? new Map(),
    frameFasteners: options.frameFasteners ?? new Map(),
    frameLabels: options.frameLabels ?? new Map(),
    frameElevations: options.frameElevations ?? new Map(),
    frameJoins: options.frameJoins ?? new Map(),
    specs: {
      systemName: options.specs?.systemName ?? "FC_Textor_Qld",
      windSpeed: options.specs?.windSpeed ?? 45,
      designCode: options.specs?.designCode ?? "AS/NZS 4600:2018",
      loadingCode: options.specs?.loadingCode ?? "AS/NZS 1170:2021",
      materialGradeReduction: options.specs?.materialGradeReduction ?? "Not Applied",
      direction: options.specs?.direction ?? "E-W",
    },
  };

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.project.name} — Frame Elevations`);
  pdf.setAuthor("HYTEK RFY Tools");
  pdf.setProducer("hytek-rfy-tools / pdf-lib");
  pdf.setCreator("hytek-rfy-tools");

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Total page count — needed up-front for the "View N of M" footer.
  let totalPages = 0;
  for (const plan of doc.project.plans) totalPages += plan.frames.length;

  let pageCount = 0;
  for (const plan of doc.project.plans) {
    for (const frame of plan.frames) {
      const page = pdf.addPage(pageDims(opts.pageSize));
      pageCount++;
      drawFramePage(page, doc, plan.name, frame, helv, helvBold, opts, pageCount, totalPages);
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
// Bright RGB palette so the operator can identify each tool at a glance
// from the printed PDF. Mirrors `app/viewer/lib/tool-colors.ts` so the
// 3D viewer + the print PDF show the same colour for the same op.
// Restored 2026-05-09 (Scott) after the Detailer-spec rebuild had
// flattened everything to black — the operator workflow needs colour to
// pair the marker on the stick with the legend at the bottom of the page.
// The companion `drawToolingLegend()` builds a per-frame key showing the
// shape + colour + name of every tool used on that frame.

const TOOL_COLOR: Record<ToolType, RGB> = {
  LipNotch: rgb(0.94, 0.27, 0.27),         // #ef4444 red
  LeftFlange: rgb(0.98, 0.45, 0.09),        // #f97316 orange
  RightFlange: rgb(0.93, 0.28, 0.6),        // #ec4899 pink
  LeftPartialFlange: rgb(0.98, 0.44, 0.52), // #fb7185 rose
  RightPartialFlange: rgb(0.99, 0.64, 0.69),// #fda4af light rose
  InnerDimple: rgb(0.98, 0.8, 0.08),        // #facc15 yellow (HYTEK adjacent)
  Swage: rgb(0.96, 0.62, 0.04),             // #f59e0b amber
  InnerNotch: rgb(0.66, 0.33, 0.97),        // #a855f7 purple
  Web: rgb(0.02, 0.71, 0.83),               // #06b6d4 cyan
  Bolt: rgb(0.23, 0.51, 0.96),              // #3b82f6 blue
  ScrewHoles: rgb(0.13, 0.77, 0.37),        // #22c55e green
  InnerService: rgb(0.08, 0.72, 0.65),      // #14b8a6 teal
  Chamfer: rgb(0.52, 0.8, 0.09),            // #84cc16 lime
  TrussChamfer: rgb(0.52, 0.8, 0.09),       // same — same physical op
};

/**
 * Human-readable label for each ToolType — used by the per-frame legend
 * at the bottom-right of each page. Keep these short so the legend box
 * doesn't blow out at small page scales.
 */
const TOOL_LABEL: Record<ToolType, string> = {
  LipNotch: "Lip Notch",
  LeftFlange: "Left Flange",
  RightFlange: "Right Flange",
  LeftPartialFlange: "L Partial Flange",
  RightPartialFlange: "R Partial Flange",
  InnerDimple: "Inner Dimple",
  Swage: "Swage",
  InnerNotch: "Inner Notch",
  Web: "Web Notch",
  Bolt: "Bolt Hole",
  ScrewHoles: "Screw / Anchor",
  InnerService: "Service Hole",
  Chamfer: "Chamfer",
  TrussChamfer: "Truss Chamfer",
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
  // Structural rule (Scott, 2026-05-09 final): end stud's WEB faces the
  // wall EDGE (the corner connection), LIPS face the wall BODY (interior).
  // For a vertical stud going up, +perp = LEFT in elevation:
  //   left-end stud at x=0:    web on LEFT (wall edge)  → lips on -perp = RIGHT (interior) → lipSign=-1
  //   right-end stud at x=max: web on RIGHT (wall edge) → lips on +perp = LEFT (interior)  → lipSign=+1
  for (const v of sortedV) {
    if (v.crossX <= leftEdgeX + EXTREME_TOL_MM) {
      overrides.set(v.stick.name, -1); // left-end: lips RIGHT (wall body), web LEFT (wall edge)
    }
    if (v.crossX >= rightEdgeX - EXTREME_TOL_MM) {
      overrides.set(v.stick.name, +1); // right-end: lips LEFT (wall body), web RIGHT (wall edge)
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

    // Structural rule for opening jambs (Scott, 2026-05-09 — important
    // correction to the prior pass): the JAMB stud's WEB faces INTO the
    // opening, LIPS face AWAY from the opening (toward the wall body).
    // Stated as a unified rule for ALL stud-position overrides:
    //   "Lips face the wall body. Web faces away from the wall body."
    // For end studs, away-from-body = the corner / wall edge.
    // For jambs, away-from-body = into the opening (door/window cavity).
    for (const v of verticals) {
      if (overrides.has(v.stick.name)) continue; // frame-end takes priority
      if (Math.abs(v.crossX - hMin) < JAMB_TOL_MM) {
        // LEFT jamb (stud at hMin = left edge of opening): opening is on
        // its RIGHT side, wall body on its LEFT. Web faces RIGHT (into
        // opening) → lipSign=+1 (lips on +perp = LEFT = wall body).
        overrides.set(v.stick.name, +1);
      } else if (Math.abs(v.crossX - hMax) < JAMB_TOL_MM) {
        // RIGHT jamb: opening on its LEFT, wall body on its RIGHT. Web
        // faces LEFT (into opening) → lipSign=-1 (lips on -perp = RIGHT
        // = wall body).
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

const MARGIN_PT = 24;            // ~8.5mm — page margin (Detailer is tighter than 36pt)
const TOP_BOM_HEIGHT_PT = 64;    // 4-row BOM strip above the drawing area
const LEGEND_STRIP_HEIGHT_PT = 18; // tooling-key strip below the BOM box, above the drawing area (Scott, 2026-05-09 — moved from bottom-right corner)
const FOOTER_HEIGHT_PT = 60;     // 3-row footer (Joins+Quantity / Specs grid / Dwg block)
const DIM_CHAIN_BOTTOM_PT = 55;  // height of the per-stud bottom dim-chain band — bumped from 36 to clear the C-marker band (Scott, 2026-05-09 N12 screenshot)
const DIM_CHAIN_RIGHT_PT = 36;   // width of the per-feature right dim-chain band

/**
 * True iff the frame should render in "wall-elevation" style — thin
 * outlined rectangles for studs (no fill), filled rectangles for plates,
 * + a small C-section orientation marker on each stud.
 *
 * Detection priority (Scott, 2026-05-09: "this needs to be understood as
 * an understanding of XML frames presented" — i.e. don't lean on plan-name
 * regex):
 *
 *   1. **frame.type from the source XML** (passed in via opts.frameTypes).
 *      Anything containing "Wall" → wall-style. Examples seen in HYTEK
 *      jobs: "ExternalWall", "InternalWall". This is the authoritative
 *      signal — the framecad_import XML schema includes type as a frame
 *      attribute precisely to convey presentation intent.
 *
 *   2. **Plan-name regex fallback** for older callers that don't supply
 *      frame.type, or for jobs where the XML omitted it. Matches
 *      `-LBW-` / `-NLBW-` (load-bearing + non-load-bearing wall). Same
 *      regex the codec uses (isWallServicePlanName).
 *
 * For walls the operator's view is perpendicular to the wall face — the
 * 89mm web is INTO the page and only the 41mm flange edge is visible.
 * Detailer renders this as thin hairline-ish outlined rectangles; HD1
 * mirrors that so the PDFs read the same as the EOL Detailer output
 * Scott's been using for years.
 *
 * Truss/Floor/RoofPanel frames render as filled rectangles (the 89mm web
 * IS visible in those elevation planes), with no orientation marker.
 */
function isWallFrame(planName: string, frameName: string, frameTypes: Map<string, string>): boolean {
  const t = frameTypes.get(frameName);
  if (t) return /wall/i.test(t);
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
  opts: Required<PdfOptions>,
  pageNum: number,
  totalPages: number,
): void {
  const W = page.getWidth();
  const H = page.getHeight();

  // Drawing-area bbox in pt.
  // Top BOM strip occupies the band immediately under the top margin.
  // Footer occupies the band immediately above the bottom margin.
  // Dim chains live INSIDE the drawing area (so the frame sits above the
  // bottom dim-chain band and to the LEFT of the right dim-chain band).
  const drawX0 = MARGIN_PT;
  const drawY0 = MARGIN_PT + FOOTER_HEIGHT_PT;
  const drawX1 = W - MARGIN_PT;
  // Drawing area top is below BOM strip + legend strip.
  const drawY1 = H - MARGIN_PT - TOP_BOM_HEIGHT_PT - LEGEND_STRIP_HEIGHT_PT;
  const innerX0 = drawX0;
  const innerY0 = drawY0 + DIM_CHAIN_BOTTOM_PT;
  const innerX1 = drawX1 - DIM_CHAIN_RIGHT_PT;
  const innerY1 = drawY1;
  const drawW = innerX1 - innerX0;
  const drawH = innerY1 - innerY0;

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
  const ox = innerX0 + (drawW - renderedWidth) / 2 - bb.minX * s;
  const oy = innerY0 + (drawH - renderedHeight) / 2 - bb.minY * s;

  const layout: PageLayout = { s, ox, oy, titleBottomPt: drawY1 };

  // Top BOM strip (per-profile inventory + Assembly Weight + M6 + Diagonal).
  drawTopBomStrip(page, doc, planName, frame, font, fontBold, opts, W, H);

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
  const wallStyle = isWallFrame(planName, frame.name, opts.frameTypes);
  const webOverrides = wallStyle ? computeWebOverrides(frame, bb) : new Map<string, 1 | -1>();
  for (const stick of frame.sticks) {
    drawStick(page, stick, layout, font, opts, wallStyle, webOverrides);
  }

  // C-section orientation: now drawn PER-STUD inside drawStick (a small
  // bracket below the bottom of each stud). The previous "under-plate
  // junction" marker has been dropped (Scott, 2026-05-09 — one indicator
  // per stud is what the operator actually wants).

  // Diagonal lines from source XML (<line layer="0">) — strap braces +
  // anchor marks. Drawn after sticks so they overlay (Detailer's
  // convention; the X-pattern is meant to read across the wall surface,
  // not be hidden behind plate fills).
  const diagonals = opts.frameDiagonals.get(frame.name);
  if (diagonals && diagonals.length > 0) {
    drawStrapBrace(page, diagonals, layout, font);
    // Bracing title above the drawing — Detailer titles bracing pages
    // "### Strap Brace - Near side" or "### Double Strap Brace - Near side"
    // when the line count exceeds ~18 (paired anchor sets at both ends of
    // two diagonals).
    const bracingTitle = diagonals.length > 18
      ? "### Double Strap Brace - Near side"
      : "### Strap Brace - Near side";
    page.drawText(bracingTitle, {
      x: innerX0 + drawW / 2 - bracingTitle.length * 2.5,
      y: drawY1 - 12,
      size: 9,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
  }

  // Fastener marks — small open circles at every stud×plate junction.
  const fasteners = opts.frameFasteners.get(frame.name);
  if (fasteners && fasteners.length > 0) {
    drawFasteners(page, fasteners, layout);
  }

  // Text callouts (<label>) — rotated, sized from the source XML's mm
  // size (multiplied by 0.5 for a reasonable pt size).
  const labels = opts.frameLabels.get(frame.name);
  if (labels && labels.length > 0) {
    drawCallouts(page, labels, layout, font);
  }

  // Per-stud bottom dim chain + per-feature right dim chain.
  if (opts.showDimensions) {
    drawDimChains(page, frame, bb, layout, font);
  }

  // Tooling legend — horizontal strip across the top, just under the BOM
  // box. Shows the symbol + colour + name of every tool type used on this
  // frame's sticks. Lets the operator decode any coloured marker on the
  // drawing without memorising the palette. Reserved space comes from
  // LEGEND_STRIP_HEIGHT_PT in the drawY1 calculation above.
  if (opts.showToolingMarks) {
    drawToolingLegend(page, frame, layout, font, W, H);
  }

  // 3-row footer: Joins/Quantity/Status, Specs grid, Dwg/Client/Job.
  drawFooter(page, doc, planName, frame, font, fontBold, opts, pageNum, totalPages, W);
}

/**
 * Top BOM strip — 4-row inventory band drawn above the elevation drawing.
 * Source data: frame.sticks (grouped by profile.metricLabel + gauge),
 * frame.weight, plan.name, fastener counts (computed from <fastener>
 * elements via opts.frameFasteners).
 *
 * Row layout (top → bottom):
 *   1. Per-profile inventory cells: `<code> | <count> | <total-length>mm`
 *      one cell per (profile.metricLabel + gauge) group.
 *   2. `Assembly Weight | <weight>kg | Working Sheet: <plan.name> | M6 Screw | <count>`
 *   3. `Powered by FRAMECAD Structure ® | Diagonal = <round(hypot(width,height))>`
 *
 * Detailer reference: HG260002-NLBW-DETAILER-REF.pdf — every page carries
 * this strip, identical layout independent of the frame.
 */
function drawTopBomStrip(
  page: PDFPage,
  doc: RfyDocument,
  planName: string,
  frame: RfyFrame,
  font: any,
  fontBold: any,
  opts: Required<PdfOptions>,
  W: number,
  H: number,
): void {
  const x0 = MARGIN_PT;
  const y1 = H - MARGIN_PT;
  const y0 = y1 - TOP_BOM_HEIGHT_PT;
  const x1 = W - MARGIN_PT;
  const stripW = x1 - x0;

  // Row Y coordinates (top → bottom).
  const row1Y = y1 - 14;
  const row2Y = y1 - 30;
  const row3Y = y1 - 46;

  // Outline (single thin border around the whole strip — the cell dividers
  // are implicit from the column layout).
  page.drawRectangle({
    x: x0,
    y: y0,
    width: stripW,
    height: TOP_BOM_HEIGHT_PT,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.4,
    color: undefined,
  });

  // ─ Row 1: per-profile inventory ────────────────────────────────────────
  // Group sticks by profile.metricLabel + gauge.
  const byProfile = new Map<string, { count: number; totalLength: number }>();
  for (const stick of frame.sticks) {
    const key = `${stick.profile.metricLabel}/${stick.profile.gauge}`;
    const cur = byProfile.get(key) ?? { count: 0, totalLength: 0 };
    cur.count += 1;
    cur.totalLength += stick.length ?? 0;
    byProfile.set(key, cur);
  }
  const profileEntries = [...byProfile.entries()];
  const cellW = profileEntries.length > 0 ? Math.min(180, stripW / profileEntries.length) : stripW;
  let cx = x0 + 6;
  for (const [code, info] of profileEntries) {
    const cellText = `${code}   |   ${info.count}   |   ${Math.round(info.totalLength)}mm`;
    page.drawText(cellText, { x: cx, y: row1Y, size: 8, font, color: rgb(0, 0, 0) });
    cx += cellW;
    if (cx > x1 - 20) break;
  }

  // ─ Row 2: Assembly Weight + Working Sheet + M6 Screw count ─────────────
  // Sum count across all 001792 fasteners (M6 self-driller SKU).
  const fasteners = opts.frameFasteners.get(frame.name) ?? [];
  let m6Count = 0;
  for (const f of fasteners) if (f.name === "001792") m6Count += f.count;
  const weight = (frame.weight ?? 0).toFixed(1);
  const row2 = `Assembly Weight   |   ${weight}kg   |   Working Sheet: ${planName}   |   M6 Screw   |   ${m6Count}`;
  page.drawText(row2, { x: x0 + 6, y: row2Y, size: 8, font, color: rgb(0, 0, 0) });

  // ─ Row 3: HYTEK branding + Diagonal ───────────────────────────────────
  // HYTEK-branded only (Scott, 2026-05-09 — universal rule: NEVER use
  // FrameCAD branding on any HYTEK output). The diagonal length is
  // genuinely useful info for the operator (sanity-checks the assembled
  // frame) so we keep it; the rest of the row is HYTEK-branded.
  const wMm = frame.length ?? 0;
  const hMm = frame.height ?? 0;
  const diagonal = Math.round(Math.hypot(wMm, hMm));
  page.drawText(
    `Powered by HYTEK   |   Diagonal = ${diagonal}`,
    { x: x0 + 6, y: row3Y, size: 8, font, color: rgb(0, 0, 0) },
  );

  // HYTEK brand bar (small, top-right corner) — kept from the original
  // title block as the only colour in the layout. Identifies the renderer's
  // origin without dominating the page.
  const brandW = 72;
  page.drawRectangle({
    x: x1 - brandW,
    y: y1 - 12,
    width: brandW,
    height: 10,
    color: rgb(0.137, 0.122, 0.125), // HYTEK black #231F20
  });
  page.drawText("HYTEK", {
    x: x1 - brandW + 8,
    y: y1 - 10,
    size: 7,
    font: fontBold,
    color: rgb(1, 0.796, 0.02), // HYTEK yellow #FFCB05
  });

  // Quiet, doc-level marker (small, top-right) — used to be in the title
  // block. Kept so prints carry the project name without crowding row 1.
  void doc; // doc-level metadata is rendered in the footer (drawFooter).
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

  // Stick body — hairline-only outline polygon. Detailer renders EVERY
  // stick (plates, studs, nogs, headers, braces) as a width-0 black
  // rectangle outline — NO fills anywhere on the elevation. Verified
  // 2026-05-09 against HG260002-NLBW-DETAILER-REF.pdf: zero filled
  // shapes on any of the 67 frame pages.
  const polyPts = corners.map(c => ({
    x: ox + c.x * s,
    y: oy + c.y * s,
  }));
  drawFilledPolygon(page, polyPts, null, rgb(0, 0, 0), 0.3);

  // Asymmetric stick outline — Detailer's signature convention. Each
  // C-section stick is drawn as 4 outer edges PLUS one interior
  // longitudinal line offset ~0.4pt INSIDE one long edge, so visually
  // ONE long edge is a "doubled line" and the OTHER is a single line.
  // The doubled-line edge is the LIP side (open side of the C); the
  // single-line edge is the WEB side (closed back of the C).
  //
  // Sign convention (rectangle CCW corner ordering from
  // buildStickElevationGraphics):
  //   edge 0→1 = +perp side (one long edge)
  //   edge 2→3 = -perp side (the other long edge)
  // perp = (-dirY, dirX) (90° CCW of stick direction).
  //
  // Default (interior studs): FrameCAD's `flipped` attribute drives the
  // C-section opening direction.
  //
  // Convention (Scott, 2026-05-09 — final, after multiple iterations):
  // The STRUCTURAL rule for end studs is "web faces wall EDGE (the
  // corner), lips face wall BODY (interior)" — opposite of what I
  // initially assumed. With that rule pinned:
  //
  //   flipped=false → lips on -perp side (RIGHT for vertical stud going up)
  //   flipped=true  → lips on +perp side (LEFT for vertical stud going up)
  //
  // Web sits opposite the lip side. End-stud override agrees:
  //   leftmost stud  → lipSign=-1 → lips on RIGHT (wall body) → web on LEFT (wall edge)
  //   rightmost stud → lipSign=+1 → lips on LEFT  (wall body) → web on RIGHT (wall edge)
  //
  // Override: webOverrides Map keyed by stick.name; +1 = lips on +perp,
  // -1 = lips on -perp. See computeWebOverrides for the structural
  // detection rules (frame-end studs, opening jamb studs).
  //
  // Only applied to stud-style sticks in wall frames (verticals + diagonals).
  // Plates/headers/nogs render as plain rectangle outlines — Detailer
  // doesn't double-line their long edges either.
  const studStyle = wallStyle && isStudStyleStick(m);
  if (studStyle) {
    const fallback = stick.flipped ? +1 : -1;
    const lipSign: 1 | -1 = webOverrides.get(stick.name) ?? (fallback as 1 | -1);

    // ASYMMETRIC OUTLINE — orientation rule (Scott, 2026-05-09):
    //   "above the lighter line is the open part of the C"
    // → the LIGHTER (single) edge of the rectangle is on the LIP / OPEN
    //   side of the C-section.
    // → the HEAVIER (doubled, with interior offset line) edge is on the
    //   WEB side (the closed back of the C).
    //
    // lipSign=+1 → lips on +perp (edge 0-1)  → web on -perp (edge 2-3)  → DOUBLE 2-3
    // lipSign=-1 → lips on -perp (edge 2-3)  → web on +perp (edge 0-1)  → DOUBLE 0-1
    const webEdgeIdx: [number, number] = lipSign === +1 ? [2, 3] : [0, 1];
    const dirX = Math.cos(m.angle);
    const dirY = Math.sin(m.angle);
    // Doubled line sits INSIDE the web edge (between web edge and the
    // stick's centerline). For lipSign=+1, web edge is on -perp side,
    // so "inward from web edge" = +perp = +lipSign × perp.
    const perpX = -dirY, perpY = dirX;            // +perp (90° CCW)
    const inwardX = lipSign * perpX;
    const inwardY = lipSign * perpY;
    const OFFSET_PT = 0.8;
    const a0 = polyPts[webEdgeIdx[0]]!;
    const a1 = polyPts[webEdgeIdx[1]]!;
    page.drawLine({
      start: { x: a0.x + inwardX * OFFSET_PT, y: a0.y + inwardY * OFFSET_PT },
      end:   { x: a1.x + inwardX * OFFSET_PT, y: a1.y + inwardY * OFFSET_PT },
      thickness: 0.3,
      color: rgb(0, 0, 0),
    });

    // C-section orientation marker — small bracket below the bottom of
    // the stud, opening toward the LIP (= away from the doubled web edge,
    // toward the lighter / single-line edge above).
    drawCMarkerBelowStud(page, m, lipSign, layout);
  }

  // Stick label — rotated 90° CCW for vertical sticks (place inside the
  // stud near the top end, ~7pt). For horizontal sticks, keep horizontal
  // and place near the left end. Detailer's labels read top-to-bottom on
  // verticals and left-to-right on horizontals.
  const labelSize = 7;
  const isVertical = Math.abs(Math.sin(m.angle)) > 0.5;
  if (isVertical) {
    // Place near the TOP end of the stud — m.start.y < m.end.y per the
    // ascending-y normalisation in stickMidline, so "top" = m.end.
    // Offset slightly INTO the stud from the top so the label sits on
    // the steel rather than above it.
    const labelPos = posAlongStick(m, Math.max(0, m.length - 60));
    page.drawText(stick.name, {
      x: ox + labelPos.x * s - labelSize * 0.4,
      y: oy + labelPos.y * s,
      size: labelSize,
      font,
      color: rgb(0, 0, 0),
      rotate: degrees(90),
    });
  } else {
    // Horizontal stick — place near the LEFT end (= m.start since
    // stickMidline orders by ascending y then x).
    const labelPos = posAlongStick(m, Math.min(m.length, 60));
    page.drawText(stick.name, {
      x: ox + labelPos.x * s,
      y: oy + labelPos.y * s + 2,
      size: labelSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

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
 * Draw a tool-type-specific symbol at point pt. ALL marks are pure black —
 * shape variation is the differentiator (matches Detailer's monochrome
 * elevation conventions, audit 2026-05-09).
 *
 * Symbol shapes:
 *   InnerDimple, Bolt, Web → small filled circle
 *   ScrewHoles             → concentric-circle (anchor symbol)
 *   Swage                  → striped/hatched rectangle (rib pattern)
 *   LipNotch + flange      → V-cut triangle (open at one edge)
 *   InnerNotch             → square outline (web cutout)
 *   InnerService           → ellipse (service slot)
 *   Chamfer / TrussChamfer → ✕ cross
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
      page.drawCircle({ x: pt.x, y: pt.y, size: r, color, borderWidth: 0 });
      break;
    case "ScrewHoles": {
      // Concentric circles — outer hairline ring + small filled centre.
      page.drawCircle({ x: pt.x, y: pt.y, size: r * 1.4, color: undefined, borderColor: color, borderWidth: 0.4 });
      page.drawCircle({ x: pt.x, y: pt.y, size: r * 0.4, color, borderWidth: 0 });
      break;
    }
    case "Swage": {
      // Hatched rectangle — outline + 3 internal hairlines for the rib pattern.
      const w = r * 2.8, h = r;
      page.drawRectangle({
        x: pt.x - w / 2,
        y: pt.y - h / 2,
        width: w,
        height: h,
        color: undefined,
        borderColor: color,
        borderWidth: 0.4,
      });
      const stripeCount = 3;
      for (let i = 1; i <= stripeCount; i++) {
        const sx = pt.x - w / 2 + (w * i) / (stripeCount + 1);
        page.drawLine({
          start: { x: sx, y: pt.y - h / 2 },
          end: { x: sx, y: pt.y + h / 2 },
          thickness: 0.3,
          color,
        });
      }
      break;
    }
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

/**
 * Render strap-brace diagonals + anchor marks pulled from <line layer="0">
 * elements in the source XML. Detailer's convention (HG260002 NLBW page 9
 * "Strap Brace - Near side"):
 *
 *   - Each strap is rendered as TWO parallel hairlines 50mm apart (the
 *     real width of the steel strap), not a single centerline.
 *   - Each end of each strap terminates in a hexagon-in-circle anchor
 *     mark + an "F10" text label — the mechanical anchor + bolt size.
 *   - All in solid black at hairline weight.
 *
 * The XML's <line layer="0"> elements arrive as the strap centerlines.
 * We thicken to paired-line strap by offsetting ±25mm perpendicular to
 * the strap direction.
 */
function drawStrapBrace(
  page: PDFPage,
  lines: { start: { x: number; y: number }; end: { x: number; y: number } }[],
  layout: PageLayout,
  font: any,
): void {
  const { s, ox, oy } = layout;
  const STRAP_HALF_MM = 25; // 50mm strap → ±25mm offset
  const ANCHOR_R_PT = 3;    // anchor circle radius

  // Render each input line as a pair of parallel hairlines, offset
  // perpendicular to the line direction by ±STRAP_HALF_MM.
  for (const ln of lines) {
    const dx = ln.end.x - ln.start.x;
    const dy = ln.end.y - ln.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      // Degenerate — render as single hairline (probably an anchor stub).
      page.drawLine({
        start: { x: ox + ln.start.x * s, y: oy + ln.start.y * s },
        end: { x: ox + ln.end.x * s, y: oy + ln.end.y * s },
        thickness: 0.4,
        color: rgb(0, 0, 0),
      });
      continue;
    }
    // For very short construction lines (<300mm — anchor stubs), keep them
    // as single hairlines. Only thicken the long diagonals into paired lines.
    if (len < 300) {
      page.drawLine({
        start: { x: ox + ln.start.x * s, y: oy + ln.start.y * s },
        end: { x: ox + ln.end.x * s, y: oy + ln.end.y * s },
        thickness: 0.4,
        color: rgb(0, 0, 0),
      });
      continue;
    }
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux; // perpendicular (90° CCW)
    for (const sign of [+1, -1]) {
      const a = { x: ln.start.x + px * sign * STRAP_HALF_MM, y: ln.start.y + py * sign * STRAP_HALF_MM };
      const b = { x: ln.end.x + px * sign * STRAP_HALF_MM, y: ln.end.y + py * sign * STRAP_HALF_MM };
      page.drawLine({
        start: { x: ox + a.x * s, y: oy + a.y * s },
        end: { x: ox + b.x * s, y: oy + b.y * s },
        thickness: 0.4,
        color: rgb(0, 0, 0),
      });
    }
    // Anchor marks at each end — hexagon-in-circle + "F10" label.
    drawAnchorMark(page, { x: ox + ln.start.x * s, y: oy + ln.start.y * s }, ANCHOR_R_PT, font);
    drawAnchorMark(page, { x: ox + ln.end.x * s,   y: oy + ln.end.y * s   }, ANCHOR_R_PT, font);
  }
}

/**
 * Draw a hexagon-in-circle anchor mark with an "F10" label nearby.
 * Used at each end of a strap brace to mark the mechanical anchor.
 */
function drawAnchorMark(page: PDFPage, pt: { x: number; y: number }, r: number, font: any): void {
  // Outer circle (hairline).
  page.drawCircle({ x: pt.x, y: pt.y, size: r, color: undefined, borderColor: rgb(0, 0, 0), borderWidth: 0.4 });
  // Inscribed hexagon (6-segment polyline).
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i * Math.PI) / 3;
    verts.push({ x: pt.x + (r * 0.85) * Math.cos(ang), y: pt.y + (r * 0.85) * Math.sin(ang) });
  }
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    page.drawLine({ start: a, end: b, thickness: 0.4, color: rgb(0, 0, 0) });
  }
  // F10 label — small, offset to the right of the anchor.
  page.drawText("F10", { x: pt.x + r + 1, y: pt.y - 2, size: 5, font, color: rgb(0, 0, 0) });
}

/**
 * Render fastener marks. SKU 001792 (M6 self-driller, count typically 2)
 * → small open circle. Heavy fasteners (count >= 10, e.g. SKU 001539
 * shear bolts) → larger outline circle. All hairline weight, black.
 */
function drawFasteners(
  page: PDFPage,
  fasteners: { pos: { x: number; y: number }; name: string; count: number }[],
  layout: PageLayout,
): void {
  const { s, ox, oy } = layout;
  for (const f of fasteners) {
    const px = ox + f.pos.x * s;
    const py = oy + f.pos.y * s;
    const heavy = f.count >= 10;
    const r = heavy ? 3 : 1.5;
    page.drawCircle({
      x: px, y: py, size: r,
      color: undefined,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.4,
    });
  }
}

/**
 * Render <label> text callouts. Each carries text + size (mm) + angle (deg).
 * The XML's `size` attribute is in mm — multiply by 0.5 for a reasonable
 * pt size on A3. pdf-lib's `rotate: degrees(...)` rotates around the
 * text's origin, which is the bottom-left of the glyphs.
 */
function drawCallouts(
  page: PDFPage,
  labels: { pos: { x: number; y: number }; text: string; size: number; angle: number }[],
  layout: PageLayout,
  font: any,
): void {
  const { s, ox, oy } = layout;
  for (const lb of labels) {
    const px = ox + lb.pos.x * s;
    const py = oy + lb.pos.y * s;
    // size attr is in mm — scale to pt and clamp to a readable range.
    const sizePt = Math.max(6, Math.min(14, lb.size * 0.5));
    page.drawText(lb.text, {
      x: px,
      y: py,
      size: sizePt,
      font,
      color: rgb(0, 0, 0),
      rotate: degrees(lb.angle),
    });
  }
}

/**
 * Per-stud bottom dim chain + per-feature right dim chain.
 *
 * BOTTOM CHAIN: walk every vertical stud, collect distinct cross-X
 * positions (rounded to 1mm), draw a tick + rotated-90° label at each.
 * Always include 0 at the origin. Format: integer mm, no "mm" suffix.
 *
 * RIGHT CHAIN: same idea on the Y axis — collect distinct horizontal-stick
 * Y positions (top/bottom plates, headers, sills, nogs).
 */
function drawDimChains(
  page: PDFPage,
  frame: RfyFrame,
  bb: BBox,
  layout: PageLayout,
  font: any,
): void {
  const { s, ox, oy } = layout;

  // Walk every stick midline once, classify by orientation.
  // Detailer's dim chain only labels actual stud positions — NOT
  // bbox extremes (Scott, 2026-05-09: "you have added extra dimensions").
  // Empty seeds; positions accumulated from frame.sticks below.
  const verticalCrossX = new Set<number>();
  const horizontalCrossY = new Set<number>();
  for (const stick of frame.sticks) {
    const m = stickMidline(stick);
    if (!m) continue;
    if (Math.abs(Math.sin(m.angle)) > 0.5) {
      // Vertical-ish stick — its cross-X (relative to frame origin) is
      // rounded to 1mm so e.g. two studs at x=600.0 and x=600.4 collapse.
      const cx = (m.start.x + m.end.x) / 2 - bb.minX;
      verticalCrossX.add(Math.round(cx));
    } else {
      // Horizontal-ish stick — its cross-Y.
      const cy = (m.start.y + m.end.y) / 2 - bb.minY;
      horizontalCrossY.add(Math.round(cy));
    }
  }

  // Bottom dim chain — pushed DOWN to clear the C-marker band above
  // (Scott, 2026-05-09 screenshot of frame N12: C-markers + rotated
  // labels were stacking in the same y range below the frame).
  // New layout below the frame's bottom:
  //   Y_BB - 5  to Y_BB - 15 → C-marker band (size 10, offset 10)
  //   Y_BB - 15 to Y_BB - 22 → gap (7pt clear)
  //   Y_BB - 22                → dim baseline (was -12)
  //   Y_BB - 19 to Y_BB - 25 → tick range (±3 around baseline)
  //   Y_BB - 26 to Y_BB - 48 → label band (CW-rotated, extends DOWN)
  const yBaseline = oy + bb.minY * s - 22;
  const xL = ox + bb.minX * s;
  const xR = ox + bb.maxX * s;
  page.drawLine({
    start: { x: xL, y: yBaseline },
    end: { x: xR, y: yBaseline },
    thickness: 0.3,
    color: rgb(0, 0, 0),
  });
  // No bbox extremes — only stud positions (matches Detailer convention).
  const sortedX = [...verticalCrossX].sort((a, b) => a - b);
  // Clash detection between adjacent labels — when two stud positions
  // are closer than MIN_LABEL_GAP_PT in pdf coords, suppress the second
  // one's label (keep the tick so the position is still visible). At
  // 7pt font with CW rotation, each label is ~9pt wide; 14pt gap leaves
  // visible whitespace between them.
  const MIN_LABEL_GAP_PT = 14;
  let lastLabelXPt = -Infinity;
  for (const xMm of sortedX) {
    const xPt = ox + (bb.minX + xMm) * s;
    page.drawLine({
      start: { x: xPt, y: yBaseline - 3 },
      end: { x: xPt, y: yBaseline + 3 },
      thickness: 0.3,
      color: rgb(0, 0, 0),
    });
    // Skip label if too close to the previous (clash prevention) — the
    // tick is still drawn so the operator can see the X position.
    if (xPt - lastLabelXPt < MIN_LABEL_GAP_PT) continue;
    lastLabelXPt = xPt;
    // CW rotation (-90°): pdf-lib's drawText origin is the baseline-left
    // of the first glyph. With degrees(-90) the text reads top-to-bottom
    // and extends DOWNWARD from origin (-y direction) — so labels sit
    // entirely below yBaseline instead of extending UP into the frame.
    // 10pt to match the right dim chain (Scott, 2026-05-09 — both chains
    // same size and a bit bigger).
    page.drawText(String(Math.round(xMm)), {
      x: xPt + 3,
      y: yBaseline - 5,
      size: 10,
      font,
      color: rgb(0, 0, 0),
      rotate: degrees(-90),
    });
  }

  // Right dim chain — vertical line on the right with ticks + horizontal labels.
  const xLine = ox + bb.maxX * s + 12;
  const yB = oy + bb.minY * s;
  const yT = oy + bb.maxY * s;
  page.drawLine({
    start: { x: xLine, y: yB },
    end: { x: xLine, y: yT },
    thickness: 0.3,
    color: rgb(0, 0, 0),
  });
  // No bbox extremes — only horizontal-member positions.
  const sortedY = [...horizontalCrossY].sort((a, b) => a - b);
  for (const yMm of sortedY) {
    const yPt = oy + (bb.minY + yMm) * s;
    page.drawLine({
      start: { x: xLine - 3, y: yPt },
      end: { x: xLine + 3, y: yPt },
      thickness: 0.3,
      color: rgb(0, 0, 0),
    });
    page.drawText(String(Math.round(yMm)), {
      x: xLine + 5,
      y: yPt - 3,
      size: 10,
      font,
      color: rgb(0, 0, 0),
    });
  }
}

/**
 * Per-frame tooling legend — small key at the bottom-right of the page
 * showing the symbol + colour + name of every tool type used on the
 * frame's sticks. Drawn below the dim chains, above the footer, so it
 * tucks into otherwise-empty space.
 *
 * Per-frame (not per-document) so the key stays compact: a frame with
 * only Bolts and Inner Dimples gets a 2-row legend, not the full 14-row
 * palette.
 *
 * Layout: vertical column. Each row = symbol swatch (drawn at the same
 * size + colour the marker uses on the stick) + label text. Box hugs
 * the right margin, sized to fit the rows.
 */
function drawToolingLegend(
  page: PDFPage,
  frame: RfyFrame,
  layout: PageLayout,
  font: any,
  W: number,
  H: number,
): void {
  // Collect every distinct ToolType present on this frame's sticks.
  const present = new Set<ToolType>();
  for (const stick of frame.sticks) {
    for (const op of stick.tooling) present.add(op.type);
  }
  if (present.size === 0) return;

  // Sort by a fixed "operator-friendly" order so the legend reads the
  // same way every time (lip notches first, then flange variants, then
  // bolts/screws, then services/dimples/swages, then chamfers).
  const ORDER: ToolType[] = [
    "LipNotch", "LeftFlange", "RightFlange",
    "LeftPartialFlange", "RightPartialFlange",
    "Web", "InnerNotch",
    "Bolt", "ScrewHoles",
    "InnerDimple", "Swage", "InnerService",
    "Chamfer", "TrussChamfer",
  ];
  const rows = ORDER.filter(t => present.has(t));

  // Horizontal strip layout (Scott, 2026-05-09 — moved from bottom-right
  // corner box to a horizontal strip across the top, just under the BOM
  // box). Reserved space comes from LEGEND_STRIP_HEIGHT_PT in the
  // drawY1 calculation in drawFramePage.
  const stripX0 = MARGIN_PT;
  const stripX1 = W - MARGIN_PT;
  const stripY1 = H - MARGIN_PT - TOP_BOM_HEIGHT_PT;          // top of strip
  const stripY0 = stripY1 - LEGEND_STRIP_HEIGHT_PT;            // bottom of strip
  const stripH = LEGEND_STRIP_HEIGHT_PT;
  const stripW = stripX1 - stripX0;

  // Background — light yellow tint matching the title block.
  page.drawRectangle({
    x: stripX0,
    y: stripY0,
    width: stripW,
    height: stripH,
    color: rgb(1, 0.98, 0.85),
    borderColor: rgb(0.6, 0.6, 0.6),
    borderWidth: 0.5,
  });

  // "Tooling key" prefix label at the very left of the strip.
  const PREFIX = "Tooling key:";
  const prefixWidth = 60;
  page.drawText(PREFIX, {
    x: stripX0 + 6,
    y: stripY0 + (stripH - 8) / 2,
    size: 8,
    font,
    color: rgb(0.15, 0.15, 0.15),
  });

  // Each tool entry: swatch (drawMarker) + label, distributed across the
  // remaining strip width. Cells are equal width — keeps spacing
  // predictable regardless of how many tools the frame uses.
  const entryX0 = stripX0 + prefixWidth + 4;
  const entryW = (stripX1 - entryX0) / Math.max(rows.length, 1);
  const cy = stripY0 + stripH / 2;
  for (let i = 0; i < rows.length; i++) {
    const tool = rows[i]!;
    const color = TOOL_COLOR[tool];
    const cellX = entryX0 + i * entryW;
    // Swatch on the left of the cell.
    drawMarker(page, { x: cellX + 6, y: cy }, tool, 3, color);
    // Label to the right of the swatch.
    page.drawText(TOOL_LABEL[tool], {
      x: cellX + 14,
      y: cy - 3,
      size: 7,
      font,
      color: rgb(0, 0, 0),
    });
  }
  // (suppress unused-param lint for `layout` — strip is page-absolute, doesn't
  // consult the per-frame layout. Kept in signature for future use.)
  void layout;
}

/**
 * 3-row footer drawn in the bottom strip of the page.
 *
 * Row 1 (centred): `<<< Joins ?     Quantity Required = 1   Mark as <name>   Stud Status = Passed   Joins ? >>>`
 *                  Header Status only present when frame has a HeadPlate stick.
 * Row 2 (specs grid): System Name | Wall Type | Wind Speed | Design Code | Loading Code | MGR | Panel RL | Envelope | Direction
 * Row 3 (left/right blocks): HYTEK Framing | Dwg | View N of M | Client | J/No.
 */
function drawFooter(
  page: PDFPage,
  doc: RfyDocument,
  planName: string,
  frame: RfyFrame,
  font: any,
  fontBold: any,
  opts: Required<PdfOptions>,
  pageNum: number,
  totalPages: number,
  W: number,
): void {
  const x0 = MARGIN_PT;
  const x1 = W - MARGIN_PT;
  const y0 = MARGIN_PT;
  const y1 = y0 + FOOTER_HEIGHT_PT;

  // Outline.
  page.drawRectangle({
    x: x0, y: y0, width: x1 - x0, height: FOOTER_HEIGHT_PT,
    borderColor: rgb(0, 0, 0), borderWidth: 0.4, color: undefined,
  });

  // ─ Row 1: Joins/Quantity/Mark/Status ───────────────────────────────────
  const row1Y = y1 - 12;
  // Header status only if frame has a HeadPlate stick (codec usage="HeadPlate"
  // → stick.usage === "HeadPlate").
  const hasHeadPlate = frame.sticks.some(st => /headplate|head/i.test(st.usage ?? ""));
  // Cross-frame joins — populated by framecadImportToRfy via envelope-edge
  // matching in 3D world space. Falls back to "?" when no neighbour found
  // (frame is at a building extreme).
  const joins = opts.frameJoins.get(frame.name);
  const leftJoin = joins?.left ?? "?";
  const rightJoin = joins?.right ?? "?";
  const row1Parts = [
    `<<< Joins ${leftJoin}`,
    "Quantity Required = 1",
    `Mark as ${frame.name}`,
    "Stud Status = Passed",
  ];
  if (hasHeadPlate) row1Parts.push("Header Status = Passed");
  row1Parts.push(`Joins ${rightJoin} >>>`);
  const row1Text = row1Parts.join("     ");
  page.drawText(row1Text, {
    x: x0 + (x1 - x0) / 2 - row1Text.length * 2.4,
    y: row1Y,
    size: 8,
    font,
    color: rgb(0, 0, 0),
  });

  // ─ Row 2: Specs grid ───────────────────────────────────────────────────
  // Wall Type derives from frame.type (when available via opts.frameTypes):
  //   InternalWall → "Non Load Bearing"
  //   ExternalWall → "Load Bearing"
  //   anything else (Truss/Floor/RoofPanel) falls through to a generic label
  // Other specs come from opts.specs (FrameCAD config-file-level constants
  // that don't live in the per-job XML).
  const row2Y = y1 - 26;
  const elevationMm = opts.frameElevations.get(frame.name) ?? 0;
  const wMm = frame.length ?? 0;
  const hMm = frame.height ?? 0;
  const frameType = opts.frameTypes.get(frame.name) ?? "";
  const wallType = /externalwall/i.test(frameType)
    ? "Load Bearing"
    : /internalwall/i.test(frameType)
      ? "Non Load Bearing"
      : frameType || "Non Load Bearing";
  const specs = [
    `System Name: ${opts.specs.systemName}`,
    `Wall Type: ${wallType}`,
    `Wind Speed: ${opts.specs.windSpeed}`,
    `Design Code: ${opts.specs.designCode}`,
    `Loading Code: ${opts.specs.loadingCode}`,
    `Material Grade Reduction: ${opts.specs.materialGradeReduction}`,
    `Panel RL: ${Math.round(elevationMm)}`,
    `Envelope: ${Math.round(hMm)}h x ${Math.round(wMm)}w`,
    `Direction: ${opts.specs.direction}`,
  ];
  page.drawText(specs.join("   |   "), {
    x: x0 + 6, y: row2Y, size: 6.5, font, color: rgb(0, 0, 0),
  });

  // ─ Row 3: HYTEK Framing | Dwg | View N of M | Client | J/No. ───────────
  const row3Y = y1 - 42;
  const dwgName = `${doc.project.name}_${doc.project.date || ""}A`;
  const row3Left = `HYTEK Framing   |   Dwg: ${truncate(dwgName, 60)}   |   View ${pageNum} of ${totalPages}   |   Client: ${doc.project.client || "-"}   |   J/No. ${doc.project.jobNum || "-"}`;
  page.drawText(row3Left, {
    x: x0 + 6, y: row3Y, size: 7, font: fontBold, color: rgb(0, 0, 0),
  });
  void planName;
}

// ---------- Utilities ----------

/**
 * Draw C-section U-bracket markers under the bottom plate at every
 * (stud × bottom-plate) junction. Detailer's convention (verified vs
 * HG260002-NLBW-DETAILER-REF.pdf, audit 2026-05-09): NOT one bracket per
 * stud individually — the bracket sits ON the bottom plate at each
 * junction X position, opening UPWARD toward the stud above it. The
 * open side points toward the lips (the C-section convention).
 *
 * Geometry: a U-bracket = 3 line segments (left flange + base + right
 * flange) drawn as a closed-bottom bracket whose width matches the stud
 * width and height ~7pt. Width is taken from the stud's outline (short
 * edge length); height is fixed in pt for visual consistency.
 *
 * Lip sign per stud is fed from webOverrides + stick.flipped (same
 * signal as the asymmetric outline's doubled-line side, so the two
 * indicators always agree).
 */
/**
 * Draw the per-stud C-section orientation marker — a small U-bracket
 * placed below the bottom of each stud, opening toward the LIP side.
 *
 * Open direction rule (Scott, 2026-05-09):
 *   "above the lighter line is the open part of the C"
 * The bracket's open mouth faces the lip side (= the side with the
 * single, lighter outline edge on the stick rectangle). This is the
 * SAME `lipSign` value that drives the asymmetric outline (which puts
 * the doubled line on the WEB side), so the two indicators always
 * agree — flip one, both move.
 *
 * Geometry: bracket sits OUTSIDE the start end of the stick (the bottom
 * for a vertical stud, since stickMidline normalises to ascending y).
 * Three line segments form the U:
 *   - top flange (toward lip side)
 *   - web (closed back, toward web side)
 *   - bottom flange (toward lip side)
 *
 * Sized so it reads at typical A3 zoom. Pure black, 1.4pt stroke.
 */
function drawCMarkerBelowStud(
  page: PDFPage,
  m: Midline,
  lipSign: 1 | -1,
  layout: PageLayout,
): void {
  const { s, ox, oy } = layout;

  // Smaller + tighter than the previous (size 14, offset 18) to fit in the
  // band between the stud bottom and the dim chain without clashing with
  // rotated dim labels (Scott, 2026-05-09 screenshot of frame N12).
  const SIZE = 10;            // bracket "height" along stick axis (pt) — was 14
  const FLANGE = SIZE * 0.6;  // bracket "width" perpendicular to stick (pt)
  const OFFSET_PT = 10;       // gap between stick start and marker centre — was 18

  const dirX = Math.cos(m.angle);
  const dirY = Math.sin(m.angle);

  const cx = ox + m.start.x * s - dirX * OFFSET_PT;
  const cy = oy + m.start.y * s - dirY * OFFSET_PT;

  // Local coords (lx along stick, ly across stick = +perp).
  // The bracket polyline goes:
  //   top-flange-tip → web-top → web-bot → bot-flange-tip
  //
  // CONVENTION (Scott, 2026-05-09 — final + canonical, matching Detailer):
  //   Doubled line on stick = WEB side
  //   Single thin line on stick = LIP side
  //   C-marker open mouth = LIP side (the open part of the C-section)
  //   ⇒ marker mouth and doubled line are on OPPOSITE sides of the stick.
  //
  // Lip side = +lipSign × +perp. So flange tips extend in +lipSign direction.
  const halfWeb = SIZE / 2;
  const pts = [
    { lx: +halfWeb, ly: lipSign * FLANGE },
    { lx: +halfWeb, ly: 0 },
    { lx: -halfWeb, ly: 0 },
    { lx: -halfWeb, ly: lipSign * FLANGE },
  ].map(({ lx, ly }) => ({
    // Rotate (lx, ly) into PDF coords using stick angle.
    // local-x maps along (dirX, dirY); local-y maps along (-dirY, dirX) = +perp.
    x: cx + lx * dirX + ly * (-dirY),
    y: cy + lx * dirY + ly * dirX,
  }));

  for (let i = 0; i < pts.length - 1; i++) {
    page.drawLine({
      start: pts[i]!,
      end: pts[i + 1]!,
      thickness: 1.4,
      color: rgb(0, 0, 0),
    });
  }
}

function drawCJunctionMarkers(
  page: PDFPage,
  frame: RfyFrame,
  bb: BBox,
  layout: PageLayout,
  webOverrides: Map<string, 1 | -1>,
): void {
  const { s, ox, oy } = layout;

  // Find the bottom plate(s) — horizontal sticks whose Y is at or near
  // the frame's bbox.minY (= bottom of the frame). Detailer typically has
  // one B1 + maybe a raised B2 (above-door sill).
  type SM = { stick: RfyStick; m: Midline };
  const sticks: SM[] = [];
  for (const stick of frame.sticks) {
    const m = stickMidline(stick);
    if (!m) continue;
    sticks.push({ stick, m });
  }
  const horizontals = sticks.filter(sm => Math.abs(Math.sin(sm.m.angle)) <= 0.5);
  const verticals   = sticks.filter(sm => Math.abs(Math.sin(sm.m.angle)) >  0.5);
  if (verticals.length === 0 || horizontals.length === 0) return;

  // Find the lowest horizontal stick(s) — Y within 50mm of bbox.minY.
  const PLATE_TOL_MM = 50;
  const bottomPlates = horizontals.filter(sm => {
    const cy = (sm.m.start.y + sm.m.end.y) / 2;
    return cy <= bb.minY + PLATE_TOL_MM;
  });
  if (bottomPlates.length === 0) return;

  // Bracket size in pt — fixed visual size, doesn't scale with frame.
  const BRACKET_HEIGHT_PT = 7;

  // For each vertical stud, find which bottom plate it intersects (X
  // coincides with the plate's span) and emit a U-bracket on that plate.
  const JUNCTION_TOL_MM = 30;
  for (const v of verticals) {
    const studCenterX = (v.m.start.x + v.m.end.x) / 2;
    // Stud width (short side of the rectangle) — use thickness from midline.
    const studWidthMm = v.m.thickness;

    // Find a bottom plate whose X-span contains studCenterX.
    let plate: SM | null = null;
    for (const bp of bottomPlates) {
      const xMin = Math.min(bp.m.start.x, bp.m.end.x) - JUNCTION_TOL_MM;
      const xMax = Math.max(bp.m.start.x, bp.m.end.x) + JUNCTION_TOL_MM;
      if (studCenterX >= xMin && studCenterX <= xMax) { plate = bp; break; }
    }
    if (!plate) continue;

    // Plate top-Y = plate.center.y + halfPlateThickness. We want the
    // bracket sitting JUST ABOVE the plate's top face (= just under the
    // stud's bottom face). Plate's outline corners give us its bbox in
    // mm; pick max Y of those.
    const plateCorners = plate.stick.outlineCorners;
    if (!plateCorners) continue;
    const plateMaxY = Math.max(...plateCorners.map(c => c.y));

    // Lip sign for this stud — same convention as drawStick.
    const lipSign: 1 | -1 = webOverrides.get(v.stick.name) ?? ((v.stick.flipped ? -1 : +1) as 1 | -1);

    // Bracket geometry in PDF pt:
    //   - Sit ON TOP of plate (y = plateMaxY in mm, converted to pt).
    //   - Width matches the stud's elevation width.
    //   - Height = BRACKET_HEIGHT_PT.
    //   - Open side faces UPWARD (toward the stud) — lip sign rotates
    //     left vs right "leg lengths" so the open lip is on the lipSign side.
    const cxPt = ox + studCenterX * s;
    const cyPt = oy + plateMaxY * s;
    const halfWidthPt = (studWidthMm * s) / 2;

    // U-bracket = 3 segments: left flange UP, base, right flange UP.
    // The "leg" on the lipSign side is FULL height; the leg on the web
    // side is also full height (a closed U), but we knock 1pt off the
    // web-side top so the asymmetry indicates the lip direction. This
    // mirrors Detailer's marker which shows the open notch on the lip
    // side as a clear gap.
    const baseY = cyPt;
    const lipLegTop = baseY + BRACKET_HEIGHT_PT;
    const webLegTop = baseY + BRACKET_HEIGHT_PT * 0.8; // shorter on web side
    const leftX = cxPt - halfWidthPt;
    const rightX = cxPt + halfWidthPt;
    // lipSign=+1 means lips on +perp (LEFT for vertical going up). So the
    // LEFT leg = lip side = full height; RIGHT leg = web side = shorter.
    // lipSign=-1 → swap.
    const leftTop = lipSign === +1 ? lipLegTop : webLegTop;
    const rightTop = lipSign === +1 ? webLegTop : lipLegTop;

    page.drawLine({ start: { x: leftX,  y: baseY }, end: { x: leftX,  y: leftTop  }, thickness: 0.4, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: leftX,  y: baseY }, end: { x: rightX, y: baseY    }, thickness: 0.4, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: rightX, y: baseY }, end: { x: rightX, y: rightTop }, thickness: 0.4, color: rgb(0, 0, 0) });
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
