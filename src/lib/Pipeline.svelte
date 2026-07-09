<script lang="ts" module>
  import { WorkflowSection } from "./Workflow.svelte";

  // The DoodleBot submit-a-sketch pipeline is just a sequence of states the
  // Workflow can be in. PipelineModel owns the three WorkflowSection instances
  // and exposes semantic transitions that mutate them; Pipeline.svelte renders
  // the model and its chrome. Drive it from app code or a test.

  export type ScreenId =
    | "approval-pending"
    | "rejected-inappropriate"
    | "rejected-complex"
    | "approved"
    | "combining"
    | "robot-selection"
    | "complete";

  type Banner = { kind: "error" | "success"; text: string };
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
      hue: 130, // recolor the light-blue hat/pen
      silhouette: true, // grey until the drawing completes
      shaped: true, // outlined robot shape, not a rectangular frame
    });
    readonly sections = [this.approval, this.combination, this.robot];

    state = $state<ScreenId>("approval-pending");
    step = $state("Step 1 of 3");
    banner = $state<Banner | undefined>(undefined);

    /** The submitted photo (kept so reset can restore it). */
    private readonly sketch: string | undefined;

    /** @param sketch the submitted photo shown in the first (Sketch) section */
    constructor(sketch?: string) {
      this.sketch = sketch;
      this.approval.image = sketch;
    }

    /** Back to the start — replays cleanly for looping demos. */
    reset() {
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
      this.reject("Inappropriate content", {
        kind: "error",
        text: "Picture hidden — flagged as inappropriate",
      });
      this.approval.image = undefined; // hide the flagged picture
      this.state = "rejected-inappropriate";
    }
    rejectTooComplex() {
      this.reject("Drawing too complex");
      this.state = "rejected-complex";
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
    startCombining() {
      this.combination.status = "processing";
      this.combination.text = "Combining";
      this.state = "combining";
    }
    /** @param vectorized image src for the combined & vectorized drawing */
    finishVectorizing(vectorized?: string) {
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
    markComplete(msg: string, hue: number = 0) {
      this.robot.status = "success";
      this.robot.frameText = undefined;
      this.robot.silhouette = false; // reveal the finished drawing
      this.robot.text = undefined;
      this.robot.hue = hue;
      this.state = "complete";
      this.step = "Done";
      this.banner = {
        kind: "success",
        text: msg,
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
</script>

<div class="pipeline">
  <Workflow sections={model.sections} />

  {#if model.banner}
    <div class="alert" data-kind={model.banner.kind}>
      {@render icon(model.banner.kind === "error" ? "warning" : "check")}
      <span>{model.banner.text}</span>
    </div>
  {/if}
</div>

{#snippet icon(name: "warning" | "check")}
  <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
    {#if name === "warning"}
      <path d="M12 3.5 2.5 20.5h19z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.6h.01" />
    {:else if name === "check"}
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12.4 11 15.4 16.2 9" />
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
  .alert .ic {
    flex-shrink: 0;
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
