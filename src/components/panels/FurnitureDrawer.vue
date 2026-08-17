<script setup lang="ts">
import { mdiMagnify } from '@mdi/js'
import { computed, ref } from 'vue'

import { CATALOG, CATEGORIES, glyphFor } from '@/lib/catalog'
import type { CatalogEntry, Category } from '@/lib/catalog'
import { alignToNearestWall, placeFurniture } from '@/lib/edits'
import { formatLength } from '@/lib/units'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'

/**
 * The furniture drawer.
 *
 * Every tile shows the item's real footprint underneath its name, because the
 * dimensions *are* the product — a catalog that says "Sofa" without saying
 * 84 × 36 is decoration. Items are drawn from the same glyphs the canvas uses,
 * at a size proportional to the real thing, so a king bed looks bigger than a
 * nightstand in the drawer too.
 */

const editor = useEditorStore()
const planStore = usePlanStore()

const search = ref('')
const activeCategory = ref<Category | 'All'>('All')

const categories = computed<(Category | 'All')[]>(() => ['All', ...CATEGORIES])

const results = computed(() => {
  const term = search.value.trim().toLowerCase()
  return CATALOG.filter((entry) => {
    if (activeCategory.value !== 'All' && entry.category !== activeCategory.value) return false
    if (!term) return true
    return (
      entry.name.toLowerCase().includes(term) || entry.category.toLowerCase().includes(term)
    )
  })
})

/**
 * Tile previews share one viewbox, so a nightstand really does look smaller
 * than a king bed. Items larger than the reference span grow the box rather
 * than being cropped, which flattens the differences among the big pieces —
 * acceptable, because the footprint printed under every tile is the precise
 * answer and the drawing is only there for recognition.
 */
const PREVIEW_BOX = 44
const REFERENCE_MM = 1500

function previewSpan(entry: CatalogEntry): number {
  return Math.max(REFERENCE_MM, entry.width, entry.depth) * 1.06
}

function previewViewBox(entry: CatalogEntry): string {
  const drawn = previewSpan(entry)
  return `${-drawn / 2} ${-drawn / 2} ${drawn} ${drawn}`
}

/** Roughly one screen pixel, whatever the tile's world span happens to be. */
function previewStroke(entry: CatalogEntry): number {
  return previewSpan(entry) / PREVIEW_BOX
}

function footprint(entry: CatalogEntry): string {
  return `${formatLength(entry.width, planStore.units)} × ${formatLength(entry.depth, planStore.units)}`
}

function onDragStart(event: DragEvent, entry: CatalogEntry): void {
  event.dataTransfer?.setData('application/x-room-planner-item', entry.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

/**
 * Clicking places the item in the middle of the view. Dragging is nicer, but a
 * click has to work too — on a trackpad, and for anyone who can't drag.
 */
function placeInView(entry: CatalogEntry): void {
  const centre = editor.snapPoint(
    editor.toWorld({
      x: editor.canvasSize.width / 2,
      y: editor.canvasSize.height / 2,
    }),
  )
  const rotation = alignToNearestWall(planStore.geometry, centre, editor.pixelsToWorld(70)) ?? 0
  const placed = placeFurniture(entry.id, centre, rotation)
  if (!placed) return
  planStore.execute(placed.command)
  editor.setTool('select')
  editor.select({ kind: 'furniture', id: placed.id })
}
</script>

<template>
  <section class="drawer" aria-label="Furniture">
    <header class="drawer__head">
      <v-text-field
        v-model="search"
        :prepend-inner-icon="mdiMagnify"
        placeholder="Search furniture"
        density="compact"
        hide-details
        clearable
      />
    </header>

    <div class="drawer__tabs" role="tablist">
      <button
        v-for="category in categories"
        :key="category"
        type="button"
        role="tab"
        class="drawer__tab"
        :class="{ 'drawer__tab--active': activeCategory === category }"
        :aria-selected="activeCategory === category"
        @click="activeCategory = category"
      >
        {{ category }}
      </button>
    </div>

    <div class="drawer__grid">
      <button
        v-for="entry in results"
        :key="entry.id"
        type="button"
        class="tile"
        draggable="true"
        :title="`${entry.name} — ${footprint(entry)}. Drag onto the plan, or click to drop it in the middle.`"
        @dragstart="onDragStart($event, entry)"
        @click="placeInView(entry)"
      >
        <svg class="tile__preview" :viewBox="previewViewBox(entry)" aria-hidden="true">
          <path
            :d="glyphFor(entry, entry.width, entry.depth).body"
            :fill="entry.color"
            stroke="#6E767B"
            :stroke-width="previewStroke(entry)"
            stroke-linejoin="round"
          />
          <path
            v-for="(path, index) in glyphFor(entry, entry.width, entry.depth).details"
            :key="index"
            :d="path"
            fill="none"
            stroke="#6E767B"
            :stroke-width="previewStroke(entry) * 0.8"
            opacity="0.5"
          />
        </svg>
        <span class="tile__name">{{ entry.name }}</span>
        <span class="tile__size mono">{{ footprint(entry) }}</span>
      </button>

      <p v-if="results.length === 0" class="drawer__empty">
        Nothing matches “{{ search }}”. Drop in a plain box and set its size in the inspector.
      </p>
    </div>
  </section>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--ink-raised);
  border-right: 1px solid var(--ink-line);
}

.drawer__head {
  padding: 10px 10px 8px;
}

.drawer__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 0 10px 8px;
}

.drawer__tab {
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chalk-faint);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}

.drawer__tab:hover {
  color: var(--chalk);
  background: rgba(255, 255, 255, 0.05);
}

.drawer__tab--active {
  color: var(--ink);
  background: var(--blueprint-bright);
}

.drawer__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 0 10px 12px;
  overflow-y: auto;
  min-height: 0;
}

.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 9px 6px 8px;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius-sm);
  background: var(--ink);
  color: var(--chalk);
  cursor: grab;
  text-align: center;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.tile:hover {
  border-color: var(--blueprint);
  background: var(--ink-sunken);
}

.tile:active {
  cursor: grabbing;
}

.tile__preview {
  width: 44px;
  height: 44px;
  flex: none;
}

.tile__name {
  font-size: 11px;
  line-height: 1.25;
}

.tile__size {
  font-size: 9.5px;
  color: var(--chalk-faint);
}

.drawer__empty {
  grid-column: 1 / -1;
  margin: 12px 2px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--chalk-faint);
}
</style>
