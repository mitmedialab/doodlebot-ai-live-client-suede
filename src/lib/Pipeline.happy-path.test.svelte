<script lang="ts">
  import Pipeline, { PipelineModel } from "./Pipeline.svelte";
  import Sweater from "../sweater-vest-suede";
  import { commandsToImgSrc, type DrawCommand } from "./utils/turtle-svg";
  import SKETCH_SRC from "./samples/catcar.png";
  import catcarCommands from "./samples/catcar.json";
  // other submissions that get paired with the sketch during grouping
  import PAIR_A from "./samples/beachnugget.png";
  import PAIR_B from "./samples/angryhashtag.png";

  // The combination step's output: the submitted turtle drawing, vectorized.
  const VECTOR_SRC = commandsToImgSrc(
    catcarCommands as unknown as DrawCommand[],
    { stroke: "#2b2f3a", strokeWidth: 13 },
  );

  const model = new PipelineModel(SKETCH_SRC);

  // Full progression from approval-pending → complete, then loop. Image sources
  // are handed to the model as the relevant transitions happen — including the
  // paired images that arrive dynamically during grouping.
  const steps = [
    () => model.approve(),
    () => model.pairImage(PAIR_A),
    () => (model.pairImage(PAIR_B), model.startCombining()),
    () => model.finishVectorizing(VECTOR_SRC),
    //() => model.sendToRobot("DoodleBot #3"),
    () =>
      model.markComplete(
        "The drawing has been assigned to the pink bot, go find it!",
      ),
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
