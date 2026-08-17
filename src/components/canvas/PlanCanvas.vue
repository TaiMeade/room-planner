<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import DimensionsLayer from '@/components/canvas/DimensionsLayer.vue'
import FurnitureLayer from '@/components/canvas/FurnitureLayer.vue'
import GridLayer from '@/components/canvas/GridLayer.vue'
import OpeningsLayer from '@/components/canvas/OpeningsLayer.vue'
import OverlayLayer from '@/components/canvas/OverlayLayer.vue'
import RoomsLayer from '@/components/canvas/RoomsLayer.vue'
import WallsLayer from '@/components/canvas/WallsLayer.vue'
import { useCanvasInteraction } from '@/composables/useCanvasInteraction'
import { boundsAreValid, emptyBounds, extendBounds, padBounds } from '@/lib/geometry'
import { alignToNearestWall, placeFurniture } from '@/lib/edits'
import { PALETTE } from '@/lib/render'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'

/**
 * The drawing surface.
 *
 * One SVG, one transform group, everything inside it in world millimetres.
 * Layers are ordered the way a drawing is built up: floor, walls, openings,
 * furniture, dimensions, then the editing overlay that never gets exported.
 */

const editor = useEditorStore()
const planStore = usePlanStore()

const surface = ref<SVGSVGElement | null>(null)
const container = ref<HTMLDivElement | null>(null)

const interaction = useCanvasInteraction(() => surface.value)

const transform = computed(
  () =>
    `translate(${editor.viewport.x} ${editor.viewport.y}) scale(${editor.viewport.scale})`,
)

const cursorClass = computed(() => {
  if (editor.isPanning) return 'plan-canvas--panning'
  if (editor.spaceHeld || editor.tool === 'pan') return 'plan-canvas--pan'
  if (editor.tool === 'wall' || editor.tool === 'room' || editor.tool === 'measure') {
    return 'plan-canvas--draw'
  }
  if (editor.tool === 'opening') return 'plan-canvas--draw'
  if (editor.isDragging) return 'plan-canvas--move'
  return ''
})

// --- sizing ----------------------------------------------------------------

let observer: ResizeObserver | null = null

function measure(): void {
  const element = container.value
  if (!element) return
  editor.canvasSize = { width: element.clientWidth, height: element.clientHeight }
}

/** The world rectangle containing everything drawn, used by "fit to plan". */
function planBounds() {
  const bounds = emptyBounds()
  for (const wall of planStore.geometry.walls) {
    for (const point of wall.polygon) extendBounds(bounds, point)
  }
  for (const item of Object.values(planStore.plan.furniture)) {
    const reach = Math.max(item.width, item.depth) / 2
    extendBounds(bounds, { x: item.x - reach, y: item.y - reach })
    extendBounds(bounds, { x: item.x + reach, y: item.y + reach })
  }
  return bounds
}

function fitToPlan(): void {
  const bounds = planBounds()
  if (boundsAreValid(bounds)) editor.fitToBounds(padBounds(bounds, 700))
}

defineExpose({ fitToPlan })

onMounted(() => {
  measure()
  observer = new ResizeObserver(() => measure())
  if (container.value) observer.observe(container.value)
  // Open on the whole plan rather than a corner of it.
  requestAnimationFrame(fitToPlan)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

// Anything that vanishes under an undo shouldn't stay selected.
watch(
  () => planStore.revision,
  () => editor.pruneSelection(),
)

// --- drag and drop from the furniture drawer -------------------------------

const dropTarget = ref(false)

function onDragOver(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes('application/x-room-planner-item')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  dropTarget.value = true
}

function onDragLeave(): void {
  dropTarget.value = false
}

function onDrop(event: DragEvent): void {
  dropTarget.value = false
  const catalogId = event.dataTransfer?.getData('application/x-room-planner-item')
  if (!catalogId) return
  event.preventDefault()

  const rect = surface.value?.getBoundingClientRect()
  if (!rect) return
  const world = editor.snapPoint(
    editor.toWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }),
  )

  // Dropping near a wall orients the item against it — a sofa dropped by a wall
  // wants its back to the wall, and making people rotate it every time is the
  // kind of small tax that adds up.
  const rotation = alignToNearestWall(planStore.geometry, world, editor.pixelsToWorld(70)) ?? 0

  const placed = placeFurniture(catalogId, world, rotation)
  if (!placed) return
  planStore.execute(placed.command)
  editor.setTool('select')
  editor.select({ kind: 'furniture', id: placed.id })
}
</script>

<template>
  <div
    ref="container"
    class="canvas-shell"
    :class="{ 'canvas-shell--drop': dropTarget }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <svg
      ref="surface"
      class="plan-canvas"
      :class="cursorClass"
      :width="editor.canvasSize.width"
      :height="editor.canvasSize.height"
      role="application"
      aria-label="Floor plan drawing area"
      @pointerdown="interaction.onPointerDown"
      @pointermove="interaction.onPointerMove"
      @pointerup="interaction.onPointerUp"
      @pointercancel="interaction.onPointerUp"
      @wheel="interaction.onWheel"
      @dblclick="interaction.onDoubleClick"
      @contextmenu.prevent
    >
      <g :transform="transform">
        <GridLayer v-if="planStore.settings.showGrid" />

        <!-- Origin mark: the one fixed reference on an infinite sheet. -->
        <g :opacity="0.5" :stroke="PALETTE.gridMajor" :stroke-width="1 / editor.viewport.scale">
          <line :x1="-300 / editor.viewport.scale" y1="0" :x2="300 / editor.viewport.scale" y2="0" />
          <line x1="0" :y1="-300 / editor.viewport.scale" x2="0" :y2="300 / editor.viewport.scale" />
        </g>

        <image
          v-if="planStore.plan.underlay?.visible"
          :href="planStore.plan.underlay.dataUrl"
          :x="planStore.plan.underlay.x"
          :y="planStore.plan.underlay.y"
          :width="planStore.plan.underlay.width"
          :height="planStore.plan.underlay.height"
          :opacity="planStore.plan.underlay.opacity"
          preserveAspectRatio="none"
        />

        <RoomsLayer />
        <WallsLayer />
        <OpeningsLayer />
        <FurnitureLayer />
        <DimensionsLayer />
        <OverlayLayer :marquee="interaction.marquee.value" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.canvas-shell {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--paper);
}

/* A quiet inset edge so the paper reads as a lit surface on the dark table. */
.canvas-shell::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 1px rgba(23, 29, 33, 0.16);
}

.canvas-shell--drop::after {
  box-shadow: inset 0 0 0 2px var(--blueprint);
}
</style>
