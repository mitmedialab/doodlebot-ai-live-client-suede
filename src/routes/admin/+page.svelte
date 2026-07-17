<script lang="ts">
  import {
    SketchItem,
    VectorizationItem,
    OptionEditor,
    priorityLabel,
    type AdminEvent,
    type SketchStatus,
    type SubmitterStats,
  } from "./model.svelte";

  // ── Connection config ──────────────────────────────────────────────────────
  // Same convention as the client page: default to same-origin ("."), so requests
  // ride the Vite dev proxy; override with ?server=http://host:port. The admin
  // token rides the query string (EventSource can't set headers); default "test"
  // matches the dev ADMIN_TOKEN and can be overridden with ?token= or the field.
  const params =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const server = params.get("server") ?? ".";

  let token = $state(params.get("token") ?? "test");
  let connected = $state(false);
  let lastError = $state<string | null>(null);

  const resourceURL = (id: string) => `${server}/resource/${id}`;
  const withToken = (path: string) =>
    `${server}${path}?token=${encodeURIComponent(token)}`;

  // ── Queues ─────────────────────────────────────────────────────────────────
  // Reactive arrays drive the galleries; the by-id maps let repeated backlog
  // events (after an EventSource reconnect) update in place instead of piling up.
  let sketchQueue = $state<SketchItem[]>([]);
  const sketchById = new Map<string, SketchItem>();
  let selectedSketchId = $state<string | null>(null);

  let vectorQueue = $state<VectorizationItem[]>([]);
  const vectorById = new Map<string, VectorizationItem>();
  let selectedVectorId = $state<string | null>(null);

  let seq = 0;

  // Sketches are served worst-need-first; ties keep submission order.
  const sortedSketches = $derived(
    [...sketchQueue].sort((a, b) => a.priority - b.priority || a.seq - b.seq),
  );
  // The loaded-for-review sketch: the admin's manual pick if it's still pending,
  // otherwise the top of the priority queue (so the next one auto-loads).
  const currentSketch = $derived(
    (selectedSketchId
      ? sketchQueue.find((s) => s.id === selectedSketchId)
      : undefined) ??
      sortedSketches[0] ??
      null,
  );

  // Vectorizations are worked in arrival order.
  const currentVector = $derived(
    (selectedVectorId
      ? vectorQueue.find((v) => v.id === selectedVectorId)
      : undefined) ??
      vectorQueue[0] ??
      null,
  );

  // ── Incoming events ──────────────────────────────────────────────────────────
  function handleEvent(evt: AdminEvent) {
    if (evt.type === "sketch") {
      const existing = sketchById.get(evt.sketch_id);
      if (existing) {
        existing.submitter = evt.submitter; // re-snapshot; re-scores the queue
        return;
      }
      const item = new SketchItem(evt.sketch_id, evt.submitter, seq++);
      sketchById.set(item.id, item);
      sketchQueue = [...sketchQueue, item];
    } else if (evt.type === "vectorization") {
      if (vectorById.has(evt.vectorization_id)) return; // already queued
      const item = new VectorizationItem(
        evt.vectorization_id,
        evt.source_trio,
        evt.command_options,
        seq++,
      );
      vectorById.set(item.id, item);
      vectorQueue = [...vectorQueue, item];
    }
  }

  // (Re)open the admin stream whenever the token changes. Runs in the browser
  // only (this route is client-rendered), and the returned cleanup closes the
  // previous connection before each reopen and on unmount.
  $effect(() => {
    const t = token; // track
    const source = new EventSource(
      `${server}/admin/events?token=${encodeURIComponent(t)}`,
    );
    connected = false;
    source.onopen = () => {
      connected = true;
      lastError = null;
    };
    source.onmessage = (e) => {
      try {
        handleEvent(JSON.parse(e.data) as AdminEvent);
      } catch (err) {
        console.error("bad admin event", e.data, err);
      }
    };
    source.onerror = () => {
      // EventSource auto-reconnects; on reconnect the backlog is replayed and
      // deduped by id. A persistent failure here usually means a bad token.
      connected = false;
      lastError = "stream disconnected — check the admin token";
    };
    return () => source.close();
  });

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function ruleOnSketch(item: SketchItem, status: SketchStatus) {
    // Optimistic: drop it from the queue immediately (resolves are idempotent
    // server-side, and resolved items are never replayed, so this is safe).
    dropSketch(item.id);
    try {
      const res = await fetch(withToken("/admin/sketch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sketch_id: item.id, status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lastError = null;
    } catch (err) {
      lastError = `failed to submit sketch verdict (${String(err)})`;
    }
  }

  async function chooseVectorization(item: VectorizationItem, opt: OptionEditor) {
    dropVector(item.id);
    try {
      const res = await fetch(withToken("/admin/vectorization"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vectorization_id: item.id,
          commands: opt.commands,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lastError = null;
    } catch (err) {
      lastError = `failed to submit vectorization choice (${String(err)})`;
    }
  }

  function dropSketch(id: string) {
    sketchById.delete(id);
    sketchQueue = sketchQueue.filter((s) => s.id !== id);
    if (selectedSketchId === id) selectedSketchId = null;
  }
  function dropVector(id: string) {
    vectorById.delete(id);
    vectorQueue = vectorQueue.filter((v) => v.id !== id);
    if (selectedVectorId === id) selectedVectorId = null;
  }

  // Rank of a sketch in the priority-sorted queue (1-based), for the gallery.
  function sketchRank(item: SketchItem): number {
    return sortedSketches.indexOf(item) + 1;
  }

  // ── Active sessions management ───────────────────────────────────────────────
  // A sketch is only accepted if its ?session= token is in this set. The panel
  // GETs the current set on open, edits it locally as chips, and POSTs the whole
  // desired list on save (wholesale replace — not a delta). No SSE involvement.
  let sessionsOpen = $state(false);
  let sessions = $state<string[]>([]);
  let newSession = $state("");
  let sessionsLoading = $state(false);
  let sessionsSaving = $state(false);
  let sessionsError = $state<string | null>(null);
  let sessionsSaved = $state(false); // transient "Saved ✓" note

  async function openSessions() {
    sessionsOpen = true;
    await loadSessions();
  }

  async function loadSessions() {
    sessionsLoading = true;
    sessionsError = null;
    sessionsSaved = false;
    try {
      const res = await fetch(withToken("/admin/sessions"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sessions: string[] };
      sessions = [...data.sessions];
    } catch (err) {
      sessionsError = `couldn't load sessions (${String(err)})`;
    } finally {
      sessionsLoading = false;
    }
  }

  function addSession() {
    const t = newSession.trim();
    newSession = "";
    if (!t || sessions.includes(t)) return;
    sessions = [...sessions, t];
    sessionsSaved = false;
  }

  function removeSession(t: string) {
    sessions = sessions.filter((s) => s !== t);
    sessionsSaved = false;
  }

  async function saveSessions() {
    sessionsSaving = true;
    sessionsError = null;
    try {
      const res = await fetch(withToken("/admin/sessions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Wholesale replace with the complete desired list; blank strings are
        // dropped server-side. The response is the stored, sorted set.
        body: JSON.stringify({ sessions }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sessions: string[] };
      sessions = [...data.sessions];
      sessionsSaved = true;
    } catch (err) {
      sessionsError = `couldn't save sessions (${String(err)})`;
    } finally {
      sessionsSaving = false;
    }
  }
</script>

<svelte:head>
  <title>DoodleBot — Admin review</title>
</svelte:head>

<div class="flex h-dvh w-dvw flex-col overflow-hidden bg-slate-100 text-slate-800">
  <!-- Top bar: connection + token -->
  <header
    class="flex shrink-0 items-center gap-3 border-b border-slate-300 bg-white px-3 py-2 text-sm"
  >
    <strong class="text-slate-900">DoodleBot Admin</strong>
    <span
      class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold"
      class:bg-emerald-100={connected}
      class:text-emerald-800={connected}
      class:bg-rose-100={!connected}
      class:text-rose-800={!connected}
    >
      <span
        class="h-2 w-2 rounded-full"
        class:bg-emerald-500={connected}
        class:bg-rose-500={!connected}
      ></span>
      {connected ? "connected" : "disconnected"}
    </span>
    <button
      class="ml-auto rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
      onclick={openSessions}
    >
      Active sessions
    </button>
    <label class="flex items-center gap-1 text-xs text-slate-500">
      token
      <input
        class="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-slate-800"
        bind:value={token}
      />
    </label>
    {#if lastError}
      <span class="max-w-md truncate text-xs text-rose-600" title={lastError}
        >{lastError}</span
      >
    {/if}
  </header>

  <!-- Two independent moderation gates, side by side. -->
  <main class="grid min-h-0 flex-1 grid-cols-2 divide-x divide-slate-300">
    <!-- ════════════════ SKETCH GATE ════════════════ -->
    <section class="flex min-h-0 flex-col">
      <div class="flex min-h-0 flex-1 flex-col p-3">
        <h2 class="mb-2 shrink-0 text-sm font-bold tracking-wide text-slate-500 uppercase">
          Sketch review
          <span class="font-normal text-slate-400">
            · {sketchQueue.length} pending
          </span>
        </h2>

        {#if currentSketch}
          {@const s = currentSketch}
          <div class="flex min-h-0 flex-1 gap-3">
            <!-- Reject-inappropriate on the far left, away from approve. -->
            <div class="flex shrink-0 items-center">
              <button
                class="h-full rounded-lg bg-rose-600 px-3 text-sm font-bold text-white hover:bg-rose-700"
                onclick={() => ruleOnSketch(s, "innapropriate")}
              >
                Inappropriate
              </button>
            </div>

            <div class="flex min-h-0 flex-1 flex-col items-center gap-2">
              <div
                class="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-white p-2"
              >
                <!-- svelte-ignore a11y_missing_attribute -->
                <img
                  src={resourceURL(s.id)}
                  alt="sketch under review"
                  class="max-h-full max-w-full object-contain"
                />
              </div>
              <button
                class="w-full shrink-0 rounded-lg bg-emerald-600 py-3 text-base font-extrabold text-white hover:bg-emerald-700"
                onclick={() => ruleOnSketch(s, "approved")}
              >
                Approve
              </button>
            </div>

            <!-- Reject-too-complex on the far right. -->
            <div class="flex shrink-0 items-center">
              <button
                class="h-full rounded-lg bg-amber-500 px-3 text-sm font-bold text-white hover:bg-amber-600"
                onclick={() => ruleOnSketch(s, "complex")}
              >
                Too&nbsp;complex
              </button>
            </div>
          </div>

          <!-- Submitter readout -->
          {@render submitterStats(s.submitter)}
        {:else}
          <div
            class="flex flex-1 items-center justify-center text-sm text-slate-400"
          >
            No sketches waiting for review.
          </div>
        {/if}
      </div>

      <!-- Gallery: ordered by priority; click to load a specific one. -->
      {@render sketchGallery()}
    </section>

    <!-- ════════════════ VECTORIZATION GATE ════════════════ -->
    <section class="flex min-h-0 flex-col">
      <div class="flex min-h-0 flex-1 flex-col overflow-auto p-3">
        <h2 class="mb-2 shrink-0 text-sm font-bold tracking-wide text-slate-500 uppercase">
          Vectorization review
          <span class="font-normal text-slate-400">
            · {vectorQueue.length} pending
          </span>
        </h2>

        {#if currentVector}
          {@const v = currentVector}
          <!-- Source trio that was combined. -->
          <div class="mb-3 shrink-0">
            <div class="mb-1 text-xs font-semibold text-slate-500">
              Source trio
            </div>
            <div class="grid grid-cols-3 gap-2">
              {#each v.trio as sourceId (sourceId)}
                <div
                  class="flex aspect-square items-center justify-center overflow-hidden rounded border border-slate-300 bg-white p-1"
                >
                  <!-- svelte-ignore a11y_missing_attribute -->
                  <img
                    src={resourceURL(sourceId)}
                    class="max-h-full max-w-full object-contain"
                  />
                </div>
              {/each}
            </div>
          </div>

          <!-- Two options to choose between. -->
          <div class="grid min-h-0 grid-cols-2 gap-3">
            {@render optionPanel(v, v.options[0], 1)}
            {@render optionPanel(v, v.options[1], 2)}
          </div>
        {:else}
          <div
            class="flex flex-1 items-center justify-center text-sm text-slate-400"
          >
            No vectorizations waiting for review.
          </div>
        {/if}
      </div>

      {@render vectorGallery()}
    </section>
  </main>
</div>

<!-- ── Snippets ──────────────────────────────────────────────────────────────── -->

{#snippet submitterStats(st: SubmitterStats)}
  <div
    class="mt-2 shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
  >
    <div class="mb-1 flex items-center gap-2">
      <span class="font-bold text-slate-600">Submitter history</span>
      <span
        class="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-600"
      >
        {priorityLabel(st)}
      </span>
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
      {@render stat("submitted", st.submitted, "text-slate-700")}
      {@render stat("pending", st.pending, "text-sky-700")}
      {@render stat("approved", st.approved, "text-emerald-700")}
      {@render stat("too complex", st.rejected_complex, "text-amber-700")}
      {@render stat("inappropriate", st.rejected_innapropriate, "text-rose-700")}
    </div>
  </div>
{/snippet}

{#snippet stat(label: string, value: number, color: string)}
  <span class="flex items-baseline gap-1">
    <span class="text-base font-extrabold {color}">{value}</span>
    <span class="text-slate-500">{label}</span>
  </span>
{/snippet}

{#snippet sketchGallery()}
  <div class="h-40 shrink-0 border-t border-slate-300 bg-white/60 p-2">
    <div class="mb-1 text-xs font-semibold text-slate-500">
      Queue ({sketchQueue.length}) — click to review
    </div>
    <div class="flex h-28 gap-2 overflow-x-auto">
      {#each sortedSketches as item (item.id)}
        <button
          class="relative flex h-28 w-24 shrink-0 flex-col overflow-hidden rounded border bg-white"
          class:border-slate-300={currentSketch?.id !== item.id}
          class:border-sky-500={currentSketch?.id === item.id}
          class:ring-2={currentSketch?.id === item.id}
          class:ring-sky-400={currentSketch?.id === item.id}
          onclick={() => (selectedSketchId = item.id)}
        >
          <span
            class="absolute left-1 top-1 z-10 rounded bg-slate-900/70 px-1 text-[10px] font-bold text-white"
          >
            #{sketchRank(item)}
          </span>
          <div class="flex flex-1 items-center justify-center overflow-hidden p-1">
            <!-- svelte-ignore a11y_missing_attribute -->
            <img
              src={resourceURL(item.id)}
              class="max-h-full max-w-full object-contain"
            />
          </div>
          <span
            class="truncate bg-slate-100 px-1 py-0.5 text-center text-[10px] text-slate-500"
          >
            {priorityLabel(item.submitter)}
          </span>
        </button>
      {:else}
        <div class="flex items-center px-2 text-xs text-slate-400">empty</div>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet vectorGallery()}
  <div class="h-40 shrink-0 border-t border-slate-300 bg-white/60 p-2">
    <div class="mb-1 text-xs font-semibold text-slate-500">
      Queue ({vectorQueue.length}) — click to review
    </div>
    <div class="flex h-28 gap-2 overflow-x-auto">
      {#each vectorQueue as item, i (item.id)}
        <button
          class="relative flex h-28 w-28 shrink-0 flex-col overflow-hidden rounded border bg-white"
          class:border-slate-300={currentVector?.id !== item.id}
          class:border-sky-500={currentVector?.id === item.id}
          class:ring-2={currentVector?.id === item.id}
          class:ring-sky-400={currentVector?.id === item.id}
          onclick={() => (selectedVectorId = item.id)}
        >
          <span
            class="absolute left-1 top-1 z-10 rounded bg-slate-900/70 px-1 text-[10px] font-bold text-white"
          >
            #{i + 1}
          </span>
          <div class="grid flex-1 grid-cols-3 gap-px overflow-hidden p-1">
            {#each item.trio as sourceId (sourceId)}
              <div class="flex items-center justify-center overflow-hidden">
                <!-- svelte-ignore a11y_missing_attribute -->
                <img
                  src={resourceURL(sourceId)}
                  class="max-h-full max-w-full object-contain"
                />
              </div>
            {/each}
          </div>
          <span
            class="bg-slate-100 px-1 py-0.5 text-center text-[10px] text-slate-500"
          >
            2 options
          </span>
        </button>
      {:else}
        <div class="flex items-center px-2 text-xs text-slate-400">empty</div>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet optionPanel(v: VectorizationItem, opt: OptionEditor, n: number)}
  <div class="flex min-h-0 flex-col rounded-lg border border-slate-300 bg-white p-2">
    <div class="mb-1 flex items-center justify-between">
      <span class="text-sm font-bold text-slate-700">Option {n}</span>
      <span class="text-xs tabular-nums text-slate-500">
        <span class="font-extrabold text-slate-800">{opt.count}</span> commands
        {#if opt.deletedCount > 0}
          <span class="text-rose-600">(−{opt.deletedCount} strokes)</span>
        {/if}
      </span>
    </div>

    <!-- Clickable per-stroke preview. Deleted strokes fade; click toggles. -->
    <div
      class="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50"
    >
      <svg
        viewBox={opt.trace.viewBox}
        class="h-full max-h-[46vh] w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <!-- visible strokes -->
        {#each opt.trace.segments as seg (seg.index)}
          <path
            d={seg.d}
            fill="none"
            vector-effect="non-scaling-stroke"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="pointer-events-none transition-colors"
            stroke={opt.isDeleted(seg.index)
              ? "#e2e8f0"
              : opt.hovered === seg.index
                ? "#dc2626"
                : "#1e293b"}
            stroke-width={opt.hovered === seg.index ? 3.5 : 2}
            stroke-dasharray={opt.isDeleted(seg.index) ? "4 4" : undefined}
          />
        {/each}
        <!-- fat transparent hit targets on top, so thin strokes are easy to click -->
        {#each opt.trace.segments as seg (seg.index)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_tabindex -->
          <path
            d={seg.d}
            fill="none"
            stroke="transparent"
            stroke-width="16"
            vector-effect="non-scaling-stroke"
            class="cursor-pointer"
            role="button"
            tabindex="-1"
            aria-label={`stroke ${seg.index}`}
            onclick={() => opt.toggle(seg.index)}
            onmouseenter={() => (opt.hovered = seg.index)}
            onmouseleave={() => {
              if (opt.hovered === seg.index) opt.hovered = null;
            }}
          />
        {/each}
      </svg>
    </div>

    <div class="mt-2 flex shrink-0 items-center gap-2">
      <button
        class="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 enabled:hover:bg-slate-100 disabled:opacity-40"
        disabled={!opt.canUndo}
        onclick={() => opt.undo()}
      >
        Undo
      </button>
      <button
        class="flex-1 rounded bg-emerald-600 py-2 text-sm font-extrabold text-white hover:bg-emerald-700"
        onclick={() => chooseVectorization(v, opt)}
      >
        Approve Option {n}
      </button>
    </div>
  </div>
{/snippet}

<!-- ── Active sessions modal ─────────────────────────────────────────────────── -->
{#if sessionsOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div class="flex w-full max-w-md flex-col rounded-lg bg-white p-4 shadow-xl">
      <div class="mb-2 flex items-center justify-between">
        <h3 class="text-base font-bold text-slate-900">Active sessions</h3>
        <button
          class="rounded px-2 text-lg leading-none text-slate-400 hover:text-slate-700"
          aria-label="close"
          onclick={() => (sessionsOpen = false)}>×</button
        >
      </div>
      <p class="mb-3 text-xs leading-relaxed text-slate-500">
        Only sketches whose <code class="rounded bg-slate-100 px-1">?session=</code>
        token is in this list are accepted. This is the complete active set (a wholesale
        replace, not a delta); saving takes effect immediately for new submissions.
      </p>

      {#if sessionsLoading}
        <div class="py-6 text-center text-sm text-slate-400">loading…</div>
      {:else}
        <div class="mb-3 flex min-h-9 flex-wrap gap-2 rounded border border-slate-200 bg-slate-50 p-2">
          {#each sessions as t (t)}
            <span
              class="inline-flex items-center gap-1 rounded-full bg-sky-100 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-sky-800"
            >
              {t}
              <button
                class="flex h-4 w-4 items-center justify-center rounded-full text-sky-500 hover:bg-sky-200 hover:text-sky-900"
                aria-label={`remove ${t}`}
                onclick={() => removeSession(t)}>×</button
              >
            </span>
          {:else}
            <span class="text-xs text-slate-400">
              No active sessions — no submissions will be accepted.
            </span>
          {/each}
        </div>

        <form
          class="flex gap-2"
          onsubmit={(e) => {
            e.preventDefault();
            addSession();
          }}
        >
          <input
            class="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="add a session token, e.g. room-1"
            bind:value={newSession}
          />
          <button
            type="submit"
            class="rounded border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Add
          </button>
        </form>
      {/if}

      {#if sessionsError}
        <div class="mt-2 text-xs text-rose-600">{sessionsError}</div>
      {/if}

      <div class="mt-4 flex items-center gap-2">
        {#if sessionsSaved}
          <span class="text-xs font-semibold text-emerald-600">Saved ✓</span>
        {/if}
        <button
          class="ml-auto rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          onclick={loadSessions}
          disabled={sessionsLoading || sessionsSaving}
        >
          Reload
        </button>
        <button
          class="rounded bg-emerald-600 px-4 py-1.5 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
          onclick={saveSessions}
          disabled={sessionsLoading || sessionsSaving}
        >
          {sessionsSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  </div>
{/if}
