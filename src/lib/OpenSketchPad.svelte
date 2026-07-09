<script lang="ts">
  import { fade, scale } from "svelte/transition";
  import { backOut } from "svelte/easing";
  import SketchPad, { type Props } from "./SketchPad.svelte";

  let { open = $bindable(false), ...sketchProps }: Props & { open?: boolean } =
    $props();

  // The size transition should only run during the open/close toggle — not on
  // viewport resizes (which change 100vw/100vh and would otherwise re-animate
  // the morph, briefly exposing the purple box past the panel).
  let animating = $state(false);

  function toggle(next: boolean) {
    animating = true;
    open = next;
  }

  function onMorphTransitionEnd(e: TransitionEvent) {
    if (e.propertyName === "width") animating = false;
  }

  export const close = () => toggle(false);
</script>

<div class="root">
  <!-- Single morphing element: a circular button that expands into the panel.
       Anchored bottom-left so it grows up and to the right from the corner. -->
  <div
    class="morph"
    class:open
    class:animating
    ontransitionend={onMorphTransitionEnd}
  >
    {#if !open}
      <button
        class="fab"
        onclick={() => toggle(true)}
        aria-label="Open sketchpad"
        in:fade={{ duration: 140, delay: 140 }}
        out:fade={{ duration: 120 }}
      >
        {@render pencil()}
      </button>
    {/if}

    {#if open}
      <!-- Fixed final size so the canvas sizes correctly regardless of the
           expand animation; the morph's overflow clips it while growing. -->
      <div
        class="pad"
        in:fade={{ duration: 200, delay: 220 }}
        out:fade={{ duration: 130 }}
      >
        <SketchPad {...sketchProps} />
      </div>
    {/if}
  </div>

  {#if open}
    <button
      class="close"
      onclick={() => toggle(false)}
      aria-label="Close sketchpad"
      in:scale={{ duration: 240, delay: 220, start: 0.4, easing: backOut }}
      out:scale={{ duration: 130, start: 0.4 }}
    >
      {@render x()}
    </button>
  {/if}
</div>

{#snippet pencil()}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M3 21c2.5-.4 4.2-1.1 5.3-2.2L18.6 8.5a2 2 0 0 0 0-2.8l-1.3-1.3a2 2 0 0 0-2.8 0L4.2 14.7C3.1 15.8 2.4 17.5 3 21Z"
    />
    <path d="m13.5 6 4.5 4.5" />
  </svg>
{/snippet}

{#snippet x()}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6 18 18M18 6 6 18" />
  </svg>
{/snippet}

<style>
  .root {
    /* Final expanded panel size — nearly the full screen, reused to
       position the close chip. The margin leaves room for the close chip,
       which straddles the top-right corner, to stay fully on-screen. */
    --margin: 1.5rem;
    --w: calc(100dvw - 2 * var(--margin));
    --h: calc(100dvh - 2 * var(--margin));
    --fab: 60px;
    --accent: #855cd6;
    --ink: #575e75;
    /* matches SketchPad's background, so the morph settles into the panel
       color instead of flashing from purple to light when the pad fades in */
    --pad-bg: #f2f0fb;

    position: absolute;
    left: var(--margin);
    bottom: var(--margin);
    z-index: 50;
    font-family:
      "Nunito",
      system-ui,
      -apple-system,
      sans-serif;
  }

  /* Morphing container: circle when closed, rounded panel when open. */
  .morph {
    position: absolute;
    left: 0;
    bottom: 0;
    width: var(--fab);
    height: var(--fab);
    border-radius: 50%;
    overflow: hidden;
    background: var(--accent);
    box-shadow: 0 6px 18px rgba(58, 43, 99, 0.28);
  }
  /* Only animate size while toggling open/closed — not on viewport resize. */
  .morph.animating {
    transition:
      width 0.36s cubic-bezier(0.34, 1.18, 0.5, 1),
      height 0.36s cubic-bezier(0.34, 1.18, 0.5, 1),
      border-radius 0.32s ease,
      box-shadow 0.32s ease,
      background-color 0.3s ease;
  }
  .morph.open {
    width: var(--w);
    height: var(--h);
    border-radius: 20px;
    box-shadow: 0 12px 40px rgba(58, 43, 99, 0.32);
    background: var(--pad-bg);
  }

  /* Closed-state circular button filling the morph. */
  .fab {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: #fff;
    cursor: pointer;
  }
  .fab svg {
    width: 26px;
    height: 26px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @media (hover: hover) {
    .fab:hover {
      background: rgba(255, 255, 255, 0.12);
    }
  }
  .fab:active {
    background: rgba(0, 0, 0, 0.08);
  }

  /* Full-size sketchpad, clipped by the morph while it expands. */
  .pad {
    position: absolute;
    left: 0;
    bottom: 0;
    width: var(--w);
    height: var(--h);
  }

  /* Close chip straddling the panel's top-right corner. */
  .close {
    position: absolute;
    left: calc(var(--w) - 16px);
    bottom: calc(var(--h) - 16px);
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: #fff;
    color: var(--ink);
    cursor: pointer;
    box-shadow: 0 3px 12px rgba(58, 43, 99, 0.28);
    z-index: 2;
  }
  .close svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @media (hover: hover) {
    .close:hover {
      background: #f2f0fb;
    }
  }
  .close:active {
    transform: scale(0.92);
  }

  @media (prefers-reduced-motion: reduce) {
    .morph.animating {
      transition-duration: 0.01ms;
    }
  }
</style>
