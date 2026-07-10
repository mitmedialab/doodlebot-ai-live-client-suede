<script lang="ts">
  import Sweater from "../sweater-vest-suede/Sweater.svelte";

  const hueByColor = {
    red: 155, // → 0°
    orange: 190, // → 30°
    yellow: 215, // → 60°
    lime: 250, // → 90°
    green: 280, // → 120°
    teal: 325, // → 165°
    cyan: 340, // → 180°
    blue: 40, // → 240°
    indigo: 60, // → 260°
    purple: 80, // → 280°
    magenta: 100, // → 300°
    pink: 130, // → 330°
  } as const satisfies Record<string, number>;

  const brightnessByColor = {
    red: 0.8,
    orange: 1,
    yellow: 1.25,
    lime: 1,
    green: 1,
    teal: 1,
    cyan: 1,
    blue: 1,
    indigo: 1,
    purple: 1,
    magenta: 1,
    pink: 1,
  } as const;

  let adjustment = $state(0);
</script>

<label for="input">hue adjustment</label>
<input type="number" id="input" bind:value={adjustment} />

{#each Object.entries(hueByColor) as [key, hue]}
  <Sweater body={async () => {}}>
    {#snippet vest(_: {})}
      <div class="workflow">
        <section class="section">
          <!-- ring around the image; striped + animated only while processing -->
          <div class="card hero">
            <div class="inner">
              <div
                class="hero"
                style:--hue={`${hue + adjustment}deg`}
                style:--brightness={brightnessByColor[key]}
              >
                <h2>{key}</h2>
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
    height: var(--card);
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

  /* Hero image: stacked layers that crossfade from grey silhouette (idle /
     processing) to full-color image + recolored overlay (success). The border
     traces the image's alpha outline rather than a rectangle. */
  .hero {
    position: relative;
    width: 100%;
    height: 100%;
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
  /* recolor the (light-blue) overlay elements */
  .hero .hero-overlay {
    filter: hue-rotate(var(--hue)) brightness(var(--brightness));
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
