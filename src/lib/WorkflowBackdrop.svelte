<script lang="ts" module>
  import type { WorkflowSection } from "./Workflow.svelte";

  export type Props = {
    /** The pipeline sections, in flow order. Only `label` + `color` are read —
     *  everything else (images, status, arrows) is rendered by Workflow inside
     *  the sliding pagination. */
    sections: WorkflowSection[];
  };
</script>

<script lang="ts">
  import { sectionColor } from "./Workflow.svelte";

  let { sections }: Props = $props();
</script>

<!-- The static chrome behind the pipeline pagination: each section's pastel wash
     plus its label. Rendered once at the page level (behind the sliding track)
     so the colors + labels stay put while only the cards/arrows slide. -->
<div class="backdrop">
  {#each sections as section, i}
    <div class="section" style:--section={sectionColor(section, i)}>
      <span class="label">{section.label}</span>
    </div>
  {/each}
</div>

<style>
  /* NOTE: the layout here (flex direction per orientation, sections as equal
     flex children, and label placement) must stay in sync with Workflow.svelte
     — the two render into the same box, so their section boundaries and label
     positions have to line up. */
  .backdrop {
    display: flex;
    width: 100%;
    height: 100%;
    font-family:
      "Nunito",
      system-ui,
      -apple-system,
      sans-serif;
  }

  .section {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    /* soft wash of the section's pastel identity color */
    background: color-mix(in srgb, var(--section) 55%, #ffffff);
  }

  .label {
    position: absolute;
    font-weight: 800;
    font-size: 0.82rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    /* a darker shade of the section's pastel, so it stays legible + on-theme */
    color: color-mix(in srgb, var(--section) 55%, #2b2333);
    white-space: nowrap;
  }

  /* ---- Portrait (tall screen): flow downward ---- */
  @media (orientation: portrait) {
    .backdrop {
      flex-direction: column;
    }
    /* label runs up the right edge, rotated 90° */
    .label {
      left: calc(100% - 1.3rem);
      top: 50%;
      transform: translate(-50%, -50%) rotate(90deg);
    }
  }

  /* ---- Landscape (wide screen): flow rightward ---- */
  @media (orientation: landscape) {
    .backdrop {
      flex-direction: row;
    }
    /* label sits along the top edge */
    .label {
      top: 0.9rem;
      left: 50%;
      transform: translateX(-50%);
    }
  }
</style>
