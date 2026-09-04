<script setup>
import {computed} from "vue";

const props = defineProps({
  modelValue: {type: Number, required: true},
  disabled: {type: Boolean, default: false},
});
const emit = defineEmits(["update:modelValue"]);

const text = computed({
  get: () => String(props.modelValue),
  set: value => emit("update:modelValue", Number(value)),
});
</script>

<template>
  <v-text-field
      v-model="text"
      label="Tick length (ms)"
      hint="Real time per simulation tick"
      persistent-hint
      inputmode="numeric"
      autocomplete="off"
      :disabled="disabled"
  />
</template>
