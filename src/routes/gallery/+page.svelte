<script lang="ts">
  import { onMount } from "svelte";
  import Gallery, { GalleryModel } from "$lib/Gallery.svelte";
  import type { SSEPayload } from "$lib/api";
  import MissingSession from "$lib/MissingSession.svelte";

  // Default to same-origin, root-absolute paths (e.g. `/resource/…`) so requests
  // go through the Vite dev proxy → the test server. Pass ?server=http://host:port
  // only to hit a server on a different origin directly. Mirrors the root route.
  const server =
    typeof window === "undefined"
      ? "."
      : (new URLSearchParams(window.location.search).get("server") ?? ".");

  // The room/session key from the URL (?session=<token>). The gallery is scoped
  // to one session; without a key there's nothing to show, so we render the same
  // friendly "wrong link" notice the sketch app uses.
  const session =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("session");

  // The model discards any payload whose session doesn't match, so it needs the
  // key up front. Constructed unconditionally (harmless when there's no session,
  // since we render MissingSession and never stream in that case).
  const model = new GalleryModel(session ?? "");

  onMount(() => {
    if (!session) return;

    // /events/all streams EVERY session's payloads (same SSEPayload shape as the
    // per-client stream); the model keeps only the ones matching our session, so
    // one screen mirrors exactly one room.
    const source = new EventSource(`${server}/events/all`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as SSEPayload;
      model.process(payload, server);
    };

    return () => source.close();
  });
</script>

<svelte:head>
  <meta name="theme-color" content="#fbfaff" />
</svelte:head>

<div class="w-dvw h-dvh overflow-hidden">
  {#if !session}
    <MissingSession />
  {:else}
    <Gallery {model} />
  {/if}
</div>
