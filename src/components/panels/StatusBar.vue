<script setup lang="ts">
import { mdiGrid, mdiMagnifyMinusOutline, mdiMagnifyPlusOutline, mdiVectorSquare } from '@mdi/js'
import { computed } from 'vue'

import { formatArea, formatLength, GRID_PRESETS } from '@/lib/units'
import { DEFAULT_SCALE, useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'

/**
 * The status strip.
 *
 * Live cursor coordinates, the grid step, the zoom, and what the plan currently
 * adds up to. Borrowed wholesale from CAD, where the bottom of the window is
 * where you look to answer "where am I and what is switched on" — and where the
 * mono numerals do the most work, since they stop the readout twitching as
 * digits change.
 */

const emit = defineEmits<{ fit: [] }>()

const editor = useEditorStore()
const planStore = usePlanStore()

const cursorX = computed(() => formatLength(editor.cursor.x, planStore.units))
const cursorY = computed(() => formatLength(editor.cursor.y, planStore.units))

/** 100% is the default scale — the zoom a plan opens at, not any pixel ratio. */
const zoomPercent = computed(
  () => `${Math.round((editor.viewport.scale / DEFAULT_SCALE) * 100)}%`,
)

const gridPresets = computed(() => GRID_PRESETS[planStore.units])
const gridLabel = computed(() => {
  const match = gridPresets.value.find(
    (preset) => Math.abs(preset.mm - planStore.settings.gridSize) < 0.5,
  )
  return match?.label ?? formatLength(planStore.settings.gridSize, planStore.units)
})

const roomCount = computed(() => planStore.rooms.length)
const area = computed(() => formatArea(planStore.floorArea, planStore.units))

function cycleGrid(): void {
  const presets = gridPresets.value
  const index = presets.findIndex(
    (preset) => Math.abs(preset.mm - planStore.settings.gridSize) < 0.5,
  )
  const next = presets[(index + 1) % presets.length]!
  planStore.updateSettings({ gridSize: next.mm })
}

function zoom(factor: number): void {
  editor.zoomAt(
    { x: editor.canvasSize.width / 2, y: editor.canvasSize.height / 2 },
    factor,
  )
}
</script>

<template>
  <footer class="status">
    <div class="status__group">
      <span class="status__label">x</span>
      <span class="status__value mono">{{ cursorX }}</span>
      <span class="status__label">y</span>
      <span class="status__value mono">{{ cursorY }}</span>
    </div>

    <div class="status__divider" />

    <button
      type="button"
      class="status__chip"
      :class="{ 'status__chip--on': planStore.settings.snapToGrid }"
      :title="
        planStore.settings.snapToGrid
          ? 'Snapping is on. Hold Alt to bypass it'
          : 'Snapping is off'
      "
      @click="planStore.updateSettings({ snapToGrid: !planStore.settings.snapToGrid })"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiGrid" fill="currentColor" /></svg>
      Snap
    </button>

    <button type="button" class="status__chip" title="Change the grid step" @click="cycleGrid">
      Grid <span class="mono">{{ gridLabel }}</span>
    </button>

    <button
      type="button"
      class="status__chip"
      :class="{ 'status__chip--on': planStore.settings.showDimensions }"
      title="Show or hide the dimension strings"
      @click="planStore.updateSettings({ showDimensions: !planStore.settings.showDimensions })"
    >
      Dimensions
    </button>

    <div class="status__spacer" />

    <div class="status__group" :title="`${roomCount} enclosed ${roomCount === 1 ? 'room' : 'rooms'}`">
      <span class="status__label">{{ roomCount === 1 ? 'room' : 'rooms' }}</span>
      <span class="status__value mono">{{ roomCount }}</span>
      <span class="status__label">area</span>
      <span class="status__value mono">{{ area }}</span>
    </div>

    <div class="status__divider" />

    <div class="status__zoom">
      <button type="button" class="status__icon" title="Zoom out" @click="zoom(1 / 1.25)">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path :d="mdiMagnifyMinusOutline" fill="currentColor" />
        </svg>
      </button>
      <span class="status__value mono status__zoomvalue">{{ zoomPercent }}</span>
      <button type="button" class="status__icon" title="Zoom in" @click="zoom(1.25)">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path :d="mdiMagnifyPlusOutline" fill="currentColor" />
        </svg>
      </button>
      <button type="button" class="status__icon" title="Fit the plan on screen (F)" @click="emit('fit')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path :d="mdiVectorSquare" fill="currentColor" />
        </svg>
      </button>
    </div>
  </footer>
</template>

<style scoped>
.status {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--statusbar);
  padding: 0 10px;
  background: var(--ink-sunken);
  border-top: 1px solid var(--ink-line);
  font-size: 11px;
  color: var(--chalk-dim);
  overflow-x: auto;
  scrollbar-width: none;
}

.status::-webkit-scrollbar {
  display: none;
}

.status__group {
  display: flex;
  align-items: baseline;
  gap: 5px;
  white-space: nowrap;
}

.status__label {
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--chalk-faint);
}

.status__value {
  font-size: 11px;
  color: var(--chalk);
  /* Keeps the readout from twitching as digits change width. */
  min-width: 3.5ch;
}

.status__divider {
  width: 1px;
  height: 14px;
  background: var(--ink-line);
  flex: none;
}

.status__spacer {
  flex: 1 1 auto;
  min-width: 8px;
}

.status__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chalk-faint);
  font: inherit;
  font-size: 10.5px;
  white-space: nowrap;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}

.status__chip:hover {
  color: var(--chalk);
  background: rgba(255, 255, 255, 0.05);
}

.status__chip--on {
  color: var(--blueprint-bright);
  border-color: rgba(90, 159, 201, 0.34);
}

.status__chip svg {
  width: 13px;
  height: 13px;
}

.status__zoom {
  display: flex;
  align-items: center;
  gap: 2px;
}

.status__zoomvalue {
  min-width: 4.5ch;
  text-align: center;
}

.status__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chalk-faint);
  cursor: pointer;
}

.status__icon:hover {
  color: var(--chalk);
  background: rgba(255, 255, 255, 0.05);
}

.status__icon svg {
  width: 15px;
  height: 15px;
}
</style>
