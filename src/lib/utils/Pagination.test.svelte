<script lang="ts">
  import Sweater from "../../sweater-vest-suede";
  import Pagination, { Model } from "./Pagination.svelte";

  type Props = {
    x: number;
  };

  class Pocket {
    model = $state<Model<Props, typeof example>>();
  }
</script>

{#snippet example({ x }: Props, active: boolean)}
  <div>
    here it is: {x}
    {#if active}
      hi
    {/if}
  </div>
{/snippet}

{#snippet empty()}
  No elements!
{/snippet}

<Sweater
  body={async ({ set }) => {
    const pocket = set(new Pocket());
    pocket.model = new Model(
      example,
      { x: 5 },
      { x: 6 },
      { x: 5 },
      { x: 8 },
      { x: 9 },
      { x: 5 },
      { x: 6 },
      { x: 5 },
      { x: 8 },
      { x: 9 },
      { x: 5 },
      { x: 6 },
      { x: 5 },
      { x: 8 },
      { x: 9 },
    );
  }}
>
  {#snippet vest(pocket: Pocket)}
    {#if pocket.model}
      <div class="flex flex-col">
        <div class="flex-grow">
          <Pagination model={pocket.model} {empty} />
        </div>
        <div>
          <button onclick={() => pocket.model?.items.splice(0, 0, { x: -5 })}>
            Hi
          </button>
        </div>
      </div>
    {/if}
  {/snippet}
</Sweater>
