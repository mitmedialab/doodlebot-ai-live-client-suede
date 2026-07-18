<script lang="ts">
  // A vertical "slot machine" auto-scroller. It renders its `children` snippet,
  // and *only once that content is taller than the viewport* starts looping it
  // upward at a constant, slow speed — a second copy trails the first so the
  // loop is seamless (when copy #1 has scrolled exactly its own height + the
  // inter-copy gap, copy #2 sits precisely where copy #1 began, and the
  // animation resets with no visible jump).
  //
  // While the content fits, it stays put (the trailing copy isn't even
  // rendered). Each instance measures itself independently, so two Marquees on
  // one screen can start scrolling at different times (or one not at all) — the
  // gallery relies on that: its sketch column can loop while the doodle column
  // is still short, and vice versa.
  //
  // Meant to sit inside a flex column: the viewport claims the remaining space
  // (flex: 1) and clips the overflow.
  import type { Snippet } from "svelte";

  type Props = {
    /** The content to display (and, when overflowing, loop). */
    children: Snippet;
    /** Scroll speed in px/second. Kept slow — this is ambient, not urgent. */
    speed?: number;
    /** Vertical gap between the content and its looped clone. Match the
     *  content's own row gap so the rhythm is unbroken across the seam. */
    gap?: number;
  };

  let { children, speed = 22, gap = 0 }: Props = $props();

  let viewport = $state<HTMLDivElement>();
  let firstCopy = $state<HTMLDivElement>();

  // True once the content is taller than the viewport — gates both the trailing
  // copy and the animation.
  let overflowing = $state(false);
  // Travel of one loop: one copy's height plus the seam gap.
  let distance = $state(0);

  // Constant speed regardless of how much content there is: longer lists simply
  // take proportionally longer to cycle.
  const duration = $derived(distance > 0 ? distance / speed : 0);

  function measure() {
    if (!viewport || !firstCopy) return;
    const copyHeight = firstCopy.offsetHeight;
    // +1 tolerance so a pixel-perfect fit doesn't flip into a pointless scroll.
    overflowing = copyHeight > viewport.clientHeight + 1;
    distance = copyHeight + gap;
  }

  $effect(() => {
    measure();
    // Re-measure whenever the viewport resizes (window/layout) or the content
    // grows/shrinks (new sketches arrive, images finish loading, --cell changes).
    const ro = new ResizeObserver(measure);
    if (viewport) ro.observe(viewport);
    if (firstCopy) ro.observe(firstCopy);
    return () => ro.disconnect();
  });
</script>

<div class="viewport" class:scrolling={overflowing} bind:this={viewport}>
  <div
    class="track"
    class:scrolling={overflowing}
    style:--distance={`${distance}px`}
    style:--duration={`${duration}s`}
    style:gap={`${gap}px`}
  >
    <div class="copy" bind:this={firstCopy}>{@render children()}</div>
    {#if overflowing}
      <!-- Trailing clone: purely decorative, it makes the loop seamless. -->
      <div class="copy" aria-hidden="true">{@render children()}</div>
    {/if}
  </div>
</div>

<style>
  .viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  /* Soft fade at the top/bottom edges so rows dissolve in and out rather than
     hard-cutting — only while actually scrolling. */
  .viewport.scrolling {
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent 0,
      #000 5%,
      #000 95%,
      transparent 100%
    );
    mask-image: linear-gradient(
      to bottom,
      transparent 0,
      #000 5%,
      #000 95%,
      transparent 100%
    );
  }
  .track {
    display: flex;
    flex-direction: column;
  }
  .track.scrolling {
    will-change: transform;
    animation: marquee var(--duration) linear infinite;
  }
  @keyframes marquee {
    from {
      transform: translateY(0);
    }
    to {
      transform: translateY(calc(-1 * var(--distance)));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .track.scrolling {
      animation: none;
    }
  }
</style>
