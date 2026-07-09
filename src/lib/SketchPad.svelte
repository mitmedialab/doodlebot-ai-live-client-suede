<script lang="ts" module>
  export type Tool = "draw" | "erase";

  export type Props = {
    /** Stroke color used when drawing. */
    color?: string;
    /** Background/canvas fill color (also the erase color). */
    background?: string;
    /** Single stroke width used for the brush. */
    size?: number;
    /** Called with a PNG data URL when the user hits "Send". */
    onsend?: (dataUrl: string) => void | Promise<void>;
  };
</script>

<script lang="ts">
  let {
    color = "#1a1a18",
    background = "#ffffff",
    size = 6,
    onsend,
  }: Props = $props();

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let ctx: CanvasRenderingContext2D;

  let tool = $state<Tool>("draw");
  const brushSize = $derived(size);

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

  function send() {
    onsend?.(toDataURL());
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
  </div>

  <div class="bottom">
    <button
      class="bottom-btn send"
      onclick={send}
      title="Submit"
      aria-label="Submit"
    >
      {@render paperAirplane()}
      <span>Submit</span>
    </button>
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

  /* bottom bar pinned at bottom */
  .bottom {
    flex-shrink: 0;
    display: flex;
  }
  .bottom-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 700;
    border: none;
    background: #eef0f6;
    color: var(--ink);
    padding: 0.85rem 1rem;
    cursor: pointer;
    transition: all 0.14s ease;
  }
  .bottom-btn svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @media (hover: hover) {
    .bottom-btn:hover {
      background: #e2e5ef;
    }
    .send:hover {
      background: #45a049;
    }
  }
  .bottom-btn:focus {
    outline: none;
  }
  .bottom-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }
  .send {
    flex: 1;
    background: var(--send);
    color: #fff;
  }
  .send:active {
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
