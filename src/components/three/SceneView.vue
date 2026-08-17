<script setup lang="ts">
import { OrbitControls } from '@tresjs/cientos'
import { TresCanvas } from '@tresjs/core'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'

import { useWalkControls } from '@/composables/useWalkControls'
import { buildSceneModel, findWalkStart } from '@/lib/three/buildScene'
import { buildSceneGroup } from '@/lib/three/sceneGroup'
import type { BuiltScene } from '@/lib/three/sceneGroup'
import { usePlanStore } from '@/stores/plan'

/**
 * The 3D walkthrough.
 *
 * A viewing mode, not a second editor. Everything here is derived from the same
 * plan the 2D canvas draws, re-derived whenever it changes, and there is no way
 * back into the document from this component. That constraint is what keeps the
 * feature finishable — the moment 3D can edit, two editors have to agree, and
 * agreeing is where projects like this stop shipping.
 */

const planStore = usePlanStore()

const surface = ref<HTMLElement | null>(null)
const cameraRef = shallowRef<PerspectiveCamera | null>(null)
const mode = ref<'orbit' | 'walk'>('orbit')

const walk = useWalkControls(() => cameraRef.value)

const model = computed(() => buildSceneModel(planStore.plan, planStore.geometry))

// The scene is rebuilt on every change, so the previous one has to be released
// explicitly — three does not garbage-collect GPU resources.
const built = shallowRef<BuiltScene | null>(null)

watch(
  model,
  (next) => {
    // Build and swap first, release afterwards. Disposing the outgoing group up
    // front frees GPU buffers the scene graph is still pointing at, and any
    // frame drawn in that gap renders from freed memory.
    const previous = built.value
    built.value = buildSceneGroup(next)
    if (previous) void nextTick(() => previous.dispose())
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  built.value?.dispose()
  built.value = null
})

/** Framed on the plan, looking down at it from one corner. */
const orbitCamera = computed(() => {
  const { centre, radius, wallHeight } = model.value
  const reach = Math.max(radius * 2.1, 3000)
  return {
    position: new Vector3(
      centre.x + reach * 0.62,
      wallHeight + reach * 0.72,
      centre.y + reach * 0.85,
    ),
    target: new Vector3(centre.x, wallHeight * 0.35, centre.y),
    far: Math.max(reach * 12, 60_000),
  }
})

/** Light directions. Constant, so they are built once rather than every render. */
const KEY_LIGHT = new Vector3(1, 2.2, 1.4)
const FILL_LIGHT = new Vector3(-1.4, 1.1, -1)

const hasSomethingToShow = computed(
  () => model.value.walls.length > 0 || model.value.furniture.length > 0,
)

function enterWalk(): void {
  const { at, heading } = findWalkStart(model.value)
  mode.value = 'walk'
  // A little downward tilt, because standing at eye level with a level gaze
  // puts every piece of furniture below the frame.
  if (surface.value) walk.start(surface.value, at, heading, -0.16)
}

function leaveWalk(): void {
  walk.stop()
  mode.value = 'orbit'
}

function onSurfaceClick(): void {
  if (mode.value === 'walk' && !walk.locked.value) walk.requestLock()
}

function onEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && mode.value === 'walk') leaveWalk()
}

watch(mode, (value) => {
  if (value === 'walk') window.addEventListener('keydown', onEscape)
  else window.removeEventListener('keydown', onEscape)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onEscape))
</script>

<template>
  <div ref="surface" class="scene" @click="onSurfaceClick">
    <!-- Sized to this panel, not the window: the inspector and rails take a
         third of the screen, and a window-sized canvas renders all of it. -->
    <TresCanvas clear-color="#1B2327" :alpha="false">
      <TresPerspectiveCamera
        ref="cameraRef"
        :position="orbitCamera.position"
        :fov="55"
        :near="20"
        :far="orbitCamera.far"
      />
      <OrbitControls
        v-if="mode === 'orbit'"
        :target="orbitCamera.target"
        :enable-damping="true"
        :max-polar-angle="1.52"
        :min-distance="600"
        :max-distance="orbitCamera.far / 3"
      />

      <!-- Flat, even light. A drafting model wants to be legible, not moody. -->
      <TresAmbientLight :intensity="1.7" />
      <TresDirectionalLight :position="KEY_LIGHT" :intensity="2.1" />
      <TresDirectionalLight :position="FILL_LIGHT" :intensity="0.85" />

      <primitive v-if="built" :object="built.group" />
    </TresCanvas>

    <div class="scene__controls">
      <button
        type="button"
        class="scene__mode"
        :class="{ 'scene__mode--on': mode === 'orbit' }"
        @click.stop="leaveWalk"
      >
        Orbit
      </button>
      <button
        type="button"
        class="scene__mode"
        :class="{ 'scene__mode--on': mode === 'walk' }"
        @click.stop="enterWalk"
      >
        Walk
      </button>
    </div>

    <p v-if="mode === 'walk'" class="scene__hint">
      <template v-if="walk.locked.value">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move · mouse to look ·
        <kbd>Shift</kbd> to hurry · <kbd>Esc</kbd> to stop
      </template>
      <template v-else>Click the view to look around</template>
    </p>

    <p v-if="!hasSomethingToShow" class="scene__empty">
      Nothing to walk through yet. Draw some walls in the 2D view and they'll appear here.
    </p>

    <p class="scene__derived">Derived from the plan — edit in 2D</p>
  </div>
</template>

<style scoped>
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--ink);
}

.scene :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.scene__controls {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: rgba(27, 35, 39, 0.92);
}

.scene__mode {
  padding: 4px 14px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chalk-dim);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}

.scene__mode:hover {
  color: var(--chalk);
  background: rgba(255, 255, 255, 0.06);
}

.scene__mode--on {
  color: var(--ink);
  background: var(--blueprint-bright);
}

.scene__hint,
.scene__empty {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 7px 12px;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: rgba(27, 35, 39, 0.92);
  font-size: 11.5px;
  color: var(--chalk-dim);
  white-space: nowrap;
}

.scene__hint {
  bottom: 14px;
}

.scene__empty {
  top: 50%;
  white-space: normal;
  max-width: 320px;
  text-align: center;
  line-height: 1.5;
}

.scene__hint kbd {
  display: inline-block;
  margin: 0 1px;
  padding: 1px 5px;
  border: 1px solid var(--ink-line);
  border-radius: 3px;
  background: var(--ink);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--chalk);
}

.scene__derived {
  position: absolute;
  top: 14px;
  right: 14px;
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--chalk-faint);
}
</style>
