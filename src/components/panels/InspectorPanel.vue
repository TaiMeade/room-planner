<script setup lang="ts">
import { mdiDelete, mdiFlipHorizontal, mdiLock, mdiLockOpenVariant, mdiSwapHorizontal } from '@mdi/js'
import { computed } from 'vue'

import AngleField from '@/components/inputs/AngleField.vue'
import LengthField from '@/components/inputs/LengthField.vue'
import { moveNodes, updateFurniture, updateOpening, updateWall } from '@/lib/commands'
import { deleteSelection } from '@/lib/edits'
import { add, angleOf, normalizeDegrees, scale, toDegrees, toRadians } from '@/lib/geometry'
import { formatArea, formatLength } from '@/lib/units'
import { clampOpening } from '@/lib/wallGeometry'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'
import type { OpeningKind } from '@/types/plan'

/**
 * The property inspector.
 *
 * The half of the product that isn't the canvas. Dragging gets you close;
 * typing gets you right, and "does the couch fit" is a question about the
 * second one. Every geometric value on screen is editable here, and edits go
 * through the same command stack as canvas gestures, so a typed change undoes
 * exactly like a dragged one.
 */

const editor = useEditorStore()
const planStore = usePlanStore()

const selection = computed(() => editor.selection)
const single = computed(() => editor.singleSelection)

const selectedWall = computed(() => {
  const entry = single.value
  if (entry?.kind !== 'wall') return null
  const wall = planStore.plan.walls[entry.id]
  const outline = planStore.geometry.wallsById.get(entry.id)
  return wall && outline ? { wall, outline } : null
})

const selectedOpening = computed(() => {
  const entry = single.value
  if (entry?.kind !== 'opening') return null
  const opening = planStore.plan.openings[entry.id]
  const outline = opening && planStore.geometry.wallsById.get(opening.wall)
  return opening && outline ? { opening, outline } : null
})

const selectedItem = computed(() => {
  const entry = single.value
  return entry?.kind === 'furniture' ? (planStore.plan.furniture[entry.id] ?? null) : null
})

const selectedNode = computed(() => {
  const entry = single.value
  return entry?.kind === 'node' ? (planStore.plan.nodes[entry.id] ?? null) : null
})

// --- wall -------------------------------------------------------------------

const wallAngle = computed(() => {
  const current = selectedWall.value
  if (!current) return 0
  // Report the angle the way people talk about it: counter-clockwise from east.
  return -normalizeDegrees(toDegrees(angleOf(current.outline.direction)))
})

/**
 * Resizing a wall moves its end node along the existing heading, which keeps
 * the corner it starts from — and everything joined there — exactly where it is.
 */
function setWallLength(length: number): void {
  const current = selectedWall.value
  if (!current) return
  const end = planStore.plan.nodes[current.wall.end]
  if (!end) return
  const target = add(current.outline.start, scale(current.outline.direction, Math.max(1, length)))
  planStore.execute(
    moveNodes([{ id: end.id, from: { x: end.x, y: end.y }, to: target }], 'resize wall'),
  )
}

function setWallAngle(degrees: number): void {
  const current = selectedWall.value
  if (!current) return
  const end = planStore.plan.nodes[current.wall.end]
  if (!end) return
  const radians = toRadians(-degrees)
  const target = add(current.outline.start, {
    x: Math.cos(radians) * current.outline.centrelineLength,
    y: Math.sin(radians) * current.outline.centrelineLength,
  })
  planStore.execute(
    moveNodes([{ id: end.id, from: { x: end.x, y: end.y }, to: target }], 'rotate wall'),
  )
}

function setWallThickness(thickness: number): void {
  const current = selectedWall.value
  if (!current) return
  planStore.execute(
    updateWall(planStore.plan, current.wall.id, { thickness: Math.max(10, thickness) }),
  )
}

function setWallHeight(height: number): void {
  const current = selectedWall.value
  if (!current) return
  planStore.execute(
    updateWall(planStore.plan, current.wall.id, { height: Math.max(100, height) }),
  )
}

/** Flip which end counts as the start — this is the direction door swings measure from. */
function reverseWall(): void {
  const current = selectedWall.value
  if (!current) return
  const { wall, outline } = current
  const length = outline.centrelineLength
  planStore.execute({
    label: 'reverse wall',
    apply(plan) {
      const target = plan.walls[wall.id]
      if (!target) return
      const { start, end } = target
      target.start = end
      target.end = start
      // Openings are measured from the start node, so they have to be mirrored
      // or every door on this wall would jump to the other end.
      for (const opening of Object.values(plan.openings)) {
        if (opening.wall === wall.id) opening.distance = length - opening.distance
      }
    },
    revert(plan) {
      const target = plan.walls[wall.id]
      if (!target) return
      const { start, end } = target
      target.start = end
      target.end = start
      for (const opening of Object.values(plan.openings)) {
        if (opening.wall === wall.id) opening.distance = length - opening.distance
      }
    },
  })
}

// --- opening ----------------------------------------------------------------

const OPENING_KINDS: { value: OpeningKind; title: string }[] = [
  { value: 'door', title: 'Door' },
  { value: 'double-door', title: 'Double door' },
  { value: 'sliding-door', title: 'Sliding door' },
  { value: 'opening', title: 'Cased opening' },
  { value: 'window', title: 'Window' },
]

function patchOpening(fields: Parameters<typeof updateOpening>[2], label?: string): void {
  const current = selectedOpening.value
  if (!current) return
  planStore.execute(updateOpening(planStore.plan, current.opening.id, fields, label))
}

function setOpeningWidth(width: number): void {
  const current = selectedOpening.value
  if (!current) return
  const clamped = Math.max(100, width)
  planStore.execute(
    updateOpening(
      planStore.plan,
      current.opening.id,
      {
        width: clamped,
        // Keep it on the wall as it grows rather than letting it overhang.
        distance: clampOpening(current.outline, current.opening.distance, clamped),
      },
      'resize opening',
    ),
  )
}

function setOpeningDistance(distance: number): void {
  const current = selectedOpening.value
  if (!current) return
  patchOpening(
    { distance: clampOpening(current.outline, distance, current.opening.width) },
    'move opening',
  )
}

/** Distance from the far end, which is often the measurement someone actually has. */
const openingFromEnd = computed(() => {
  const current = selectedOpening.value
  if (!current) return 0
  return current.outline.centrelineLength - current.opening.distance
})

// --- furniture --------------------------------------------------------------

function patchItem(fields: Parameters<typeof updateFurniture>[2], label?: string): void {
  const item = selectedItem.value
  if (!item) return
  planStore.execute(updateFurniture(planStore.plan, item.id, fields, label))
}

const itemRotation = computed({
  get: () => Math.round(normalizeDegrees(toDegrees(selectedItem.value?.rotation ?? 0))),
  set: (degrees: number) => patchItem({ rotation: toRadians(degrees) }, 'rotate item'),
})

function nudgeRotation(degrees: number): void {
  const item = selectedItem.value
  if (!item) return
  patchItem({ rotation: item.rotation + toRadians(degrees) }, 'rotate item')
}

// --- node -------------------------------------------------------------------

function moveNode(axis: 'x' | 'y', value: number): void {
  const node = selectedNode.value
  if (!node) return
  planStore.execute(
    moveNodes(
      [
        {
          id: node.id,
          from: { x: node.x, y: node.y },
          to: { x: axis === 'x' ? value : node.x, y: axis === 'y' ? value : node.y },
        },
      ],
      'move corner',
    ),
  )
}

/** Corners are shared, so it helps to know how much a drag will take with it. */
const nodeWallCount = computed(() => {
  const node = selectedNode.value
  if (!node) return 0
  return Object.values(planStore.plan.walls).filter(
    (wall) => wall.start === node.id || wall.end === node.id,
  ).length
})

// --- shared -----------------------------------------------------------------

function removeSelection(): void {
  const command = deleteSelection(planStore.plan, selection.value)
  if (!command) return
  planStore.execute(command)
  editor.clearSelection()
}

const summary = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of selection.value) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1)
  return [...counts.entries()]
    .map(([kind, count]) => `${count} ${count === 1 ? kind : `${kind}s`}`)
    .join(', ')
})

/** Centre-to-centre spans of the selection, so a multi-select still reports something useful. */
const multiExtent = computed(() => {
  const points = selection.value
    .flatMap((entry) => {
      if (entry.kind === 'furniture') {
        const item = planStore.plan.furniture[entry.id]
        return item ? [{ x: item.x, y: item.y }] : []
      }
      if (entry.kind === 'node') {
        const node = planStore.plan.nodes[entry.id]
        return node ? [{ x: node.x, y: node.y }] : []
      }
      if (entry.kind === 'wall') {
        const outline = planStore.geometry.wallsById.get(entry.id)
        return outline ? [outline.start, outline.end] : []
      }
      return []
    })
    .filter(Boolean)

  if (points.length < 2) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
})

const totalArea = computed(() => formatArea(planStore.floorArea, planStore.units))
const wallCount = computed(() => Object.keys(planStore.plan.walls).length)
const itemCount = computed(() => Object.keys(planStore.plan.furniture).length)
</script>

<template>
  <aside class="inspector" aria-label="Properties">
    <!-- Nothing selected: the plan itself -->
    <template v-if="selection.length === 0">
      <section class="block">
        <h2 class="eyebrow">Plan</h2>
        <v-text-field
          :model-value="planStore.plan.meta.name"
          label="Name"
          class="mt-2"
          @update:model-value="planStore.plan.meta.name = $event"
        />
        <div class="stats mt-3">
          <div class="stat">
            <span class="stat__label">Enclosed area</span>
            <span class="stat__value mono">{{ totalArea }}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Rooms</span>
            <span class="stat__value mono">{{ planStore.rooms.length }}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Walls</span>
            <span class="stat__value mono">{{ wallCount }}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Items</span>
            <span class="stat__value mono">{{ itemCount }}</span>
          </div>
        </div>
      </section>

      <v-divider />

      <section class="block">
        <h2 class="eyebrow">New wall defaults</h2>
        <div class="pair mt-2">
          <LengthField
            :model-value="planStore.settings.defaultWallThickness"
            label="Thickness"
            :min="10"
            @update:model-value="planStore.updateSettings({ defaultWallThickness: $event })"
          />
          <LengthField
            :model-value="planStore.settings.defaultWallHeight"
            label="Height"
            :min="100"
            @update:model-value="planStore.updateSettings({ defaultWallHeight: $event })"
          />
        </div>
      </section>

      <v-divider />

      <section class="block">
        <h2 class="eyebrow">Drawing aids</h2>
        <div class="toggles mt-2">
          <v-switch
            :model-value="planStore.settings.showGrid"
            label="Grid"
            @update:model-value="planStore.updateSettings({ showGrid: Boolean($event) })"
          />
          <v-switch
            :model-value="planStore.settings.showDimensions"
            label="Dimension strings"
            @update:model-value="planStore.updateSettings({ showDimensions: Boolean($event) })"
          />
          <v-switch
            :model-value="planStore.settings.showAreas"
            label="Room areas"
            @update:model-value="planStore.updateSettings({ showAreas: Boolean($event) })"
          />
        </div>
        <v-select
          :model-value="planStore.settings.angleSnap"
          :items="[
            { title: 'Off', value: 0 },
            { title: 'Every 15°', value: 15 },
            { title: 'Every 45°', value: 45 },
            { title: 'Right angles only', value: 90 },
          ]"
          label="Angle snap"
          class="mt-3"
          @update:model-value="planStore.updateSettings({ angleSnap: Number($event) })"
        />
      </section>

      <div class="hint">
        <p>Select something on the plan to edit it, or press <kbd>W</kbd> to draw a wall.</p>
        <p>
          Drag with the right button to move around, or hold <kbd>Space</kbd>. Scroll to zoom,
          <kbd>F</kbd> to fit the plan.
        </p>
      </div>
    </template>

    <!-- Wall -->
    <template v-else-if="selectedWall">
      <section class="block">
        <h2 class="eyebrow">Wall</h2>
        <div class="pair mt-2">
          <LengthField
            :model-value="selectedWall.outline.centrelineLength"
            label="Length"
            :min="10"
            @update:model-value="setWallLength"
          />
          <AngleField :model-value="wallAngle" label="Angle°" @update:model-value="setWallAngle" />
        </div>
        <div class="pair mt-2">
          <LengthField
            :model-value="selectedWall.wall.thickness"
            label="Thickness"
            :min="10"
            @update:model-value="setWallThickness"
          />
          <LengthField
            :model-value="selectedWall.wall.height"
            label="Height"
            :min="100"
            @update:model-value="setWallHeight"
          />
        </div>
        <p class="note">
          Length is measured along the centreline, corner to corner. Dragging a corner moves every
          wall that shares it.
        </p>
        <div class="actions mt-2">
          <v-btn size="small" :prepend-icon="mdiSwapHorizontal" @click="reverseWall">
            Reverse direction
          </v-btn>
        </div>
      </section>
    </template>

    <!-- Opening -->
    <template v-else-if="selectedOpening">
      <section class="block">
        <h2 class="eyebrow">{{ selectedOpening.opening.kind.replace('-', ' ') }}</h2>
        <v-select
          :model-value="selectedOpening.opening.kind"
          :items="OPENING_KINDS"
          label="Type"
          class="mt-2"
          @update:model-value="patchOpening({ kind: $event as OpeningKind }, 'change opening')"
        />
        <div class="pair mt-2">
          <LengthField
            :model-value="selectedOpening.opening.width"
            label="Width"
            :min="100"
            @update:model-value="setOpeningWidth"
          />
          <LengthField
            :model-value="selectedOpening.opening.height"
            label="Height"
            :min="100"
            @update:model-value="patchOpening({ height: Math.max(100, $event) })"
          />
        </div>
        <div class="pair mt-2">
          <LengthField
            :model-value="selectedOpening.opening.distance"
            label="From start"
            :min="0"
            @update:model-value="setOpeningDistance"
          />
          <LengthField
            :model-value="openingFromEnd"
            label="From end"
            :min="0"
            @update:model-value="
              setOpeningDistance(selectedOpening.outline.centrelineLength - $event)
            "
          />
        </div>
        <LengthField
          v-if="selectedOpening.opening.kind === 'window'"
          :model-value="selectedOpening.opening.sillHeight"
          label="Sill height"
          :min="0"
          class="mt-2"
          @update:model-value="patchOpening({ sillHeight: Math.max(0, $event) })"
        />

        <p v-if="selectedOpening.opening.width > selectedOpening.outline.centrelineLength" class="note note--warn">
          This opening is wider than its wall. It is drawn in red until it fits.
        </p>

        <div class="actions mt-3">
          <v-btn
            size="small"
            :prepend-icon="mdiFlipHorizontal"
            @click="patchOpening({ flipFace: !selectedOpening!.opening.flipFace }, 'flip opening')"
          >
            Flip side
          </v-btn>
          <v-btn
            v-if="selectedOpening.opening.kind === 'door'"
            size="small"
            :prepend-icon="mdiSwapHorizontal"
            @click="patchOpening({ flipHinge: !selectedOpening!.opening.flipHinge }, 'flip hinge')"
          >
            Swap hinge
          </v-btn>
        </div>
      </section>
    </template>

    <!-- Furniture -->
    <template v-else-if="selectedItem">
      <section class="block">
        <h2 class="eyebrow">Item</h2>
        <v-text-field
          :model-value="selectedItem.label"
          label="Label"
          class="mt-2"
          @update:model-value="patchItem({ label: String($event) }, 'rename item')"
        />
        <div class="pair mt-2">
          <LengthField
            :model-value="selectedItem.width"
            label="Width"
            :min="10"
            @update:model-value="patchItem({ width: Math.max(10, $event) }, 'resize item')"
          />
          <LengthField
            :model-value="selectedItem.depth"
            label="Depth"
            :min="10"
            @update:model-value="patchItem({ depth: Math.max(10, $event) }, 'resize item')"
          />
        </div>
        <div class="pair mt-2">
          <LengthField
            :model-value="selectedItem.height"
            label="Height"
            :min="10"
            @update:model-value="patchItem({ height: Math.max(10, $event) }, 'resize item')"
          />
          <AngleField v-model="itemRotation" label="Rotation°" />
        </div>

        <div class="actions mt-2">
          <v-btn size="small" @click="nudgeRotation(-90)">−90°</v-btn>
          <v-btn size="small" @click="nudgeRotation(90)">+90°</v-btn>
          <v-btn
            size="small"
            :prepend-icon="selectedItem.locked ? mdiLock : mdiLockOpenVariant"
            @click="patchItem({ locked: !selectedItem!.locked }, selectedItem!.locked ? 'unlock' : 'lock')"
          >
            {{ selectedItem.locked ? 'Locked' : 'Lock' }}
          </v-btn>
        </div>

        <v-divider class="my-3" />

        <h3 class="eyebrow">Position</h3>
        <div class="pair mt-2">
          <LengthField
            :model-value="selectedItem.x"
            label="X"
            @update:model-value="patchItem({ x: $event }, 'move item')"
          />
          <LengthField
            :model-value="selectedItem.y"
            label="Y"
            @update:model-value="patchItem({ y: $event }, 'move item')"
          />
        </div>
      </section>
    </template>

    <!-- Corner -->
    <template v-else-if="selectedNode">
      <section class="block">
        <h2 class="eyebrow">Corner</h2>
        <div class="pair mt-2">
          <LengthField
            :model-value="selectedNode.x"
            label="X"
            @update:model-value="moveNode('x', $event)"
          />
          <LengthField
            :model-value="selectedNode.y"
            label="Y"
            @update:model-value="moveNode('y', $event)"
          />
        </div>
        <p class="note">
          {{ nodeWallCount }} {{ nodeWallCount === 1 ? 'wall meets' : 'walls meet' }} here. Moving
          this corner moves {{ nodeWallCount === 1 ? 'that wall' : 'all of them' }}.
        </p>
      </section>
    </template>

    <!-- Several things -->
    <template v-else>
      <section class="block">
        <h2 class="eyebrow">Selection</h2>
        <p class="summary mt-2">{{ summary }}</p>
        <div v-if="multiExtent" class="stats mt-3">
          <div class="stat">
            <span class="stat__label">Spans</span>
            <span class="stat__value mono">{{ formatLength(multiExtent.width, planStore.units) }}</span>
          </div>
          <div class="stat">
            <span class="stat__label">By</span>
            <span class="stat__value mono">{{ formatLength(multiExtent.height, planStore.units) }}</span>
          </div>
        </div>
        <p class="note">
          Arrow keys nudge by one grid step. Hold Shift for a fine nudge.
        </p>
      </section>
    </template>

    <div v-if="selection.length > 0" class="footer">
      <v-btn
        block
        variant="tonal"
        color="error"
        size="small"
        :prepend-icon="mdiDelete"
        @click="removeSelection"
      >
        Delete {{ selection.length > 1 ? `${selection.length} items` : '' }}
      </v-btn>
    </div>
  </aside>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  width: var(--inspector);
  height: 100%;
  overflow-y: auto;
  background: var(--ink-raised);
  border-left: 1px solid var(--ink-line);
}

.block {
  padding: 14px 14px 16px;
}

.block + .block {
  padding-top: 14px;
}

.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.toggles {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--ink-line);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  background: var(--ink-raised);
}

.stat__label {
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--chalk-faint);
}

.stat__value {
  font-size: 14px;
  color: var(--chalk);
}

.summary {
  font-size: 13px;
  color: var(--chalk);
  text-transform: capitalize;
}

.note {
  margin: 10px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--chalk-faint);
}

.note--warn {
  color: var(--amber-bright);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.hint {
  margin-top: auto;
  padding: 14px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--chalk-faint);
  border-top: 1px solid var(--ink-line);
}

.hint p {
  margin: 0;
}

.hint p + p {
  margin-top: 8px;
}

.hint kbd {
  padding: 1px 5px;
  border: 1px solid var(--ink-line);
  border-radius: 3px;
  background: var(--ink);
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--chalk-dim);
}

.footer {
  margin-top: auto;
  padding: 12px 14px;
  border-top: 1px solid var(--ink-line);
}

.mt-2 {
  margin-top: 8px;
}
.mt-3 {
  margin-top: 12px;
}
.my-3 {
  margin: 12px 0;
}
</style>
