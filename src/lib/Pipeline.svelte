<script lang="ts" module>
  import { WorkflowSection } from "./Workflow.svelte";
  import type { OverlayFilter } from "./color";

  // The DoodleBot submit-a-sketch pipeline is just a sequence of states the
  // Workflow can be in. PipelineModel owns the three WorkflowSection instances
  // and exposes semantic transitions that mutate them; Pipeline.svelte renders
  // the model and its chrome. Drive it from app code or a test.

  export type ScreenId =
    | "approval-pending"
    | "rejected-inappropriate"
    | "rejected-complex"
    | "rejected-inactive-session"
    | "approved"
    | "combining"
    | "robot-selection"
    | "complete";

  type Banner = {
    kind: "error" | "success" | "info";
    text: string;
    /** Optional inline color chip: the first occurrence of `token` in `text` is
     *  rendered as a pill filled with `bg` and lettered in `fg` (e.g. the
     *  completion message highlights which color robot to go find). Both are
     *  meant to be shades of the same hue — a deep fill with a light label — so
     *  the chip reads as that color and stays legible for every hue. */
    accent?: { token: string; bg: string; fg: string };
  };
  export type PipelineAction = { label: string; run: (...args: any[]) => void };

  export class PipelineModel {
    readonly approval = new WorkflowSection({
      label: "Sketch",
      status: "processing",
      text: "Reviewing",
    });
    readonly combination = new WorkflowSection({
      label: "Combine",
      status: "idle",
    });
    readonly robot = new WorkflowSection({
      label: "Doodlebot",
      status: "idle",
      image: "./full.png",
      overlay: "./elements.png",
      // Overlay recolor left at identity — the hat art is a deep red at rest;
      // markComplete retints it to the server-assigned color once assigned.
      silhouette: true, // grey until the drawing completes
      shaped: true, // outlined robot shape, not a rectangular frame
    });
    readonly sections = [this.approval, this.combination, this.robot];

    state = $state<ScreenId>("approval-pending");
    step = $state("Step 1 of 3");
    banner = $state<Banner | undefined>(undefined);

    /** The submitted photo (kept so reset can restore it). */
    private readonly sketch: string | undefined;

    /** Pending timer for the "combining takes a while" info banner, so it can
     *  be cancelled if we leave the combining phase (or reset) before it fires. */
    private bannerTimer: ReturnType<typeof setTimeout> | undefined;

    /** @param sketch the submitted photo shown in the first (Sketch) section */
    constructor(sketch?: string) {
      this.sketch = sketch;
      this.approval.image = sketch;
    }

    private clearBannerTimer() {
      if (this.bannerTimer !== undefined) {
        clearTimeout(this.bannerTimer);
        this.bannerTimer = undefined;
      }
    }

    /** Back to the start — replays cleanly for looping demos. */
    reset() {
      this.clearBannerTimer();
      this.approval.status = "processing";
      this.approval.text = "Reviewing";
      this.approval.frameText = undefined;
      this.approval.image = this.sketch;
      this.combination.status = "idle";
      this.combination.text = undefined;
      this.combination.frameText = undefined;
      this.combination.image = undefined; // no vectorized result yet
      this.combination.companions = []; // no paired images yet
      this.robot.status = "idle";
      this.robot.frameText = undefined;
      this.robot.silhouette = true;
      this.approval.severed = false;
      this.combination.severed = false;
      this.robot.severed = false;
      this.state = "approval-pending";
      this.step = "Step 1 of 3";
      this.banner = undefined;
    }

    // ── Approval outcomes ───────────────────────────────────────────────
    approve() {
      this.approval.status = "success";
      // transient status pill clears once resolved
      this.approval.text = undefined;
      this.combination.status = "processing";
      this.combination.text = "Grouping";
      this.state = "approved";
      this.step = "Step 2 of 3";
    }
    rejectInappropriate() {
      this.reject("Inappropriate content. Please draw something else!", {
        kind: "error",
        text: "Picture hidden — flagged as inappropriate",
      });
      this.approval.image = undefined; // hide the flagged picture
      this.state = "rejected-inappropriate";
    }
    rejectTooComplex() {
      this.reject("Drawing too complex. Please try again!");
      this.state = "rejected-complex";
    }
    /** Synchronous, pre-pipeline rejection: the sketch rode a session token that
     *  isn't active. No SSE events will ever arrive for it. */
    rejectInactiveSession() {
      this.reject("This session isn't active — ask the host for a current link.", {
        kind: "error",
        text: "Session not active — get a fresh link from the event host",
      });
      this.state = "rejected-inactive-session";
    }
    private reject(reason: string, banner?: Banner) {
      this.approval.status = "error";
      this.approval.text = "Rejected";
      // The detail is too long for the arrow, so it rides in section 2's frame.
      this.combination.status = "error";
      this.combination.text = undefined;
      this.combination.frameText = reason;
      // the flow ends here — drop the arrow to the robot stage
      this.combination.severed = true;
      this.robot.status = "idle";
      this.robot.text = "Not reached";
      this.step = "Concluded";
      this.banner = banner;
    }

    // ── Combination ─────────────────────────────────────────────────────
    /** A paired source image (from the server) arrives during grouping. */
    pairImage(src: string) {
      this.combination.companions.push(src);
    }
    /**
     * Enter the combining phase. Mashing the drawings together + vectorizing can
     * take a while, so once we've been waiting for `infoBannerDelayMs` we drop a
     * playful info banner nudging the user to tap a grouped image while they wait
     * (rather than nagging the instant combining starts). Defaults to 5s for the
     * real app; tests can pass a shorter delay to surface the banner quickly.
     */
    startCombining(infoBannerDelayMs = 5000) {
      this.combination.status = "processing";
      this.combination.text = "Combining";
      this.state = "combining";

      this.clearBannerTimer();
      this.bannerTimer = setTimeout(() => {
        this.bannerTimer = undefined;
        // Only nudge if we're still stuck waiting in the combining phase.
        if (this.state !== "combining") return;
        this.banner = {
          kind: "info",
          text: "This step can take a while... In the meantime, try tapping on any picture to see it larger, checkout out what the doodlebots have already drawn, or sketch something else!",
        };
      }, infoBannerDelayMs);
    }
    /** @param vectorized image src for the combined & vectorized drawing */
    finishVectorizing(vectorized?: string) {
      // Combining is done — drop the pending nudge and clear it if it showed.
      this.clearBannerTimer();
      if (this.banner?.kind === "info") this.banner = undefined;
      this.combination.status = "success";
      // transient status pill clears once resolved
      this.combination.text = undefined;
      this.combination.image = vectorized; // the vectorized drawing
      //this.combination.companions = []; // paired images consumed into the result
      this.robot.status = "processing";
      this.step = "Step 3 of 3";
      this.robot.status = "processing";
      this.robot.text = "Selecting";
      this.state = "robot-selection";
    }
    /**
     * @param msg    the completion message
     * @param filter recolor (hue-rotate/saturate/brightness) applied to the
     *               revealed robot overlay art, retinting the red hat to the
     *               assigned color. Defaults to identity (the art's own red).
     * @param accent optional inline color chip (e.g. the robot color to find),
     *               whose `token` must appear verbatim in `msg`
     */
    markComplete(
      msg: string,
      filter?: OverlayFilter,
      accent?: Banner["accent"],
    ) {
      this.robot.status = "success";
      this.robot.frameText = undefined;
      this.robot.silhouette = false; // reveal the finished drawing
      this.robot.text = undefined;
      this.robot.hue = filter?.hue ?? 0;
      this.robot.saturate = filter?.saturate ?? 1;
      this.robot.brightness = filter?.brightness ?? 1;
      this.state = "complete";
      this.step = "Done";
      this.banner = {
        kind: "success",
        text: msg,
        accent,
      };
    }
  }

  export type Props = {
    /** The pipeline state to render + drive. Defaults to a fresh one. */
    model?: PipelineModel;
  };
</script>

<script lang="ts">
  import Workflow from "./Workflow.svelte";

  let { model = new PipelineModel() }: Props = $props();

  // Split a banner message around the first occurrence of its accent token, so
  // the token can be rendered as a colored chip inline with the surrounding text.
  function splitAround(text: string, token: string) {
    const i = text.indexOf(token);
    return i === -1
      ? { before: text, after: "" }
      : { before: text.slice(0, i), after: text.slice(i + token.length) };
  }
</script>

<div class="pipeline">
  <Workflow sections={model.sections} />

  {#if model.banner}
    <div class="alert" data-kind={model.banner.kind}>
      {@render icon(
        model.banner.kind === "error"
          ? "warning"
          : model.banner.kind === "info"
            ? "info"
            : "check",
      )}
      <span>
        {#if model.banner.accent}
          {@const parts = splitAround(
            model.banner.text,
            model.banner.accent.token,
          )}
          {parts.before}<span
            class="chip"
            style:background={model.banner.accent.bg}
            style:color={model.banner.accent.fg}
            >{model.banner.accent.token}</span
          >{parts.after}
        {:else}
          {model.banner.text}
        {/if}
      </span>
    </div>
  {/if}
</div>

{#snippet icon(name: "warning" | "check" | "info")}
  <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
    {#if name === "warning"}
      <path d="M12 3.5 2.5 20.5h19z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.6h.01" />
    {:else if name === "check"}
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12.4 11 15.4 16.2 9" />
    {:else if name === "info"}
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11.2v5" />
      <path d="M12 7.8h.01" />
    {/if}
  </svg>
{/snippet}

<style>
  .pipeline {
    position: relative;
    width: 100%;
    height: 100%;
    font-family:
      "Nunito",
      system-ui,
      -apple-system,
      sans-serif;
  }

  /* floating alert above the workflow */
  .alert {
    position: absolute;
    top: 0.9rem;
    left: 0.9rem;
    right: 0.9rem;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.85rem;
    border-radius: 12px;
    font-weight: 700;
    font-size: 0.82rem;
    box-shadow: 0 4px 14px rgba(40, 40, 70, 0.14);
  }
  .alert[data-kind="error"] {
    background: #fdecee;
    color: #c0343f;
  }
  .alert[data-kind="success"] {
    background: #e7f7ef;
    color: #1c8b5c;
  }
  .alert[data-kind="info"] {
    background: #e9f1fe;
    color: #2166c9;
  }
  .alert .ic {
    flex-shrink: 0;
  }

  /* Inline color pill naming the robot to hunt for. Its bg/fg are set inline to
     two shades of the robot's own hue (deep fill, light label), so the word
     reads as that color and stays legible across every hue (incl. yellow). */
  .chip {
    display: inline-block;
    padding: 0.05em 0.5em;
    margin: 0 0.12em;
    border-radius: 999px;
    font-weight: 800;
    text-transform: capitalize;
    box-shadow: 0 1px 3px rgba(40, 40, 70, 0.2);
  }

  .ic {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
