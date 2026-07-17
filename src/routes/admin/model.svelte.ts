/**
 * Reactive models for the admin moderation page.
 *
 * The heavy geometry/algorithm work lives (and is unit-tested) in
 * `$lib/utils/vectorization-edit`; this module is only the thin reactive shell
 * that wires that pure logic into Svelte runes and models the two review queues.
 * See `release/v2_admin_frontend.md` for the wire contract these types mirror.
 */

import {
  rebuildCommands,
  traceSegments,
  type DrawCommand,
  type Trace,
} from "$lib/utils/vectorization-edit";

// ── Wire types (mirror the admin SSE / POST contract) ───────────────────────

/** The three moderation verdicts. Note the intentional "innapropriate". */
export type SketchStatus = "approved" | "innapropriate" | "complex";

/** A point-in-time snapshot of the submitting client's history. The buckets
 *  partition: submitted === pending + approved + rejected_complex +
 *  rejected_innapropriate. */
export interface SubmitterStats {
  submitted: number;
  pending: number;
  approved: number;
  rejected_complex: number;
  rejected_innapropriate: number;
}

export interface AdminSketchEvent {
  type: "sketch";
  sketch_id: string;
  submitter: SubmitterStats;
}

export interface AdminVectorizationEvent {
  type: "vectorization";
  vectorization_id: string;
  source_trio: [string, string, string];
  command_options: [DrawCommand[], DrawCommand[]];
}

export type AdminEvent = AdminSketchEvent | AdminVectorizationEvent;

// ── Sketch queue priority ────────────────────────────────────────────────────

/**
 * Priority score for a pending sketch (lower = review sooner). Straight from the
 * integration guide: serve people still waiting on their first honest approval
 * first, pull "stuck retrying on complexity" users even further forward, and
 * push repeat / likely-abusive submitters to the back.
 */
export function priority(s: SubmitterStats): number {
  if (s.approved === 0 && s.rejected_innapropriate === 0) {
    const stuckOnComplexity =
      s.rejected_complex > 0 && s.approved === 0 ? -1 : 0;
    return s.pending + stuckOnComplexity;
  }
  return 100 + s.approved + 5 * s.rejected_innapropriate + s.pending;
}

/** A short human label for why an item sits where it does in the queue. */
export function priorityLabel(s: SubmitterStats): string {
  if (s.approved === 0 && s.rejected_innapropriate === 0) {
    if (s.rejected_complex > 0) return "stuck on complexity";
    return "first-timer";
  }
  if (s.rejected_innapropriate >= 2) return "repeat offender";
  if (s.approved > 0) return "already approved one";
  return "returning";
}

// ── Sketch item ──────────────────────────────────────────────────────────────

export class SketchItem {
  readonly id: string;
  /** Baked in per event; a later event for the same client re-snapshots it, so
   *  keep it reactive and re-score the queue when it changes. */
  submitter = $state<SubmitterStats>({
    submitted: 0,
    pending: 0,
    approved: 0,
    rejected_complex: 0,
    rejected_innapropriate: 0,
  });
  /** Arrival order — a stable tiebreaker so equal-priority sketches keep their
   *  submission order rather than jittering. */
  readonly seq: number;

  constructor(id: string, submitter: SubmitterStats, seq: number) {
    this.id = id;
    this.submitter = submitter;
    this.seq = seq;
  }

  get priority(): number {
    return priority(this.submitter);
  }
}

// ── One editable vectorization option ────────────────────────────────────────

export class OptionEditor {
  readonly original: DrawCommand[];
  /** One clickable SVG subpath per drawn stroke + a viewBox spanning them all,
   *  computed once from the pristine option so the frame never reflows. */
  readonly trace: Trace;

  /** Original indices of the strokes the admin has deleted. Reassigned (never
   *  mutated in place) so the derived command list re-runs. */
  deleted = $state<Set<number>>(new Set());
  /** Deletion order, for undo. */
  private history = $state<number[]>([]);
  /** Index of the stroke currently hovered in the preview, for highlighting. */
  hovered = $state<number | null>(null);

  /** The trimmed command list to draw / POST — always recomputed from scratch. */
  readonly commands = $derived.by(() =>
    rebuildCommands(this.original, this.deleted),
  );
  readonly count = $derived(this.commands.length);

  constructor(commands: DrawCommand[]) {
    this.original = commands;
    this.trace = traceSegments(commands);
  }

  isDeleted(index: number): boolean {
    return this.deleted.has(index);
  }

  /** Delete a stroke (or restore it if already deleted) — the click handler. */
  toggle(index: number): void {
    if (this.deleted.has(index)) this.restore(index);
    else this.delete(index);
  }

  delete(index: number): void {
    if (this.deleted.has(index)) return;
    const next = new Set(this.deleted);
    next.add(index);
    this.deleted = next;
    this.history = [...this.history, index];
  }

  restore(index: number): void {
    if (!this.deleted.has(index)) return;
    const next = new Set(this.deleted);
    next.delete(index);
    this.deleted = next;
    this.history = this.history.filter((i) => i !== index);
  }

  undo(): void {
    if (this.history.length === 0) return;
    const last = this.history[this.history.length - 1];
    this.restore(last);
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get deletedCount(): number {
    return this.deleted.size;
  }
}

// ── Vectorization item (a trio + two options to choose between) ──────────────

export class VectorizationItem {
  readonly id: string;
  readonly trio: [string, string, string];
  readonly options: [OptionEditor, OptionEditor];
  readonly seq: number;

  constructor(
    id: string,
    trio: [string, string, string],
    commandOptions: [DrawCommand[], DrawCommand[]],
    seq: number,
  ) {
    this.id = id;
    this.trio = trio;
    this.options = [
      new OptionEditor(commandOptions[0]),
      new OptionEditor(commandOptions[1]),
    ];
    this.seq = seq;
  }
}
