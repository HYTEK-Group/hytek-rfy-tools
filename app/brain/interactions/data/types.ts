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
  /** Optional viewport hint — camera target + distance override. */
  cameraTarget?: [number, number, number];
  cameraDistance?: number;
}
