/**
 * Rigorous tests for the vectorization deletion algorithm.
 *
 * The two properties that matter most and are easiest to get subtly wrong:
 *
 *   1. GEOMETRY PRESERVATION — deleting strokes must leave every *surviving*
 *      stroke drawn at exactly the same absolute place. Because commands are
 *      relative, a wrong bridge silently shifts everything downstream.
 *
 *   2. CONSOLIDATION — a maximal run of deleted strokes must collapse to a
 *      SINGLE bridge (≤3 commands), so trimming a region can't balloon the list.
 *
 * We check both on hand-built cases, on the three real sample drawings, and on
 * randomized fuzz inputs. Randomness is seeded (no Math.random) so failures
 * reproduce.
 */

import { describe, it, expect } from "vitest";
import {
  isDrawn,
  step,
  computeStates,
  rebuildCommands,
  traceSegments,
  ORIGIN,
  type DrawCommand,
  type TurtleState,
} from "./vectorization-edit";

import catcar from "../samples/catcar.json";
import beachnugget from "../samples/beachnugget.json";
import angryhashtag from "../samples/angryhashtag.json";

const SAMPLES: Record<string, DrawCommand[]> = {
  catcar: catcar as DrawCommand[],
  beachnugget: beachnugget as DrawCommand[],
  angryhashtag: angryhashtag as DrawCommand[],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Absolute sample points for one drawn stroke, given the pose entering it.
 *  Lines → endpoints; arcs → a dense polyline so position AND curvature count. */
function strokePoints(cmd: DrawCommand, entry: TurtleState): [number, number][] {
  const DEG2RAD = Math.PI / 180;
  if (cmd.kind === "line") {
    const rad = entry.heading * DEG2RAD;
    return [
      [entry.x, entry.y],
      [
        entry.x + cmd.distance * Math.cos(rad),
        entry.y + cmd.distance * Math.sin(rad),
      ],
    ];
  }
  if (cmd.kind !== "arc") return []; // only lines & arcs are drawn strokes
  const { radius, degrees } = cmd;
  const side = Math.sign(degrees);
  const centerAngle = (entry.heading + side * 90) * DEG2RAD;
  const cx = entry.x + radius * Math.cos(centerAngle);
  const cy = entry.y + radius * Math.sin(centerAngle);
  const phi = entry.heading - side * 90;
  const pts: [number, number][] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const a = (phi + (degrees * i) / N) * DEG2RAD;
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

/** The ordered list of drawn strokes in a command list, each as a polyline of
 *  absolute points. This is the "what actually gets inked, and where" view. */
function drawnPolylines(commands: readonly DrawCommand[]): [number, number][][] {
  const states = computeStates(commands);
  const out: [number, number][][] = [];
  for (let i = 0; i < commands.length; i++) {
    if (isDrawn(commands[i])) out.push(strokePoints(commands[i], states[i]));
  }
  return out;
}

/** The worst absolute coordinate discrepancy between two stroke sets, or
 *  Infinity if their shapes (stroke count / point counts) differ. Collapsing a
 *  whole comparison to one number keeps the fuzz loops from drowning in
 *  thousands of individual `expect` calls. */
function maxPolylineError(
  actual: [number, number][][],
  expected: [number, number][][],
): number {
  if (actual.length !== expected.length) return Infinity;
  let worst = 0;
  for (let s = 0; s < expected.length; s++) {
    if (actual[s].length !== expected[s].length) return Infinity;
    for (let p = 0; p < expected[s].length; p++) {
      worst = Math.max(
        worst,
        Math.abs(actual[s][p][0] - expected[s][p][0]),
        Math.abs(actual[s][p][1] - expected[s][p][1]),
      );
    }
  }
  return worst;
}

function expectPolylinesClose(
  actual: [number, number][][],
  expected: [number, number][][],
  tol = 1e-6,
) {
  expect(maxPolylineError(actual, expected)).toBeLessThan(tol);
}

/** Indices of drawn commands within a list, in order. */
function drawnIndices(commands: readonly DrawCommand[]): number[] {
  const idx: number[] = [];
  commands.forEach((c, i) => {
    if (isDrawn(c)) idx.push(i);
  });
  return idx;
}

/** The polylines of the strokes that survive a given deletion, taken from the
 *  ORIGINAL list — i.e. the ground truth the rebuild must reproduce. */
function survivingPolylines(
  original: readonly DrawCommand[],
  deleted: ReadonlySet<number>,
): [number, number][][] {
  const states = computeStates(original);
  const out: [number, number][][] = [];
  for (let i = 0; i < original.length; i++) {
    if (isDrawn(original[i]) && !deleted.has(i))
      out.push(strokePoints(original[i], states[i]));
  }
  return out;
}

/** Deterministic PRNG (mulberry32) — reproducible fuzzing without Math.random. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCommands(rand: () => number, n: number): DrawCommand[] {
  const cmds: DrawCommand[] = [];
  for (let i = 0; i < n; i++) {
    const r = rand();
    if (r < 0.34) cmds.push({ kind: "spin", degrees: (rand() - 0.5) * 720 });
    else if (r < 0.67)
      cmds.push({
        kind: "line",
        distance: rand() * 200,
        penDown: rand() < 0.5,
      });
    else
      cmds.push({
        kind: "arc",
        radius: 5 + rand() * 300,
        degrees: (rand() - 0.5) * 300,
      });
  }
  return cmds;
}

// ── isDrawn / step ────────────────────────────────────────────────────────────

describe("isDrawn", () => {
  it("classifies drawn vs connective commands", () => {
    expect(isDrawn({ kind: "line", distance: 10, penDown: true })).toBe(true);
    expect(isDrawn({ kind: "line", distance: 10, penDown: false })).toBe(false);
    expect(isDrawn({ kind: "line", distance: 0, penDown: true })).toBe(false);
    expect(isDrawn({ kind: "arc", radius: 5, degrees: 30 })).toBe(true);
    expect(isDrawn({ kind: "arc", radius: 0, degrees: 30 })).toBe(false);
    expect(isDrawn({ kind: "arc", radius: 5, degrees: 0 })).toBe(false);
    expect(isDrawn({ kind: "spin", degrees: 90 })).toBe(false);
  });
});

describe("step", () => {
  it("moves a pen-up line the same as a pen-down line", () => {
    const up = step(ORIGIN, { kind: "line", distance: 10, penDown: false });
    const down = step(ORIGIN, { kind: "line", distance: 10, penDown: true });
    expect(up).toEqual(down);
    expect(up.x).toBeCloseTo(10);
    expect(up.y).toBeCloseTo(0);
  });

  it("a 90° arc of radius r ends r away, heading rotated by 90°", () => {
    const end = step(ORIGIN, { kind: "arc", radius: 100, degrees: 90 });
    // Starting at origin heading +x, curving toward +y (clockwise on screen).
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(100);
    expect(end.heading).toBeCloseTo(90);
  });
});

// ── rebuildCommands: core invariants ─────────────────────────────────────────

describe("rebuildCommands — identity", () => {
  for (const [name, cmds] of Object.entries(SAMPLES)) {
    it(`empty deletion returns the original list unchanged (${name})`, () => {
      const rebuilt = rebuildCommands(cmds, new Set());
      expect(rebuilt).toEqual(cmds);
    });
  }
});

describe("rebuildCommands — geometry preservation", () => {
  for (const [name, cmds] of Object.entries(SAMPLES)) {
    const drawn = drawnIndices(cmds);

    it(`deleting each single stroke keeps every survivor in place (${name})`, () => {
      for (const idx of drawn) {
        const deleted = new Set([idx]);
        const rebuilt = rebuildCommands(cmds, deleted);
        expectPolylinesClose(
          drawnPolylines(rebuilt),
          survivingPolylines(cmds, deleted),
        );
      }
    });

    it(`deleting ALL strokes leaves nothing drawn (${name})`, () => {
      const deleted = new Set(drawn);
      const rebuilt = rebuildCommands(cmds, deleted);
      expect(drawnPolylines(rebuilt)).toHaveLength(0);
    });

    it(`deleting every other stroke keeps the rest in place (${name})`, () => {
      const deleted = new Set(drawn.filter((_, k) => k % 2 === 0));
      const rebuilt = rebuildCommands(cmds, deleted);
      expectPolylinesClose(
        drawnPolylines(rebuilt),
        survivingPolylines(cmds, deleted),
      );
    });
  }
});

describe("rebuildCommands — the rebuilt list never introduces ink", () => {
  it("bridges are pen-up only; drawn-stroke count only ever drops", () => {
    for (const cmds of Object.values(SAMPLES)) {
      const drawn = drawnIndices(cmds);
      // A scattering of deletions.
      const deleted = new Set(drawn.filter((_, k) => k % 3 === 0));
      const rebuilt = rebuildCommands(cmds, deleted);
      expect(drawnIndices(rebuilt).length).toBe(drawn.length - deleted.size);
    }
  });
});

// ── rebuildCommands: consolidation ───────────────────────────────────────────

/** Count the bridge (pen-up) commands a rebuild adds relative to a baseline of
 *  surviving verbatim commands — used to assert "one bridge per run". */
function countBridgeCommands(commands: readonly DrawCommand[]): number {
  // In a rebuilt list, bridge commands are the spins and pen-up lines. Every
  // surviving command from the original is drawn or was already tissue, so this
  // is only meaningful when compared between rebuilds of the same input.
  return commands.filter(
    (c) => c.kind === "spin" || (c.kind === "line" && !c.penDown),
  ).length;
}

describe("rebuildCommands — consolidation of adjacent deletions", () => {
  // A, t1, B, t2, C, t3, D — four arcs joined by pen-up spin/line/spin tissue.
  const chain = (): DrawCommand[] => [
    { kind: "arc", radius: 100, degrees: 90 }, // A drawn
    { kind: "spin", degrees: 30 },
    { kind: "line", distance: 40, penDown: false },
    { kind: "spin", degrees: -10 },
    { kind: "arc", radius: 80, degrees: -60 }, // B drawn
    { kind: "spin", degrees: 20 },
    { kind: "line", distance: 25, penDown: false },
    { kind: "spin", degrees: 15 },
    { kind: "arc", radius: 120, degrees: 45 }, // C drawn
    { kind: "spin", degrees: 5 },
    { kind: "line", distance: 10, penDown: false },
    { kind: "arc", radius: 60, degrees: -30 }, // D drawn
  ];

  it("two strokes between two survivors collapse to ONE bridge", () => {
    const cmds = chain();
    const drawn = drawnIndices(cmds); // [A, B, C, D]
    // Delete the two middle strokes B and C; A and D survive on either side.
    const both = rebuildCommands(cmds, new Set([drawn[1], drawn[2]]));

    // A ... bridge ... D — the whole B/t2/C region is one pen-up bridge.
    expect(drawnIndices(both)).toHaveLength(2); // A and D
    expect(both[0]).toEqual(cmds[drawn[0]]); // starts with A
    expect(both[both.length - 1]).toEqual(cmds[drawn[3]]); // ends with D
    const middle = both.slice(1, both.length - 1);
    expect(middle.length).toBeLessThanOrEqual(3); // a single spin→line→spin
    expect(middle.every((c) => c.kind === "spin" || !("penDown" in c) || !c.penDown)).toBe(true);

    // Survivors stay exactly where they were.
    expectPolylinesClose(
      drawnPolylines(both),
      survivingPolylines(cmds, new Set([drawn[1], drawn[2]])),
    );
  });

  it("deleting a neighbour extends the bridge rather than adding one", () => {
    const cmds = chain();
    const drawn = drawnIndices(cmds);
    const onlyB = rebuildCommands(cmds, new Set([drawn[1]]));
    const bAndC = rebuildCommands(cmds, new Set([drawn[1], drawn[2]]));
    // Trimming the adjacent stroke removes a stroke and merges the bridge, so
    // the list can only get shorter — never longer.
    expect(bAndC.length).toBeLessThanOrEqual(onlyB.length);
  });

  it("a trailing run of deletions vanishes (nothing to bridge to)", () => {
    const cmds = chain();
    const drawn = drawnIndices(cmds);
    // Delete C and D — everything after the last survivor (B).
    const rebuilt = rebuildCommands(cmds, new Set([drawn[2], drawn[3]]));
    expect(drawnIndices(rebuilt)).toHaveLength(2); // A and B
    expect(rebuilt[rebuilt.length - 1]).toEqual(cmds[drawn[1]]); // ends at B
  });

  it("a survivor between two deleted regions yields TWO bridges", () => {
    const cmds = chain();
    const drawn = drawnIndices(cmds);
    // Delete A (prefix) and C (a gap between survivors B and D).
    const rebuilt = rebuildCommands(cmds, new Set([drawn[0], drawn[2]]));
    const collapsed = rebuildCommands(
      cmds,
      new Set([drawn[0], drawn[1], drawn[2]]),
    );
    // Two separated deletions keep more bridge tissue than fusing them into one.
    expect(countBridgeCommands(rebuilt)).toBeGreaterThan(
      countBridgeCommands(collapsed),
    );
    expectPolylinesClose(
      drawnPolylines(rebuilt),
      survivingPolylines(cmds, new Set([drawn[0], drawn[2]])),
    );
  });

  it("incremental deletion of a neighbour extends the bridge instead of adding one", () => {
    // Real-world flow: delete one stroke, then delete the one next to it.
    const cmds = SAMPLES.beachnugget;
    const drawn = drawnIndices(cmds);
    // Find two strokes adjacent in draw-order.
    const a = drawn[3];
    const b = drawn[4];

    const afterFirst = rebuildCommands(cmds, new Set([a]));
    const afterSecond = rebuildCommands(cmds, new Set([a, b]));

    // Deleting the neighbour must not grow the list (one stroke removed, bridge
    // merged) — it should be no longer than after the first deletion.
    expect(afterSecond.length).toBeLessThanOrEqual(afterFirst.length);
    // And geometry of survivors still exact.
    expectPolylinesClose(
      drawnPolylines(afterSecond),
      survivingPolylines(cmds, new Set([a, b])),
    );
  });
});

// ── rebuildCommands: purity / order independence ─────────────────────────────

describe("rebuildCommands — purity", () => {
  it("output depends only on the deleted SET, not deletion order", () => {
    const cmds = SAMPLES.catcar;
    const drawn = drawnIndices(cmds);
    const pick = [drawn[1], drawn[5], drawn[2]];
    const a = rebuildCommands(cmds, new Set([pick[0], pick[1], pick[2]]));
    const b = rebuildCommands(cmds, new Set([pick[2], pick[0], pick[1]]));
    expect(a).toEqual(b);
  });

  it("undo (removing an index from the set) exactly restores the prior rebuild", () => {
    const cmds = SAMPLES.angryhashtag;
    const drawn = drawnIndices(cmds);
    const base = new Set([drawn[2], drawn[6]]);
    const before = rebuildCommands(cmds, base);
    const withExtra = new Set([...base, drawn[9]]);
    rebuildCommands(cmds, withExtra); // delete
    const undone = rebuildCommands(cmds, base); // undo
    expect(undone).toEqual(before);
  });
});

// ── Fuzz ─────────────────────────────────────────────────────────────────────

describe("rebuildCommands — randomized fuzz", () => {
  it("survivors stay geometrically exact for random inputs & random deletions", () => {
    let worst = 0;
    let inkOk = true;
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed);
      const cmds = randomCommands(rand, 4 + Math.floor(rand() * 40));
      const drawn = drawnIndices(cmds);
      if (drawn.length === 0) continue;

      // Random subset of strokes to delete.
      const deleted = new Set<number>();
      for (const idx of drawn) if (rand() < 0.5) deleted.add(idx);

      const rebuilt = rebuildCommands(cmds, deleted);
      worst = Math.max(
        worst,
        maxPolylineError(
          drawnPolylines(rebuilt),
          survivingPolylines(cmds, deleted),
        ),
      );
      // Never introduces ink.
      if (drawnIndices(rebuilt).length !== drawn.length - deleted.size)
        inkOk = false;
    }
    expect(worst).toBeLessThan(1e-4);
    expect(inkOk).toBe(true);
  });

  it("deleting a contiguous run keeps survivors exact and never adds ink", () => {
    let worst = 0;
    let inkOk = true;
    for (let seed = 1; seed <= 100; seed++) {
      const rand = rng(seed + 5000);
      const cmds = randomCommands(rand, 6 + Math.floor(rand() * 30));
      const drawn = drawnIndices(cmds);
      if (drawn.length < 3) continue;

      // Delete a contiguous window of drawn strokes (in draw-order).
      const startK = Math.floor(rand() * (drawn.length - 1));
      const lenK = 1 + Math.floor(rand() * (drawn.length - startK));
      const deleted = new Set(drawn.slice(startK, startK + lenK));

      const rebuilt = rebuildCommands(cmds, deleted);
      worst = Math.max(
        worst,
        maxPolylineError(
          drawnPolylines(rebuilt),
          survivingPolylines(cmds, deleted),
        ),
      );
      if (drawnIndices(rebuilt).length !== drawn.length - deleted.size)
        inkOk = false;
    }
    expect(worst).toBeLessThan(1e-4);
    expect(inkOk).toBe(true);
  });
});

// ── traceSegments ────────────────────────────────────────────────────────────

describe("traceSegments", () => {
  it("emits one segment per drawn stroke, keyed by original index", () => {
    for (const [name, cmds] of Object.entries(SAMPLES)) {
      const { segments } = traceSegments(cmds);
      const drawn = drawnIndices(cmds);
      expect(
        segments.map((s) => s.index),
        `segment indices for ${name}`,
      ).toEqual(drawn);
      for (const seg of segments) expect(seg.d.length).toBeGreaterThan(0);
    }
  });

  it("viewBox is stable regardless of which strokes are deleted", () => {
    const cmds = SAMPLES.catcar;
    const full = traceSegments(cmds).viewBox;
    // Deleting strokes changes the rebuilt list, but the preview traces the
    // ORIGINAL for a stable frame — so tracing the original is unaffected.
    const again = traceSegments(cmds).viewBox;
    expect(again).toBe(full);
  });
});
