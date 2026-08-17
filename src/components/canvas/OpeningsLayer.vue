<script setup lang="ts">
import { computed } from 'vue'

import { openingPaths, PALETTE } from '@/lib/render'
import type { OpeningGeometry } from '@/lib/wallGeometry'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'

/**
 * Doors and windows, painted over the wall they're hosted in.
 *
 * An opening that has been pushed past the end of its wall is drawn in red
 * rather than clamped silently — the numbers in the inspector are the source of
 * truth, and quietly moving someone's door is worse than showing them it
 * doesn't fit.
 */

const editor = useEditorStore()
const planStore = usePlanStore()

const openings = computed(() =>
  planStore.geometry.openings.map((entry) => ({
    entry,
    paths: openingPaths(entry),
  })),
)

const hairline = computed(() => 1.1 / editor.viewport.scale)
const leafLine = computed(() => 1.6 / editor.viewport.scale)

function tint(entry: OpeningGeometry): string {
  if (entry.overflows) return PALETTE.danger
  if (editor.isSelected('opening', entry.opening.id)) return PALETTE.blueprint
  return PALETTE.graphiteLine
}

/** The hole is painted in the floor colour so it reads as a gap in the poché. */
function holeFill(entry: OpeningGeometry): string {
  return entry.overflows ? 'rgba(184, 84, 63, 0.16)' : PALETTE.roomFill
}
</script>

<template>
  <g>
    <g
      v-for="{ entry, paths } in openings"
      :key="entry.opening.id"
      :data-entity="`opening:${entry.opening.id}`"
    >
      <path :d="paths.cut" :fill="holeFill(entry)" stroke="none" />

      <path
        v-for="(jamb, index) in paths.jambs"
        :key="`jamb-${index}`"
        :d="jamb"
        :stroke="tint(entry)"
        :stroke-width="hairline"
        fill="none"
      />

      <path
        v-for="(leaf, index) in paths.leaves"
        :key="`leaf-${index}`"
        :d="leaf"
        :stroke="tint(entry)"
        :stroke-width="leafLine"
        stroke-linecap="round"
        fill="none"
      />

      <path
        v-for="(arc, index) in paths.arcs"
        :key="`arc-${index}`"
        :d="arc"
        :stroke="tint(entry)"
        :stroke-width="hairline"
        fill="none"
        opacity="0.5"
        stroke-dasharray="none"
      />

      <path
        v-for="(pane, index) in paths.panes"
        :key="`pane-${index}`"
        :d="pane"
        :stroke="tint(entry)"
        :stroke-width="hairline"
        fill="none"
      />
    </g>
  </g>
</template>
