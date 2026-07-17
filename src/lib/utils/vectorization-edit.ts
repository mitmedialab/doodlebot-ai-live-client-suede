/**
 * vectorization-edit.ts
 *
 * The command-list editing model behind the admin's vectorization review. It
 * lets an admin delete individual pieces of *drawn* geometry (pen-down lines and
 * arcs) from a turtle command list and posts the trimmed list back to the
 * server, drawn as-is.
 *
 * Why this is not just `commands.filter(keep)`
 * --------------------------------------------
 * Turtle commands are *relative*: every `spin`/`line`/`arc` acts from wherever
 * the pen currently is. A drawn command carries the pen from an entry pose to an
 * exit pose; deleting it would strand every later command at the wrong place. So
 * a deletion is replaced by a **bridge** — a pen-up `spin → line → spin` that
 * reproduces exactly the entry→exit displacement the deleted stroke performed,
 * leaving every surviving command's absolute geometry untouched.
 *
 * Consolidation
 * -------------
 * Bridges anchor on *surviving strokes*, not on the deleted ones: the connective
 * tissue between two surviving strokes is regenerated as a single bridge the
 * moment anything between them is deleted, absorbing every deleted stroke and
 * every pen-up move in that gap at once. So no matter how many adjacent strokes
 * an admin trims, the two survivors on either side are joined by exactly one
 * bridge — deleting a neighbour extends that bridge rather than adding another,
 * and a trailing run of deletions (nothing survives after it) simply vanishes.
 * A gap with no deletions is left byte-for-byte untouched.
 *
 * Purity
 * ------
 * {@link rebuildCommands} is a pure function of `(original, deletedSet)`, so it
 * always recomputes from the pristine list — undo/redo is just membership in the
 * set, never an incremental patch that could drift. This module holds no Svelte
 * runes so it can be unit-tested in plain Node; the reactive wrapper lives in the
 * admin page.
 */

import type { DrawCommand } from "./turtle-svg";

export type { DrawCommand };

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Below this, two points are the same point (drawing units). */
const POS_EPS = 1e-6;
/** Below this many degrees, a spin is a no-op and is dropped. */
const ANG_EPS = 1e-9;

/** Max angular span of a single SVG `A` segment — mirrors turtle-svg so the
 *  admin's per-segment preview is byte-compatible with the shared renderer. */
const MAX_ARC_SEGMENT_DEGREES = 90;

export interface TurtleState {
  x: number;
  y: number;
  /** Heading in degrees; +y is down and positive angles rotate clockwise. */
  heading: number;
}

export const ORIGIN: TurtleState = { x: 0, y: 0, heading: 0 };

/**
 * Is this command *drawn geometry* — i.e. does it put ink on the page and is it
 * therefore individually deletable? Mirrors turtle-svg's draw conditions:
 * pen-down lines with real length, and arcs with a real radius and sweep.
 */
export function isDrawn(cmd: DrawCommand): boolean {
  switch (cmd.kind) {
    case "line":
      return cmd.penDown && cmd.distance !== 0;
    case "arc":
      return cmd.radius > 0 && cmd.degrees !== 0;
    default:
      return false;
  }
}

/**
 * Advance the turtle by one command. Exactly mirrors the position/heading math
 * in turtle-svg's `tracePath`, so states computed here line up with what the
 * shared renderer (and the robot) will draw.
 */
export function step(s: TurtleState, cmd: DrawCommand): TurtleState {
  switch (cmd.kind) {
    case "spin":
      return { x: s.x, y: s.y, heading: s.heading + cmd.degrees };

    case "line": {
      const rad = s.heading * DEG2RAD;
      return {
        x: s.x + cmd.distance * Math.cos(rad),
        y: s.y + cmd.distance * Math.sin(rad),
        heading: s.heading,
      };
    }

    case "arc": {
      const { radius, degrees } = cmd;
      // Degenerate arc: turtle-svg treats it as a bare heading change.
      if (radius <= 0 || degrees === 0)
        return { x: s.x, y: s.y, heading: s.heading + degrees };

      const side = Math.sign(degrees);
      const centerAngle = (s.heading + side * 90) * DEG2RAD;
      const cx = s.x + radius * Math.cos(centerAngle);
      const cy = s.y + radius * Math.sin(centerAngle);
      const phi = s.heading - side * 90;
      const phiFinal = (phi + degrees) * DEG2RAD;
      return {
        x: cx + radius * Math.cos(phiFinal),
        y: cy + radius * Math.sin(phiFinal),
        heading: s.heading + degrees,
      };
    }
  }
}

/**
 * The pose entering each command. `states[i]` is the turtle state *before*
 * command `i`; `states[commands.length]` is the final state. Length is n + 1.
 */
export function computeStates(commands: readonly DrawCommand[]): TurtleState[] {
  const states: TurtleState[] = [ORIGIN];
  let s = ORIGIN;
  for (const cmd of commands) {
    s = step(s, cmd);
    states.push(s);
  }
  return states;
}

/** Normalize an angle to (-180, 180], so bridge spins stay minimal. */
function normalizeAngle(deg: number): number {
  let d = ((deg % 360) + 360) % 360; // [0, 360)
  if (d > 180) d -= 360; // (-180, 180]
  return d;
}

/**
 * Emit a pen-up bridge that carries the turtle from `from` to `to`, both in
 * position and heading, using at most `spin → line → spin`. Zero components are
 * dropped. The bridge never draws.
 */
function pushBridge(
  out: DrawCommand[],
  from: TurtleState,
  to: TurtleState,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);

  if (dist > POS_EPS) {
    const travelDir = Math.atan2(dy, dx) * RAD2DEG;
    const s1 = normalizeAngle(travelDir - from.heading);
    if (Math.abs(s1) > ANG_EPS) out.push({ kind: "spin", degrees: s1 });
    out.push({ kind: "line", distance: dist, penDown: false });
    const s2 = normalizeAngle(to.heading - travelDir);
    if (Math.abs(s2) > ANG_EPS) out.push({ kind: "spin", degrees: s2 });
  } else {
    // No travel needed — just reconcile heading for the following commands.
    const s = normalizeAngle(to.heading - from.heading);
    if (Math.abs(s) > ANG_EPS) out.push({ kind: "spin", degrees: s });
  }
}

/**
 * Rebuild the command list with the given drawn-command indices deleted.
 *
 * - `deleted` holds indices into `original` that must be drawn commands
 *   ({@link isDrawn}); non-drawn indices are ignored.
 * - Surviving strokes are emitted verbatim and stay at their exact absolute
 *   pose, so with an empty `deleted` the output is identical to the input.
 * - The stretch between two consecutive surviving strokes (and the run before
 *   the first survivor) is left untouched when nothing in it was deleted, and
 *   replaced by a single pen-up bridge the moment it contains any deletion —
 *   absorbing the deleted strokes and their connective tissue together.
 * - A run of deleted strokes with no survivor after it (the suffix) is dropped
 *   entirely: there is nothing left to bridge to.
 *
 * Pure: depends only on `(original, deleted)`.
 */
export function rebuildCommands(
  original: readonly DrawCommand[],
  deleted: ReadonlySet<number>,
): DrawCommand[] {
  const states = computeStates(original);
  const n = original.length;

  // The surviving drawn strokes are the anchors everything else hangs off.
  const survivors: number[] = [];
  for (let i = 0; i < n; i++)
    if (isDrawn(original[i]) && !deleted.has(i)) survivors.push(i);

  // Does [lo, hi) contain a drawn command that was deleted?
  const regionHasDeletion = (lo: number, hi: number): boolean => {
    for (let k = lo; k < hi; k++)
      if (isDrawn(original[k]) && deleted.has(k)) return true;
    return false;
  };

  // Nothing survives: either the list never drew anything (keep it verbatim so
  // identity holds) or every stroke was trimmed away (emit an empty list).
  if (survivors.length === 0)
    return deleted.size === 0 ? original.slice() : [];

  const out: DrawCommand[] = [];

  // Emit the connective region [lo, hi) that lands the turtle at `to`: one
  // bridge if anything in it was deleted, otherwise the original commands as-is.
  const emitRegion = (lo: number, hi: number, from: TurtleState, to: TurtleState) => {
    if (regionHasDeletion(lo, hi)) pushBridge(out, from, to);
    else for (let k = lo; k < hi; k++) out.push(original[k]);
  };

  // Prefix: origin → first survivor.
  emitRegion(0, survivors[0], states[0], states[survivors[0]]);
  out.push(original[survivors[0]]);

  // Each gap between consecutive survivors.
  for (let j = 1; j < survivors.length; j++) {
    const prev = survivors[j - 1];
    const cur = survivors[j];
    emitRegion(prev + 1, cur, states[prev + 1], states[cur]);
    out.push(original[cur]);
  }

  // Suffix: after the last survivor. If it held any deleted stroke, drop the
  // whole tail (no survivor to bridge to); otherwise keep its inert tissue.
  const last = survivors[survivors.length - 1];
  if (!regionHasDeletion(last + 1, n))
    for (let k = last + 1; k < n; k++) out.push(original[k]);

  return out;
}

// ── Rendering support for the per-segment, clickable preview ────────────────

export interface Segment {
  /** Index into the original command list — the delete/undo key. */
  index: number;
  /** SVG path data for just this stroke, in absolute coordinates. */
  d: string;
}

export interface Trace {
  segments: Segment[];
  /** viewBox covering *all* strokes, so deleting one never reflows the frame. */
  viewBox: string;
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Trace a command list into one SVG subpath per drawn stroke (so each is
 * independently clickable) plus a stable viewBox spanning every stroke.
 *
 * The arc chunking mirrors turtle-svg exactly, so a segment previewed here draws
 * identically to the shared renderer and the robot.
 */
export function traceSegments(
  commands: readonly DrawCommand[],
  padding = 20,
): Trace {
  const segments: Segment[] = [];
  let b: Bounds | null = null;

  const include = (x: number, y: number) => {
    if (!b) b = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      if (x < b.minX) b.minX = x;
      if (y < b.minY) b.minY = y;
      if (x > b.maxX) b.maxX = x;
      if (y > b.maxY) b.maxY = y;
    }
  };

  let s = ORIGIN;
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const next = step(s, cmd);

    if (cmd.kind === "line" && cmd.penDown && cmd.distance !== 0) {
      include(s.x, s.y);
      include(next.x, next.y);
      segments.push({
        index: i,
        d: `M ${fmt(s.x)} ${fmt(s.y)} L ${fmt(next.x)} ${fmt(next.y)}`,
      });
    } else if (cmd.kind === "arc" && cmd.radius > 0 && cmd.degrees !== 0) {
      const { radius, degrees } = cmd;
      const side = Math.sign(degrees);
      const centerAngle = (s.heading + side * 90) * DEG2RAD;
      const cx = s.x + radius * Math.cos(centerAngle);
      const cy = s.y + radius * Math.sin(centerAngle);
      const phi = s.heading - side * 90;

      const sweepFlag = degrees > 0 ? 1 : 0;
      const chunks = Math.max(
        1,
        Math.ceil(Math.abs(degrees) / MAX_ARC_SEGMENT_DEGREES),
      );
      const stepDeg = degrees / chunks;

      let d = `M ${fmt(s.x)} ${fmt(s.y)}`;
      include(s.x, s.y);
      for (let c = 1; c <= chunks; c++) {
        const phiEnd = (phi + stepDeg * c) * DEG2RAD;
        const ex = cx + radius * Math.cos(phiEnd);
        const ey = cy + radius * Math.sin(phiEnd);
        d += ` A ${fmt(radius)} ${fmt(radius)} 0 0 ${sweepFlag} ${fmt(ex)} ${fmt(ey)}`;

        const phiStart = (phi + stepDeg * (c - 1)) * DEG2RAD;
        const samples = 8;
        for (let sample = 0; sample <= samples; sample++) {
          const a = phiStart + ((phiEnd - phiStart) * sample) / samples;
          include(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
        }
      }
      segments.push({ index: i, d });
    }

    s = next;
  }

  const bounds = b ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const vbX = bounds.minX - padding;
  const vbY = bounds.minY - padding;
  const vbW = bounds.maxX - bounds.minX + padding * 2;
  const vbH = bounds.maxY - bounds.minY + padding * 2;

  return {
    segments,
    viewBox: `${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}`,
  };
}
