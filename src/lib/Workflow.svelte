<script lang="ts" module>
  /** Visual state of a section: neutral while idle, animated blue while
   *  working, solid green/red once it resolves. */
  export type WorkflowStatus = "idle" | "processing" | "success" | "error";

  export type WorkflowSectionInit = {
    /** Short label shown on the side of the section. */
    label: string;
    /** This section's state, which drives the ring/arrow color + animation. */
    status?: WorkflowStatus;
    /** Identity color (pastel) for the section. Defaults by position. */
    color?: string;
    /** Image src shown in the middle of the section. */
    image?: string;
    /** Alt text for the image. */
    alt?: string;
    /** Single line shown centered on this section's outgoing arrow. */
    text?: string;
    /** Text shown inside this section's frame (instead of an image). */
    frameText?: string;
    /** Render this section's outgoing arrow as severed (process ended here). */
    severed?: boolean;
  };

  /** A section is a reactive object: mutate its fields (e.g. `.status`,
   *  `.text`) and the Workflow updates + animates in place. A higher-level
   *  flow (like the sketch pipeline) is just a sequence of these states. */
  export class WorkflowSection {
    label = $state("");
    status = $state<WorkflowStatus>("processing");
    color = $state<string | undefined>(undefined);
    image = $state<string | undefined>(undefined);
    alt = $state<string | undefined>(undefined);
    text = $state<string | undefined>(undefined);
    frameText = $state<string | undefined>(undefined);
    severed = $state(false);

    constructor(init: WorkflowSectionInit) {
      this.label = init.label;
      if (init.status) this.status = init.status;
      this.color = init.color;
      this.image = init.image;
      this.alt = init.alt;
      this.text = init.text;
      this.frameText = init.frameText;
      this.severed = init.severed ?? false;
    }
  }

  export type Props = {
    /** The three (or more) sections, in flow order. */
    sections?: WorkflowSection[];
  };

  /** Friendly pastel identity palette, cycled by section position. */
  const SECTION_PALETTE = [
    "#f4a6cf", // pink
    "#c3b2f4", // purple
    "#fbd06b", // yellow
    "#f7ac70", // orange
    "#8fd6c0", // mint
  ];

  /** State colors, tuned to sit warmly alongside the pastels above. */
  const STATUS_COLOR: Record<WorkflowStatus, string> = {
    idle: "#b4bac7", // neutral / not started
    processing: "#4f8ef7", // friendly blue
    success: "#35c98a", // fresh green
    error: "#f2606b", // soft coral red
  };

  const sectionColor = (s: WorkflowSection, i: number) =>
    s.color ?? SECTION_PALETTE[i % SECTION_PALETTE.length];
</script>

<script lang="ts">
  import { scale, fade } from "svelte/transition";
  import { backOut } from "svelte/easing";

  // Defaults demonstrate one of each state, plus a mid-arrow label.
  const defaults: WorkflowSection[] = [
    new WorkflowSection({
      label: "Sketch",
      status: "success",
      text: "Processing",
    }),
    new WorkflowSection({ label: "Combine", status: "processing" }),
    new WorkflowSection({ label: "Doodlebot", status: "error" }),
  ];

  let { sections = defaults }: Props = $props();
</script>

<div class="workflow" style:--n={sections.length}>
  {#each sections as section, i}
    <section
      class="section"
      style:--section={sectionColor(section, i)}
      style:--state={STATUS_COLOR[section.status]}
    >
      <!-- ring around the image; striped + animated only while processing -->
      <div
        class="card"
        class:processing={section.status === "processing"}
        class:idle={section.status === "idle"}
      >
        <div class="inner">
          {#if section.frameText}
            <span class="frame-text" transition:fade={{ duration: 180 }}>
              {section.frameText}
            </span>
          {:else if section.image}
            <img src={section.image} alt={section.alt ?? section.label} />
          {:else}
            <span class="placeholder" aria-hidden="true"></span>
          {/if}
        </div>
      </div>
      <span class="label">{section.label}</span>
    </section>
  {/each}

  <!-- Arrows sit above every section so they can cross section boundaries.
       Each spans the gap between two rings and shares its source section's
       animated stripes, so it reads as extending out from that ring. An
       optional `text` rides in a pill centered on the arrow. -->
  <div class="arrows">
    {#each sections.slice(0, -1) as section, i}
      <span
        class="arrow"
        class:processing={section.status === "processing"}
        class:severed={section.severed}
        style:--at={(i + 1) / sections.length}
        style:--state={STATUS_COLOR[section.status]}
        aria-hidden="true"
      ></span>
      {#if section.text}
        <span
          class="arrow-label"
          class:processing={section.status === "processing"}
          style:--at={(i + 1) / sections.length}
          style:--state={STATUS_COLOR[section.status]}
          transition:scale={{ duration: 400, start: 0.55, easing: backOut }}
        >
          <span class="arrow-label-inner">{section.text}</span>
        </span>
      {/if}
    {/each}
  </div>
</div>

<style>
  .workflow {
    --ink: #46506b;
    /* size of the square image card (border-box, ring included) */
    --card: min(44vmin, 220px);
    /* length of an arrow: the gap between two rings (shared with labels) */
    --gap: max(28px, calc(100% / var(--n) - var(--card)));
    position: relative;
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

  /* Animated striped overlay for the "processing" state — two distinct tones
     of the (blue) status color, marching to read as in-progress. Overrides
     the solid ring/arrow color below. */
  .processing {
    background-image: repeating-linear-gradient(
      45deg,
      var(--state) 0 12px,
      color-mix(in srgb, var(--state) 60%, #ffffff) 12px 24px
    );
    background-size: 34px 34px;
    animation: march 0.7s linear infinite;
  }
  @keyframes march {
    to {
      background-position: -34px 0;
    }
  }

  /* Ring: a square card whose padding shows the animated stripes; the white
     inner holds the image. Floats in the section's true center so the
     connecting arrows line up with the image centers. */
  .card {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    box-sizing: border-box;
    width: var(--card);
    aspect-ratio: 1;
    padding: 8px;
    border-radius: 20px;
    box-shadow: 0 6px 20px rgba(40, 40, 70, 0.16);
    /* solid status color (success/error); processing adds stripes on top.
       Use background-color (not the shorthand) so it doesn't reset the
       striped background-image from .processing. */
    background-color: var(--state);
  }
  /* not-started stages sit back visually */
  .card.idle {
    opacity: 0.82;
    box-shadow: 0 4px 14px rgba(40, 40, 70, 0.1);
  }
  .inner {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8%;
    background: #fff;
    border-radius: 13px;
    overflow: hidden;
  }
  .inner img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .frame-text {
    text-align: center;
    font-weight: 800;
    font-size: 0.95rem;
    line-height: 1.3;
    color: color-mix(in srgb, var(--state) 68%, #2b2f3a);
  }
  .placeholder {
    width: 100%;
    height: 100%;
    border-radius: 8px;
    border: 2px dashed rgba(70, 80, 107, 0.25);
    background: repeating-linear-gradient(
      45deg,
      transparent 0 10px,
      rgba(70, 80, 107, 0.05) 10px 20px
    );
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

  /* Arrow overlay spans the whole component, above every section. */
  .arrows {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  /* Arrow shape (clip-path) filled with the same animated stripes; sized to
     span the gap between two rings: sectionLength / n − cardSize. */
  .arrow {
    --thickness: 26px;
    position: absolute;
    /* solid status color (success/error); processing adds stripes on top */
    background-color: var(--state);
    filter: drop-shadow(0 1px 1px rgba(255, 255, 255, 0.5));
  }
  /* severed: muted, with a diagonal gap cut through the shaft — the flow
     ended here so the link is visibly broken. */
  .arrow.severed {
    background-color: #c2c6d1;
    animation: none;
    background-image: none;
    -webkit-mask: linear-gradient(
      135deg,
      #000 43%,
      transparent 43% 57%,
      #000 57%
    );
    mask: linear-gradient(135deg, #000 43%, transparent 43% 57%, #000 57%);
  }
  /* Mid-arrow label: a white pill whose border echoes the frame/arrow — a
     solid status color, or the same marching stripes while processing (the
     .processing class layers striped background-image over the color). */
  .arrow-label {
    position: absolute;
    z-index: 3;
    padding: 3px;
    border-radius: 10px;
    background-color: var(--state);
    box-shadow: 0 2px 9px rgba(40, 40, 70, 0.22);
  }
  .arrow-label-inner {
    display: block;
    padding: 0.16rem 0.5rem;
    border-radius: 7px;
    background: #ffffff;
    color: #1c2230;
    font-weight: 800;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  /* ---- Portrait (tall screen): flow downward ---- */
  @media (orientation: portrait) {
    .workflow {
      flex-direction: column;
    }
    /* label runs up the left edge, rotated 90° */
    .label {
      left: 1.3rem;
      top: 50%;
      transform: translate(-50%, -50%) rotate(-90deg);
    }
    /* arrows point down, centered horizontally, sitting on each boundary */
    .arrow {
      left: 50%;
      top: calc(var(--at) * 100%);
      transform: translate(-50%, -50%);
      width: var(--thickness);
      height: var(--gap);
      clip-path: polygon(
        32% 0,
        68% 0,
        68% 62%,
        100% 62%,
        50% 100%,
        0 62%,
        32% 62%
      );
    }
    /* sit the pill above the boundary — centered between the source frame's
       bottom (arrow top) and the arrowhead top (62% down the arrow) */
    .arrow-label {
      left: 50%;
      top: calc(var(--at) * 100% - 0.19 * var(--gap));
      transform: translate(-50%, -50%);
    }
  }

  /* ---- Landscape (wide screen): flow rightward ---- */
  @media (orientation: landscape) {
    .workflow {
      flex-direction: row;
    }
    /* label sits along the bottom edge */
    .label {
      bottom: 0.9rem;
      left: 50%;
      transform: translateX(-50%);
    }
    /* arrows point right, centered vertically, sitting on each boundary */
    .arrow {
      top: 50%;
      left: calc(var(--at) * 100%);
      transform: translate(-50%, -50%);
      height: var(--thickness);
      width: var(--gap);
      clip-path: polygon(
        0 32%,
        62% 32%,
        62% 0,
        100% 50%,
        62% 100%,
        62% 68%,
        0 68%
      );
    }
    /* drop the pill below the arrow line so both stay visible */
    .arrow-label {
      top: calc(50% + 24px);
      left: calc(var(--at) * 100%);
      transform: translateX(-50%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .processing {
      animation: none;
    }
  }
</style>
