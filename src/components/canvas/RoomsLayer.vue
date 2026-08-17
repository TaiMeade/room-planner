<script setup lang="ts">
import { computed } from 'vue'

import { PALETTE, polygonPath } from '@/lib/render'
import { formatArea } from '@/lib/units'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'

/**
 * Enclosed floor regions, filled and labelled with their area.
 *
 * The area label is the payoff of the whole room-detection pass, and it is the
 * number people actually came for — "is this big enough" is the question under
 * most of the reasons someone opens a floor planner.
 */

const editor = useEditorStore()
const planStore = usePlanStore()

const rooms = computed(() => planStore.rooms)
const showAreas = computed(() => planStore.settings.showAreas)

/** Screen-constant text: font sizes are authored in px and divided by the zoom. */
const px = (value: number) => value / editor.viewport.scale

/** Don't label a room too small to hold the text legibly. */
function labelFits(area: number): boolean {
  return Math.sqrt(area) * editor.viewport.scale > 74
}
</script>

<template>
  <g>
    <path
      v-for="room in rooms"
      :key="room.id"
      :d="polygonPath(room.polygon)"
      :fill="PALETTE.roomFill"
      stroke="none"
    />

    <template v-if="showAreas">
      <g v-for="room in rooms" :key="`label-${room.id}`">
        <template v-if="labelFits(room.area)">
          <text
            :x="room.centroid.x"
            :y="room.centroid.y - px(3)"
            text-anchor="middle"
            :font-size="px(12)"
            :font-family="'IBM Plex Mono, ui-monospace, monospace'"
            :fill="PALETTE.label"
            font-weight="500"
          >
            {{ formatArea(room.area, planStore.units) }}
          </text>
        </template>
      </g>
    </template>
  </g>
</template>
