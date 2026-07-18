<script lang="ts">
  import Sweater from "../sweater-vest-suede/Sweater.svelte";
  import Gallery, { GalleryModel } from "./Gallery.svelte";
  import type { SSEPayload } from "$lib/api";
  import { commandsToImgSrc, type DrawCommand } from "./utils/turtle-svg";
  import catcarSketch from "./samples/catcar.png";
  import beachnuggetSketch from "./samples/beachnugget.png";
  import angryhashtagSketch from "./samples/angryhashtag.png";
  import catcarCommands from "./samples/catcar.json";
  import beachnuggetCommands from "./samples/beachnugget.json";
  import angryhashtagCommands from "./samples/angryhashtag.json";

  // Three real sample sketches + their vectorizations, cycled to stand in for a
  // live session's output. `resourceURL` (see api.ts) passes these bundled
  // URLs / data URLs straight through, so the model can key off them directly —
  // we only need to tack a unique `?id=` / `#` suffix on each so two payloads
  // built from the *same* sample don't collapse onto one entry.
  const sketchSamples = [catcarSketch, beachnuggetSketch, angryhashtagSketch];

  const vectorizations = [
    catcarCommands,
    beachnuggetCommands,
    angryhashtagCommands,
  ].map((commands) =>
    commandsToImgSrc(commands as DrawCommand[], {
      stroke: "#2b2f3a",
      strokeWidth: 13,
    }),
  );
</script>

<Sweater
  body={async ({ set, delay, note }) => {
    const session = "test";
    const server = ".";
    const model = set(new GalleryModel(session));

    // ── Deterministic RNG (mulberry32) so a reload replays the same show ──
    let seed = 0x9e3779b9;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

    // Monotonic suffix so every sketch/vectorization key is globally unique.
    let uid = 0;
    const unique = () => uid++;

    // Our own bookkeeping of the entries we've emitted (the model's internals
    // are private), tracking each one's progress through the pipeline so we only
    // ever emit *valid* next-steps. Only our-session entries are tracked; other-
    // session ones are emitted-and-forgotten to prove the filter drops them.
    type Sim = {
      key: string;
      src: string;
      approved: boolean;
      grouped: boolean;
      companion: boolean; // is the trio's representative (carries companions)
      vectorized: boolean;
      robot: boolean;
    };
    const sims: Sim[] = [];

    // Emit a payload into the model, narrating the choice to the console (+ the
    // report note stream).
    const emit = (payload: SSEPayload, label: string) => {
      console.log("[gallery-sim]", label, payload);
      note(label);
      model.process(payload, server);
    };

    // ── Actions ─────────────────────────────────────────────────────────
    // A fresh sketch arrives. 15% ride a foreign session key, which the model
    // must discard — those never touch `sims` or the grids.
    const spawn = () => {
      const id = unique();
      const src = `${sketchSamples[Math.floor(rand() * 3)]}?id=${id}`;
      if (rand() < 0.15) {
        emit(
          { sketch: `${src}`, session: "some-other-session" },
          "spawn — foreign session (filtered out)",
        );
        return;
      }
      sims.push({
        key: src,
        src,
        approved: false,
        grouped: false,
        companion: false,
        vectorized: false,
        robot: false,
      });
      emit({ sketch: src, session }, `spawn — new sketch #${id}`);
    };

    // Moderation approves a pending sketch → it appears in the Sketches grid.
    const approve = () => {
      const s = pick(sims.filter((x) => !x.approved));
      s.approved = true;
      emit(
        { sketch: s.key, session, status: "approved" },
        "approve — sketch revealed",
      );
    };

    // Group three approved sketches into a trio; the representative carries the
    // other two as its companions (its three sources).
    const group = () => {
      const pool = sims.filter((x) => x.approved && !x.grouped);
      const trio: Sim[] = [];
      const scratch = [...pool];
      for (let i = 0; i < 3; i++)
        trio.push(scratch.splice(Math.floor(rand() * scratch.length), 1)[0]);
      trio.forEach((x) => (x.grouped = true));
      const [rep, a, b] = trio;
      rep.companion = true;
      emit(
        { sketch: rep.key, session, companions: [a.key, b.key] },
        "group — trio combined",
      );
    };

    // The combined trio finishes vectorizing → a doodle appears, aligned with
    // its sketch row.
    const vectorize = () => {
      const rep = pick(sims.filter((x) => x.companion && !x.vectorized));
      rep.vectorized = true;
      const v = `${pick(vectorizations)}#${unique()}`;
      emit(
        { sketch: rep.key, session, vectorization: v },
        "vectorize — doodle produced",
      );
    };

    // A robot (a random hat color) is assigned → the recolored bot perches on
    // the doodle's corner.
    const assignRobot = () => {
      const rep = pick(sims.filter((x) => x.vectorized && !x.robot));
      rep.robot = true;
      const color = `#${Math.floor(rand() * 0x1000000)
        .toString(16)
        .padStart(6, "0")}`;
      emit({ sketch: rep.key, session, color }, `assign robot — hat ${color}`);
    };

    // ── Weighted scheduler ──────────────────────────────────────────────
    // Each tick, offer only the actions that are currently valid and pick one
    // (weighted to keep the pipeline flowing). Capped so the grids grow enough
    // to overflow and start the auto-scroll, then settle.
    while (true) {
      await delay({ seconds: 0.35 });

      const choices: [fn: () => void, weight: number][] = [];
      if (sims.length < 27) choices.push([spawn, 3]);
      if (sims.some((x) => !x.approved)) choices.push([approve, 4]);
      if (sims.filter((x) => x.approved && !x.grouped).length >= 3)
        choices.push([group, 3]);
      if (sims.some((x) => x.companion && !x.vectorized))
        choices.push([vectorize, 4]);
      if (sims.some((x) => x.vectorized && !x.robot))
        choices.push([assignRobot, 1]);
      if (!choices.length) continue; // fully processed — idle

      let r = rand() * choices.reduce((sum, [, w]) => sum + w, 0);
      for (const [fn, w] of choices) {
        if ((r -= w) < 0) {
          fn();
          break;
        }
      }
    }
  }}
  lazy
>
  {#snippet vest(pocket: GalleryModel)}
    <Gallery model={pocket} />
  {/snippet}
</Sweater>
