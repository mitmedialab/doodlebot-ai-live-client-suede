<script lang="ts">
  import Pipeline, { PipelineModel } from "./Pipeline.svelte";
  import Sweater from "../sweater-vest-suede";
  import SKETCH_SRC from "./samples/catcar.png";

  const model = new PipelineModel(SKETCH_SRC);

  // approval-pending → rejected (too complex), then loop.
  const steps = [() => model.rejectTooComplex(), () => model.reset()];

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
