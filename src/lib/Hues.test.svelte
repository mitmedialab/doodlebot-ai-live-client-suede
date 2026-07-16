<script lang="ts">
  import Sweater from "../sweater-vest-suede/Sweater.svelte";
  import { describeRobotColor } from "./color";

  // Visual check for the hex → overlay-recolor pipeline. Each swatch shows a
  // target hex, its human-readable name, and the red-hat overlay recolored via
  // the CSS filter `describeRobotColor` derives — so you can eyeball how closely
  // the retinted hat matches the target chip across the whole color space.
  const samples = [
    "#c0392b", // red
    "#e67e22", // orange
    "#f1c40f", // yellow
    "#a3c644", // lime
    "#52a447", // green (the server example)
    "#16a085", // teal
    "#1ab2c8", // cyan
    "#2f6fd8", // blue
    "#5b3fbf", // indigo
    "#8e44ad", // violet
    "#b3379a", // purple
    "#e84393", // pink
    "#8b5a2b", // brown
    "#7f8c8d", // gray
    "#2c2c2c", // near-black
    "#ecf0f1", // near-white
  ];

  const samplesPerRow = 4;

  // Split the flat sample list into rows of `samplesPerRow` for the grid layout.
  const rows = samples.reduce<string[][]>((acc, hex, i) => {
    if (i % samplesPerRow === 0) acc.push([]);
    acc[acc.length - 1].push(hex);
    return acc;
  }, []);
</script>

{#each rows as row}
  <Sweater config>
    {#each row as hex}
      {@const { name, filter, chip } = describeRobotColor(hex)}
      <Sweater body={async () => {}}>
        {#snippet vest(_: {})}
          <div class="workflow">
            <section class="section">
              <div class="card hero">
                <div class="inner">
                  <!-- label band, reserved above the image so it never overlaps -->
                  <header class="labels">
                    <h2 style:background={chip.bg} style:color={chip.fg}>
                      {name} · {hex}
                    </h2>
                    <!-- target color, so the retinted hat can be compared to it -->
                    <span class="target" style:background={hex}></span>
                  </header>
                  <div
                    class="hero"
                    style:--hue={`${filter.hue}deg`}
                    style:--saturate={filter.saturate}
                    style:--brightness={filter.brightness}
                  >
                    <img class="hero-full" src={"/full.png"} alt="" />
                    <img class="hero-overlay" src={"/elements.png"} alt="" />
                  </div>
                </div>
              </div>
            </section>
          </div>
        {/snippet}
      </Sweater>
    {/each}
  </Sweater>
{/each}

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

  /* "hero" section: the image's silhouette *is* the frame — no rectangular
     card, no white inner. Height matches --card so arrow spacing is preserved;
     width follows the image aspect. */
  .card.hero {
    width: auto;
    /* extra height beyond the image so the label band has its own room */
    height: calc(var(--card) + 2.4rem);
    aspect-ratio: 604 / 830;
    padding: 0;
    background-color: transparent;
    border-radius: 0;
    box-shadow: none;
  }

  .card.hero .inner {
    padding: 4%;
    background: transparent;
    border-radius: 0;
    overflow: visible;
    /* stack the label band above the image so neither overlaps the other */
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  /* label band: title on the left, target swatch on the right */
  .labels {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    flex: 0 0 auto;
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

  /* target color chip, sitting in the label band for side-by-side comparison */
  .target {
    flex: 0 0 auto;
    width: 22%;
    aspect-ratio: 3 / 2;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(40, 40, 70, 0.3);
  }
  h2 {
    margin: 0;
    padding: 0.1em 0.5em;
    border-radius: 999px;
    font-size: 0.8rem;
    text-transform: capitalize;
  }

  /* Hero image: stacked layers that crossfade from grey silhouette (idle /
     processing) to full-color image + recolored overlay (success). The border
     traces the image's alpha outline rather than a rectangle. */
  .hero {
    position: relative;
    width: 100%;
    /* fill whatever vertical room is left after the label band */
    flex: 1 1 auto;
    min-height: 0;
    filter: drop-shadow(0 5px 9px rgba(40, 40, 70, 0.2));
  }

  .hero .hero-full,
  .hero .hero-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .hero .hero-full,
  .hero .hero-overlay {
    transition: opacity 0.35s ease;
  }

  .hero .hero-full,
  .hero .hero-overlay {
    object-fit: contain;
    opacity: 1;
  }
  /* recolor the (deep red) overlay elements — same filter chain as the app */
  .hero .hero-overlay {
    filter: hue-rotate(var(--hue)) saturate(var(--saturate))
      brightness(var(--brightness));
  }

  /* ---- Portrait (tall screen): flow downward ---- */
  @media (orientation: portrait) {
    .workflow {
      flex-direction: column;
    }
  }

  /* ---- Landscape (wide screen): flow rightward ---- */
  @media (orientation: landscape) {
    .workflow {
      flex-direction: row;
    }
  }
</style>
