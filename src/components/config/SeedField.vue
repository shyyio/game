<script setup>
import {computed} from "vue";
import {randomWorldSeed} from "@/common/WorldNoise.js";

// WORLD_SEED_MAX has ten digits; the mask lets nothing but digits in.
const SEED_MASK = "##########";

const props = defineProps({
  // null draws a random seed for a new world.
  modelValue: {type: Number, default: null},
  // The seed a saved world already has; shown to read and copy, not to edit.
  lockedTo: {type: Number, default: null},
});
const emit = defineEmits(["update:modelValue"]);

const locked = computed(() => props.lockedTo !== null);

const text = computed({
  get: () => {
    if (locked.value) {
      return String(props.lockedTo);
    }
    if (props.modelValue === null) {
      return "";
    }
    return String(props.modelValue);
  },
  set: value => {
    if (value === "") {
      emit("update:modelValue", null);
      return;
    }
    emit("update:modelValue", Number(value));
  },
});

function randomize() {
  emit("update:modelValue", randomWorldSeed());
}
</script>

<template>
  <v-mask-input
      v-model="text"
      :mask="SEED_MASK"
      variant="outlined"
      label="World seed"
      placeholder="Random"
      persistent-placeholder
      :hint="locked ? 'The saved world keeps its seed' : ''"
      :persistent-hint="locked"
      inputmode="numeric"
      autocomplete="off"
      :readonly="locked"
  >
    <template #append-inner>
      <v-btn v-if="!locked" variant="text" size="small" @click="randomize">Randomize</v-btn>
    </template>
  </v-mask-input>
</template>
