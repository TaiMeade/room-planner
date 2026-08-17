<script setup lang="ts">
import {
  mdiCursorDefaultOutline,
  mdiDoorClosed,
  mdiHandBackRightOutline,
  mdiRulerSquare,
  mdiSelectionDrag,
  mdiVectorLine,
} from '@mdi/js'
import { computed } from 'vue'

import { useEditorStore } from '@/stores/editor'
import type { Tool } from '@/stores/editor'

/**
 * The tool rail.
 *
 * Five tools, each with a single-key shortcut, because in a drawing app you
 * switch tools constantly and reaching for a menu each time is the difference
 * between fluent and tedious.
 */

const editor = useEditorStore()

interface ToolSpec {
  id: Tool
  icon: string
  label: string
  shortcut: string
  hint: string
}

const tools: ToolSpec[] = [
  {
    id: 'select',
    icon: mdiCursorDefaultOutline,
    label: 'Select',
    shortcut: 'V',
    hint: 'Move walls, corners and furniture',
  },
  {
    id: 'pan',
    icon: mdiHandBackRightOutline,
    label: 'Pan',
    shortcut: 'H',
    hint: 'Drag to move around the plan. Right-drag or space-drag does this from any tool',
  },
  {
    id: 'wall',
    icon: mdiVectorLine,
    label: 'Wall',
    shortcut: 'W',
    hint: 'Click to start, click again to continue. Esc ends the run',
  },
  {
    id: 'room',
    icon: mdiSelectionDrag,
    label: 'Room',
    shortcut: 'R',
    hint: 'Drag a rectangle to lay four walls at once',
  },
  {
    id: 'opening',
    icon: mdiDoorClosed,
    label: 'Door or window',
    shortcut: 'D',
    hint: 'Click a wall to cut the selected opening into it',
  },
  {
    id: 'measure',
    icon: mdiRulerSquare,
    label: 'Measure',
    shortcut: 'M',
    hint: 'Drag to check a distance without changing anything',
  },
]

const active = computed(() => editor.tool)
</script>

<template>
  <nav class="rail" aria-label="Tools">
    <button
      v-for="tool in tools"
      :key="tool.id"
      type="button"
      class="rail__tool"
      :class="{ 'rail__tool--active': active === tool.id }"
      :aria-pressed="active === tool.id"
      :title="`${tool.label} (${tool.shortcut}) — ${tool.hint}`"
      @click="editor.setTool(tool.id)"
    >
      <svg viewBox="0 0 24 24" class="rail__icon" aria-hidden="true">
        <path :d="tool.icon" fill="currentColor" />
      </svg>
      <span class="rail__key mono">{{ tool.shortcut }}</span>
      <span class="sr-only">{{ tool.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: var(--rail);
  padding: 8px 0;
  background: var(--ink);
  border-right: 1px solid var(--ink-line);
}

.rail__tool {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  width: 42px;
  padding: 7px 0 5px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--chalk-dim);
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}

.rail__tool:hover {
  color: var(--chalk);
  background: rgba(255, 255, 255, 0.045);
}

.rail__tool--active {
  color: var(--ink);
  background: var(--blueprint-bright);
}

.rail__tool--active .rail__key {
  color: rgba(15, 21, 24, 0.62);
}

/* The active tool gets a bar bleeding off the rail's edge — the rail reads as a
   set of tabs into the drawing rather than a strip of buttons. */
.rail__tool--active::after {
  content: '';
  position: absolute;
  right: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  background: var(--blueprint-bright);
}

.rail__icon {
  width: 20px;
  height: 20px;
}

.rail__key {
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--chalk-faint);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
