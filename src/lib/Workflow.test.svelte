<script lang="ts">
  import Workflow from "./Workflow.svelte";
  import Sweater from "../sweater-vest-suede";
</script>

<Sweater body={async () => {}}>
  {#snippet vest(pocket: {})}
    <div class="stage">
      <Workflow />
    </div>
  {/snippet}
</Sweater>

<style>
  .stage {
    width: 100%;
    height: 100vh;
  }
</style>
