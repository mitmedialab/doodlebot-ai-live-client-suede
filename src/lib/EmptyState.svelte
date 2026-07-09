<script lang="ts">
  // Playful, hand-drawn empty state shown when no sketches exist yet. It nudges
  // the user toward the OpenSketchPad pencil button anchored in the bottom-left
  // corner. Everything is drawn with a shared turbulence filter so the strokes
  // (and the heading) read as wobbly, sketched-by-hand lines.
</script>

<div class="empty">
  <!-- Hidden defs: a fractal-noise displacement that gives every stroke it's
       applied to a subtle hand-drawn wobble. -->
  <svg class="defs" aria-hidden="true" width="0" height="0">
    <filter id="empty-wobble">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.018"
        numOctaves="2"
        seed="9"
        result="noise"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale="3.4"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  </svg>

  <div class="scene">
    <!-- Hero doodle: an empty picture frame (sun + hills) = "your drawing goes
         here", with a few twinkling sparkles. -->
    <svg class="canvas-doodle" viewBox="0 0 132 116" aria-hidden="true">
      <g class="ink" filter="url(#empty-wobble)">
        <rect class="frame" x="16" y="14" width="100" height="80" rx="13" />
        <circle class="sun" cx="46" cy="40" r="8" />
        <path class="hills" d="M20 86 L48 56 L66 74 L92 44 L114 86" />
        <path
          class="spark s1"
          d="M104 20 l2.4 6 6 2.4 -6 2.4 -2.4 6 -2.4 -6 -6 -2.4 6 -2.4 z"
        />
        <path
          class="spark s2"
          d="M22 104 l1.8 4.6 4.6 1.8 -4.6 1.8 -1.8 4.6 -1.8 -4.6 -4.6 -1.8 4.6 -1.8 z"
        />
        <path
          class="spark s3"
          d="M120 66 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 z"
        />
      </g>
    </svg>

    <h2 class="title">No doodles yet!</h2>
    <p class="subtitle">
      Tap the <span class="hl">pencil</span> to sketch your first masterpiece
    </p>
  </div>

  <!-- A curvy arrow sweeping down toward the pencil button in the corner. -->
  <div class="pointer" aria-hidden="true">
    <svg class="arrow" viewBox="0 0 150 180">
      <g class="ink" filter="url(#empty-wobble)">
        <path class="arrow-line" d="M132 20 C 138 92, 104 116, 40 156" />
        <path class="arrow-head" d="M40 156 l 36 -3 M40 156 l 5 -34" />
      </g>
    </svg>
    <span class="hint">start here!</span>
  </div>
</div>

<style>
  .empty {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family:
      "Nunito",
      system-ui,
      -apple-system,
      sans-serif;
    /* palette shared with the pipeline chrome */
    --purple: #855cd6;
    --pink: #ef77b4;
    --yellow: #f4b942;
    --mint: #4fc4a3;
    --ink: #6b7189;
  }

  .scene {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.35rem;
    padding: 1.5rem;
    max-width: 22rem;
    /* lift the message off dead-center so it sits above the corner arrow */
    transform: translateY(-4%);
  }

  .canvas-doodle {
    width: min(46vmin, 190px);
    height: auto;
    margin-bottom: 0.4rem;
    animation: bob 3.4s ease-in-out infinite alternate;
  }

  /* every doodle stroke: rounded, unfilled, hand-drawn weight */
  .ink :is(rect, circle, path) {
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .frame {
    stroke: var(--purple);
    stroke-dasharray: 10 9;
  }
  .sun {
    stroke: var(--yellow);
  }
  .hills {
    stroke: var(--mint);
  }
  .spark {
    stroke: var(--pink);
    fill: var(--pink);
    stroke-width: 1.5;
    transform-box: fill-box;
    transform-origin: center;
    animation: twinkle 2.2s ease-in-out infinite;
  }
  .s2 {
    animation-delay: 0.7s;
  }
  .s3 {
    animation-delay: 1.3s;
  }

  .title {
    font-size: clamp(1.6rem, 5vmin, 2.3rem);
    font-weight: 900;
    letter-spacing: 0.01em;
    color: var(--purple);
    margin: 0;
    transform: rotate(-2deg);
    /* wobble the heading too, so it looks penned rather than typeset */
    filter: url(#empty-wobble);
  }
  .subtitle {
    font-size: clamp(0.95rem, 2.6vmin, 1.1rem);
    font-weight: 700;
    color: var(--ink);
    margin: 0;
    line-height: 1.4;
  }
  .hl {
    color: var(--pink);
    font-weight: 900;
  }

  /* corner pointer + label, aimed at the bottom-left FAB */
  .pointer {
    position: absolute;
    left: 0.75rem;
    bottom: 4.5rem;
    width: min(30vmin, 140px);
  }
  .arrow {
    width: 100%;
    height: auto;
    display: block;
    animation: nudge 1.7s ease-in-out infinite;
  }
  .arrow-line,
  .arrow-head {
    fill: none;
    stroke: var(--purple);
    stroke-width: 4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .hint {
    position: absolute;
    top: 8%;
    left: 58%;
    font-size: clamp(0.95rem, 2.8vmin, 1.25rem);
    font-weight: 900;
    color: var(--pink);
    transform: rotate(-11deg);
    white-space: nowrap;
    filter: url(#empty-wobble);
  }

  @keyframes bob {
    from {
      transform: translateY(0) rotate(-1deg);
    }
    to {
      transform: translateY(-8px) rotate(1.5deg);
    }
  }
  @keyframes twinkle {
    0%,
    100% {
      opacity: 0.35;
      transform: scale(0.7);
    }
    50% {
      opacity: 1;
      transform: scale(1.15);
    }
  }
  @keyframes nudge {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(-5px, 6px);
    }
  }

  /* On short viewports the corner arrow would crowd the message — hide it. */
  @media (max-height: 460px) {
    .pointer {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .canvas-doodle,
    .arrow,
    .spark {
      animation: none;
    }
  }
</style>
