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
    /** Image src shown in the middle of the section. Rendered as a grey
     *  silhouette until the section succeeds, then revealed in full color. */
    image?: string;
    /** Alt text for the image. */
    alt?: string;
    /** Overlay image shown over `image` (transparent, same size). Hidden while
     *  the silhouette is showing. */
    overlay?: string;
    /** Overlay recolor, applied as `hue-rotate() saturate() brightness()`.
     *  Together they can retint the (deep red) overlay art to any color — hue
     *  shifts it, saturate scales its vividness, brightness its lightness.
     *  Defaults are identity (0° / 1× / 1×), i.e. the art's own color. */
    hue?: number;
    saturate?: number;
    brightness?: number;
    /** Show `image` as a flat grey silhouette instead of full color. */
    silhouette?: boolean;
    /** Render `image` as a bare outlined shape (its border traces the image's
     *  outline) instead of inside a rectangular frame. */
    shaped?: boolean;
    /** Single line shown centered on this section's outgoing arrow. */
    text?: string;
    /** Text shown inside this section's frame (instead of an image). */
    frameText?: string;
    /** Drop this section's outgoing arrow entirely (process ended here). */
    severed?: boolean;
    /** Extra source images that feed into this section — shown small near its
     *  incoming edge, each with a thin arrow into the center. */
    companions?: string[];
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
    overlay = $state<string | undefined>(undefined);
    hue = $state(0);
    saturate = $state(1);
    brightness = $state(1);
    silhouette = $state(false);
    shaped = $state(false);
    text = $state<string | undefined>(undefined);
    frameText = $state<string | undefined>(undefined);
    severed = $state(false);
    companions = $state<string[]>([]);

    constructor(init: WorkflowSectionInit) {
      this.label = init.label;
      if (init.status) this.status = init.status;
      this.color = init.color;
      this.image = init.image;
      this.alt = init.alt;
      this.overlay = init.overlay;
      this.hue = init.hue ?? 0;
      this.saturate = init.saturate ?? 1;
      this.brightness = init.brightness ?? 1;
      this.silhouette = init.silhouette ?? false;
      this.shaped = init.shaped ?? false;
      this.text = init.text;
      this.frameText = init.frameText;
      this.severed = init.severed ?? false;
      this.companions = init.companions ?? [];
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

  /** The section's identity color: its explicit `color`, else a palette color
   *  chosen by position. Exported so the page-level backdrop (which paints the
   *  section washes + labels) resolves colors identically. */
  export const sectionColor = (s: WorkflowSection, i: number) =>
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

  // Click any frame/companion image to expand it into a lightbox modal.
  let lightbox = $state<{ src: string; alt: string } | null>(null);
  const openLightbox = (src: string, alt: string) => (lightbox = { src, alt });
  const closeLightbox = () => (lightbox = null);

  // Move a node to <body> so its `position: fixed` is relative to the viewport
  // rather than an ancestor with a `transform` (the pagination track slides with
  // translateX, which would otherwise become the fixed lightbox's containing
  // block and drag it off-screen on any page but the first).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") closeLightbox();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="workflow" style:--n={sections.length}>
  {#each sections as section, i}
    <section class="section" style:--state={STATUS_COLOR[section.status]}>
      <!-- ring around the image; striped + animated only while processing -->
      <div
        class="card"
        class:processing={section.status === "processing"}
        class:idle={section.status === "idle"}
        class:hero={section.shaped && !!section.image}
      >
        <div class="inner">
          {#if section.frameText}
            <span class="frame-text" transition:fade={{ duration: 180 }}>
              {section.frameText}
            </span>
          {:else if section.image && !section.shaped}
            <button
              type="button"
              class="img-btn"
              onclick={() =>
                openLightbox(section.image!, section.alt ?? section.label)}
            >
              <img
                class="framed"
                src={section.image}
                alt={section.alt ?? section.label}
              />
            </button>
          {:else if section.image}
            <!-- grey silhouette until success, then the full-color image plus
                 its (recolorable) overlay -->
            <div
              class="hero"
              class:show-silhouette={section.silhouette}
              style:--hue={`${section.hue}deg`}
              style:--saturate={section.saturate}
              style:--brightness={section.brightness}
              style:--img={`url(${section.image})`}
            >
              <!-- border + silhouette are rounded together (the goo filter
                   rounds the composited shape, softening the image's flat
                   canvas-cropped edges); the full-color image stays crisp -->
              <span class="hero-silo">
                <span
                  class="hero-border"
                  class:processing={section.status === "processing"}
                ></span>
                <span class="silhouette"></span>
              </span>
              <img
                class="hero-full"
                src={section.image}
                alt={section.alt ?? section.label}
              />
              {#if section.overlay}
                <img class="hero-overlay" src={section.overlay} alt="" />
              {/if}
            </div>
          {:else}
            <span class="placeholder" aria-hidden="true"></span>
          {/if}
        </div>
        <!-- the final section has no outgoing arrow, so its status pill rides
             the bottom of the picture instead -->
        {#if i === sections.length - 1 && section.text}
          <span
            class="frame-pill"
            class:processing={section.status === "processing"}
            transition:scale={{ duration: 400, start: 0.55, easing: backOut }}
          >
            <span class="arrow-label-inner">{section.text}</span>
          </span>
        {/if}
      </div>
      <!-- Companion source images attach to the frame's edge (left in portrait,
           bottom in landscape) and stack along it. Each is a padded ring that
           shares the section's status color + marching stripes while processing. -->
      {#if section.companions.length}
        <div class="companions">
          {#each section.companions as src, k (k)}
            <span
              class="companion"
              class:processing={section.status === "processing"}
              transition:scale={{ duration: 280, start: 0.4, easing: backOut }}
            >
              <button
                type="button"
                class="img-btn"
                onclick={() => openLightbox(src, "Paired source")}
              >
                <img class="companion-img" src={src} alt="Paired source" />
              </button>
            </span>
          {/each}
        </div>
      {/if}
    </section>
  {/each}

  <!-- Arrows sit above every section so they can cross section boundaries.
       Each spans the gap between two rings and shares its source section's
       animated stripes, so it reads as extending out from that ring. An
       optional `text` rides in a pill centered on the arrow. -->
  <div class="arrows">
    {#each sections.slice(0, -1) as section, i}
      <!-- a severed section drops its outgoing arrow entirely -->
      {#if !section.severed}
        <span
          class="arrow"
          class:processing={section.status === "processing"}
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
      {/if}
    {/each}
  </div>

  <!-- "round corners" filter: blur then threshold the alpha, so a masked
       shape's sharp/flat edges become smoothly rounded. -->
  <svg class="wf-defs" aria-hidden="true" width="0" height="0">
    <filter
      id="wf-round"
      x="-20%"
      y="-20%"
      width="140%"
      height="140%"
      color-interpolation-filters="sRGB"
    >
      <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="b" />
      <feColorMatrix
        in="b"
        type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 18 -8.5"
      />
    </filter>
  </svg>
</div>

<!-- Lightbox: click a frame/companion image to expand it here; dismiss with the
     'x', a backdrop click, or Escape. -->
{#if lightbox}
  <div
    class="lightbox"
    role="dialog"
    aria-modal="true"
    aria-label="Expanded image"
    tabindex="-1"
    use:portal
    onclick={(e) => {
      if (e.target === e.currentTarget) closeLightbox();
    }}
    onkeydown={onKeydown}
    transition:fade={{ duration: 180 }}
  >
    <img
      class="lightbox-img"
      src={lightbox.src}
      alt={lightbox.alt}
      transition:scale={{ duration: 240, start: 0.85, easing: backOut }}
    />
    <button class="lightbox-close" onclick={closeLightbox} aria-label="Close">
      {@render x()}
    </button>
  </div>
{/if}

{#snippet x()}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6 18 18M18 6 6 18" />
  </svg>
{/snippet}

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
    /* The section's pastel wash + label are painted by WorkflowBackdrop at the
       page level so they don't slide with the pagination; this component only
       renders the (sliding) card, arrows, and companions. */
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
  /* "hero" section: the image's silhouette *is* the frame — no rectangular
     card, no white inner. Height matches --card so arrow spacing is preserved;
     width follows the image aspect. */
  .card.hero {
    width: auto;
    height: var(--card);
    aspect-ratio: 604 / 830;
    padding: 0;
    background-color: transparent;
    border-radius: 0;
    box-shadow: none;
  }
  /* no rectangular striped frame while processing — the stripes ride the shape
     border instead */
  .card.hero.processing {
    background-image: none;
    animation: none;
  }
  .card.hero .inner {
    padding: 4%;
    background: transparent;
    border-radius: 0;
    overflow: visible;
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
  /* transparent wrapper that makes an image clickable (opens the lightbox)
     without disturbing its layout — fills the frame so contained images (incl.
     intrinsic-less SVGs) have a definite box to size against */
  .img-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: none;
    cursor: zoom-in;
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

  /* Hero image: stacked layers that crossfade from grey silhouette (idle /
     processing) to full-color image + recolored overlay (success). The border
     traces the image's alpha outline rather than a rectangle. */
  .hero {
    position: relative;
    width: 100%;
    height: 100%;
    filter: drop-shadow(0 5px 9px rgba(40, 40, 70, 0.2));
  }
  /* border + silhouette grouped so the goo filter rounds them together */
  .hero .hero-silo {
    position: absolute;
    inset: 0;
    filter: url(#wf-round);
  }
  .hero .hero-border,
  .hero .silhouette,
  .hero .hero-full,
  .hero .hero-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .wf-defs {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  /* Companion source images, attached to the frame's edge and stacked along
     it. The container is anchored to the card edge per-orientation (below);
     flex handles the stacking. */
  .companions {
    position: absolute;
    z-index: 4;
    display: flex;
    gap: 6px;
    pointer-events: none;
  }
  /* padded ring around the source image — solid status color, or the marching
     stripes while processing (the .processing rule layers them on top) */
  .companion {
    --comp: calc(var(--card) * 0.32);
    box-sizing: border-box;
    width: var(--comp);
    height: var(--comp);
    padding: 4px;
    border-radius: 12px;
    background-color: var(--state);
    box-shadow: 0 3px 10px rgba(40, 40, 70, 0.18);
    /* re-enable clicks (the .companions container disables them so it doesn't
       block the flow arrows) */
    pointer-events: auto;
  }
  .companion-img {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 6%;
    background: #fff;
    border-radius: 9px;
    object-fit: contain;
  }
  .hero .silhouette,
  .hero .hero-full,
  .hero .hero-overlay {
    transition: opacity 0.35s ease;
  }
  /* Border: the status color masked by the image dilated in 8 directions, so
     it peeks out as an even rim around the shape. The silhouette / full image
     on top cover the center, leaving only the rim visible. */
  .hero .hero-border {
    --bw: 6px;
    background-color: var(--state);
    opacity: 1;
    transition: opacity 0.3s ease;
    /* image dilated in 16 directions (22.5° apart) for a smooth even rim */
    -webkit-mask:
      var(--img) calc(50% + 1 * var(--bw)) calc(50% + 0 * var(--bw)) / contain
        no-repeat,
      var(--img) calc(50% + 0.924 * var(--bw)) calc(50% + 0.383 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0.707 * var(--bw)) calc(50% + 0.707 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0.383 * var(--bw)) calc(50% + 0.924 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0 * var(--bw)) calc(50% + 1 * var(--bw)) / contain
        no-repeat,
      var(--img) calc(50% - 0.383 * var(--bw)) calc(50% + 0.924 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% - 0.707 * var(--bw)) calc(50% + 0.707 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% - 0.924 * var(--bw)) calc(50% + 0.383 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% - 1 * var(--bw)) calc(50% + 0 * var(--bw)) / contain
        no-repeat,
      var(--img) calc(50% - 0.924 * var(--bw)) calc(50% - 0.383 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% - 0.707 * var(--bw)) calc(50% - 0.707 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% - 0.383 * var(--bw)) calc(50% - 0.924 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0 * var(--bw)) calc(50% - 1 * var(--bw)) / contain
        no-repeat,
      var(--img) calc(50% + 0.383 * var(--bw)) calc(50% - 0.924 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0.707 * var(--bw)) calc(50% - 0.707 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0.924 * var(--bw)) calc(50% - 0.383 * var(--bw)) /
        contain no-repeat;
    mask:
      var(--img) calc(50% + 1 * var(--bw)) calc(50% + 0 * var(--bw)) / contain
        no-repeat,
      var(--img) calc(50% + 0.924 * var(--bw)) calc(50% + 0.383 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0.707 * var(--bw)) calc(50% + 0.707 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0.383 * var(--bw)) calc(50% + 0.924 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0 * var(--bw)) calc(50% + 1 * var(--bw)) / contain
        no-repeat,
      var(--img) calc(50% - 0.383 * var(--bw)) calc(50% + 0.924 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% - 0.707 * var(--bw)) calc(50% + 0.707 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% - 0.924 * var(--bw)) calc(50% + 0.383 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% - 1 * var(--bw)) calc(50% + 0 * var(--bw)) / contain
        no-repeat,
      var(--img) calc(50% - 0.924 * var(--bw)) calc(50% - 0.383 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% - 0.707 * var(--bw)) calc(50% - 0.707 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% - 0.383 * var(--bw)) calc(50% - 0.924 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0 * var(--bw)) calc(50% - 1 * var(--bw)) / contain
        no-repeat,
      var(--img) calc(50% + 0.383 * var(--bw)) calc(50% - 0.924 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0.707 * var(--bw)) calc(50% - 0.707 * var(--bw)) /
        contain no-repeat,
      var(--img) calc(50% + 0.924 * var(--bw)) calc(50% - 0.383 * var(--bw)) /
        contain no-repeat;
  }
  /* the idle doodlebot shows no rim — just the silhouette */
  .card.hero.idle .hero-border {
    opacity: 0;
  }
  /* grey silhouette = the image's opaque shape filled flat grey (via mask);
     hidden by default, shown only in silhouette mode */
  .hero .silhouette {
    background-color: #a7adba;
    opacity: 0;
    -webkit-mask: var(--img) center / contain no-repeat;
    mask: var(--img) center / contain no-repeat;
  }
  .hero .hero-full,
  .hero .hero-overlay {
    object-fit: contain;
    opacity: 1;
  }
  /* recolor the (deep red) overlay elements: shift hue, then scale saturation
     and lightness so the one asset can stand in for any assigned robot color */
  .hero .hero-overlay {
    filter: hue-rotate(var(--hue)) saturate(var(--saturate))
      brightness(var(--brightness));
  }
  /* silhouette mode: grey shape instead of the full-color image + overlay */
  .hero.show-silhouette .silhouette {
    opacity: 1;
  }
  .hero.show-silhouette .hero-full,
  .hero.show-silhouette .hero-overlay {
    opacity: 0;
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
    /* fixed arrowhead length so it doesn't stretch with the arrow's length */
    --head: 22px;
    position: absolute;
    /* solid status color (success/error); processing adds stripes on top */
    background-color: var(--state);
    filter: drop-shadow(0 1px 1px rgba(255, 255, 255, 0.5));
  }
  /* Mid-arrow label: a white pill whose border echoes the frame/arrow — a
     solid status color, or the same marching stripes while processing (the
     .processing class layers striped background-image over the color). The
     final section reuses this pill under its picture (.frame-pill). */
  .arrow-label,
  .frame-pill {
    position: absolute;
    z-index: 3;
    padding: 3px;
    border-radius: 10px;
    background-color: var(--state);
    box-shadow: 0 2px 9px rgba(40, 40, 70, 0.22);
  }
  .frame-pill {
    left: 50%;
    bottom: -0.7rem;
    transform: translateX(-50%);
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
    /* companions attach to the frame's left edge and stack down it */
    .companions {
      top: 50%;
      right: calc(50% + var(--card) / 2 - 4px);
      transform: translateY(-50%);
      flex-direction: column;
    }
  }

  /* ---- Landscape (wide screen): flow rightward ---- */
  @media (orientation: landscape) {
    .workflow {
      flex-direction: row;
    }
    /* arrows point right; head is a fixed --head px so it never stretches */
    .arrow {
      top: 50%;
      left: calc(var(--at) * 100%);
      transform: translate(-50%, -50%);
      height: var(--thickness);
      width: var(--gap);
      clip-path: polygon(
        0 32%,
        calc(100% - var(--head)) 32%,
        calc(100% - var(--head)) 0,
        100% 50%,
        calc(100% - var(--head)) 100%,
        calc(100% - var(--head)) 68%,
        0 68%
      );
    }
    /* drop the pill below the arrow line so both stay visible */
    .arrow-label {
      top: calc(50% + 24px);
      left: calc(var(--at) * 100%);
      transform: translateX(-50%);
    }
    /* companions attach to the frame's bottom edge and stack across it */
    .companions {
      left: 50%;
      top: calc(50% + var(--card) / 2 - 4px);
      transform: translateX(-50%);
      flex-direction: row;
    }
  }

  /* Lightbox: full-screen dimmed backdrop with the enlarged image centered and
     a close chip in the top-right corner. */
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5vmin;
    background: rgba(20, 22, 34, 0.72);
    cursor: zoom-out;
  }
  .lightbox-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
  }
  /* close chip, echoing the frame pills */
  .lightbox-close {
    position: absolute;
    top: max(1rem, 3vmin);
    right: max(1rem, 3vmin);
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: #fff;
    color: #46506b;
    cursor: pointer;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
  }
  .lightbox-close svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @media (hover: hover) {
    .lightbox-close:hover {
      background: #f2f0fb;
    }
  }
  .lightbox-close:active {
    transform: scale(0.92);
  }

  @media (prefers-reduced-motion: reduce) {
    .processing {
      animation: none;
    }
  }
</style>
