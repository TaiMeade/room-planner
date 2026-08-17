<script setup lang="ts">
import { computed } from 'vue'

import { gridLines, PALETTE } from '@/lib/render'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'

/**
 * The grid, drawn only across what's visible.
 *
 * Two weights: a light rule at the grid step and a firmer one every fifth line,
 * so the eye can count squares without the drawing turning into graph paper.
 * Below ~4 px per square the minor lines are dropped entirely — a solid grey
 * wash reads as noise and hides the plan.
 */

const editor = useEditorStore()
const planStore = usePlanStore()

const MINOR_VISIBILITY_PX = 5

const step = computed(() => planStore.settings.gridSize)
const majorEvery = computed(() => (planStore.settings.units === 'imperial' ? 2 : 5))

const pixelsPerStep = computed(() => step.value * editor.viewport.scale)
const showMinor = computed(() => pixelsPerStep.value >= MINOR_VISIBILITY_PX)

const lines = computed(() => gridLines(editor.visibleWorld, step.value))

/** Major lines fall on every nth step measured from the origin, not from the viewport. */
function isMajor(value: number): boolean {
  const index = Math.round(value / step.value)
  return index % majorEvery.value === 0
}

const minorVertical = computed(() =>
  showMinor.value ? lines.value.vertical.filter((x) => !isMajor(x)) : [],
)
const minorHorizontal = computed(() =>
  showMinor.value ? lines.value.horizontal.filter((y) => !isMajor(y)) : [],
)
const majorVertical = computed(() => lines.value.vertical.filter(isMajor))
const majorHorizontal = computed(() => lines.value.horizontal.filter(isMajor))

const bounds = computed(() => editor.visibleWorld)
const strokeMinor = computed(() => 1 / editor.viewport.scale)
const strokeMajor = computed(() => 1.25 / editor.viewport.scale)
</script>

<template>
  <g aria-hidden="true">
    <g :stroke="PALETTE.gridMinor" :stroke-width="strokeMinor" shape-rendering="crispEdges">
      <line
        v-for="x in minorVertical"
        :key="`vn-${x}`"
        :x1="x"
        :y1="bounds.minY"
        :x2="x"
        :y2="bounds.maxY"
      />
      <line
        v-for="y in minorHorizontal"
        :key="`hn-${y}`"
        :x1="bounds.minX"
        :y1="y"
        :x2="bounds.maxX"
        :y2="y"
      />
    </g>
    <g :stroke="PALETTE.gridMajor" :stroke-width="strokeMajor" shape-rendering="crispEdges">
      <line
        v-for="x in majorVertical"
        :key="`vm-${x}`"
        :x1="x"
        :y1="bounds.minY"
        :x2="x"
        :y2="bounds.maxY"
      />
      <line
        v-for="y in majorHorizontal"
        :key="`hm-${y}`"
        :x1="bounds.minX"
        :y1="y"
        :x2="bounds.maxX"
        :y2="y"
      />
    </g>
  </g>
</template>
