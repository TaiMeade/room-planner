<script setup lang="ts">
import { computed } from 'vue'

import { PALETTE, polygonPath } from '@/lib/render'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'

/**
 * Wall footprints, mitred at every join by the geometry pass.
 *
 * Filled graphite with a darker outline — the standard poché of a plan drawing.
 * Selection recolours the fill rather than adding a halo, so a selected wall
 * still reads as a wall at the same thickness.
 */

const editor = useEditorStore()
const planStore = usePlanStore()

const walls = computed(() => planStore.geometry.walls)
const stroke = computed(() => 1 / editor.viewport.scale)

function state(wallId: string): 'selected' | 'hovered' | 'idle' {
  if (editor.isSelected('wall', wallId)) return 'selected'
  if (editor.hovered?.kind === 'wall' && editor.hovered.id === wallId) return 'hovered'
  return 'idle'
}

function fillFor(wallId: string): string {
  const current = state(wallId)
  if (current === 'selected') return PALETTE.blueprint
  if (current === 'hovered') return '#3C474D'
  return PALETTE.graphite
}
</script>

<template>
  <g>
    <path
      v-for="wall in walls"
      :key="wall.wallId"
      :d="polygonPath(wall.polygon)"
      :fill="fillFor(wall.wallId)"
      :stroke="PALETTE.graphiteLine"
      :stroke-width="stroke"
      stroke-linejoin="round"
      :data-entity="`wall:${wall.wallId}`"
      class="wall"
    />
  </g>
</template>

<style scoped>
.wall {
  transition: fill 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .wall {
    transition: none;
  }
}
</style>
