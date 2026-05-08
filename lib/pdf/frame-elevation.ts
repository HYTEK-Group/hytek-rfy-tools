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

import { PDFDocument, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
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
  for (const stick of frame.sticks) {
    drawStick(page, stick, layout, font, opts);
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
  opts: Required<PdfOptions>
): void {
  const m = stickMidline(stick);
  if (!m) return;

  const corners = stick.outlineCorners!;
  const { s, ox, oy } = layout;

  // Stick body — filled polygon from outline corners.
  // pdf-lib has drawSvgPath but no native polygon, so we use drawSvgPath.
  const svgPath = polygonSvgPath(corners.map(c => ({
    x: ox + c.x * s,
    y: oy + c.y * s,
  })));
  page.drawSvgPath(svgPath, {
    color: rgb(0.85, 0.86, 0.88),       // light steel grey fill
    borderColor: rgb(0.27, 0.27, 0.3),  // darker grey outline
    borderWidth: 0.5,
  });

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
      // V-shape via SVG path.
      const path = `M ${pt.x - r} ${pt.y - r} L ${pt.x} ${pt.y + r} L ${pt.x + r} ${pt.y - r} Z`;
      page.drawSvgPath(path, { color, borderWidth: 0 });
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
      const path = `M ${pt.x - r} ${pt.y - r} L ${pt.x + r} ${pt.y + r} M ${pt.x - r} ${pt.y + r} L ${pt.x + r} ${pt.y - r}`;
      page.drawSvgPath(path, { borderColor: color, borderWidth: 1.2 });
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

function polygonSvgPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  const head = `M ${pts[0]!.x} ${pts[0]!.y}`;
  const tail = pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");
  return `${head} ${tail} Z`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
