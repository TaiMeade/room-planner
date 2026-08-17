<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'

import PlanCanvas from '@/components/canvas/PlanCanvas.vue'
import ExportDialog from '@/components/panels/ExportDialog.vue'
import FurnitureDrawer from '@/components/panels/FurnitureDrawer.vue'
import InspectorPanel from '@/components/panels/InspectorPanel.vue'
import OpeningPicker from '@/components/panels/OpeningPicker.vue'
import StatusBar from '@/components/panels/StatusBar.vue'
import StorageNotice from '@/components/panels/StorageNotice.vue'
import ToolRail from '@/components/panels/ToolRail.vue'
import TopBar from '@/components/panels/TopBar.vue'
import { useAutosave } from '@/composables/useAutosave'
import { deleteSelection, duplicateFurniture, nudgeSelection } from '@/lib/edits'
import { exportJson } from '@/lib/export'
import { PlanParseError, parsePlanJson } from '@/lib/schema'
import { useEditorStore } from '@/stores/editor'
import { usePlanStore } from '@/stores/plan'
import type { Tool } from '@/stores/editor'

/**
 * The application shell, and the keyboard layer.
 *
 * Shortcuts live here rather than on the canvas because they have to work while
 * focus is anywhere that isn't a text field — someone typing a wall length in
 * the inspector should get an ordinary `w`, not the wall tool.
 */

/**
 * Three.js and TresJS are the largest dependency in the app by a wide margin,
 * and most sessions never open the 3D view — 2D correctness is the product.
 * Loading it on first use keeps that cost off everyone who only ever draws.
 */
const SceneView = defineAsyncComponent(() => import('@/components/three/SceneView.vue'))

const planStore = usePlanStore()
const editor = useEditorStore()
const autosave = useAutosave()

const canvas = ref<InstanceType<typeof PlanCanvas> | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const exportOpen = ref(false)

const toast = ref<{ text: string; tone: 'info' | 'warn' | 'error' } | null>(null)
let toastTimer: number | null = null

function notify(text: string, tone: 'info' | 'warn' | 'error' = 'info'): void {
  toast.value = { text, tone }
  if (toastTimer !== null) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), tone === 'info' ? 3600 : 7000)
}

/** Rough measure of how much work is at stake, used to time the storage nag. */
const planWeight = computed(
  () =>
    Object.keys(planStore.plan.walls).length + Object.keys(planStore.plan.furniture).length,
)

// --- file in and out --------------------------------------------------------

function pickFile(): void {
  fileInput.value?.click()
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    const { plan, warnings } = parsePlanJson(await file.text())
    planStore.loadPlan(plan, 'open plan')
    autosave.markExported()
    requestAnimationFrame(() => canvas.value?.fitToPlan())
    if (warnings.length > 0) {
      notify(`Opened with ${warnings.length} issue${warnings.length === 1 ? '' : 's'}: ${warnings[0]}`, 'warn')
    } else {
      notify(`Opened ${plan.meta.name}.`)
    }
  } catch (error) {
    notify(
      error instanceof PlanParseError ? error.message : 'That file could not be opened.',
      'error',
    )
  }
}

async function quickExportJson(): Promise<void> {
  try {
    await exportJson(planStore.plan)
    autosave.markExported()
    notify('Exported. That file is now the copy you own.')
  } catch {
    notify('The export did not finish.', 'error')
  }
}

function newPlan(): void {
  planStore.newBlankPlan()
  editor.clearSelection()
  notify('New plan. Press W to draw a wall, or R to drag out a room.')
}

function loadSample(): void {
  planStore.loadSample()
  editor.clearSelection()
  requestAnimationFrame(() => canvas.value?.fitToPlan())
}

async function forgetStorage(): Promise<void> {
  await autosave.forget()
  notify('Cleared this browser\'s copy. The plan on screen is untouched.')
}

// --- keyboard ---------------------------------------------------------------

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'pan',
  w: 'wall',
  r: 'room',
  d: 'opening',
  m: 'measure',
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true
  )
}

function nudge(event: KeyboardEvent): boolean {
  const deltas: Record<string, { x: number; y: number }> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
  }
  const direction = deltas[event.key]
  if (!direction || !editor.hasSelection) return false

  const step = event.shiftKey ? 10 : editor.snapEnabled ? editor.gridStep : 10
  const command = nudgeSelection(planStore.plan, editor.selection, {
    x: direction.x * step,
    y: direction.y * step,
  })
  if (command) planStore.execute(command)
  return true
}

function onKeyDown(event: KeyboardEvent): void {
  if (isTypingTarget(event.target)) return

  const modifier = event.ctrlKey || event.metaKey

  if (modifier) {
    const key = event.key.toLowerCase()
    if (key === 'z') {
      event.preventDefault()
      if (event.shiftKey) planStore.redo()
      else planStore.undo()
      return
    }
    if (key === 'y') {
      event.preventDefault()
      planStore.redo()
      return
    }
    if (key === 's') {
      event.preventDefault()
      void quickExportJson()
      return
    }
    if (key === 'e') {
      event.preventDefault()
      exportOpen.value = true
      return
    }
    if (key === 'o') {
      event.preventDefault()
      pickFile()
      return
    }
    if (key === 'd') {
      event.preventDefault()
      const result = duplicateFurniture(planStore.plan, editor.selection, {
        x: editor.gridStep * 2,
        y: editor.gridStep * 2,
      })
      if (result) {
        planStore.execute(result.command)
        editor.selectMany(result.ids.map((id) => ({ kind: 'furniture' as const, id })))
      }
      return
    }
    if (key === 'a') {
      event.preventDefault()
      editor.selectMany([
        ...Object.keys(planStore.plan.walls).map((id) => ({ kind: 'wall' as const, id })),
        ...Object.keys(planStore.plan.furniture).map((id) => ({ kind: 'furniture' as const, id })),
      ])
      return
    }
    return
  }

  if (event.key === '2' || event.key === '3') {
    event.preventDefault()
    editor.setViewMode(event.key === '2' ? '2d' : '3d')
    return
  }

  // The 3D view is read-only, so the editing keys have nothing to act on. They
  // are swallowed rather than left to silently change the tool or the selection
  // behind a view that can't show it.
  if (editor.viewMode === '3d') return

  if (event.altKey) {
    editor.snapOverride = true
    return
  }

  // Space-to-pan. Held rather than toggled, and swallowed so it doesn't also
  // scroll the page or activate whatever button was last focused.
  if (event.key === ' ') {
    event.preventDefault()
    editor.spaceHeld = true
    return
  }

  if (nudge(event)) {
    event.preventDefault()
    return
  }

  const tool = TOOL_KEYS[event.key.toLowerCase()]
  if (tool) {
    event.preventDefault()
    editor.setTool(tool)
    return
  }

  if (event.key === 'f') {
    event.preventDefault()
    canvas.value?.fitToPlan()
    return
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    const command = deleteSelection(planStore.plan, editor.selection)
    if (command) {
      planStore.execute(command)
      editor.clearSelection()
    }
    return
  }

  if (event.key === 'Escape') {
    editor.draftWall = null
    editor.measurement = null
    editor.clearSelection()
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key === 'Alt') editor.snapOverride = false
  if (event.key === ' ') editor.spaceHeld = false
}

/**
 * A key can be held while the window loses focus, in which case its keyup
 * never arrives and the canvas is left stuck in pan mode. Clear on blur.
 */
function onWindowBlur(): void {
  editor.spaceHeld = false
  editor.snapOverride = false
}

// --- lifecycle --------------------------------------------------------------

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onWindowBlur)

  const { restored, warnings } = await autosave.restore()
  if (restored) {
    requestAnimationFrame(() => canvas.value?.fitToPlan())
    notify('Picked up where you left off, from this browser\'s copy.')
    if (warnings.length > 0) notify(warnings[0]!, 'warn')
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onWindowBlur)
  if (toastTimer !== null) window.clearTimeout(toastTimer)
})
</script>

<template>
  <v-app>
    <div class="shell">
      <TopBar
        @export="exportOpen = true"
        @open="pickFile"
        @new="newPlan"
        @sample="loadSample"
        @clear-storage="forgetStorage"
      />

      <div class="shell__body">
        <ToolRail />
        <FurnitureDrawer class="shell__drawer" />

        <main class="shell__canvas">
          <!-- The 2D canvas stays mounted behind the 3D view: it owns the
               viewport and the ResizeObserver, and remounting it would throw
               away the user's pan and zoom every time they glance at 3D. -->
          <div v-show="editor.viewMode === '2d'" class="shell__view">
            <PlanCanvas ref="canvas" />
          </div>
          <SceneView v-if="editor.viewMode === '3d'" class="shell__view" />
          <OpeningPicker v-if="editor.viewMode === '2d'" />
          <StorageNotice
            :has-unexported-work="autosave.hasUnexportedWork.value"
            :storage-available="autosave.available.value"
            :storage-failed="autosave.failed.value"
            :last-saved-at="autosave.lastSavedAt.value"
            :weight="planWeight"
            @export="quickExportJson"
          />
          <transition name="toast">
            <div v-if="toast" class="toast" :class="`toast--${toast.tone}`" role="status">
              {{ toast.text }}
            </div>
          </transition>
        </main>

        <InspectorPanel />
      </div>

      <StatusBar @fit="canvas?.fitToPlan()" />
    </div>

    <ExportDialog v-model="exportOpen" @exported="autosave.markExported()" />

    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="hidden-input"
      @change="onFileChosen"
    />
  </v-app>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--ink);
}

.shell__body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.shell__drawer {
  width: 232px;
  flex: none;
}

.shell__canvas {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.shell__view {
  position: absolute;
  inset: 0;
}

/* Below a laptop width the drawer is the first thing to go — the canvas and the
   inspector are both load-bearing, and furniture can still be placed by search
   once the drawer is back. */
@media (max-width: 1180px) {
  .shell__drawer {
    display: none;
  }
}

@media (max-width: 900px) {
  .shell__body :deep(.inspector) {
    width: 250px;
  }
}

.toast {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 5;
  max-width: 380px;
  padding: 9px 12px;
  border: 1px solid var(--ink-line);
  border-left: 3px solid var(--blueprint-bright);
  border-radius: var(--radius);
  background: var(--ink-raised);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
  font-size: 12px;
  line-height: 1.45;
  color: var(--chalk);
}

.toast--warn {
  border-left-color: var(--amber-bright);
}

.toast--error {
  border-left-color: var(--danger);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.hidden-input {
  display: none;
}
</style>
