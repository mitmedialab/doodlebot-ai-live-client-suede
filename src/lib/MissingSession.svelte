<script lang="ts">
  // Shown on the root route when the URL carries no ?session=<token> key. Without
  // one, no sketch can be accepted, so instead of the sketch pad we explain — in a
  // friendly, non-alarming way — that they've likely opened the wrong link and
  // should get a fresh one from the event hosts. Visual language matches
  // EmptyState (hand-drawn wobble, shared pastel palette).
</script>

<div class="notice">
  <svg class="defs" aria-hidden="true" width="0" height="0">
    <filter id="session-wobble">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.018"
        numOctaves="2"
        seed="4"
        result="noise"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale="3.2"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  </svg>

  <div class="scene">
    <!-- A friendly "ticket / pass" doodle with a question mark — "you need a
         session pass to get in". -->
    <svg class="doodle" viewBox="0 0 140 120" aria-hidden="true">
      <g class="ink" filter="url(#session-wobble)">
        <rect class="ticket" x="20" y="34" width="100" height="54" rx="12" />
        <path class="perforation" d="M70 38 V84" />
        <circle class="q-dot" cx="49" cy="61" r="1.6" />
        <path class="q-mark" d="M45 55 q4 -7 9 -2 q3 3 -1 6 q-3 2 -4 5" />
        <path class="spark s1" d="M110 22 l1.8 4.6 4.6 1.8 -4.6 1.8 -1.8 4.6 -1.8 -4.6 -4.6 -1.8 4.6 -1.8 z" />
        <path class="spark s2" d="M26 96 l1.5 3.8 3.8 1.5 -3.8 1.5 -1.5 3.8 -1.5 -3.8 -3.8 -1.5 3.8 -1.5 z" />
      </g>
    </svg>

    <h2 class="title">Hmm, no session here!</h2>
    <p class="subtitle">
      This link doesn't include a <span class="hl">session key</span>, so we can't
      start drawing yet.
    </p>
    <p class="hint">
      Double-check you're using the exact link the event hosts gave you — it should
      look like <code>…/?session=…</code>
    </p>
  </div>
</div>

<style>
  .notice {
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
    gap: 0.5rem;
    padding: 1.5rem;
    max-width: 24rem;
    transform: translateY(-2%);
  }

  .doodle {
    width: min(48vmin, 210px);
    height: auto;
    margin-bottom: 0.3rem;
    animation: bob 3.6s ease-in-out infinite alternate;
  }

  .ink :is(rect, circle, path) {
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ticket {
    stroke: var(--purple);
  }
  .perforation {
    stroke: var(--purple);
    stroke-dasharray: 4 6;
    stroke-width: 2.4;
  }
  .q-mark,
  .q-dot {
    stroke: var(--pink);
    stroke-width: 3.2;
  }
  .q-dot {
    fill: var(--pink);
  }
  .spark {
    stroke: var(--yellow);
    fill: var(--yellow);
    stroke-width: 1.4;
    transform-box: fill-box;
    transform-origin: center;
    animation: twinkle 2.3s ease-in-out infinite;
  }
  .s2 {
    animation-delay: 0.8s;
  }

  .title {
    font-size: clamp(1.5rem, 5vmin, 2.1rem);
    font-weight: 900;
    color: var(--purple);
    margin: 0;
    transform: rotate(-1.5deg);
    filter: url(#session-wobble);
  }
  .subtitle {
    font-size: clamp(0.95rem, 2.6vmin, 1.1rem);
    font-weight: 700;
    color: var(--ink);
    margin: 0;
    line-height: 1.45;
  }
  .hl {
    color: var(--pink);
    font-weight: 900;
  }
  .hint {
    font-size: clamp(0.8rem, 2.2vmin, 0.95rem);
    font-weight: 600;
    color: var(--ink);
    opacity: 0.85;
    margin: 0.2rem 0 0;
    line-height: 1.4;
  }
  code {
    background: #efeaf9;
    color: var(--purple);
    border-radius: 6px;
    padding: 0.05em 0.4em;
    font-weight: 800;
    white-space: nowrap;
  }

  @keyframes bob {
    from {
      transform: translateY(0) rotate(-1deg);
    }
    to {
      transform: translateY(-7px) rotate(1.5deg);
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

  @media (prefers-reduced-motion: reduce) {
    .doodle,
    .spark {
      animation: none;
    }
  }
</style>
