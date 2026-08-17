<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

/**
 * An angle in degrees, committed on blur or Enter — never on keystroke.
 *
 * The naive version binds straight to the model and rotates the wall on every
 * character typed: reaching for "45" swings it to 4° on the way, and clearing
 * the field to retype sends it to 0°, which quietly destroys the angle the
 * person was trying to adjust. Same contract as `LengthField`, for the same
 * reason.
 */

const props = withDefaults(
  defineProps<{
    modelValue: number
    label?: string
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const draft = ref('')
const focused = ref(false)
const invalid = ref(false)

const display = computed(() => {
  const rounded = Math.round(props.modelValue * 10) / 10
  // Keep whole degrees whole; nobody wants to read "90.0°".
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
})

watch(
  () => props.modelValue,
  () => {
    if (!focused.value) draft.value = display.value
  },
  { immediate: true },
)

function commit(): void {
  const text = draft.value.trim()
  // An empty box is a cleared field, not an instruction to set zero.
  if (text === '') {
    draft.value = display.value
    invalid.value = false
    return
  }

  const parsed = Number(text.replace(/°/g, '').trim())
  if (!Number.isFinite(parsed)) {
    invalid.value = true
    return
  }

  invalid.value = false
  emit('update:modelValue', parsed)
  // Resync after the model has actually changed, not before. Reading `display`
  // synchronously here gets the value from before the edit, so committing 45
  // would leave the box reading 0 over an item that had turned. Waiting a tick
  // also picks up any normalising the parent does — type 400 and see 40.
  void nextTick(() => {
    draft.value = display.value
  })
}

function onFocus(event: FocusEvent): void {
  focused.value = true
  ;(event.target as HTMLInputElement).select()
}

function onBlur(): void {
  focused.value = false
  commit()
  if (invalid.value) {
    draft.value = display.value
    invalid.value = false
  }
}

function onEnter(event: KeyboardEvent): void {
  commit()
  ;(event.target as HTMLInputElement).select()
}

function onEscape(event: KeyboardEvent): void {
  draft.value = display.value
  invalid.value = false
  ;(event.target as HTMLInputElement).blur()
}
</script>

<template>
  <v-text-field
    v-model="draft"
    :label="props.label"
    :disabled="props.disabled"
    :error="invalid"
    :messages="invalid ? 'Enter a number of degrees' : undefined"
    class="angle-field"
    autocomplete="off"
    spellcheck="false"
    @focus="onFocus"
    @blur="onBlur"
    @keydown.enter.prevent="onEnter"
    @keydown.esc.prevent="onEscape"
  />
</template>

<style scoped>
.angle-field :deep(input) {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  letter-spacing: -0.01em;
}
</style>
