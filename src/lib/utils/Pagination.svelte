<script lang="ts" module>
  import type { Snippet } from "svelte";

  export class Model<
    P extends Record<string, any>,
    S extends Snippet<[props: P]> | Snippet<[props: P, active: boolean]>,
  > {
    readonly snippet: S;
    items = $state<P[]>([]);
    index = $state(0);

    constructor(snippet: S, ...items: P[]) {
      this.snippet = snippet;
      for (const item of items) this.items.push(item);
    }
  }

  export type Props<
    P extends Record<string, any>,
    S extends Snippet<[props: P]> | Snippet<[props: P, active: boolean]>,
  > = {
    model: Model<P, S>;
    empty: Snippet<[]>;
    /** How many dots to show at once before windowing kicks in. */
    maxDots?: number;
  };
</script>

<script
  lang="ts"
  generics="P extends Record<string, any>, S extends Snippet<[props: P]> | Snippet<[props: P, active: boolean]>"
>
  import { untrack } from "svelte";

  let { model, empty, maxDots = 7 }: Props<P, S> = $props();

  const duration = 300;

  let viewportWidth = $state(0);

  // Swipe / drag state.
  let dragDx = $state(0); // live horizontal offset (px) while a finger is down
  let animating = $state(false); // true while settling to a committed slide
  let pending = $state<"next" | "prev" | "none">("none");

  let startX = 0;
  let startY = 0;
  let axis: "h" | "v" | null = null;

  const hasPrev = $derived(model.index > 0);
  const hasNext = $derived(model.index < model.items.length - 1);

  // Render at most three slides — the current one plus each neighbour — so a
  // swipe reveals real content on either side without mounting the whole array.
  const slots = $derived(
    [
      hasPrev ? model.index - 1 : null,
      model.index,
      hasNext ? model.index + 1 : null,
    ].filter((i): i is number => i !== null),
  );

  // The current slide sits in slot 0 or 1 depending on whether a prev exists;
  // shift the track left by one viewport when it does to keep current centred.
  const baseOffset = $derived(hasPrev ? -viewportWidth : 0);

  function resist(dx: number) {
    // Rubber-band when dragging past the first/last slide.
    if ((dx > 0 && !hasPrev) || (dx < 0 && !hasNext)) return dx * 0.35;
    return dx;
  }

  function onPointerDown(e: PointerEvent) {
    if (animating) return;
    startX = e.clientX;
    startY = e.clientY;
    axis = null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (
      animating ||
      !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)
    )
      return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (axis !== "h") return;
    e.preventDefault();
    dragDx = resist(dx);
  }

  function onPointerUp() {
    if (animating || axis !== "h") {
      axis = null;
      return;
    }
    axis = null;
    const threshold = Math.max(60, viewportWidth * 0.2);
    if (dragDx <= -threshold && hasNext) settle("next");
    else if (dragDx >= threshold && hasPrev) settle("prev");
    else settle("none");
  }

  function settle(direction: "next" | "prev" | "none") {
    pending = direction;
    animating = true;
    dragDx =
      direction === "next"
        ? -viewportWidth
        : direction === "prev"
          ? viewportWidth
          : 0;
  }

  function onTransitionEnd(e: TransitionEvent) {
    if (!animating || e.propertyName !== "transform") return;
    // Commit the index and reset the offset in one batch. Because the slot
    // array shifts with the index, the newly-centred slide lands on the exact
    // pixels the animation ended on — so killing the transition here is
    // seamless rather than a jump.
    animating = false;
    if (pending === "next") model.index += 1;
    else if (pending === "prev") model.index -= 1;
    pending = "none";
    dragDx = 0;
  }

  function jumpTo(i: number) {
    if (animating || i === model.index) return;
    dragDx = 0;
    model.index = i;
  }

  // --- Windowed dots ------------------------------------------------------
  const n = $derived(model.items.length);

  // A *stateful* sliding window: rather than re-centre on the active index
  // (which pins the highlight to the middle so swiping only flashes it), the
  // window holds still and scrolls one dot at a time only once the active
  // index comes within `margin` of an edge. The highlight then visibly travels
  // across the dots and the strip slides just at the boundaries.
  let windowStart = $state(0);
  $effect(() => {
    const idx = model.index;
    const total = n;
    untrack(() => {
      const maxStart = Math.max(0, total - maxDots);
      const margin = Math.min(2, Math.floor((maxDots - 1) / 2));
      let start = windowStart;
      if (idx < start + margin) start = idx - margin;
      else if (idx > start + maxDots - 1 - margin)
        start = idx - (maxDots - 1) + margin;
      windowStart = Math.max(0, Math.min(start, maxStart));
    });
  });

  const windowEnd = $derived(Math.min(n, windowStart + maxDots));
  const overflowLeft = $derived(windowStart > 0);
  const overflowRight = $derived(windowEnd < n);
  const hiddenLeft = $derived(windowStart);
  const hiddenRight = $derived(n - windowEnd);

  // The dots are one continuous, keyed track clipped to a `maxDots`-wide
  // viewport. Scrolling the window just translates the track by whole slots, so
  // dots physically slide in/out rather than popping to a new index — and the
  // active dot, whose screen position is fixed, hands its highlight to the dot
  // sliding into place. Every dot stays mounted with a stable key, so the
  // translate is a single always-on CSS transition with no re-keying.
  const dotSize = 8; // px — matches w-2 / h-2
  const dotGap = 8; // px — matches gap-2
  const slot = dotSize + dotGap;
  const visibleDots = $derived(Math.min(n, maxDots));
  const stripWidth = $derived(
    visibleDots * dotSize + (visibleDots - 1) * dotGap,
  );
  const dotOffset = $derived(-windowStart * slot);
  const allDots = $derived(Array.from({ length: n }, (_, i) => i));

  function dotScale(i: number) {
    // Shrink the outermost one/two dots on a side that has hidden dots, iOS-style.
    if (overflowLeft && i === windowStart) return 0.4;
    if (overflowLeft && i === windowStart + 1) return 0.7;
    if (overflowRight && i === windowEnd - 1) return 0.4;
    if (overflowRight && i === windowEnd - 2) return 0.7;
    return 1;
  }
</script>

<div class="flex h-full w-full flex-col">
  {#if n > 0}
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={`Page ${model.index + 1} of ${n}`}
      class="relative flex-1 touch-pan-y overflow-hidden"
      bind:clientWidth={viewportWidth}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
    >
      <div
        class="flex h-full"
        style:transform={`translateX(${baseOffset + dragDx}px)`}
        style:transition={animating
          ? `transform ${duration}ms ease-out`
          : "none"}
        ontransitionend={onTransitionEnd}
      >
        {#each slots as i (i)}
          <div class="h-full w-full shrink-0 grow-0 basis-full">
            {@render model.snippet(model.items[i], i === model.index)}
          </div>
        {/each}
      </div>
    </div>

    <div class="flex items-center justify-center gap-2 py-3">
      <span
        aria-hidden={!overflowLeft}
        class:opacity-0={!overflowLeft}
        class:opacity-100={overflowLeft}
        class="min-w-6 text-right text-xs tabular-nums text-gray-500 transition-opacity duration-200"
      >
        {#if overflowLeft}‹&#8202;{hiddenLeft}{/if}
      </span>

      <div class="overflow-hidden" style:width={`${stripWidth}px`}>
        <div
          class="flex gap-2"
          style:transform={`translateX(${dotOffset}px)`}
          style:transition={`transform ${duration}ms ease-out`}
        >
          {#each allDots as i (i)}
            {@const active = i === model.index}
            <button
              type="button"
              aria-label={`Go to page ${i + 1}`}
              aria-current={active}
              onclick={() => jumpTo(i)}
              class:bg-gray-800={active}
              class:bg-gray-400={!active}
              class="h-2 w-2 shrink-0 rounded-full transition-[transform,background-color] duration-200"
              style:transform={`scale(${active ? 1 : dotScale(i)})`}
            ></button>
          {/each}
        </div>
      </div>

      <span
        aria-hidden={!overflowRight}
        class:opacity-0={!overflowRight}
        class:opacity-100={overflowRight}
        class="min-w-6 text-left text-xs tabular-nums text-gray-500 transition-opacity duration-200"
      >
        {#if overflowRight}{hiddenRight}&#8202;›{/if}
      </span>
    </div>
  {:else}
    {@render empty()}
  {/if}
</div>
