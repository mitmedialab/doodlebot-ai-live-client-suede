<script lang="ts" module>
  import { describeRobotColor } from "$lib/color";

  type SSEPayload = {
    sketch: string;
    status?: "approved" | "innapropriate" | "complex";
    companions?: string[];
    vectorization?: string;
    robot?: string;
    color?: string;
  };

  const resourceURL = (server: string, identifier: string) =>
    `${server}/resource/${identifier}`;

  const process = (
    payload: SSEPayload,
    pipelineBySketch: Map<string, PipelineModel>,
    pages: PagesModel<PipelineModel, typeof page>,
    server: string,
  ): true => {
    const { sketch } = payload;
    const pipeline = pipelineBySketch.get(sketch);

    if (!pipeline) {
      const model = new PipelineModel(resourceURL(server, sketch));
      pages.items.splice(0, 0, model);
      pipelineBySketch.set(sketch, model);
      return true;
    }

    switch (pipeline.state) {
      case "approval-pending":
        switch (payload.status) {
          case "approved":
            pipeline.approve();
            return true;
          case "innapropriate":
            pipeline.rejectInappropriate();
            return true;
          case "complex":
            pipeline.rejectTooComplex();
            return true;
        }
      case "approved":
        if (!payload.companions) return true;
        for (const companion of payload.companions) {
          const url = resourceURL(server, companion);
          if (pipeline.combination.companions.includes(url)) continue;
          pipeline.pairImage(url);
        }
        if (pipeline.combination.companions.length === 2)
          pipeline.startCombining();
        return true;
      case "combining":
        if (!payload.vectorization) return true;
        pipeline.finishVectorizing(resourceURL(server, payload.vectorization));
        return true;
      case "robot-selection":
        // The server assigns a robot and its hat color (a hex string). Translate
        // the hex into a human-readable name, the filter that repaints the red
        // hat overlay to match, and a matching inline color chip.
        if (!payload.color) return true;
        const { name, filter, chip } = describeRobotColor(payload.color);
        pipeline.markComplete(
          `The drawing has been assigned to the robot with the ${name} hat, go find it to see your doodle in action!`,
          filter,
          { token: name, ...chip },
        );
        return true;
      case "rejected-complex":
      case "rejected-inappropriate":
      case "complete":
        console.error(
          `New message received for sketch ${sketch} in unexpected state: ${pipeline.state}`,
        );
        return true;
    }
  };
</script>

<script lang="ts">
  import Pagination, {
    Model as PagesModel,
  } from "$lib/utils/Pagination.svelte";
  import { onMount } from "svelte";
  import Pipeline, { PipelineModel } from "../lib/Pipeline.svelte";
  import OpenSketchPad from "$lib/OpenSketchPad.svelte";
  import WorkflowBackdrop from "$lib/WorkflowBackdrop.svelte";
  import EmptyState from "$lib/EmptyState.svelte";

  const pipelineByHash = new Map<string, PipelineModel>();
  const pages = new PagesModel<PipelineModel, typeof page>(page);

  // Every pipeline shares the same section chrome (labels + colors), so paint it
  // once as a static backdrop behind the pagination instead of per-slide. A
  // throwaway model gives us the canonical section list without duplicating it.
  const chrome = new PipelineModel().sections;

  let opener = $state<OpenSketchPad>();

  // Default to same-origin, root-absolute paths (e.g. `/resource/…`) so requests
  // go through the Vite dev proxy → the test server. Pass ?server=http://host:port
  // only to hit a server on a different origin directly.
  const server =
    typeof window === "undefined"
      ? "."
      : (new URLSearchParams(window.location.search).get("server") ?? ".");

  // Resolves once the client id is known, so a sketch submitted before the SSE
  // handshake finishes still waits for a real id rather than racing it.
  let clientId: Promise<string> | undefined;

  onMount(() => {
    let source: EventSource | undefined;

    clientId = (async () => {
      let client = localStorage.getItem("ai-live-client-id");
      if (!client) {
        const response = await fetch(`${server}/client`, { method: "GET" });
        client = (await response.json())["client"] as string;
        // Persist so a returning client replays its history on reconnect.
        localStorage.setItem("ai-live-client-id", client);
      }

      // Stream updates for this client. Replayed history arrives first (oldest
      // sketch → newest), then live updates; `process` handles both.
      source = new EventSource(
        `${server}/events?client=${encodeURIComponent(client)}`,
      );
      source.onmessage = (event) => {
        const payload = JSON.parse(event.data) as SSEPayload;
        process(payload, pipelineByHash, pages, server);
      };
      return client;
    })();

    return () => source?.close();
  });
</script>

<svelte:head>
  <!-- theme-color paints the browser's own chrome (a flat fill — it can't be a
       gradient). The address bar sits above the top edge, where the first
       section shows; match it to that section's rendered wash (55% of the pink
       identity color #f4a6cf over white) so the bar bleeds into the app. -->
  <meta
    name="theme-color"
    content={pages.items.length === 0 ? "white" : "#f9cee5"}
  />
</svelte:head>

<div class="w-dvw h-dvh overflow-hidden">
  <!-- Dot colors picked to sit on the pastel section washes: a deep indigo-plum
       active dot (echoing the section labels) over a soft lavender inactive. -->
  <Pagination
    model={pages}
    {empty}
    {backdrop}
    --active-dot="#4a3f6b"
    --inactive-dot="#b7a9cf"
  />
  <OpenSketchPad
    bind:this={opener}
    onsend={async (dataUrl) => {
      // Show the sketch immediately using the local data URL (eager loading);
      // the server round-trip below reconciles it with its sketch id.
      const model = new PipelineModel(dataUrl);
      pages.items.splice(0, 0, model);
      pages.index = 0;
      opener?.close();

      const client = await clientId;
      if (!client) return;

      const response = await fetch(`${server}/sketch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client, sketch: dataUrl }),
      });
      const { sketch } = (await response.json()) as { sketch: string };

      const existing = pipelineByHash.get(sketch);
      if (existing && existing !== model) {
        // The SSE creation event beat this response and already built a model;
        // drop our eager duplicate and keep the stream-owned one.
        // TODO: Consider more sophisticated solution, to ensure no jank for user.
        const index = pages.items.indexOf(model);
        if (index >= 0) pages.items.splice(index, 1);
      } else pipelineByHash.set(sketch, model);
    }}
  />
</div>

{#snippet page(model: PipelineModel)}
  <Pipeline {model} />
{/snippet}

{#snippet backdrop()}
  <WorkflowBackdrop sections={chrome} />
{/snippet}

{#snippet empty()}
  <EmptyState />
{/snippet}
