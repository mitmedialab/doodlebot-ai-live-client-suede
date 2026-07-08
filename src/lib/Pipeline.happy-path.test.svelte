<script lang="ts">
  import Pipeline, { PipelineModel } from "./Pipeline.svelte";
  import Sweater from "../sweater-vest-suede";

  const model = new PipelineModel();

  // Full progression from approval-pending → complete, then loop.
  const steps = [
    () => model.approve(),
    () => model.startCombining(),
    () => model.finishVectorizing(),
    () => model.sendToRobot("DoodleBot #3"),
    () => model.markComplete(),
    () => model.reset(),
  ];

  $effect(() => {
    let i = 0;
    const id = setInterval(() => {
      steps[i % steps.length]();
      i += 1;
    }, 1400);
    return () => clearInterval(id);
  });
</script>

<Sweater body={async () => {}}>
  {#snippet vest(pocket: {})}
    <div class="backdrop"><Pipeline {model} /></div>
  {/snippet}
</Sweater>

<style>
  .backdrop {
    width: 100%;
    height: 100vh;
    background: #e9e6f2;
  }
</style>
