// Type definitions for the Stick Interactions gallery.
//
// An "interaction" is the geometric pattern of how two (or more) C-section
// sticks meet — e.g. T-junction, scissor cross, B2B partner pair. Each
// interaction is defined by a set of sticks (positioned + oriented in 3D
// scene space) and the tool operations that fire on each stick to make
// the joint work physically.

import type { RfyProfile } from "@hytek/rfy-codec";

/** Standard HYTEK 70S41 profile — common stud size. */
export const PROFILE_70S41: RfyProfile = {
  metricLabel: "70 S 41",
  gauge: "0.75",
  shape: "S",
  web: 70,
  lFlange: 41,
  rFlange: 38,
  lip: 12,
};

/** 89S41 — bigger profile used for plates / outer in nested joins. */
export const PROFILE_89S41: RfyProfile = {
  metricLabel: "89 S 41",
  gauge: "0.75",
  shape: "S",
  web: 89,
  lFlange: 41,
  rFlange: 38,
  lip: 12,
};

/** 75S41 — alternate stud size used for nested examples. */
export const PROFILE_75S41: RfyProfile = {
  metricLabel: "75 S 41",
  gauge: "0.75",
  shape: "S",
  web: 75,
  lFlange: 41,
  rFlange: 38,
  lip: 12,
};

/**
 * 89S39 — asymmetric "inner" variant of 89S41 used for boxed members.
 * Same web (89mm) and lip (12mm) as 89S41 but with smaller flanges (39mm
 * each) so the inner stick nests INSIDE an 89S41 outer stick's cavity
 * with ~2mm clearance between inner flange tip and outer lip turn-back.
 * The overlapping flange region is where paired flange dimples land and
 * 10g flathead screws pass through both flange surfaces (1.5mm steel grip).
 */
export const PROFILE_89S39: RfyProfile = {
  metricLabel: "89 S 39",
  gauge: "0.75",
  shape: "S",
  web: 89,
  lFlange: 39,
  rFlange: 39,
  lip: 12,
};

/**
 * 70S39 — asymmetric inner variant of 70S41 for wall-stud boxed
 * assemblies (e.g. `L1-S5` parent + `L1-S5 (Box1)` inner in the
 * GF-LBW-70.075 CSV). Smaller scale of the same nesting principle.
 */
export const PROFILE_70S39: RfyProfile = {
  metricLabel: "70 S 39",
  gauge: "0.75",
  shape: "S",
  web: 70,
  lFlange: 39,
  rFlange: 39,
  lip: 12,
};

/**
 * One tool operation as it should be visualised on a stick.
 *
 * Coordinate convention: `pos` and `spanStart`/`spanEnd` are millimetres
 * along the stick's length axis (the extrusion direction), measured from
 * the START end of the stick.
 */
export type OpConfig =
  | {
      type: "LipNotch";
      spanStart: number;
      spanEnd: number;
      /** Which lip(s) to cut: top = +y lip (the lFlange's lip), bottom = −y lip (rFlange's lip), both = both lips. */
      flangeSide: "top" | "bottom" | "both";
    }
  | {
      type: "Swage";
      spanStart: number;
      spanEnd: number;
    }
  | {
      type: "InnerDimple";
      pos: number;
      /**
       * Optional cross-section offset on the web (mm from web centreline,
       * along the web-height axis = profile local +Y). Default = 0 (centred).
       * Use this to place the 3-dimple triangle pattern observed at every
       * stud-to-plate end on packed-frame photos (catalog 2026-05-12 item
       * #1): one centre-high near the tip, two lower flanking it on either
       * side of the web centreline.
       */
      webY?: number;
    }
  | {
      type: "InnerNotch";
      spanStart: number;
      spanEnd: number;
    }
  | {
      type: "InnerService";
      pos: number;
      diameter: number;
    }
  | {
      type: "Web";
      pos: number;
      diameter: number;
    }
  | {
      type: "Bolt";
      pos: number;
      diameter: number;
    }
  | {
      type: "Chamfer";
      end: "start" | "end";
    }
  | {
      type: "TrussChamfer";
      end: "start" | "end";
    }
  | {
      type: "ScrewHoles";
      pos: number;
      /** Pattern offsets (mm) relative to `pos`. e.g. [-8, 0, 8] for a triple. */
      pattern: number[];
    }
  | {
      /**
       * Full-depth cut THROUGH the web at a single position. Used on wall
       * nogs at every stud crossing — lets the nog's tip slot in past the
       * stud's flange line. Different from `LipNotch` (lip only) and
       * `InnerNotch` (web cut spanning a length range).
       */
      type: "WebNotch";
      pos: number;
    }
  | {
      /**
       * Slab-anchor hardware position (separate from `Bolt` which is just
       * a pre-drilled hole). Renders a small indicator showing where a
       * slab anchor will be driven. Fires on bottom plates only.
       */
      type: "Anchor";
      pos: number;
    }
  | {
      /**
       * "Left Leg Notch" rollformer op — rectangular cut through flange +
       * lip (leaving the web intact) on the LEFT flange (lFlange side).
       * Each cut is its own discrete tool stamp. Consecutive cuts at
       * ~48mm pitch combine into a wider opening that lets a crossing
       * stick pass DOWN through the flange-line into the cavity.
       */
      type: "LeftLegNotch";
      pos: number;
    }
  | {
      /** Mirror of LeftLegNotch — cuts the RIGHT flange (rFlange side). */
      type: "RightLegNotch";
      pos: number;
    }
  | {
      /**
       * "Full Chamfer" rollformer op — angled triangular cut across the
       * full flange body at a stick end so the flange terminates at the
       * receiving stick's edge with no overhang. Position can be slightly
       * OUTSIDE the stick (e.g. `-3` or `length+3`) per FrameCAD setup.
       *
       * Replaces the older `TrussChamfer` for new scenes — `TrussChamfer`
       * is kept for backwards compatibility but renders as the same
       * triangle-across-flange-body geometry.
       */
      type: "FullChamfer";
      end: "start" | "end";
      /**
       * Optional overshoot in mm — how far past the stick end the
       * chamfer's hypotenuse extends. Default 3mm. CSVs show positions
       * like `-3` (start) and `length+3` (end), corresponding to overshoot=3.
       */
      overshoot?: number;
    };

/**
 * One stick within an interaction scene.
 *
 * `position` is the WORLD position (in mm) of the stick's START point.
 * `rotation` is XYZ Euler angles (in radians) applied so the stick's
 * extrusion direction (originally +Z) points where it should.
 *
 * `flangeDir` overrides the default flange-direction (the +X profile axis
 * after rotation). Used for B2B partner pairs where the two sticks face
 * each other — one's flangeDir is +Z, the other's is −Z.
 */
export interface StickConfig {
  /** Profile cross-section used. */
  profile: RfyProfile;
  /** Length of the stick (mm). Drives the extrusion depth. */
  length: number;
  /** World-space start position of the stick (mm). */
  position: [number, number, number];
  /** Stick rotation as XYZ Euler angles (radians). */
  rotation: [number, number, number];
  /** Override flange direction — used for B2B mirroring. Default: +X axis after rotation. */
  flangeDir?: "default" | "flipped";
  /** Tool operations applied to this stick. */
  ops: OpConfig[];
  /** Optional name to display in the caption. */
  label?: string;
  /** Optional tint colour override (default zinc-grey steel). */
  tint?: string;
}

/**
 * One joint in an interaction — the point where one stick TERMINATES INTO
 * another. Renders the FrameCAD-spec fasteners (1× or 2× #10 screws per
 * side, plus optional reinforcing connector plates) at the joint.
 *
 * Per HYTEK standard ("Use 1×10g screws for all connections"), every
 * joint where one stick enters another has at minimum 1 screw per side
 * driven perpendicular to the touching flanges. High-load joints add a
 * connector plate sandwiching the joint with a multi-screw cluster.
 */
export interface JointConfig {
  /** World-space position of the joint centre (mm). */
  position: [number, number, number];
  /**
   * The world-space axis that the screws are perpendicular to — i.e. the
   * direction from one side of the joint to the other ("through the
   * touching flanges"). For an A1 stud-into-top-plate joint, this is the
   * world Z axis (front-back through the wall).
   */
  axis: [number, number, number];
  /**
   * The world-space length axis of the joint — typically along the
   * receiving stick's length. Used to space multiple screws along the
   * joint when count > 1.
   */
  spanAxis: [number, number, number];
  /**
   * "Half thickness" of the joint along `axis` — the distance from the
   * joint centre to where the screw heads bear. For a 70mm-web receiving
   * stick this is web/2 = 35mm.
   */
  halfThickness: number;
  /**
   * Number of screws PER SIDE.
   *   1 = single-screw variant (2 total — one each side)
   *   2 = double-screw variant (4 total)
   * For "reinforced" joints, set count and `connectorPlate: true`.
   */
  screwsPerSide: number;
  /**
   * Mid-screw spacing along spanAxis (mm). For double-screw, spacing
   * between the 2 screws on the same side. For 4+ screws, the cluster
   * grid pitch.
   */
  screwSpacing?: number;
  /**
   * If true, render a flat connector plate sandwiching the joint on
   * BOTH sides of the truss/wall (one plate each side of `axis`). Used
   * for high-load joints (FC-R3 right variant, FC-R4 apex/heel, FC-R5).
   * The plate is sized to span the joint members.
   */
  connectorPlate?: boolean;
  /** Connector-plate dimensions — width (along spanAxis), height (perpendicular). */
  plateSize?: [number, number];
  /** Optional label for documentation/debug. */
  label?: string;
}

/** Full configuration for one interaction scene. */
export interface InteractionConfig {
  /** Catalogue id, e.g. "A1", "D2". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** One-paragraph description of the interaction. */
  description: string;
  /** Sticks comprising the scene. */
  sticks: StickConfig[];
  /**
   * Optional joints — the points where sticks meet. Renders fasteners
   * and optional connector plates at each joint per the HYTEK FrameCAD
   * standard.
   */
  joints?: JointConfig[];
  /** Optional viewport hint — camera target + distance override. */
  cameraTarget?: [number, number, number];
  cameraDistance?: number;
}
