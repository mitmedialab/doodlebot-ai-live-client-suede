<script lang="ts">
  import SketchPad from "./SketchPad.svelte";
  import Sweater from "../sweater-vest-suede";
</script>

<Sweater body={async () => {}}>
  {#snippet vest(pocket: {})}
    <SketchPad />
  {/snippet}
</Sweater>
