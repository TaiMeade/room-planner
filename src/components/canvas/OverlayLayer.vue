<script setup lang="ts">
import { computed } from 'vue'

import {
  add,
  angleOf,
  distance,
  normalizeDegrees,
  rectCorners,
  rotate,
  sub,
  toDegrees,
} from '@/lib/geometry'
import type { Point } from '@/lib/geometry'
import { PALETTE, polygonPath } from '@/lib/render'
import { formatLength } from '@/lib/units'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'

/**
 * Everything that isn't the drawing: node handles, selection outlines, the
 * rubber-band marquee, the wall being drawn, and the live readout that follows
 * the cursor.
 *
 * All of it is sized in screen pixels converted to world units, so handles stay
 * the same size to grab no matter how far in you've zoomed. None of it is ever
 * exported.
 */

const props = defineProps<{
  marquee: { from: Point; to: Point } | null
}>()

const editor = useEditorStore()
const planStore = usePlanStore()

const px = (value: number) => value / editor.viewport.scale

const handleRadius = computed(() => px(4.5))
const hairline = computed(() => 1 / editor.viewport.scale)

// --- node handles -----------------------------------------------------------

/** Corner handles appear only in the select tool, and only once there's something to grab. */
const nodes = computed(() => {
  if (editor.tool !== 'select') return []
  return Object.values(planStore.plan.nodes)
})

function nodeState(id: string): 'selected' | 'hovered' | 'idle' {
  if (editor.isSelected('node', id)) return 'selected'
  if (editor.hovered?.kind === 'node' && editor.hovered.id === id) return 'hovered'
  return 'idle'
}

// --- selection outlines -----------------------------------------------------

const selectedFurniture = computed(() =>
  editor.selection
    .filter((entry) => entry.kind === 'furniture')
    .map((entry) => planStore.plan.furniture[entry.id])
    .filter((item): item is NonNullable<typeof item> => Boolean(item)),
)

function outlineFor(item: { x: number; y: number; width: number; depth: number; rotation: number }) {
  return polygonPath(
    rectCorners({ x: item.x, y: item.y }, item.width, item.depth, item.rotation),
  )
}

/** The rotate grip sits off the item's front edge, in its own rotated frame. */
function rotationGrip(item: {
  x: number
  y: number
  depth: number
  rotation: number
}): { anchor: Point; grip: Point } {
  const localOffset = { x: 0, y: -(item.depth / 2 + px(26)) }
  const anchorLocal = { x: 0, y: -item.depth / 2 }
  const centre = { x: item.x, y: item.y }
  return {
    anchor: add(centre, rotate(anchorLocal, item.rotation)),
    grip: add(centre, rotate(localOffset, item.rotation)),
  }
}

// --- draft wall -------------------------------------------------------------

const draft = computed(() => {
  const current = editor.draftWall
  if (!current) return null
  const span = distance(current.from, current.to)
  if (span < 1) return null
  const degrees = normalizeDegrees(toDegrees(angleOf(sub(current.to, current.from))))
  return {
    ...current,
    span,
    // Report the angle the way people think about it: 0° is east, positive is
    // counter-clockwise, which means flipping the sign of screen-space y.
    degrees: -degrees,
  }
})

// --- live readout -----------------------------------------------------------

/** A chip that follows the cursor with the number that matters right now. */
const readout = computed(() => {
  if (draft.value) {
    return {
      at: draft.value.to,
      lines: [
        formatLength(draft.value.span, planStore.units),
        `${draft.value.degrees.toFixed(1)}°`,
      ],
    }
  }
  if (editor.measurement) {
    const span = distance(editor.measurement.from, editor.measurement.to)
    return {
      at: editor.measurement.to,
      lines: [formatLength(span, planStore.units)],
    }
  }
  return null
})

const chip = computed(() => ({
  padX: px(7),
  padY: px(5),
  lineHeight: px(14),
  font: px(11.5),
  radius: px(3),
}))

function chipWidth(lines: string[]): number {
  const longest = Math.max(...lines.map((line) => line.length))
  return longest * chip.value.font * 0.62 + chip.value.padX * 2
}
</script>

<template>
  <g>
    <!-- Measurement tape -->
    <g v-if="editor.measurement">
      <path
        :d="`M ${editor.measurement.from.x} ${editor.measurement.from.y} L ${editor.measurement.to.x} ${editor.measurement.to.y}`"
        :stroke="PALETTE.amber"
        :stroke-width="hairline * 1.6"
        :stroke-dasharray="`${px(7)} ${px(4)}`"
        fill="none"
      />
      <circle
        v-for="(point, index) in [editor.measurement.from, editor.measurement.to]"
        :key="index"
        :cx="point.x"
        :cy="point.y"
        :r="handleRadius * 0.7"
        :fill="PALETTE.amber"
      />
    </g>

    <!-- The wall being drawn -->
    <g v-if="draft">
      <path
        :d="`M ${draft.from.x} ${draft.from.y} L ${draft.to.x} ${draft.to.y}`"
        :stroke="PALETTE.blueprint"
        :stroke-width="planStore.settings.defaultWallThickness"
        stroke-linecap="butt"
        opacity="0.28"
        fill="none"
      />
      <path
        :d="`M ${draft.from.x} ${draft.from.y} L ${draft.to.x} ${draft.to.y}`"
        :stroke="PALETTE.blueprint"
        :stroke-width="hairline * 1.4"
        fill="none"
      />
      <!-- Welding onto an existing corner is called out before the click lands. -->
      <circle
        v-if="draft.toNode"
        :cx="draft.to.x"
        :cy="draft.to.y"
        :r="handleRadius * 1.7"
        fill="none"
        :stroke="PALETTE.blueprint"
        :stroke-width="hairline * 1.6"
      />
    </g>

    <!-- Marquee -->
    <rect
      v-if="props.marquee"
      :x="Math.min(props.marquee.from.x, props.marquee.to.x)"
      :y="Math.min(props.marquee.from.y, props.marquee.to.y)"
      :width="Math.abs(props.marquee.to.x - props.marquee.from.x)"
      :height="Math.abs(props.marquee.to.y - props.marquee.from.y)"
      :fill="PALETTE.blueprint"
      fill-opacity="0.08"
      :stroke="PALETTE.blueprint"
      :stroke-width="hairline"
      :stroke-dasharray="`${px(5)} ${px(3)}`"
    />

    <!-- Selected furniture: outline plus a rotate grip -->
    <g v-for="item in selectedFurniture" :key="`sel-${item.id}`">
      <path
        :d="outlineFor(item)"
        fill="none"
        :stroke="PALETTE.blueprint"
        :stroke-width="hairline * 1.6"
      />
      <template v-if="!item.locked">
        <path
          :d="`M ${rotationGrip(item).anchor.x} ${rotationGrip(item).anchor.y} L ${rotationGrip(item).grip.x} ${rotationGrip(item).grip.y}`"
          :stroke="PALETTE.blueprint"
          :stroke-width="hairline"
          fill="none"
        />
        <circle
          :cx="rotationGrip(item).grip.x"
          :cy="rotationGrip(item).grip.y"
          :r="handleRadius"
          :fill="PALETTE.paper"
          :stroke="PALETTE.blueprint"
          :stroke-width="hairline * 1.8"
          :data-handle="`rotate:${item.id}`"
          class="grip"
        />
      </template>
    </g>

    <!-- Node handles -->
    <g v-if="editor.tool === 'select'">
      <rect
        v-for="node in nodes"
        :key="node.id"
        :x="node.x - handleRadius"
        :y="node.y - handleRadius"
        :width="handleRadius * 2"
        :height="handleRadius * 2"
        :fill="nodeState(node.id) === 'idle' ? PALETTE.paper : PALETTE.blueprint"
        :stroke="PALETTE.blueprint"
        :stroke-width="hairline * 1.6"
        :data-handle="`node:${node.id}`"
        class="grip"
      />
    </g>

    <!-- Cursor readout -->
    <g v-if="readout" :transform="`translate(${readout.at.x} ${readout.at.y})`">
      <g :transform="`translate(${px(14)} ${px(-10)})`">
        <rect
          x="0"
          :y="-chip.lineHeight * readout.lines.length - chip.padY * 2 + chip.lineHeight"
          :width="chipWidth(readout.lines)"
          :height="chip.lineHeight * readout.lines.length + chip.padY * 2"
          :rx="chip.radius"
          fill="#1B2327"
          opacity="0.94"
        />
        <text
          v-for="(line, index) in readout.lines"
          :key="index"
          :x="chip.padX"
          :y="
            -chip.lineHeight * (readout.lines.length - 1 - index) -
            chip.padY +
            chip.lineHeight * 0.32
          "
          :font-size="chip.font"
          font-family="IBM Plex Mono, ui-monospace, monospace"
          :fill="index === 0 ? '#E8ECEC' : '#93A4AE'"
        >
          {{ line }}
        </text>
      </g>
    </g>
  </g>
</template>

<style scoped>
.grip {
  cursor: grab;
}
</style>
