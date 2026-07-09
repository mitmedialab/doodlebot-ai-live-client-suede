<script lang="ts">
  import OpenSketchPad from "./OpenSketchPad.svelte";
  import Sweater from "../sweater-vest-suede";

  class Pocket {
    opener = $state<OpenSketchPad>();
  }
</script>

<Sweater
  body={async ({ set }) => {
    set(new Pocket());
  }}
>
  {#snippet vest(pocket: Pocket)}
    <div class="stage">
      <OpenSketchPad
        bind:this={pocket.opener}
        onsend={(url) => pocket.opener?.close()}
      />
    </div>
  {/snippet}
</Sweater>

<style>
  /* positioned ancestor so the widget anchors to this box's lower-left */
  .stage {
    position: relative;
    width: 100%;
    height: 100vh;
    background: #d9d5ea;
  }
</style>
