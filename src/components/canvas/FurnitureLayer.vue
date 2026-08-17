<script setup lang="ts">
import { computed } from 'vue'

import { catalogEntry, glyphFor } from '@/lib/catalog'
import { toDegrees } from '@/lib/geometry'
import { PALETTE } from '@/lib/render'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'
import type { FurnitureItem } from '@/types/plan'

/**
 * Placed furniture, drawn from parametric glyphs at true footprint size.
 *
 * Each item is a group transformed into its own local frame, so the glyph
 * functions never have to think about rotation or position — they draw a bed
 * around the origin and the transform puts it in the room.
 */

const editor = useEditorStore()
const planStore = usePlanStore()

const items = computed(() =>
  planStore.plan.furnitureOrder
    .map((id) => planStore.plan.furniture[id])
    .filter((item): item is FurnitureItem => Boolean(item))
    .map((item) => {
      const entry = catalogEntry(item.catalogId)
      return {
        item,
        glyph: glyphFor(entry, item.width, item.depth),
        fill: item.color ?? entry?.color ?? '#D8CFC0',
      }
    }),
)

const outline = computed(() => 1.2 / editor.viewport.scale)
const detail = computed(() => 1 / editor.viewport.scale)
const px = (value: number) => value / editor.viewport.scale

function transformFor(item: FurnitureItem): string {
  return `translate(${item.x} ${item.y}) rotate(${toDegrees(item.rotation)})`
}

function strokeFor(item: FurnitureItem): string {
  if (editor.isSelected('furniture', item.id)) return PALETTE.blueprint
  if (editor.hovered?.kind === 'furniture' && editor.hovered.id === item.id) {
    return PALETTE.blueprint
  }
  return '#6E767B'
}

/**
 * Labels turn with their item, the way they do on a real plan — but a label
 * past vertical gets flipped back so nothing has to be read upside down.
 */
function labelTransform(item: FurnitureItem): string {
  const degrees = ((toDegrees(item.rotation) % 360) + 360) % 360
  return degrees > 90 && degrees < 270 ? 'rotate(180)' : ''
}

/** Label an item only when its footprint can hold the text. */
function labelFits(item: FurnitureItem): boolean {
  return (
    Math.min(item.width, item.depth) * editor.viewport.scale > 42 &&
    item.width * editor.viewport.scale > item.label.length * 6.4
  )
}
</script>

<template>
  <g>
    <g
      v-for="{ item, glyph, fill } in items"
      :key="item.id"
      :transform="transformFor(item)"
      :data-entity="`furniture:${item.id}`"
      :opacity="item.locked ? 0.62 : 1"
    >
      <path
        :d="glyph.body"
        :fill="fill"
        :stroke="strokeFor(item)"
        :stroke-width="outline"
        stroke-linejoin="round"
      />
      <path
        v-for="(path, index) in glyph.details"
        :key="index"
        :d="path"
        fill="none"
        :stroke="strokeFor(item)"
        :stroke-width="detail"
        stroke-linejoin="round"
        opacity="0.55"
      />
      <text
        v-if="labelFits(item)"
        x="0"
        y="0"
        :transform="labelTransform(item)"
        text-anchor="middle"
        dominant-baseline="middle"
        :font-size="px(10)"
        font-family="Archivo Variable, Archivo, system-ui, sans-serif"
        :fill="PALETTE.label"
        opacity="0.8"
      >
        {{ item.label }}
      </text>
    </g>
  </g>
</template>
