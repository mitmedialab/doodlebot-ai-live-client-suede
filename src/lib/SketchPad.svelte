<script lang="ts" module>
  export type Tool = "draw" | "erase";

  export type Props = {
    /** Stroke color used when drawing. */
    color?: string;
    /** Background/canvas fill color (also the erase color). */
    background?: string;
    /** Single stroke width used for the brush. */
    size?: number;
    /** Seconds the user gets to draw before being prompted to submit. */
    duration?: number;
    /** Called with a PNG data URL when the user hits "Send". */
    onsend?: (dataUrl: string) => void | Promise<void>;
  };
</script>

<script lang="ts">
  import { fade, scale } from "svelte/transition";

  let {
    color = "#1a1a18",
    background = "#ffffff",
    size = 6,
    duration = 15,
    onsend,
  }: Props = $props();

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let ctx: CanvasRenderingContext2D;

  let tool = $state<Tool>("draw");
  const brushSize = $derived(size);
  // Widest the countdown ever gets, so the chip can reserve a fixed digit width
  // and not jitter when the number drops a digit (e.g. 10 → 9).
  const maxDigits = $derived(String(Math.max(1, Math.ceil(duration))).length);

  // Countdown: the user has `duration` seconds to draw, after which they're
  // prompted to submit or trash & redraw. Because SketchPad is mounted fresh
  // each time the pad opens (OpenSketchPad guards it with {#if open}), the
  // mount effect below resets the timer on every open.
  // svelte-ignore state_referenced_locally -- intentional: seed the display
  // with the initial duration; startTimer() keeps it in sync thereafter.
  let remaining = $state(duration);
  let expired = $state(false);
  // Set when the user tries to submit a canvas that's essentially blank — swaps
  // the expiry prompt for an "empty drawing" nudge.
  let emptyWarning = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  function startTimer() {
    clearInterval(timer);
    remaining = duration;
    expired = false;
    emptyWarning = false;
    timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        remaining = 0;
        clearInterval(timer);
        // Decide the moment time's up: an essentially-blank canvas goes
        // straight to the "looks empty" nudge instead of offering submit.
        emptyWarning = isEmptyDrawing();
        expired = true;
      }
    }, 1000);
  }

  $effect(() => {
    startTimer();
    return () => clearInterval(timer);
  });

  let drawing = false;
  let lastX = 0;
  let lastY = 0;
  let history: ImageData[] = [];

  function paintBackground() {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function initCanvas() {
    ctx = canvas.getContext("2d")!;
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    paintBackground();
    history = [];
  }

  $effect(() => {
    initCanvas();

    // Touch listeners must be non-passive so startDraw/doDraw can preventDefault
    // (Svelte registers on:touch* attributes as passive, which ignores it).
    const opts = { passive: false } as const;
    canvas.addEventListener("touchstart", startDraw, opts);
    canvas.addEventListener("touchmove", doDraw, opts);
    canvas.addEventListener("touchend", endDraw, opts);
    return () => {
      canvas.removeEventListener("touchstart", startDraw);
      canvas.removeEventListener("touchmove", doDraw);
      canvas.removeEventListener("touchend", endDraw);
    };
  });

  function saveSnap() {
    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (history.length > 40) history.shift();
  }

  function undoLast() {
    const snap = history.pop();
    if (snap) ctx.putImageData(snap, 0, 0);
  }

  function clearCanvas() {
    saveSnap();
    paintBackground();
  }

  function pos(e: MouseEvent | TouchEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    const s = "touches" in e ? e.touches[0] : e;
    return [
      (s.clientX - r.left) * (canvas.width / r.width),
      (s.clientY - r.top) * (canvas.height / r.height),
    ];
  }

  function startDraw(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    saveSnap();
    drawing = true;
    [lastX, lastY] = pos(e);
  }

  function doDraw(e: MouseEvent | TouchEvent) {
    if (!drawing) return;
    e.preventDefault();
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = tool === "erase" ? background : color;
    ctx.lineWidth = tool === "erase" ? brushSize * 3 : brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    [lastX, lastY] = [x, y];
  }

  function endDraw() {
    drawing = false;
  }

  // Crop to drawn content bounding box, pad ~10% around it, export as a square PNG.
  export function toDataURL(): string {
    const src = canvas;
    const data = ctx.getImageData(0, 0, src.width, src.height).data;

    let minX = src.width;
    let maxX = 0;
    let minY = src.height;
    let maxY = 0;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        // consider a pixel "drawn" if it's dark (not white/near-white)
        if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // nothing drawn — fall back to full canvas
    if (maxX < minX) {
      minX = 0;
      maxX = src.width - 1;
      minY = 0;
      maxY = src.height - 1;
    }

    const contentW = maxX - minX + 1;
    const contentH = maxY - minY + 1;
    const pad = Math.round(Math.max(contentW, contentH) * 0.1);

    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(src.width, maxX + pad + 1) - cropX;
    const cropH = Math.min(src.height, maxY + pad + 1) - cropY;

    // export as square, centering the crop inside it
    const size = Math.max(cropW, cropH);
    const sq = document.createElement("canvas");
    sq.width = sq.height = size;
    const sqcx = sq.getContext("2d")!;
    sqcx.fillStyle = background;
    sqcx.fillRect(0, 0, size, size);
    sqcx.drawImage(
      src,
      cropX,
      cropY,
      cropW,
      cropH,
      Math.floor((size - cropW) / 2),
      Math.floor((size - cropH) / 2),
      cropW,
      cropH,
    );
    return sq.toDataURL("image/png");
  }

  export function clear() {
    clearCanvas();
  }

  // A drawing must ink at least this fraction of the canvas to count as
  // "something". It's a fraction (not an absolute pixel count) so it holds
  // across devices: the canvas is sized in CSS pixels (see initCanvas), so a
  // phone, tablet, and laptop all measure the drawing against their own area.
  // 0.1% clears an obvious empty — a blank canvas, a stray tap, a tiny mark —
  // while even a short line or small shape (typically >0.3%) passes easily.
  // The absolute floor guards very small canvases where the fraction underflows.
  const MIN_INK_FRACTION = 0.001;
  const MIN_INK_PIXELS = 120;

  // Count inked pixels using the same "darker than near-white" heuristic the
  // crop in toDataURL relies on (assumes a light background, as it does).
  function inkedPixelCount(): number {
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) count++;
    }
    return count;
  }

  function isEmptyDrawing(): boolean {
    const total = canvas.width * canvas.height;
    const threshold = Math.max(MIN_INK_PIXELS, total * MIN_INK_FRACTION);
    return inkedPixelCount() < threshold;
  }

  // Only reachable from the "time's up" prompt, which is shown only when the
  // canvas isn't empty (emptiness is decided at expiry — see startTimer).
  function submit() {
    onsend?.(toDataURL());
  }

  // Discard the current drawing and hand the user a fresh canvas + timer.
  function trashAndRedraw() {
    paintBackground();
    history = [];
    startTimer();
  }
</script>

<div class="sketchpad">
  <div class="toolbar">
    <button
      class="tool-btn"
      class:active={tool === "draw"}
      onclick={() => (tool = "draw")}
      title="Brush"
      aria-label="Brush"
      aria-pressed={tool === "draw"}
    >
      {@render pencil()}
    </button>
    <button
      class="tool-btn"
      class:active={tool === "erase"}
      onclick={() => (tool = "erase")}
      title="Eraser"
      aria-label="Eraser"
      aria-pressed={tool === "erase"}
    >
      {@render eraser()}
    </button>

    <div class="tb-space"></div>

    <div
      class="timer"
      class:urgent={remaining <= 5}
      role="timer"
      aria-label="Time remaining to draw"
    >
      {@render clock()}
      <span class="count"
        ><span class="num" style="min-width: {maxDigits}ch">{remaining}</span
        >s</span
      >
    </div>

    <div class="tb-space"></div>

    <button class="tool-btn" onclick={undoLast} title="Undo" aria-label="Undo">
      {@render backCycleArrow()}
    </button>
    <button
      class="tool-btn"
      onclick={clearCanvas}
      title="Clear"
      aria-label="Clear"
    >
      {@render trashCan()}
    </button>
  </div>

  <div class="canvas-wrap" bind:this={wrap}>
    <canvas
      bind:this={canvas}
      onmousedown={startDraw}
      onmousemove={doDraw}
      onmouseup={endDraw}
      onmouseleave={endDraw}
      style:background
    ></canvas>

    {#if expired}
      <!-- When the clock runs out, drawing is locked behind this prompt: the
           overlay covers the canvas so strokes can't land while it's up. -->
      <div class="overlay" transition:fade={{ duration: 160 }}>
        <div class="prompt" transition:scale={{ duration: 200, start: 0.85 }}>
          {#if emptyWarning}
            <h2>Looks empty!</h2>
            <p>
              The canvas was too empty to submit. Trash it and give it another
              go.
            </p>
            <div class="prompt-actions">
              <button class="prompt-btn trash" onclick={trashAndRedraw}>
                {@render trashCan()}
                <span>Trash &amp; redraw</span>
              </button>
            </div>
          {:else}
            <h2>Time's up!</h2>
            <p>Submit your sketch, or trash it and draw something new.</p>
            <div class="prompt-actions">
              <button class="prompt-btn trash" onclick={trashAndRedraw}>
                {@render trashCan()}
                <span>Trash &amp; redraw</span>
              </button>
              <button class="prompt-btn submit" onclick={submit}>
                {@render paperAirplane()}
                <span>Submit</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <div class="bottom">
    <p class="hint">
      You have <strong>{duration} seconds</strong> to sketch — you'll be prompted
      to submit when the timer runs out.
    </p>
  </div>
</div>

{#snippet pencil()}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M3 21c2.5-.4 4.2-1.1 5.3-2.2L18.6 8.5a2 2 0 0 0 0-2.8l-1.3-1.3a2 2 0 0 0-2.8 0L4.2 14.7C3.1 15.8 2.4 17.5 3 21Z"
    />
    <path d="m13.5 6 4.5 4.5" />
  </svg>
{/snippet}

{#snippet eraser()}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M8.5 20.5 3.9 15.9a2 2 0 0 1 0-2.8l8.4-8.4a2 2 0 0 1 2.8 0l4.6 4.6a2 2 0 0 1 0 2.8L13 20.5Z"
    />
    <path d="M8.5 20.5H21" />
    <path d="m8.5 9.5 6 6" />
  </svg>
{/snippet}

{#snippet backCycleArrow()}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 7v6h6" />
    <path d="M3.5 13a9 9 0 1 1 2.1 6.4" />
  </svg>
{/snippet}

{#snippet trashCan()}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M6 6v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
{/snippet}

{#snippet paperAirplane()}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4Z" />
  </svg>
{/snippet}

{#snippet clock()}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
{/snippet}

<style>
  .sketchpad {
    --accent: #855cd6; /* Scratch purple */
    --accent-soft: #ede7fb;
    --send: #4caf50;
    --send-soft: #e6f4e6;
    --ink: #575e75;
    --line: #e6e8f0;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #f2f0fb;
    font-family:
      "Nunito",
      system-ui,
      -apple-system,
      sans-serif;
    color: var(--ink);
  }

  /* toolbar pinned at top */
  .toolbar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.65rem;
    background: #fff;
    border-bottom: 1px solid var(--line);
  }

  .tool-btn {
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    transition: all 0.14s ease;
    flex-shrink: 0;
  }
  /* hover feedback only on hover-capable pointers, so it doesn't stick on touch */
  @media (hover: hover) {
    .tool-btn:hover {
      background: var(--accent-soft);
    }
  }
  .tool-btn:active {
    transform: translateY(1px);
  }
  /* one-shot actions shouldn't look "selected" after a click — drop the focus
     highlight for pointer clicks, keep a ring only for keyboard navigation */
  .tool-btn:focus {
    outline: none;
  }
  .tool-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .tool-btn.active {
    background: var(--accent);
    color: #fff;
    box-shadow: 0 3px 8px rgba(133, 92, 214, 0.35);
  }
  .tool-btn svg {
    width: 21px;
    height: 21px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .tb-space {
    flex: 1;
  }

  /* canvas fills remaining space */
  .canvas-wrap {
    flex: 1;
    position: relative;
    min-height: 0;
    padding: 0.7rem;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 16px;
    box-shadow: 0 2px 10px rgba(58, 43, 99, 0.08);
    touch-action: none;
    cursor: crosshair;
  }

  /* bottom bar pinned at bottom — now an informational note instead of a
     Submit button (submit is prompted when the timer expires). */
  .bottom {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    background: #fff;
    border-top: 1px solid var(--line);
  }
  .hint {
    margin: 0;
    padding: 0.7rem 1rem;
    text-align: center;
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1.35;
    color: var(--ink);
  }
  .hint strong {
    color: var(--accent);
    font-weight: 800;
  }

  /* countdown chip in the toolbar */
  .timer {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 0.95rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    transition:
      background-color 0.2s ease,
      color 0.2s ease;
  }
  .timer svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  /* Reserve a fixed, right-aligned slot for the digits (width set inline from
     maxDigits) so the chip doesn't shift when the count drops a digit. */
  .timer .num {
    display: inline-block;
    text-align: right;
  }
  .timer.urgent {
    background: #fde3e3;
    color: #d64545;
    animation: timer-pulse 1s ease-in-out infinite;
  }
  @keyframes timer-pulse {
    50% {
      transform: scale(1.08);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .timer.urgent {
      animation: none;
    }
  }

  /* time's-up prompt covering the canvas */
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.7rem;
    background: rgba(58, 43, 99, 0.28);
    backdrop-filter: blur(2px);
    z-index: 5;
  }
  .prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    max-width: 320px;
    padding: 1.4rem 1.3rem;
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 12px 40px rgba(58, 43, 99, 0.32);
    text-align: center;
  }
  .prompt h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--ink);
  }
  .prompt p {
    margin: 0 0 0.6rem;
    font-size: 0.9rem;
    line-height: 1.4;
    color: var(--ink);
  }
  .prompt-actions {
    display: flex;
    gap: 0.6rem;
    width: 100%;
  }
  .prompt-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 700;
    border: none;
    border-radius: 12px;
    padding: 0.75rem 0.6rem;
    cursor: pointer;
    transition: all 0.14s ease;
  }
  .prompt-btn svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .prompt-btn:active {
    transform: translateY(1px);
  }
  .prompt-btn:focus {
    outline: none;
  }
  .prompt-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .prompt-btn.trash {
    background: #eef0f6;
    color: var(--ink);
  }
  .prompt-btn.submit {
    background: var(--send);
    color: #fff;
  }
  @media (hover: hover) {
    .prompt-btn.trash:hover {
      background: #e2e5ef;
    }
    .prompt-btn.submit:hover {
      background: #45a049;
    }
  }
  .prompt-btn.submit:active {
    background: #45a049;
  }

  /* Landscape: the panel is wide and short, so a top toolbar squashes the
     canvas into a thin band. Reflow to a vertical toolbar on the left (matching
     WorkflowBackdrop, which also reflows by orientation) so the canvas keeps
     its height. Grid lets the tall toolbar span both rows on the left while the
     canvas and its Submit bar stack on the right. Portrait keeps the default
     column layout with the toolbar on top. */
  @media (orientation: landscape) {
    .sketchpad {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: 1fr auto;
    }
    .toolbar {
      grid-column: 1;
      grid-row: 1 / 3;
      flex-direction: column;
      border-bottom: none;
      border-right: 1px solid var(--line);
    }
    .canvas-wrap {
      grid-column: 2;
      grid-row: 1;
    }
    .bottom {
      grid-column: 2;
      grid-row: 2;
    }
  }
</style>
