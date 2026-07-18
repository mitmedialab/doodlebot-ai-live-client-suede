<script lang="ts" module>
  import { describeRobotColor, type OverlayFilter } from "$lib/color";
  import { type SSEPayload, resourceURL } from "$lib/api";

  // The gallery is a passive, big-screen visualization of one session's output.
  // It listens to the *same* SSEPayload stream the sketch app produces (here via
  // /events/all, filtered to one session), but instead of driving a per-sketch
  // pipeline it folds every payload into a flat per-sketch aggregate — one
  // GalleryEntry — and paints two grids from it.

  /** One sketch's accumulated story: the original drawing, the source images it
   *  was combined with, the vectorized "doodle", and (once assigned) the robot
   *  color. Payloads for a sketch can arrive in any order / repeat on reconnect,
   *  so every field is set idempotently. */
  class GalleryEntry {
    readonly id: string;
    readonly sketchSrc: string;
    /** Only show sketches once explicitly approved */
    hidden = $state(true);
    /** The (up to two) images this sketch was grouped with before vectorizing. */
    companions = $state<string[]>([]);
    /** The combined + vectorized result. Its presence is what promotes this
     *  entry into the doodles column. */
    vectorization = $state<string | undefined>(undefined);
    /** Recolor filter for the beret overlay once a robot is assigned. */
    robot = $state<OverlayFilter | undefined>(undefined);

    constructor(id: string, sketchSrc: string) {
      this.id = id;
      this.sketchSrc = sketchSrc;
    }

    /** The three source images feeding the doodle: the sketch itself plus its
     *  companions (the pairing tops out at two, so this is at most three). */
    get sources(): string[] {
      return [this.sketchSrc, ...this.companions].slice(0, 3);
    }
  }

  export class GalleryModel {
    private readonly byId = new Map<string, GalleryEntry>();
    /** Insertion-ordered (oldest first) so the grids read as a growing feed. */
    entries = $state<GalleryEntry[]>([]);

    readonly session: string;

    /** Every visible sketch — the left grid. */
    get sketches(): GalleryEntry[] {
      return this.entries.filter((e) => !e.hidden);
    }
    /** Only sketches that reached a vectorization — the right (doodles) grid. */
    get doodles(): GalleryEntry[] {
      const unique = new Set<string>();
      return this.entries.filter(({ hidden, vectorization }) => {
        if (hidden || !vectorization || unique.has(vectorization)) return false;
        unique.add(vectorization);
        return true;
      });
    }

    constructor(session: string) {
      this.session = session;
    }

    /** Fold one already-session-matched payload into its entry. */
    process(payload: SSEPayload, server: string) {
      const { sketch, session } = payload;
      if (session !== this.session) return;

      let entry = this.byId.get(sketch);
      if (!entry) {
        entry = new GalleryEntry(sketch, resourceURL(server, sketch));
        this.byId.set(sketch, entry);
        this.entries.push(entry);
      }

      if (payload.status === "approved") entry.hidden = false;

      if (payload.companions) {
        for (const companion of payload.companions) {
          const url = resourceURL(server, companion);
          if (!entry.companions.includes(url)) entry.companions.push(url);
        }
      }

      if (payload.vectorization)
        entry.vectorization = resourceURL(server, payload.vectorization);

      // The server assigns a robot and its hat color (a hex string); translate
      // it into the CSS filter that repaints the red beret overlay to match.
      if (payload.color) entry.robot = describeRobotColor(payload.color).filter;
    }
  }

  export type Props = {
    /** The reactive model fed by the route's SSE stream. */
    model: GalleryModel;
  };
</script>

<script lang="ts">
  import Marquee from "$lib/Marquee.svelte";
  import { fade } from "svelte/transition";

  let { model }: Props = $props();

  // Layout constants. GAP/PAD are shared by both columns so their rows share a
  // rhythm; K is the doodle column's width in units of a sketch cell — enough to
  // hold the main frame (1×), the stacked sources tucked at its left, and the
  // robot poking off its bottom-right corner.
  const GAP = 16;
  const PAD = 20;
  const DIVIDER = 1;
  const K = 1.55;

  let root = $state<HTMLDivElement>();
  // The square-cell edge, shared by both grids so a doodle's main frame is
  // exactly a sketch square and their rows line up. Derived from the *total*
  // width (not a measured column) so sizing the doodle column can't feed back
  // into the sketch column and oscillate.
  let cell = $state(150);
  let doodleWidth = $state(240);

  $effect(() => {
    if (!root) return;
    const compute = () => {
      const inner = root!.clientWidth - DIVIDER;
      // inner = sketch(3·S + 2·GAP + 2·PAD) + doodle(K·S + 2·PAD)
      //       = (3 + K)·S + 2·GAP + 4·PAD   →  solve for S.
      const s = Math.max(80, (inner - 2 * GAP - 4 * PAD) / (3 + K));
      cell = s;
      doodleWidth = K * s + 2 * PAD;
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(root);
    return () => ro.disconnect();
  });

  const robotFilter = (f: OverlayFilter) =>
    `hue-rotate(${f.hue}deg) saturate(${f.saturate}) brightness(${f.brightness})`;
</script>

<div
  class="gallery"
  bind:this={root}
  style:--cell={`${cell}px`}
  style:--gap={`${GAP}px`}
  style:--pad={`${PAD}px`}
  style:--doodle-w={`${doodleWidth}px`}
  style:--bg={`#${new URLSearchParams(window.location.search).get("bg") ?? "f0edfd"}`}
  style:--ink={`#${new URLSearchParams(window.location.search).get("ink") ?? "46506b"}`}
>
  <!-- ~3/4: the sketches, three squares to a row -->
  <section class="col sketches">
    <h2 class="title">Sketches</h2>
    <Marquee
      gap={GAP}
      speed={parseFloat(
        new URLSearchParams(window.location.search).get("speed") ?? "22",
      )}
    >
      {#if model.sketches.length}
        <div class="sketch-grid" in:fade>
          {#each model.sketches as entry (entry.id)}
            <div class="frame square" in:fade>
              <img src={entry.sketchSrc} alt="A submitted sketch" />
            </div>
          {/each}
        </div>
      {:else}
        <p class="waiting">Waiting for sketches…</p>
      {/if}
    </Marquee>
  </section>

  <div class="divider" aria-hidden="true"></div>

  <!-- ~1/4: the doodles, one per row, each aligned to a sketch row -->
  <section class="col doodles">
    <h2 class="title">Doodles</h2>
    <Marquee
      gap={GAP}
      speed={parseFloat(
        new URLSearchParams(window.location.search).get("speed") ?? "22",
      )}
    >
      {#if model.doodles.length}
        <div class="doodle-stack" in:fade>
          {#each model.doodles as entry (entry.id)}
            <div class="doodle" in:fade>
              <!-- the three sources, stacked and tucked against the frame's
                   left edge -->
              <div class="sources">
                {#each entry.sources as src (src)}
                  <div class="source" in:fade>
                    <img {src} alt="A source drawing" />
                  </div>
                {/each}
              </div>

              <div class="frame square main">
                <img src={entry.vectorization} alt="The vectorized doodle" />
              </div>

              {#if entry.robot}
                <!-- the assigned robot, its red beret repainted to the assigned
                     color, perched on the frame's bottom-right corner -->
                <div class="robot" in:fade>
                  <img class="robot-body" src="./full.png" alt="" />
                  <img
                    class="robot-hat"
                    src="./elements.png"
                    alt=""
                    style:filter={robotFilter(entry.robot)}
                  />
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="waiting">No doodles yet…</p>
      {/if}
    </Marquee>
  </section>
</div>

<style>
  .gallery {
    display: flex;
    width: 100%;
    height: 100%;
    background: var(--bg);
    font-family:
      "Nunito",
      system-ui,
      -apple-system,
      sans-serif;
  }

  .col {
    display: flex;
    flex-direction: column;
    padding: var(--pad);
    min-height: 0;
    min-width: 0;
  }
  .sketches {
    flex: 1;
  }
  /* Fixed to exactly hold one doodle row (frame + sources + robot overhang), so
     the sketch column takes the honest remainder and S stays consistent. */
  .doodles {
    flex: 0 0 var(--doodle-w);
  }

  /* thin, hand-off vertical rule fading at its ends */
  .divider {
    width: var(--divider, 1px);
    align-self: stretch;
    margin: var(--pad) 0;
    background: linear-gradient(
      to bottom,
      transparent 0,
      rgba(70, 80, 107, 0.16) 12%,
      rgba(70, 80, 107, 0.16) 88%,
      transparent 100%
    );
  }

  .title {
    margin: 0 0 var(--gap) 2px;
    font-weight: 800;
    font-size: 0.95rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink);
    opacity: 0.82;
  }

  .waiting {
    margin: var(--gap) 2px;
    font-weight: 700;
    color: #8a90a3;
  }

  /* three-up grid of square sketch cells */
  .sketch-grid {
    display: grid;
    grid-template-columns: repeat(3, var(--cell));
    grid-auto-rows: var(--cell);
    gap: var(--gap);
    justify-content: start;
  }

  /* one doodle per row; its height is exactly a cell so rows align with the
     sketch grid to its left */
  .doodle-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }
  .doodle {
    position: relative;
    display: flex;
    align-items: center;
    height: var(--cell);
    width: calc(var(--cell) * 1.55);
    gap: calc(var(--cell) * 0.05);
  }
  .main {
    flex: 0 0 var(--cell);
  }

  /* the three source thumbnails, stacked to fill the frame's height and nudged
     to overlap its left edge so they read as "attached" */
  .sources {
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: calc(var(--cell) * 0.05);
    margin-right: calc(var(--cell) * -0.05);
  }
  .source {
    box-sizing: border-box;
    width: calc(var(--cell) * 0.3);
    height: calc(var(--cell) * 0.3);
    padding: 8%;
    background: #fff;
    border: 1px solid rgba(70, 80, 107, 0.1);
    border-radius: 10px;
    box-shadow: 0 3px 9px rgba(40, 40, 70, 0.14);
  }
  .source img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  /* shared white frame — a soft-shadowed rounded card holding a contained image */
  .frame {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 7%;
    background: #fff;
    border: 1px solid rgba(70, 80, 107, 0.1);
    border-radius: 16px;
    box-shadow: 0 5px 16px rgba(40, 40, 70, 0.12);
    overflow: hidden;
  }
  .square {
    width: var(--cell);
    height: var(--cell);
  }
  .frame img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  /* assigned robot, overhanging the frame's bottom-right corner */
  .robot {
    position: absolute;
    right: calc(var(--cell) * -0.1);
    bottom: calc(var(--cell) * -0.06);
    width: calc(var(--cell) * 0.52);
    height: calc(var(--cell) * 0.52);
    z-index: 3;
    filter: drop-shadow(0 4px 8px rgba(40, 40, 70, 0.28));
  }
  .robot img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
