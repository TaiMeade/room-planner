<script setup lang="ts">
import {
  mdiDotsVertical,
  mdiFileOutline,
  mdiFolderOpenOutline,
  mdiRedo,
  mdiTrayArrowDown,
  mdiUndo,
} from '@mdi/js'
import { computed } from 'vue'

import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'
import type { UnitSystem } from '@/types/plan'

/**
 * The top bar: what plan this is, what you just did, and how to get it out.
 *
 * Export sits on the right in the primary colour and never moves. It is the
 * promise the product is built on — a plan leaves as a file, free, without an
 * account — so it should be the most findable control on the screen.
 */

const emit = defineEmits<{
  export: []
  open: []
  new: []
  sample: []
  clearStorage: []
}>()

const planStore = usePlanStore()
const editor = useEditorStore()

const undoTitle = computed(() =>
  planStore.canUndo ? `Undo ${planStore.undoLabel} (Ctrl+Z)` : 'Nothing to undo',
)
const redoTitle = computed(() =>
  planStore.canRedo ? `Redo ${planStore.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo',
)

const units = computed({
  get: () => planStore.units,
  set: (value: UnitSystem) => {
    // Grid steps are unit-specific; carrying 6 inches into metric would leave a
    // 152.4 mm grid, which is nobody's idea of a metric grid.
    planStore.updateSettings({
      units: value,
      gridSize: value === 'imperial' ? 152.4 : 100,
    })
  },
})
</script>

<template>
  <header class="topbar">
    <div class="topbar__brand">
      <svg class="topbar__mark" viewBox="0 0 100 100" aria-hidden="true">
        <path
          d="M22 24h56v52H22z"
          fill="none"
          stroke="currentColor"
          stroke-width="7"
          stroke-linejoin="round"
        />
        <path
          d="M22 52h26V24M48 76V60h30"
          fill="none"
          stroke="currentColor"
          stroke-width="7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="topbar__wordmark">Room Planner</span>
    </div>

    <input
      v-model="planStore.plan.meta.name"
      class="topbar__name"
      aria-label="Plan name"
      placeholder="Untitled plan"
      spellcheck="false"
    />

    <div class="topbar__actions">
      <button
        type="button"
        class="topbar__icon"
        :disabled="!planStore.canUndo"
        :title="undoTitle"
        @click="planStore.undo()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiUndo" fill="currentColor" /></svg>
      </button>
      <button
        type="button"
        class="topbar__icon"
        :disabled="!planStore.canRedo"
        :title="redoTitle"
        @click="planStore.redo()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiRedo" fill="currentColor" /></svg>
      </button>

      <div class="topbar__divider" />

      <div class="units" role="group" aria-label="View">
        <button
          type="button"
          class="units__option"
          :class="{ 'units__option--on': editor.viewMode === '2d' }"
          title="The drawing. Everything is edited here"
          @click="editor.setViewMode('2d')"
        >
          2D
        </button>
        <button
          type="button"
          class="units__option"
          :class="{ 'units__option--on': editor.viewMode === '3d' }"
          title="Walk through the plan. Read-only"
          @click="editor.setViewMode('3d')"
        >
          3D
        </button>
      </div>

      <div class="topbar__divider" />

      <div class="units" role="group" aria-label="Units">
        <button
          type="button"
          class="units__option"
          :class="{ 'units__option--on': units === 'imperial' }"
          @click="units = 'imperial'"
        >
          ft / in
        </button>
        <button
          type="button"
          class="units__option"
          :class="{ 'units__option--on': units === 'metric' }"
          @click="units = 'metric'"
        >
          m / mm
        </button>
      </div>

      <div class="topbar__divider" />

      <v-menu location="bottom end">
        <template #activator="{ props: menu }">
          <button type="button" class="topbar__icon" v-bind="menu" title="Plan menu">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path :d="mdiDotsVertical" fill="currentColor" />
            </svg>
          </button>
        </template>
        <v-list bg-color="surface" width="248">
          <v-list-item :prepend-icon="mdiFileOutline" title="New empty plan" @click="emit('new')" />
          <v-list-item
            :prepend-icon="mdiFolderOpenOutline"
            title="Open a plan file…"
            subtitle="A .json file you exported"
            @click="emit('open')"
          />
          <v-list-item title="Load the sample room" @click="emit('sample')" />
          <v-divider class="my-1" />
          <v-list-item
            title="Clear this browser's copy"
            subtitle="Removes the autosave only"
            @click="emit('clearStorage')"
          />
        </v-list>
      </v-menu>

      <v-btn
        variant="flat"
        color="primary"
        size="small"
        class="topbar__export"
        :prepend-icon="mdiTrayArrowDown"
        @click="emit('export')"
      >
        Export
      </v-btn>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--topbar);
  padding: 0 10px 0 12px;
  background: var(--ink);
  border-bottom: 1px solid var(--ink-line);
}

.topbar__brand {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--blueprint-bright);
  flex: none;
}

.topbar__mark {
  width: 21px;
  height: 21px;
}

.topbar__wordmark {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--chalk);
  white-space: nowrap;
}

/* The plan name is the one editable thing in the bar, so it looks like a field
   on focus and like a title the rest of the time. */
.topbar__name {
  flex: 1 1 auto;
  min-width: 60px;
  max-width: 340px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chalk);
  font: inherit;
  font-size: 12.5px;
}

.topbar__name::placeholder {
  color: var(--chalk-faint);
}

.topbar__name:hover {
  border-color: var(--ink-line);
}

.topbar__name:focus {
  outline: none;
  border-color: var(--blueprint);
  background: var(--ink-sunken);
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.topbar__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chalk-dim);
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}

.topbar__icon:hover:not(:disabled) {
  color: var(--chalk);
  background: rgba(255, 255, 255, 0.06);
}

.topbar__icon:disabled {
  color: var(--chalk-faint);
  opacity: 0.4;
  cursor: default;
}

.topbar__icon svg {
  width: 18px;
  height: 18px;
}

.topbar__divider {
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--ink-line);
}

.units {
  display: flex;
  padding: 2px;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius-sm);
}

.units__option {
  padding: 2px 8px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--chalk-faint);
  font-family: var(--font-mono);
  font-size: 10.5px;
  cursor: pointer;
  white-space: nowrap;
}

.units__option--on {
  background: var(--ink-line);
  color: var(--chalk);
}

.topbar__export {
  margin-left: 4px;
}
</style>
