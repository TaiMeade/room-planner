<script setup lang="ts">
import { useEditorStore } from '@/stores/editor'
import type { OpeningKind } from '@/types/plan'

/**
 * Which opening the next click cuts.
 *
 * Floats over the canvas only while the opening tool is active, rather than
 * living permanently in the inspector — it is a property of what you are about
 * to do, and it disappears the moment that stops being the question.
 */

const editor = useEditorStore()

/** Little plan-view glyphs, so the choice is made by shape rather than by name. */
const kinds: { value: OpeningKind; label: string; glyph: string }[] = [
  { value: 'door', label: 'Door', glyph: 'M4 18h6M10 18V8M10 18a10 10 0 0 0 10-10h-4' },
  {
    value: 'double-door',
    label: 'Double',
    glyph: 'M2 18h4M18 18h4M6 18V9M18 18V9M6 18a6 6 0 0 1 6-6M18 18a6 6 0 0 0-6-6',
  },
  { value: 'sliding-door', label: 'Sliding', glyph: 'M3 18h18M4 14h10M10 20h10' },
  { value: 'opening', label: 'Opening', glyph: 'M3 18h4M17 18h4M7 14v8M17 14v8' },
  { value: 'window', label: 'Window', glyph: 'M3 18h18M3 15h18M3 21h18M12 15v6' },
]
</script>

<template>
  <div v-if="editor.tool === 'opening'" class="picker" role="group" aria-label="Opening type">
    <span class="picker__label eyebrow">Click a wall to place</span>
    <div class="picker__options">
      <button
        v-for="kind in kinds"
        :key="kind.value"
        type="button"
        class="picker__option"
        :class="{ 'picker__option--on': editor.pendingOpeningKind === kind.value }"
        :aria-pressed="editor.pendingOpeningKind === kind.value"
        @click="editor.pendingOpeningKind = kind.value"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            :d="kind.glyph"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
        {{ kind.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-raised);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
}

.picker__label {
  white-space: nowrap;
}

.picker__options {
  display: flex;
  gap: 3px;
}

.picker__option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 54px;
  padding: 5px 2px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chalk-dim);
  font: inherit;
  font-size: 9.5px;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}

.picker__option:hover {
  color: var(--chalk);
  background: rgba(255, 255, 255, 0.05);
}

.picker__option--on {
  color: var(--blueprint-bright);
  border-color: rgba(90, 159, 201, 0.4);
  background: rgba(90, 159, 201, 0.12);
}

.picker__option svg {
  width: 22px;
  height: 22px;
}
</style>
