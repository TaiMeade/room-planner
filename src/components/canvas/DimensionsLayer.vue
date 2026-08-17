<script setup lang="ts">
import { computed } from 'vue'

import { add, pointInPolygon, scale } from '@/lib/geometry'
import { dimensionPaths, PALETTE } from '@/lib/render'
import { formatLength } from '@/lib/units'
import type { WallOutline } from '@/lib/wallGeometry'
import { wallMidpoint } from '@/lib/wallGeometry'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'

/**
 * Dimension strings along every wall — witness lines, a run, 45° ticks, and the
 * length set in a knocked-out gap in the middle.
 *
 * This is the signature mark of the app. It is also the point: "get an accurate
 * scaled drawing out of my head" is the job, and a drawing without dimensions
 * isn't one. Anyone can put a number beside a rectangle; the tick-slash string
 * is what makes it read as a drawing rather than a shape editor.
 */

const editor = useEditorStore()
const planStore = usePlanStore()

/** Below this many pixels a dimension string is more clutter than information. */
const MIN_SCREEN_LENGTH = 44

const px = (value: number) => value / editor.viewport.scale

/**
 * Push the dimension to the outside of the space. A point just off the wall on
 * the normal side lands inside a room only if that side is interior.
 */
function outwardSign(wall: WallOutline): number {
  const probe = add(wallMidpoint(wall), scale(wall.normal, wall.thickness / 2 + 60))
  const interior = planStore.rooms.some((room) => pointInPolygon(probe, room.polygon))
  return interior ? -1 : 1
}

/** Held clear of the wall at all zooms: a real distance, floored by a screen distance. */
const offsetDistance = computed(() => Math.max(360, px(30)))

const dimensions = computed(() => {
  if (!planStore.settings.showDimensions) return []

  return planStore.geometry.walls
    .filter((wall) => wall.centrelineLength * editor.viewport.scale >= MIN_SCREEN_LENGTH)
    .map((wall) => {
      const sign = outwardSign(wall)
      const paths = dimensionPaths(wall.start, wall.end, sign * offsetDistance.value, {
        tickLength: px(7),
        witnessGap: Math.max(90, px(7)),
      })
      return {
        id: wall.wallId,
        paths,
        text: formatLength(wall.centrelineLength, planStore.units),
        emphasised: editor.isSelected('wall', wall.wallId),
      }
    })
})

const hairline = computed(() => 1 / editor.viewport.scale)
const fontSize = computed(() => px(11))

/** Width of the gap punched in the run so the label sits in clear space. */
function labelBackdropWidth(text: string): number {
  return (text.length * 0.62 + 0.8) * fontSize.value
}
</script>

<template>
  <g>
    <g
      v-for="dimension in dimensions"
      :key="dimension.id"
      :stroke="dimension.emphasised ? PALETTE.blueprint : PALETTE.dimension"
      :opacity="dimension.emphasised ? 1 : 0.72"
    >
      <path
        v-for="(witness, index) in dimension.paths.witnesses"
        :key="`w-${index}`"
        :d="witness"
        :stroke-width="hairline"
        fill="none"
      />
      <path :d="dimension.paths.run" :stroke-width="hairline" fill="none" />
      <path
        v-for="(tick, index) in dimension.paths.ticks"
        :key="`t-${index}`"
        :d="tick"
        :stroke-width="hairline * 1.5"
        fill="none"
        stroke-linecap="round"
      />

      <g
        :transform="`translate(${dimension.paths.label.x} ${dimension.paths.label.y}) rotate(${dimension.paths.label.angle})`"
        stroke="none"
      >
        <!-- Knock a gap in the run rather than drawing a box: the label sits in
             the line, as it does on a drawing sheet. -->
        <rect
          :x="-labelBackdropWidth(dimension.text) / 2"
          :y="-fontSize * 0.62"
          :width="labelBackdropWidth(dimension.text)"
          :height="fontSize * 1.24"
          :fill="PALETTE.paper"
        />
        <text
          x="0"
          y="0"
          text-anchor="middle"
          dominant-baseline="central"
          :font-size="fontSize"
          font-family="IBM Plex Mono, ui-monospace, monospace"
          :fill="dimension.emphasised ? PALETTE.blueprint : PALETTE.dimension"
          font-weight="500"
        >
          {{ dimension.text }}
        </text>
      </g>
    </g>
  </g>
</template>
